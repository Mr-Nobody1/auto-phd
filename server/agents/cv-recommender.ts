import { callGeminiJSON } from '../tools/gemini';
import type {
  CVRecommendations,
  UserProfile,
  ProfessorProfile,
  FitAnalysis,
} from '../types';

/**
 * CV Recommender Agent
 * Provides detailed recommendations for tailoring CV to specific professor
 */
export async function recommendCVChanges(
  cvText: string,
  userProfile: UserProfile,
  professorProfile: ProfessorProfile,
  fitAnalysis: FitAnalysis,
  onStatus: (status: string) => void
): Promise<CVRecommendations> {
  onStatus('Analyzing current CV structure...');

  const prompt = `You are a PhD application advisor reviewing a CV for a specific professor. Provide detailed, actionable recommendations.

APPLICANT'S CURRENT CV:
${cvText.slice(0, 6000)}

PARSED CV INFORMATION:
- Name: ${userProfile.name}
- Education: ${JSON.stringify(userProfile.education)}
- Experience: ${JSON.stringify(userProfile.experience)}
- Publications: ${JSON.stringify(userProfile.publications)}
- Skills: ${userProfile.skills.join(', ')}

PROFESSOR THEY'RE APPLYING TO:
- Name: ${professorProfile.name}
- University: ${professorProfile.university}
- Research Areas: ${professorProfile.researchInterests.join(', ')}
- Recent Work: ${professorProfile.recentPapers.map((p) => p.title).join('; ')}

FIT ANALYSIS:
- Overall Fit: ${fitAnalysis.overallFit}
- Key Overlaps: ${fitAnalysis.keyOverlaps.join('; ')}
- Gaps: ${fitAnalysis.gaps.join('; ')}
- Suggested Angle: ${fitAnalysis.suggestedAngle}

Provide DETAILED CV recommendations as JSON:
{
  "updates": [
    {
      "section": "Section name (e.g., 'Research Experience')",
      "currentText": "Exact current text from the CV (quote it)",
      "suggestedText": "The revised text you recommend",
      "reason": "Why this change helps for THIS professor",
      "priority": "high" | "medium" | "low"
    }
  ],
  "keepAsIs": [
    {
      "section": "Section that's already strong",
      "reason": "Why it works well for this application"
    }
  ],
  "removeOrDeemphasize": [
    {
      "section": "Section to minimize or remove",
      "reason": "Why it's not helping this specific application"
    }
  ],
  "formatSuggestions": [
    "Any structural or formatting improvements"
  ]
}

REQUIREMENTS:
1. Provide at least 3-5 specific updates with EXACT text suggestions
2. Be specific - quote current text and provide replacement text
3. Focus on aligning with professor's research areas
4. Prioritize changes that emphasize relevant skills and experience
5. Consider the gaps identified in the fit analysis
6. Keep suggestions truthful - don't add skills or experience they don't have

Remember: The goal is to EMPHASIZE and FRAME existing experience better, not to fabricate.`;

  onStatus('Identifying priority sections to update...');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  onStatus('Generating specific text recommendations...');

  const recommendations = await callGeminiJSON<CVRecommendations>(prompt, {
    useProModel: true,
    temperature: 0.4,
  });

  onStatus('Prioritizing changes...');

  // Validate the response
  if (!recommendations.updates) {
    recommendations.updates = [];
  }
  if (!recommendations.keepAsIs) {
    recommendations.keepAsIs = [];
  }
  if (!recommendations.removeOrDeemphasize) {
    recommendations.removeOrDeemphasize = [];
  }
  if (!recommendations.formatSuggestions) {
    recommendations.formatSuggestions = [];
  }

  onStatus('CV recommendations complete');

  return recommendations;
}
