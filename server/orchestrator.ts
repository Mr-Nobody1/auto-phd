import type {
  UserInput,
  SharedContext,
  AgentStatus,
  GenerationResult,
} from './types';
import { parseCV } from './agents/cv-parser';
import { researchProfessor } from './agents/professor-researcher';
import { analyzeFit } from './agents/fit-analyzer';
import { writeEmail } from './agents/email-writer';
import { recommendCVChanges } from './agents/cv-recommender';
import { writeMotivationLetter } from './agents/motivation-writer';
import { writeResearchProposal } from './agents/proposal-writer';

export type StatusCallback = (status: AgentStatus) => void;

const AGENTS = [
  { step: 1, name: 'CV Parser', key: 'cvParser' },
  { step: 2, name: 'Professor Researcher', key: 'professorResearcher' },
  { step: 3, name: 'Fit Analyzer', key: 'fitAnalyzer' },
  { step: 4, name: 'Email Writer', key: 'emailWriter' },
  { step: 5, name: 'CV Recommender', key: 'cvRecommender' },
  { step: 6, name: 'Motivation Letter Writer', key: 'motivationWriter' },
  { step: 7, name: 'Research Proposal Writer', key: 'proposalWriter' },
];

/**
 * Orchestrator - coordinates all agents and manages pipeline state
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

    // ========== Step 2: Research Professor ==========
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

    // ========== Step 3: Analyze Fit ==========
    updateStatus(3, { status: 'running', currentAction: 'Analyzing research fit...' });

    context.fitAnalysis = await analyzeFit(
      context.userProfile!,
      context.professorProfile!,
      input.researchInterests,
      (action) => {
        updateStatus(3, { currentAction: action });
      }
    );

    updateStatus(3, {
      status: 'complete',
      currentAction: `Fit: ${context.fitAnalysis.overallFit}`,
      progress: 100,
      output: context.fitAnalysis,
    });

    // ========== Step 4: Write Email ==========
    updateStatus(4, { status: 'running', currentAction: 'Crafting personalized email...' });

    context.email = await writeEmail(
      context.userProfile!,
      context.professorProfile!,
      context.fitAnalysis!,
      input,
      (action) => {
        updateStatus(4, { currentAction: action });
      }
    );

    updateStatus(4, {
      status: 'complete',
      currentAction: `${context.email.wordCount} words`,
      progress: 100,
      output: context.email,
    });

    // ========== Step 5: CV Recommendations ==========
    updateStatus(5, { status: 'running', currentAction: 'Analyzing CV for recommendations...' });

    context.cvRecommendations = await recommendCVChanges(
      cvText,
      context.userProfile!,
      context.professorProfile!,
      context.fitAnalysis!,
      (action) => {
        updateStatus(5, { currentAction: action });
      }
    );

    updateStatus(5, {
      status: 'complete',
      currentAction: `${context.cvRecommendations.updates.length} updates suggested`,
      progress: 100,
      output: context.cvRecommendations,
    });

    // ========== Step 6: Motivation Letter ==========
    updateStatus(6, { status: 'running', currentAction: 'Writing motivation letter...' });

    context.motivationLetter = await writeMotivationLetter(
      context.userProfile!,
      context.professorProfile!,
      context.fitAnalysis!,
      context.email!,
      input,
      (action) => {
        updateStatus(6, { currentAction: action });
      }
    );

    updateStatus(6, {
      status: 'complete',
      currentAction: `${context.motivationLetter.wordCount} words`,
      progress: 100,
      output: context.motivationLetter,
    });

    // ========== Step 7: Research Proposal ==========
    updateStatus(7, { status: 'running', currentAction: 'Drafting research proposal...' });

    context.researchProposal = await writeResearchProposal(
      context.userProfile!,
      context.professorProfile!,
      context.fitAnalysis!,
      input,
      (action) => {
        updateStatus(7, { currentAction: action });
      }
    );

    updateStatus(7, {
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
