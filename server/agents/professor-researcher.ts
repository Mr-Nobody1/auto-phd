import { callGeminiJSON } from '../tools/gemini';
import {
  findFacultyPage,
  findScholarProfile,
  scrapeUrl,
  scrapeScholarPapers,
  searchGoogleScholar,
} from '../tools/browser';
import type { ProfessorProfile } from '../types';

/**
 * Professor Researcher Agent
 * Researches professor's work, papers, and contact info
 */
export async function researchProfessor(
  professorName: string,
  university: string,
  onStatus: (status: string) => void
): Promise<ProfessorProfile> {
  const sources: string[] = [];
  let facultyPageContent = '';
  let scholarPapers: { title: string; year: string; citations: string; url: string }[] = [];

  // Step 1: Find and scrape faculty page
  onStatus('Searching for faculty page...');
  const facultyUrl = await findFacultyPage(professorName, university);

  if (facultyUrl) {
    sources.push(facultyUrl);
    onStatus(`Found faculty page, extracting information...`);
    try {
      facultyPageContent = await scrapeUrl(facultyUrl);
    } catch (error) {
      console.error('Failed to scrape faculty page:', error);
      facultyPageContent = '';
    }
  }

  // Step 2: Find Google Scholar profile and papers
  onStatus('Searching Google Scholar...');
  const scholarUrl = await findScholarProfile(professorName);

  if (scholarUrl) {
    sources.push(scholarUrl);
    onStatus('Extracting recent publications...');
    try {
      scholarPapers = await scrapeScholarPapers(scholarUrl, 8);
    } catch (error) {
      console.error('Failed to scrape scholar papers:', error);
    }
  }

  // Step 3: If no Scholar results, try direct search
  if (scholarPapers.length === 0) {
    onStatus('Searching for papers directly...');
    const searchResults = await searchGoogleScholar(`author:"${professorName}"`, 5);
    scholarPapers = searchResults.map((r) => ({
      title: r.title,
      year: '',
      citations: '',
      url: r.url,
    }));
  }

  // Step 4: Use Gemini to synthesize the profile
  onStatus('Analyzing professor profile...');

  const synthesisPrompt = `Based on the following information about a professor, create a comprehensive research profile.

PROFESSOR NAME: ${professorName}
UNIVERSITY: ${university}

FACULTY PAGE CONTENT:
${facultyPageContent.slice(0, 4000) || 'Not available'}

GOOGLE SCHOLAR PAPERS:
${scholarPapers.map((p) => `- ${p.title} (${p.year}) - ${p.citations} citations`).join('\n') || 'Not available'}

Create a JSON profile with this structure:
{
  "name": "${professorName}",
  "title": "Their academic title (e.g., Associate Professor)",
  "university": "${university}",
  "department": "Their department name",
  "email": "Their email if found, or null",
  "emailSource": "URL where email was found, or null",
  "researchInterests": ["List of 3-5 main research areas"],
  "recentPapers": [
    {
      "title": "Paper title",
      "year": 2024,
      "abstract": "Brief description or key contribution",
      "url": "Paper URL if available",
      "venue": "Conference or journal name if known"
    }
  ],
  "currentProjects": ["Any mentioned ongoing projects or grants"],
  "labInfo": "Brief description of their lab or research group",
  "labUrl": "Lab website URL if found",
  "openPositions": "Any mentioned PhD positions or opportunities, or null"
}

Be accurate - only include information that can be inferred from the provided content.
For papers, include only the most recent and relevant ones (max 5).
If information is not available, use null or empty arrays.`;

  const profile = await callGeminiJSON<ProfessorProfile>(synthesisPrompt, {
    useProModel: true,
  });

  // Add sources
  profile.sources = sources;

  // Ensure papers have proper structure
  if (!profile.recentPapers || profile.recentPapers.length === 0) {
    profile.recentPapers = scholarPapers.slice(0, 5).map((p) => ({
      title: p.title,
      year: parseInt(p.year) || new Date().getFullYear(),
      abstract: '',
      url: p.url,
      venue: '',
    }));
  }

  onStatus('Professor research complete');

  return profile;
}
