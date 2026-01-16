import { callGeminiJSON } from '../tools/gemini';
import type { 
  UserProfile, 
  PaperCandidate, 
  PaperSelectionDecision,
  PaperContext,
  AdditionalPaperSuggestion,
  AdditionalPaperResult,
  AdditionalPapersDecision
} from '../types';

/**
 * Paper Selection Agent
 * Uses AI to intelligently decide which papers to download based on:
 * 1. Relevance to user's research interests
 * 2. Recency (prefer last 3 years)
 * 3. Open access availability (has PDF URL)
 * 4. Citation count (quality signal)
 * 5. What's already been downloaded
 */
export async function selectPapers(
  userProfile: UserProfile,
  researchInterests: string,
  paperContext: PaperContext,
  onStatus: (status: string) => void
): Promise<PaperSelectionDecision> {
  onStatus('Analyzing available papers...');

  // Filter papers that haven't been downloaded and have PDF URLs
  const candidatePapers = paperContext.availablePapers.filter(
    (p) => p.pdfUrl && !paperContext.downloadedContent.has(p.title)
  );

  // If no papers available to download, return early
  if (candidatePapers.length === 0) {
    return {
      papersToDownload: [],
      papersToSkip: [],
      shouldSearchMore: paperContext.totalDownloaded < 2, // Need at least 2 papers
      searchSuggestions: paperContext.totalDownloaded < 2 
        ? ['Try searching for the professor name with different keywords']
        : undefined,
      reasoning: 'No more papers with open access PDFs available to download.',
    };
  }

  // Calculate how many more papers we can download
  const remainingSlots = paperContext.maxPapers - paperContext.totalDownloaded;
  
  if (remainingSlots <= 0) {
    return {
      papersToDownload: [],
      papersToSkip: candidatePapers.map((p) => ({ 
        title: p.title, 
        reason: 'Maximum paper limit reached' 
      })),
      shouldSearchMore: false,
      reasoning: `Already downloaded ${paperContext.maxPapers} papers (maximum limit).`,
    };
  }

  onStatus(`Evaluating ${candidatePapers.length} candidate papers...`);

  // Build context about already downloaded papers
  const downloadedPapersList = Array.from(paperContext.downloadedContent.keys());
  const downloadedContext = downloadedPapersList.length > 0
    ? `Already downloaded papers:\n${downloadedPapersList.map((t, i) => `${i + 1}. "${t}"`).join('\n')}`
    : 'No papers downloaded yet.';

  const prompt = `You are a research assistant helping a PhD applicant. Your task is to select which academic papers to download for deeper analysis.

APPLICANT PROFILE:
- Name: ${userProfile.name}
- Skills: ${userProfile.skills.join(', ')}
- Education: ${userProfile.education.map((e) => `${e.degree} from ${e.institution}`).join('; ')}
- Publications: ${userProfile.publications.map((p) => p.title).join('; ') || 'None'}
- Research Interests: ${researchInterests}

${downloadedContext}

AVAILABLE PAPERS TO CONSIDER:
${candidatePapers.slice(0, 10).map((p, i) => `
${i + 1}. "${p.title}" (${p.year})
   - Citations: ${p.citationCount}
   - Venue: ${p.venue || 'Unknown'}
   - Has PDF: ${p.pdfUrl ? 'Yes' : 'No'}
   - Abstract: ${p.abstract?.slice(0, 200) || 'Not available'}...
`).join('\n')}

CONSTRAINTS:
- You can select up to ${remainingSlots} more paper(s) to download
- Total papers already downloaded: ${paperContext.totalDownloaded}
- Maximum papers allowed: ${paperContext.maxPapers}
- Prefer recent papers (last 3 years)
- Prefer papers relevant to the applicant's research interests and skills
- Prefer papers with higher citation counts (indicates quality)

Respond with a JSON object:
{
  "papersToDownload": [
    {
      "title": "Exact paper title",
      "pdfUrl": "URL",
      "reason": "Brief explanation of why this paper is relevant",
      "priority": "high" | "medium" | "low"
    }
  ],
  "papersToSkip": [
    {
      "title": "Paper title",
      "reason": "Why this paper is not a good fit"
    }
  ],
  "shouldSearchMore": boolean (true if we need more relevant papers),
  "searchSuggestions": ["Optional keywords to search for more papers"],
  "reasoning": "Overall explanation of selection strategy"
}

Select papers that will help the applicant demonstrate genuine interest and knowledge in their email and research proposal.`;

  try {
    const decision = await callGeminiJSON<PaperSelectionDecision>(prompt, {
      useProModel: true,
      temperature: 0.3,
    });

    // Validate response
    if (!decision.papersToDownload) {
      decision.papersToDownload = [];
    }
    if (!decision.papersToSkip) {
      decision.papersToSkip = [];
    }
    if (typeof decision.shouldSearchMore !== 'boolean') {
      decision.shouldSearchMore = false;
    }
    if (!decision.reasoning) {
      decision.reasoning = 'Paper selection completed.';
    }

    // Map AI-selected papers to actual candidates (use ACTUAL PDF URLs, not AI-generated ones)
    const validatedPapers: Array<{
      title: string;
      pdfUrl: string;
      reason: string;
      priority: 'high' | 'medium' | 'low';
    }> = [];
    
    for (const aiPaper of decision.papersToDownload) {
      // Find the actual candidate paper by title (fuzzy match)
      const candidate = candidatePapers.find(c => 
        c.title.toLowerCase().includes(aiPaper.title.toLowerCase().slice(0, 30)) ||
        aiPaper.title.toLowerCase().includes(c.title.toLowerCase().slice(0, 30))
      );
      
      if (candidate && candidate.pdfUrl && candidate.pdfUrl.startsWith('http')) {
        validatedPapers.push({
          title: candidate.title, // Use actual title
          pdfUrl: candidate.pdfUrl, // Use ACTUAL PDF URL from candidate
          reason: aiPaper.reason || 'Selected by AI',
          priority: aiPaper.priority || 'medium',
        });
      } else {
        console.log(`⚠️ Paper not found or no valid URL: ${aiPaper.title}`);
      }
    }
    
    decision.papersToDownload = validatedPapers;

    // Limit to remaining slots
    decision.papersToDownload = decision.papersToDownload.slice(0, remainingSlots);

    // Log decision
    console.log(`📚 Paper Selection Decision:
  - To download: ${decision.papersToDownload.length}
  - Skipped: ${decision.papersToSkip.length}
  - Need more: ${decision.shouldSearchMore}
  - Reasoning: ${decision.reasoning}`);

    onStatus(`Selected ${decision.papersToDownload.length} papers to download`);

    return decision;
  } catch (error) {
    console.error('Paper selection error:', error);
    
    // Fallback: select the most recent papers with highest citations
    const sorted = candidatePapers
      .sort((a, b) => {
        // Score = recency (weight 2) + citations (weight 1)
        const scoreA = (a.year - 2020) * 2 + Math.log10(a.citationCount + 1);
        const scoreB = (b.year - 2020) * 2 + Math.log10(b.citationCount + 1);
        return scoreB - scoreA;
      })
      .slice(0, remainingSlots);

    return {
      papersToDownload: sorted.map((p) => ({
        title: p.title,
        pdfUrl: p.pdfUrl!,
        reason: 'Fallback selection based on recency and citations',
        priority: 'medium' as const,
      })),
      papersToSkip: [],
      shouldSearchMore: false,
      reasoning: 'Fallback selection due to AI error.',
    };
  }
}

