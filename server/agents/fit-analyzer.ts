import { callGeminiJSON } from '../tools/gemini';
import type { FitAnalysis, UserProfile, ProfessorProfile, UserInput } from '../types';

/**
 * Fit Analyzer Agent
 * Analyzes fit between user and professor/posting, selects best paper to reference
 */
export async function analyzeFit(
  userProfile: UserProfile,
  professorProfile: ProfessorProfile,
  input: UserInput,
  onStatus: (status: string) => void
): Promise<FitAnalysis> {
  onStatus('Comparing research backgrounds...');

  const prompt = `Analyze the fit between this PhD applicant and professor. This analysis will guide all application materials.

APPLICANT PROFILE:
Name: ${userProfile.name}
Education: ${userProfile.education.map((e) => `${e.degree} from ${e.institution} (${e.year})`).join('; ')}
Experience: ${userProfile.experience.map((e) => `${e.title} at ${e.organization}`).join('; ')}
Publications: ${userProfile.publications.map((p) => `${p.title} (${p.venue}, ${p.year})`).join('; ') || 'None listed'}
Skills: ${userProfile.skills.join(', ')}
Summary: ${userProfile.summary}

USER'S STATED RESEARCH INTERESTS:
${input.researchInterests}

ADDITIONAL NOTES:
${input.additionalNotes || 'N/A'}

PHD / JOB POSTING CONTENT (If available):
${input.postingContent || 'N/A'}

PROFESSOR PROFILE:
Name: ${professorProfile.name}
Title: ${professorProfile.title}
University: ${professorProfile.university}
Department: ${professorProfile.department}
Research Interests: ${professorProfile.researchInterests.join(', ')}
Lab Info: ${professorProfile.labInfo}
Open Positions: ${professorProfile.openPositions || 'Not specified'}

RECENT PAPERS:
${professorProfile.recentPapers
  .map((p, i) => {
    let paperInfo = `${i + 1}. "${p.title}" (${p.year})${p.abstract ? ` - ${p.abstract}` : ''}`;
    // Include full text excerpt if available for more detailed analysis
    if (p.fullText) {
      paperInfo += `\n   PAPER CONTENT EXCERPT: ${p.fullText.slice(0, 1500)}...`;
    }
    return paperInfo;
  })
  .join('\n')}

Provide a detailed fit analysis as JSON:
{
  "overallFit": "high" | "medium" | "low",
  "keyOverlaps": [
    "Specific overlap area 1 with evidence from both profiles",
    "Specific overlap area 2 with evidence",
    "Specific overlap area 3 with evidence"
  ],
  "gaps": [
    "Any gaps the applicant should address in their application"
  ],
  "bestPaperToReference": {
    "title": "The paper title that best connects to applicant's background",
    "year": 2024,
    "abstract": "Why this paper is relevant to the applicant",
    "url": "Paper URL if available",
    "venue": "Where it was published"
  },
  "suggestedAngle": "The most compelling narrative for why this applicant should work with this professor (2-3 sentences)"
}

Choose the bestPaperToReference carefully - it should be:
1. Recent (ideally last 2-3 years)
2. Directly relevant to the applicant's skills or stated interests
3. Something the applicant can genuinely engage with in their email

Be specific with evidence. Generic statements are not helpful.`;

  onStatus('Identifying key research overlaps...');

  const analysis = await callGeminiJSON<FitAnalysis>(prompt, {
    useProModel: true,
    temperature: 0.3,
  });

  onStatus('Selecting best paper to reference...');

  // Validate the analysis
  if (!analysis.overallFit) {
    analysis.overallFit = 'medium';
  }
  if (!analysis.keyOverlaps || analysis.keyOverlaps.length === 0) {
    analysis.keyOverlaps = ['Research area alignment identified'];
  }
  if (!analysis.gaps) {
    analysis.gaps = [];
  }
  if (!analysis.bestPaperToReference) {
    const firstPaper = professorProfile.recentPapers[0];
    if (firstPaper) {
      analysis.bestPaperToReference = firstPaper;
    } else {
      // Provide a default paper if none exist
      analysis.bestPaperToReference = {
        title: 'Recent research',
        year: new Date().getFullYear(),
        abstract: 'Professor research area',
        url: '',
        venue: '',
      };
    }
  }
  if (!analysis.suggestedAngle) {
    const skills = userProfile.skills.length > 0 ? userProfile.skills.slice(0, 3).join(', ') : 'relevant skills';
    const interests = professorProfile.researchInterests.length > 0 
      ? professorProfile.researchInterests.slice(0, 2).join(' and ') 
      : 'their research area';
    analysis.suggestedAngle = `The applicant's background in ${skills} aligns with ${professorProfile.name}'s research in ${interests}.`;
  }

  onStatus('Fit analysis complete');

  return analysis;
}
