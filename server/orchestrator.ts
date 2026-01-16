import type {
  UserInput,
  SharedContext,
  AgentStatus,
  GenerationResult,
  PaperContext,
  PaperCandidate,
  AdditionalPaperResult,
} from './types';
import { parseCV } from './agents/cv-parser';
import { researchProfessor } from './agents/professor-researcher';
import { selectPapers, shouldContinueGathering, suggestAdditionalPapers } from './agents/paper-selector';
import { analyzeFit } from './agents/fit-analyzer';
import { writeEmail } from './agents/email-writer';
import { recommendCVChanges } from './agents/cv-recommender';
import { writeMotivationLetter } from './agents/motivation-writer';
import { writeResearchProposal } from './agents/proposal-writer';
import { downloadOpenAccessPdf, searchPaperByTitle } from './tools/academic-api';
import { parsePDFBuffer } from './tools/pdf';

export type StatusCallback = (status: AgentStatus) => void;

// Configuration for the paper selection loop
const PAPER_CONFIG = {
  maxPapers: 5,       // Maximum professor papers to download
  maxIterations: 5,   // Maximum selection iterations
  maxAdditionalPapers: 3,     // Maximum additional papers beyond professor's
  maxAdditionalIterations: 3, // Maximum iterations for additional paper suggestions
};

const AGENTS = [
  { step: 1, name: 'CV Parser', key: 'cvParser' },
  { step: 2, name: 'Professor Researcher', key: 'professorResearcher' },
  { step: 3, name: 'Paper Selector', key: 'paperSelector' },  // New agent
  { step: 4, name: 'Fit Analyzer', key: 'fitAnalyzer' },
  { step: 5, name: 'Email Writer', key: 'emailWriter' },
  { step: 6, name: 'CV Recommender', key: 'cvRecommender' },
  { step: 7, name: 'Motivation Letter Writer', key: 'motivationWriter' },
  { step: 8, name: 'Research Proposal Writer', key: 'proposalWriter' },
];

/**
 * Enhanced Orchestrator with AI-driven paper selection loop
 */
