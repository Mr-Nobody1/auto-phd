import { callGemini } from '../tools/gemini';
import type {
  ResearchProposalOutput,
  UserProfile,
  ProfessorProfile,
  FitAnalysis,
  UserInput,
} from '../types';

/**
 * Research Proposal Writer Agent
 * Creates a detailed research proposal aligned with professor's work
 */
export async function writeResearchProposal(
  userProfile: UserProfile,
  professorProfile: ProfessorProfile,
  fitAnalysis: FitAnalysis,
  input: UserInput,
  onStatus: (status: string) => void
): Promise<ResearchProposalOutput> {
  onStatus('Analyzing research landscape...');

  const language = input.customLanguage || input.language;

  const prompt = `Write a research proposal for a PhD application. This should demonstrate the applicant's ability to think like a researcher and propose original work that builds on the professor's research.

FULL CONTEXT:

APPLICANT BACKGROUND:
- Name: ${userProfile.name}
- Education: ${userProfile.education.map((e) => `${e.degree} from ${e.institution} (${e.year})${e.thesis ? `, Thesis: "${e.thesis}"` : ''}`).join('\n  ')}
- Research Experience:
  ${userProfile.experience.map((e) => `• ${e.title} at ${e.organization} (${e.dates}):\n    ${e.description}\n    Skills: ${e.skills.join(', ')}`).join('\n  ')}
- Publications: 
  ${userProfile.publications.map((p) => `• ${p.title} (${p.venue}, ${p.year}) - ${p.role}`).join('\n  ') || 'None yet'}
- Technical Skills: ${userProfile.skills.join(', ')}
- Stated Research Interests: ${input.researchInterests}

PROFESSOR'S RESEARCH:
- Name: ${professorProfile.name}
- University: ${professorProfile.university}
- Research Areas: ${professorProfile.researchInterests.join(', ')}
- Lab: ${professorProfile.labInfo}
- Recent Papers (IMPORTANT - build on these):
  ${professorProfile.recentPapers.map((p) => `• "${p.title}" (${p.year})\n    ${p.abstract || 'No abstract available'}`).join('\n  ')}

FIT ANALYSIS:
- Key Overlaps: ${fitAnalysis.keyOverlaps.join('; ')}
- Suggested Research Angle: ${fitAnalysis.suggestedAngle}
- Best Paper to Build On: "${fitAnalysis.bestPaperToReference.title}"

STRUCTURE (1500-2000 words):

## 1. TITLE
Create a specific, informative, academic-style title

## 2. ABSTRACT (150-200 words)
- Research problem
- Proposed approach
- Expected contributions

## 3. INTRODUCTION & MOTIVATION (300-400 words)
- Research problem and its significance
- Current state of the field
- Limitations of existing approaches
- Why this matters now
- Reference 2-3 of the professor's papers to show you understand their work

## 4. RESEARCH QUESTIONS (100-150 words)
- 2-3 specific, answerable research questions
- How they connect to professor's existing work
- What gaps they address

## 5. PROPOSED METHODOLOGY (400-500 words)
- Research approach and methods
- Why these methods are appropriate
- Technical approach (if applicable)
- Data sources or datasets
- Evaluation metrics
- Timeline (rough phases over 3-4 year PhD)

## 6. EXPECTED CONTRIBUTIONS (200-250 words)
- Scientific contributions
- Practical applications
- How this advances the professor's research agenda
- Broader impact

## 7. PRELIMINARY WORK (100-150 words)
- Relevant experience from the CV
- Any pilot work or related projects
- How existing skills apply

## 8. REFERENCES
- Include the professor's papers you referenced
- Include 3-5 other relevant literature

IMPORTANT GUIDELINES:
- Propose something REALISTIC and feasible for a PhD
- Show you understand both technical details AND big picture
- Connect to professor's work WITHOUT just repeating it
- Bring a FRESH perspective from your unique background
- Be specific about methods and timeline
- Language: ${language}

Write the complete research proposal now.`;

  onStatus('Defining research questions...');
  await new Promise((resolve) => setTimeout(resolve, 2000));

  onStatus('Developing methodology...');
  await new Promise((resolve) => setTimeout(resolve, 2000));

  onStatus('Outlining expected contributions...');
  await new Promise((resolve) => setTimeout(resolve, 2000));

  onStatus('Writing proposal sections...');

  const proposalText = await callGemini(prompt, {
    useProModel: true,
    temperature: 0.6,
    maxTokens: 4000,
  });

  onStatus('Extracting references...');

  // Parse the proposal
  const parsed = parseProposal(proposalText);

  onStatus('Research proposal complete');

  return parsed;
}

/**
 * Parse proposal text into structured format
 */
function parseProposal(text: string): ResearchProposalOutput {
  const lines = text.split('\n');
  let title = '';
  let abstract = '';
  const sections: { heading: string; content: string }[] = [];
  const references: string[] = [];

  let currentSection = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    // Check for section headers
    const sectionMatch = line.match(/^#+ \d*\.?\s*(.+)/);
    if (sectionMatch) {
      // Save previous section
      if (currentSection && currentContent.length > 0) {
        const content = currentContent.join('\n').trim();
        if (currentSection.toLowerCase().includes('abstract')) {
          abstract = content;
        } else if (currentSection.toLowerCase().includes('reference')) {
          // Parse references
          content.split('\n').forEach((ref) => {
            const trimmed = ref.replace(/^[-•*]\s*/, '').trim();
            if (trimmed) {
              references.push(trimmed);
            }
          });
        } else {
          sections.push({ heading: currentSection, content });
        }
      }

      currentSection = sectionMatch[1]?.trim() || '';
      currentContent = [];
    } else {
      // Check if this is the title (first non-header line with content)
      if (title === '' && line.trim() && !line.startsWith('#')) {
        title = line.trim();
      } else {
        currentContent.push(line);
      }
    }
  }

  // Save last section
  if (currentSection && currentContent.length > 0) {
    const content = currentContent.join('\n').trim();
    if (currentSection.toLowerCase().includes('reference')) {
      content.split('\n').forEach((ref) => {
        const trimmed = ref.replace(/^[-•*]\s*/, '').trim();
        if (trimmed) {
          references.push(trimmed);
        }
      });
    } else {
      sections.push({ heading: currentSection, content });
    }
  }

  // Extract title from first section if not found
  if (!title && sections.length > 0) {
    const firstSection = sections[0];
    if (firstSection) {
      const firstContent = firstSection.content;
      const firstLine = firstContent.split('\n')[0];
      if (firstLine && firstLine.length < 200) {
        title = firstLine;
      }
    }
  }

  const wordCount = text.split(/\s+/).length;

  return {
    title: title || 'Research Proposal',
    abstract: abstract || sections.find((s) => s.heading.toLowerCase().includes('abstract'))?.content || '',
    sections,
    references,
    wordCount,
  };
}
