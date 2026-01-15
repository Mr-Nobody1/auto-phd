import { callGeminiJSON } from '../tools/gemini';
import type { UserProfile } from '../types';

/**
 * CV Parser Agent
 * Extracts structured information from user's CV
 */
export async function parseCV(
  cvText: string,
  onStatus: (status: string) => void
): Promise<UserProfile> {
  onStatus('Analyzing CV structure...');

  const prompt = `Analyze this CV/resume and extract structured information.

CV TEXT:
${cvText}

Extract and return as JSON with this exact structure:
{
  "name": "Full name of the person",
  "education": [
    {
      "degree": "Degree name (e.g., MSc Computer Science)",
      "institution": "University/Institution name",
      "year": 2024,
      "gpa": "GPA if mentioned (e.g., 3.8/4.0)",
      "thesis": "Thesis title if mentioned"
    }
  ],
  "experience": [
    {
      "title": "Job/Position title",
      "organization": "Company/Institution",
      "dates": "Date range (e.g., Jan 2023 - Present)",
      "description": "Key responsibilities and achievements",
      "skills": ["skill1", "skill2"]
    }
  ],
  "publications": [
    {
      "title": "Publication title",
      "venue": "Journal/Conference name",
      "year": 2024,
      "role": "first_author or co_author"
    }
  ],
  "skills": ["List of technical skills mentioned"],
  "summary": "A 2-3 sentence professional summary of this candidate"
}

Be thorough - extract ALL education, experience, and publications. This information will be used to write PhD application materials.
If a field is not found in the CV, use empty array [] or empty string "".`;

  onStatus('Extracting education and experience...');

  const profile = await callGeminiJSON<UserProfile>(prompt);

  onStatus('Identifying skills and publications...');

  // Validate the response has required fields
  if (!profile.name) {
    profile.name = 'Applicant';
  }
  if (!profile.education) {
    profile.education = [];
  }
  if (!profile.experience) {
    profile.experience = [];
  }
  if (!profile.publications) {
    profile.publications = [];
  }
  if (!profile.skills) {
    profile.skills = [];
  }
  if (!profile.summary) {
    profile.summary = 'PhD applicant with research experience.';
  }

  onStatus('CV analysis complete');

  return profile;
}