export async function runPipeline(
  input: UserInput,
  cvText: string,
  onStatus: StatusCallback
): Promise<GenerationResult> {
  const context: SharedContext = { input };
  const startTime = Date.now();

  // Initialize all agents as pending
  const agentStatuses: Map<number, AgentStatus> = new Map();
  AGENTS.forEach((agent) => {
    agentStatuses.set(agent.step, {
      step: agent.step,
      name: agent.name,
      status: 'pending',
      currentAction: 'Waiting...',
      progress: 0,
      timeElapsed: 0,
    });
  });

  const updateStatus = (step: number, update: Partial<AgentStatus>) => {
    const current = agentStatuses.get(step)!;
    const updated = {
      ...current,
      ...update,
      timeElapsed: Math.floor((Date.now() - startTime) / 1000),
    };
    agentStatuses.set(step, updated);
    onStatus(updated);
  };

  try {
    // ========== Step 1: Parse CV ==========
    updateStatus(1, { status: 'running', currentAction: 'Starting CV analysis...' });

    context.userProfile = await parseCV(cvText, (action) => {
      updateStatus(1, { currentAction: action });
    });

    updateStatus(1, {
      status: 'complete',
      currentAction: 'Extracted profile',
      progress: 100,
      output: context.userProfile,
    });

    // ========== Step 2: Research Professor (Basic Info + Paper List) ==========
    updateStatus(2, { status: 'running', currentAction: 'Starting professor research...' });

    context.professorProfile = await researchProfessor(
      input.professorName,
      input.university,
      (action) => {
        updateStatus(2, { currentAction: action });
      }
    );

    updateStatus(2, {
      status: 'complete',
      currentAction: `Found ${context.professorProfile.recentPapers.length} papers`,
      progress: 100,
      output: context.professorProfile,
    });

    // ========== Step 3: AI-Driven Paper Selection Loop ==========
    updateStatus(3, { status: 'running', currentAction: 'Initializing paper selection...' });

    // Initialize paper context
    const paperContext: PaperContext = {
      availablePapers: context.professorProfile.recentPapers.map((p) => ({
        title: p.title,
        year: p.year,
        abstract: p.abstract,
        url: p.url,
        pdfUrl: p.pdfUrl,
        citationCount: 0, // Default, could be enhanced
        venue: p.venue,
      })),
      downloadedContent: new Map(),
      selectionHistory: [],
      totalDownloaded: 0,
      maxPapers: PAPER_CONFIG.maxPapers,
    };

    // Check if we already have downloaded content from professor-researcher
    for (const paper of context.professorProfile.recentPapers) {
      if (paper.fullText) {
        paperContext.downloadedContent.set(paper.title, paper.fullText);
        paperContext.totalDownloaded++;
      }
    }

    console.log(`📊 Starting paper selection with ${paperContext.totalDownloaded} already downloaded`);

    // Paper selection loop
    let iteration = 0;
    while (iteration < PAPER_CONFIG.maxIterations) {
      iteration++;
      updateStatus(3, { 
        currentAction: `Paper selection iteration ${iteration}/${PAPER_CONFIG.maxIterations}...` 
      });

      // Ask AI which papers to download
      const decision = await selectPapers(
        context.userProfile!,
        input.researchInterests,
        paperContext,
        (action) => updateStatus(3, { currentAction: action })
      );

      // Store decision history
      paperContext.selectionHistory.push(decision);

      // Download selected papers
      for (const paperToDownload of decision.papersToDownload) {
        if (paperContext.totalDownloaded >= PAPER_CONFIG.maxPapers) {
          console.log('📚 Reached max paper limit');
          break;
        }

        try {
          updateStatus(3, { 
            currentAction: `Downloading: ${paperToDownload.title.slice(0, 35)}...` 
          });

          const pdfBuffer = await downloadOpenAccessPdf(paperToDownload.pdfUrl);
          
          if (pdfBuffer) {
            const buffer = Buffer.from(pdfBuffer);
            const text = await parsePDFBuffer(buffer);
            
            if (text && text.length > 100) {
              paperContext.downloadedContent.set(paperToDownload.title, text.slice(0, 5000));
              paperContext.totalDownloaded++;
              console.log(`✅ Downloaded paper #${paperContext.totalDownloaded}: ${paperToDownload.title.slice(0, 40)}`);

              // Update professor profile with downloaded content
              const paperIndex = context.professorProfile!.recentPapers.findIndex(
                p => p.title.toLowerCase() === paperToDownload.title.toLowerCase()
              );
              if (paperIndex >= 0 && context.professorProfile!.recentPapers[paperIndex]) {
                context.professorProfile!.recentPapers[paperIndex].fullText = text.slice(0, 5000);
              }
            }
          }
        } catch (error) {
          console.log(`⚠️ Failed to download: ${paperToDownload.title.slice(0, 30)}`);
        }
      }

      // Check if we should continue
      if (!decision.shouldSearchMore) {
        console.log('📚 AI decided no more papers needed');
        break;
      }

      // Additional check with the evaluation function
      const continueResult = await shouldContinueGathering(
        context.userProfile!,
        input.researchInterests,
        paperContext,
        iteration,
        PAPER_CONFIG.maxIterations,
        (action) => updateStatus(3, { currentAction: action })
      );

      if (!continueResult.shouldContinue) {
        console.log(`📚 Stopping: ${continueResult.reason}`);
        break;
      }

      console.log(`📚 Continue gathering: ${continueResult.reason}`);
    }

    // ========== Step 3b: Additional Papers Loop ==========
    // AI suggests, searches, and downloads additional relevant papers
    console.log('\n📚 === ADDITIONAL PAPERS SEARCH ===' );
    updateStatus(3, { currentAction: 'Searching for additional relevant papers...' });

    const allDownloadedPapers = Array.from(paperContext.downloadedContent.keys());
    const additionalPaperResults: AdditionalPaperResult[] = [];
    let additionalDownloaded = 0;
    let additionalIteration = 0;

    while (
      additionalIteration < PAPER_CONFIG.maxAdditionalIterations &&
      additionalDownloaded < PAPER_CONFIG.maxAdditionalPapers
    ) {
      additionalIteration++;
      console.log(`\n📚 Additional papers iteration ${additionalIteration}/${PAPER_CONFIG.maxAdditionalIterations}`);

      // Ask AI to suggest additional papers (with feedback from previous attempts)
      const additionalDecision = await suggestAdditionalPapers(
        context.userProfile!,
        input.researchInterests,
        allDownloadedPapers,
        additionalPaperResults,
        (action) => updateStatus(3, { currentAction: action })
      );

      // If AI suggests no more papers, we're done
      if (additionalDecision.suggestedPapers.length === 0) {
        console.log('📚 AI decided no additional papers needed');
        break;
      }

      // Search and download each suggested paper
      for (const suggestion of additionalDecision.suggestedPapers) {
        if (additionalDownloaded >= PAPER_CONFIG.maxAdditionalPapers) {
          console.log('📚 Reached max additional papers limit');
          break;
        }

        updateStatus(3, {
          currentAction: `Searching: ${suggestion.title.slice(0, 35)}...`,
        });

        const result: AdditionalPaperResult = {
          suggestion,
          success: false,
        };

        try {
          // Search for the paper on OpenAlex
          const foundPaper = await searchPaperByTitle(suggestion.title, suggestion.keywords);

          if (!foundPaper || !foundPaper.pdfUrl) {
            result.error = 'Paper not found or no open access PDF available';
            console.log(`⚠️ Not found: "${suggestion.title.slice(0, 40)}..."`);
          } else {
            // Download the PDF
            updateStatus(3, {
              currentAction: `Downloading: ${foundPaper.title.slice(0, 35)}...`,
            });

            const pdfBuffer = await downloadOpenAccessPdf(foundPaper.pdfUrl);

            if (pdfBuffer) {
              const buffer = Buffer.from(pdfBuffer);
              const text = await parsePDFBuffer(buffer);

              if (text && text.length > 100) {
                // Success! Add to downloaded content
                paperContext.downloadedContent.set(foundPaper.title, text.slice(0, 5000));
                allDownloadedPapers.push(foundPaper.title);
                additionalDownloaded++;

                result.success = true;
                result.paper = {
                  title: foundPaper.title,
                  year: foundPaper.year,
                  abstract: foundPaper.abstract,
                  pdfUrl: foundPaper.pdfUrl,
                };
                result.contentExtracted = true;

                console.log(`✅ Downloaded additional paper: "${foundPaper.title.slice(0, 40)}..."`);
              } else {
                result.error = 'Could not extract text from PDF';
                console.log(`⚠️ Text extraction failed: "${foundPaper.title.slice(0, 40)}..."`);
              }
            } else {
              result.error = 'PDF download failed';
              console.log(`⚠️ PDF download failed: "${foundPaper.title.slice(0, 40)}..."`);
            }
          }
        } catch (error) {
          result.error = String(error);
          console.log(`⚠️ Error processing: "${suggestion.title.slice(0, 40)}..."`);
        }

        additionalPaperResults.push(result);
      }

      // Check if AI wants to suggest more
      if (!additionalDecision.shouldSuggestMore) {
        console.log('📚 AI is satisfied with additional papers');
        break;
      }
    }

    console.log(`\n📊 Additional papers summary:`);
    console.log(`   - Downloaded: ${additionalDownloaded}`);
    console.log(`   - Failed: ${additionalPaperResults.filter(r => !r.success).length}`);
    console.log(`   - Iterations: ${additionalIteration}`);

    updateStatus(3, {
      status: 'complete',
      currentAction: `Downloaded ${paperContext.totalDownloaded} professor + ${additionalDownloaded} additional papers`,
      progress: 100,
      output: {
        totalDownloaded: paperContext.totalDownloaded,
        additionalDownloaded,
        iterations: iteration,
        papers: Array.from(paperContext.downloadedContent.keys()),
        additionalResults: additionalPaperResults,
      },
    });

    // ========== Step 4: Analyze Fit ==========
    updateStatus(4, { status: 'running', currentAction: 'Analyzing research fit...' });

    context.fitAnalysis = await analyzeFit(
      context.userProfile!,
      context.professorProfile!,
      input,
      (action) => {
        updateStatus(4, { currentAction: action });
      }
    );

    updateStatus(4, {
      status: 'complete',
      currentAction: `Fit: ${context.fitAnalysis.overallFit}`,
      progress: 100,
      output: context.fitAnalysis,
    });

    // ========== Step 5: Write Email ==========
    updateStatus(5, { status: 'running', currentAction: 'Crafting personalized email...' });

    context.email = await writeEmail(
      context.userProfile!,
      context.professorProfile!,
      context.fitAnalysis!,
      input,
      (action) => {
        updateStatus(5, { currentAction: action });
      }
    );

    updateStatus(5, {
      status: 'complete',
      currentAction: `${context.email.wordCount} words`,
      progress: 100,
      output: context.email,
    });

    // ========== Step 6: CV Recommendations ==========
    updateStatus(6, { status: 'running', currentAction: 'Analyzing CV for recommendations...' });

    context.cvRecommendations = await recommendCVChanges(
      cvText,
      context.userProfile!,
      context.professorProfile!,
      context.fitAnalysis!,
      (action) => {
        updateStatus(6, { currentAction: action });
      }
    );

    updateStatus(6, {
      status: 'complete',
      currentAction: `${context.cvRecommendations.updates.length} updates suggested`,
      progress: 100,
      output: context.cvRecommendations,
    });

    // ========== Step 7: Motivation Letter ==========
    updateStatus(7, { status: 'running', currentAction: 'Writing motivation letter...' });

    context.motivationLetter = await writeMotivationLetter(
      context.userProfile!,
      context.professorProfile!,
      context.fitAnalysis!,
      context.email!,
      input,
      (action) => {
        updateStatus(7, { currentAction: action });
      }
    );

    updateStatus(7, {
      status: 'complete',
      currentAction: `${context.motivationLetter.wordCount} words`,
      progress: 100,
      output: context.motivationLetter,
    });

    // ========== Step 8: Research Proposal ==========
    updateStatus(8, { status: 'running', currentAction: 'Drafting research proposal...' });

    context.researchProposal = await writeResearchProposal(
      context.userProfile!,
      context.professorProfile!,
      context.fitAnalysis!,
      input,
      (action) => {
        updateStatus(8, { currentAction: action });
      }
    );

    updateStatus(8, {
      status: 'complete',
      currentAction: `${context.researchProposal.wordCount} words`,
      progress: 100,
      output: context.researchProposal,
    });

    // ========== Done ==========
    return {
      success: true,
      email: context.email,
      cvRecommendations: context.cvRecommendations,
      motivationLetter: context.motivationLetter,
      researchProposal: context.researchProposal,
      professorProfile: context.professorProfile,
      fitAnalysis: context.fitAnalysis,
    };
  } catch (error) {
    console.error('Pipeline error:', error);

    // Find which step failed
    for (const agent of AGENTS) {
      const status = agentStatuses.get(agent.step);
      if (status?.status === 'running') {
        updateStatus(agent.step, {
          status: 'error',
          currentAction: `Error: ${error}`,
          error: String(error),
        });
        break;
      }
    }

    return {
      success: false,
      error: String(error),
      // Return partial results if available
      email: context.email,
      cvRecommendations: context.cvRecommendations,
      motivationLetter: context.motivationLetter,
      researchProposal: context.researchProposal,
      professorProfile: context.professorProfile,
      fitAnalysis: context.fitAnalysis,
    };
  }
}
