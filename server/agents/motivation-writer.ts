import { callGemini } from '../tools/gemini';
import type {
  MotivationLetterOutput,
  UserProfile,
  ProfessorProfile,
  FitAnalysis,
  EmailOutput,
  UserInput,
} from '../types';

/**
 * Motivation Letter Writer Agent
 * Creates a comprehensive, tailored motivation letter
 */
export async function writeMotivationLetter(
  userProfile: UserProfile,
  professorProfile: ProfessorProfile,
  fitAnalysis: FitAnalysis,
  email: EmailOutput,
  input: UserInput,
  onStatus: (status: string) => void
): Promise<MotivationLetterOutput> {
  onStatus('Structuring motivation letter...');

  const language = input.customLanguage || input.language;

  const prompt = `Write a motivation letter for a PhD application. This is one of the most important documents in the application.

FULL CONTEXT:

APPLICANT:
- Name: ${userProfile.name}
- Education: ${userProfile.education.map((e) => `${e.degree} from ${e.institution} (${e.year})${e.gpa ? `, GPA: ${e.gpa}` : ''}${e.thesis ? `, Thesis: ${e.thesis}` : ''}`).join('\n  ')}
- Experience: 
  ${userProfile.experience.map((e) => `• ${e.title} at ${e.organization} (${e.dates}): ${e.description}`).join('\n  ')}
- Publications: ${userProfile.publications.map((p) => `${p.title} (${p.venue}, ${p.year})`).join('; ') || 'None yet'}
- Skills: ${userProfile.skills.join(', ')}
- Summary: ${userProfile.summary}
- Stated Research Interests: ${input.researchInterests}

PROFESSOR:
- Name: ${professorProfile.name}
- Title: ${professorProfile.title}
- University: ${professorProfile.university}
- Department: ${professorProfile.department}
- Research Areas: ${professorProfile.researchInterests.join(', ')}
- Lab: ${professorProfile.labInfo}
- Recent Papers: 
  ${professorProfile.recentPapers.map((p) => `• "${p.title}" (${p.year})`).join('\n  ')}

FIT ANALYSIS:
- Overall Fit: ${fitAnalysis.overallFit}
- Key Overlaps: ${fitAnalysis.keyOverlaps.join('; ')}
- Gaps to Address: ${fitAnalysis.gaps.join('; ')}
- Suggested Angle: ${fitAnalysis.suggestedAngle}

THE EMAIL ALREADY WRITTEN (motivation letter should complement, not repeat):
${email.body}

USER PREFERENCES:
- Language: ${language}
- Funding Status: ${input.fundingStatus}
- Preferred Start: ${input.preferredStart}

STRUCTURE (600-800 words total):

1. OPENING (1 paragraph, ~80 words)
   - Why this specific program and professor
   - Hook with connection to their research

2. ACADEMIC BACKGROUND (1-2 paragraphs, ~120 words)
   - Relevant coursework, grades, and academic achievements
   - How your education prepared you for PhD research

3. RESEARCH EXPERIENCE (2 paragraphs, ~200 words)
   - Detail your most relevant research experiences
   - Specific contributions, skills developed, results
   - Show you can do independent research

4. RESEARCH INTERESTS & FIT (1-2 paragraphs, ~150 words)
   - Your research vision and questions
   - How it connects to professor's work
   - Specific papers or projects you want to build on

5. WHY THIS UNIVERSITY/LAB (1 paragraph, ~100 words)
   - Specific resources, collaborators, or facilities
   - What you'll bring to the lab
   - Why this is the right environment for your research

6. CLOSING (1 paragraph, ~80 words)
   - Career goals
   - Reiterate fit and enthusiasm
   - Thank them for consideration

TONE:
- Scholarly and mature
- Shows deep thinking about research
- Specific and evidence-based
- Confident but not arrogant
- Professional but engaging

IMPORTANT:
- Show, don't tell (instead of "I am passionate", describe actions that show passion)
- Be specific with examples from your experience
- Connect everything back to the professor's research
- Address any gaps identified in the fit analysis
- Language: ${language}

Write the complete motivation letter now. Output ONLY the letter text, properly formatted with clear paragraphs.`;

  onStatus('Writing opening paragraph...');
  await new Promise((resolve) => setTimeout(resolve, 1500));

  onStatus('Detailing academic background...');
  await new Promise((resolve) => setTimeout(resolve, 1500));

  onStatus('Describing research experience...');
  await new Promise((resolve) => setTimeout(resolve, 1500));

  onStatus('Articulating research vision...');

  const letterText = await callGemini(prompt, {
    useProModel: true,
    temperature: 0.7,
    maxTokens: 2000,
  });

  onStatus('Finalizing motivation letter...');

  // Parse sections from the letter
  const sections = parseSections(letterText);
  const wordCount = letterText.split(/\s+/).length;

  onStatus('Motivation letter complete');

  return {
    letter: letterText.trim(),
    wordCount,
    sections,
  };
}

/**
 * Parse letter into sections
 */
function parseSections(letter: string): { name: string; content: string }[] {
  const sections: { name: string; content: string }[] = [];
  const paragraphs = letter.split(/\n\n+/);

  const sectionNames = [
    'Opening',
    'Academic Background',
    'Research Experience',
    'Research Interests',
    'Why This University',
    'Closing',
  ];

  paragraphs.forEach((p, i) => {
    const trimmed = p.trim();
    if (trimmed) {
      sections.push({
        name: sectionNames[i] || `Paragraph ${i + 1}`,
        content: trimmed,
      });
    }
  });

  return sections;
}