/**
 * Evaluate if we should continue gathering more papers
 */
export async function shouldContinueGathering(
  userProfile: UserProfile,
  researchInterests: string,
  paperContext: PaperContext,
  currentIteration: number,
  maxIterations: number,
  onStatus: (status: string) => void
): Promise<{ shouldContinue: boolean; reason: string }> {
  // Hard limits
  if (currentIteration >= maxIterations) {
    return { 
      shouldContinue: false, 
      reason: `Reached maximum iteration limit (${maxIterations})` 
    };
  }

  if (paperContext.totalDownloaded >= paperContext.maxPapers) {
    return { 
      shouldContinue: false, 
      reason: `Downloaded maximum papers (${paperContext.maxPapers})` 
    };
  }

  // If we have less than 2 papers, definitely need more
  if (paperContext.totalDownloaded < 2) {
    return { 
      shouldContinue: true, 
      reason: 'Need at least 2 papers for comprehensive analysis' 
    };
  }

  onStatus('Evaluating if more papers are needed...');

  // Build summary of downloaded papers
  const downloadedSummary = Array.from(paperContext.downloadedContent.entries())
    .map(([title, content]) => `- "${title}": ${content.slice(0, 200)}...`)
    .join('\n');

  const prompt = `You are helping a PhD applicant prepare materials for a professor. 

APPLICANT'S RESEARCH INTERESTS:
${researchInterests}

APPLICANT'S SKILLS:
${userProfile.skills.join(', ')}

PAPERS ALREADY DOWNLOADED:
${downloadedSummary || 'None yet'}

QUESTION: Do we have enough relevant papers to write a compelling, specific email and research proposal?

Consider:
1. Do the downloaded papers cover the applicant's research interests?
2. Are there enough papers to show deep engagement with the professor's work?
3. Is there diversity in the papers (different aspects of research)?

Respond with JSON:
{
  "shouldContinue": boolean,
  "reason": "Brief explanation"
}`;

  try {
    const result = await callGeminiJSON<{ shouldContinue: boolean; reason: string }>(prompt, {
      useProModel: false, // Use Flash for quick decisions
      temperature: 0.2,
    });

    return {
      shouldContinue: result.shouldContinue ?? false,
      reason: result.reason ?? 'Assessment complete',
    };
  } catch (error) {
    console.error('Continue decision error:', error);
    // Default: don't continue if we have at least some papers
    return {
      shouldContinue: paperContext.totalDownloaded < 2,
      reason: 'Default decision based on paper count',
    };
  }
}

