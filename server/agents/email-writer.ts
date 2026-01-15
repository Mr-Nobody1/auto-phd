import { callGeminiJSON } from '../tools/gemini';
import type {
  EmailOutput,
  UserProfile,
  ProfessorProfile,
  FitAnalysis,
  UserInput,
} from '../types';

/**
 * Email Writer Agent
 * Crafts a highly personalized cold email
 */
export async function writeEmail(
  userProfile: UserProfile,
  professorProfile: ProfessorProfile,
  fitAnalysis: FitAnalysis,
  input: UserInput,
  onStatus: (status: string) => void
): Promise<EmailOutput> {
  onStatus('Preparing email context...');

  const language = input.customLanguage || input.language;
  const fundingText =
    input.fundingStatus === 'seeking_funding'
      ? 'funding opportunities'
      : input.fundingStatus === 'fully_funded'
        ? 'fully funded PhD positions'
        : 'PhD positions';

  const prompt = `You are writing a PhD inquiry email. Take your time to craft something exceptional that could change someone's career.

FULL CONTEXT:

APPLICANT:
- Name: ${userProfile.name}
- Education: ${userProfile.education.map((e) => `${e.degree} from ${e.institution} (${e.year})`).join('; ')}
- Experience: ${userProfile.experience.map((e) => `${e.title} at ${e.organization}: ${e.description}`).join('; ')}
- Publications: ${userProfile.publications.map((p) => `${p.title} (${p.venue}, ${p.year})`).join('; ') || 'None yet'}
- Skills: ${userProfile.skills.join(', ')}
- Summary: ${userProfile.summary}

PROFESSOR:
- Name: ${professorProfile.name}
- Title: ${professorProfile.title}
- University: ${professorProfile.university}
- Department: ${professorProfile.department}
- Research: ${professorProfile.researchInterests.join(', ')}
- Lab: ${professorProfile.labInfo}
- Email: ${professorProfile.email || 'Not found'}

FIT ANALYSIS:
- Overall Fit: ${fitAnalysis.overallFit}
- Key Overlaps: ${fitAnalysis.keyOverlaps.join('; ')}
- Suggested Angle: ${fitAnalysis.suggestedAngle}

PAPER TO REFERENCE:
- Title: "${fitAnalysis.bestPaperToReference.title}"
- Year: ${fitAnalysis.bestPaperToReference.year}
- Abstract/Relevance: ${fitAnalysis.bestPaperToReference.abstract}
- URL: ${fitAnalysis.bestPaperToReference.url}

USER PREFERENCES:
- Language: ${language}
- Looking for: ${fundingText}
- Preferred Start: ${input.preferredStart}
- Research Interests: ${input.researchInterests}

REQUIREMENTS:
1. Length: 200-250 words (strict)
2. Language: ${language}
3. Must include:
   - Opening that shows genuine familiarity with their SPECIFIC work (not generic praise)
   - Reference to "${fitAnalysis.bestPaperToReference.title}" with a thoughtful observation or question
   - Brief applicant background (2-3 sentences max, highlight MOST relevant experience)
   - A potential research direction connecting their work and applicant's interests
   - Question about ${fundingText}
   - Clear call to action (request 15-20 min video call)

TONE:
- Professional but personable
- Confident but not arrogant
- Specific, never generic
- Shows you've done your homework

ABSOLUTELY AVOID:
- "passionate", "deeply inspired", "esteemed", "renowned"
- Excessive flattery or superlatives
- Generic phrases like "I came across your work"
- Begging or desperate tone
- Long paragraphs

Return as JSON:
{
  "subjectOptions": [
    "Subject line 1 - concise and professional",
    "Subject line 2 - slightly different angle",
    "Subject line 3 - alternative approach"
  ],
  "body": "The complete email body",
  "wordCount": 225,
  "referencedPaper": {
    "title": "${fitAnalysis.bestPaperToReference.title}",
    "url": "${fitAnalysis.bestPaperToReference.url}"
  },
  "effectivenessNote": "Brief note on what makes this email effective"
}`;

  onStatus('Crafting opening paragraph...');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  onStatus('Referencing specific research...');
  await new Promise((resolve) => setTimeout(resolve, 1000));

  onStatus('Writing body paragraphs...');

  const email = await callGeminiJSON<EmailOutput>(prompt, {
    useProModel: true,
    temperature: 0.7,
  });

  onStatus('Generating subject line variants...');

  // Validate word count
  const words = email.body.split(/\s+/).length;
  email.wordCount = words;

  // Ensure referenced paper is set
  if (!email.referencedPaper) {
    email.referencedPaper = {
      title: fitAnalysis.bestPaperToReference.title,
      url: fitAnalysis.bestPaperToReference.url,
    };
  }

  onStatus('Email draft complete');

  return email;
}