/**
 * Suggest additional relevant papers beyond the professor's publications
 * The AI receives feedback about previous download attempts to improve suggestions
 */
export async function suggestAdditionalPapers(
  userProfile: UserProfile,
  researchInterests: string,
  downloadedPapers: string[],
  previousResults: AdditionalPaperResult[],
  onStatus: (status: string) => void
): Promise<AdditionalPapersDecision> {
  onStatus('AI analyzing for additional relevant papers...');

  // Build feedback section from previous attempts
  let feedbackSection = '';
  if (previousResults.length > 0) {
    feedbackSection = '\n\nPREVIOUS SEARCH RESULTS:\n';
    for (const result of previousResults) {
      if (result.success) {
        feedbackSection += `✅ SUCCESS: "${result.suggestion.title}" - Found and downloaded\n`;
      } else {
        feedbackSection += `❌ FAILED: "${result.suggestion.title}" - ${result.error || 'Not found on OpenAlex'}\n`;
      }
    }
    feedbackSection += '\nUse this feedback to improve your suggestions. Avoid suggesting papers that are likely unavailable.';
  }

  const prompt = `You are a research assistant helping a PhD applicant find additional relevant papers to read.

APPLICANT PROFILE:
- Name: ${userProfile.name}
- Skills: ${userProfile.skills.join(', ')}
- Research Interests: ${researchInterests}
- Publications: ${userProfile.publications.map((p) => p.title).join('; ') || 'None'}

ALREADY DOWNLOADED PAPERS:
${downloadedPapers.length > 0 ? downloadedPapers.map((t, i) => `${i + 1}. "${t}"`).join('\n') : 'None yet'}
${feedbackSection}

TASK: Suggest up to 3 additional HIGHLY RELEVANT research papers that would help the applicant:
1. Understand the research area better
2. Find potential research directions
3. Demonstrate knowledge in their outreach emails

IMPORTANT GUIDELINES:
- Suggest REAL, well-known papers that are likely to be found in academic databases (OpenAlex, arXiv, ACL Anthology)
- Prefer papers from top venues (NeurIPS, ICML, ACL, CVPR, Nature, Science, etc.)
- Prefer papers from the last 5 years for relevance
- Prefer papers that are likely to have open access PDFs (arXiv, conference proceedings)
- Do NOT suggest papers similar to ones that already failed to download

Respond with JSON:
{
  "suggestedPapers": [
    {
      "title": "Exact or close paper title",
      "keywords": ["optional", "search", "keywords"],
      "reason": "Why this paper is relevant"
    }
  ],
  "reasoning": "Why these papers were chosen and how they complement existing downloads",
  "shouldSuggestMore": boolean (true if more papers would be helpful after these)
}

If no more papers are needed (enough context already), return empty suggestedPapers array.`;

  try {
    const decision = await callGeminiJSON<AdditionalPapersDecision>(prompt, {
      useProModel: true,
      temperature: 0.4,
    });

    // Validate response
    if (!decision.suggestedPapers) {
      decision.suggestedPapers = [];
    }
    if (!decision.reasoning) {
      decision.reasoning = 'Additional paper suggestions generated.';
    }
    if (typeof decision.shouldSuggestMore !== 'boolean') {
      decision.shouldSuggestMore = false;
    }

    // Limit to 3 suggestions
    decision.suggestedPapers = decision.suggestedPapers.slice(0, 3);

    console.log(`📚 AI Additional Paper Suggestions:
  - Suggested: ${decision.suggestedPapers.length}
  - Should suggest more: ${decision.shouldSuggestMore}
  - Reasoning: ${decision.reasoning}`);

    if (decision.suggestedPapers.length > 0) {
      decision.suggestedPapers.forEach((p, i) => {
        console.log(`   ${i + 1}. "${p.title}" - ${p.reason}`);
      });
    }

    onStatus(`AI suggested ${decision.suggestedPapers.length} additional papers`);

    return decision;
  } catch (error) {
    console.error('Additional paper suggestion error:', error);
    return {
      suggestedPapers: [],
      reasoning: 'Error generating suggestions.',
      shouldSuggestMore: false,
    };
  }
}

