import { callGeminiJSON } from '../tools/gemini';
import { findFacultyPage, scrapeFacultyPage } from '../tools/browser';
import { searchAuthor, downloadOpenAccessPdf, type AcademicPaper } from '../tools/academic-api';
import { parsePDFBuffer } from '../tools/pdf';
import type { ProfessorProfile, Paper } from '../types';

/**
 * Professor Researcher Agent
 * Uses Semantic Scholar / OpenAlex APIs for papers
 * Uses browser only for faculty page scraping
 */
export async function researchProfessor(
  professorName: string,
  university: string,
  onStatus: (status: string) => void
): Promise<ProfessorProfile> {
  const sources: string[] = [];

  // Step 1: Search academic APIs for papers (no scraping!)
  onStatus('Searching academic databases...');
  const authorProfile = await searchAuthor(professorName, university);
  
  let papers: AcademicPaper[] = [];
  if (authorProfile) {
    papers = authorProfile.papers;
    console.log(`✅ Found ${papers.length} papers via API`);
    if (authorProfile.affiliation) {
      sources.push(`Academic Profile: ${authorProfile.affiliation}`);
    }
  }

  // Step 2: Find and scrape faculty page for bio, email, etc.
  onStatus('Searching for faculty page...');
  const facultyUrl = await findFacultyPage(professorName, university);
  
  let facultyInfo = {
    bio: '',
    researchInterests: [] as string[],
    email: null as string | null,
    labUrl: null as string | null,
    labName: null as string | null,
    openPositions: null as string | null,
  };

  if (facultyUrl) {
    sources.push(facultyUrl);
    onStatus('Extracting faculty page information...');
    facultyInfo = await scrapeFacultyPage(facultyUrl);
    console.log(`✅ Scraped faculty page, email: ${facultyInfo.email || 'not found'}`);
  }

  // Step 3: Download open access PDFs for context
  onStatus('Downloading open access papers...');
  const paperContents: Map<string, string> = new Map();
  
  // Only download papers that have open access PDFs
  const openAccessPapers = papers.filter(p => p.pdfUrl);
  console.log(`📚 ${openAccessPapers.length} papers have open access PDFs`);
  
  for (const paper of openAccessPapers.slice(0, 2)) {
    try {
      onStatus(`Downloading: ${paper.title.slice(0, 40)}...`);
      const pdfBuffer = await downloadOpenAccessPdf(paper.pdfUrl!);
      
      if (pdfBuffer) {
        const buffer = Buffer.from(pdfBuffer);
        const text = await parsePDFBuffer(buffer);
        if (text && text.length > 100) {
          paperContents.set(paper.title, text.slice(0, 5000));
          console.log(`✅ Extracted ${text.length} chars from: ${paper.title.slice(0, 50)}`);
        }
      }
    } catch (error) {
      console.log(`⚠️ Could not process paper: ${paper.title.slice(0, 30)}`);
    }
  }

  // Step 4: Use Gemini to synthesize the profile
  onStatus('Analyzing professor profile...');

  // Build paper content section
  let paperContentSection = '';
  if (paperContents.size > 0) {
    paperContentSection = '\n\nDOWNLOADED PAPER CONTENTS:';
    for (const [title, content] of paperContents) {
      paperContentSection += `\n\n--- "${title}" ---\n${content.slice(0, 2500)}`;
    }
  }

  const papersDescription = papers
    .slice(0, 8)
    .map((p, i) => `${i + 1}. "${p.title}" (${p.year}) - ${p.citationCount} citations\n   ${p.abstract?.slice(0, 200) || 'No abstract'}`)
    .join('\n');

  const synthesisPrompt = `Based on the following information, create a comprehensive professor profile.

PROFESSOR NAME: ${professorName}
UNIVERSITY: ${university}

FACULTY PAGE INFO:
Email: ${facultyInfo.email || 'Not found'}
Lab: ${facultyInfo.labName || 'Not mentioned'}
Open Positions: ${facultyInfo.openPositions || 'Not mentioned'}
Bio: ${facultyInfo.bio.slice(0, 2000) || 'Not available'}

ACADEMIC RECORD (from Semantic Scholar/OpenAlex):
${authorProfile ? `
- Total Papers: ${authorProfile.paperCount}
- Total Citations: ${authorProfile.citationCount}
- H-Index: ${authorProfile.hIndex || 'Unknown'}
- Affiliation: ${authorProfile.affiliation || university}
` : 'Not found'}

RECENT PAPERS:
${papersDescription || 'No papers found'}
${paperContentSection}

Create a JSON profile:
{
  "name": "${professorName}",
  "title": "Their academic title",
  "university": "${university}",
  "department": "Department name",
  "email": ${facultyInfo.email ? `"${facultyInfo.email}"` : 'null'},
  "emailSource": ${facultyUrl ? `"${facultyUrl}"` : 'null'},
  "researchInterests": ["List 3-5 main research areas based on papers"],
  "recentPapers": [
    {
      "title": "Paper title",
      "year": 2024,
      "abstract": "Key contribution",
      "url": "Paper URL",
      "venue": "Journal/Conference"
    }
  ],
  "currentProjects": ["Inferred from recent papers"],
  "labInfo": "${facultyInfo.labName || 'Unknown'}",
  "labUrl": ${facultyInfo.labUrl ? `"${facultyInfo.labUrl}"` : 'null'},
  "openPositions": ${facultyInfo.openPositions ? `"${facultyInfo.openPositions.slice(0, 200)}"` : 'null'}
}

Include max 5 most relevant recent papers. Be accurate.`;

  const profile = await callGeminiJSON<ProfessorProfile>(synthesisPrompt, {
    useProModel: true,
  });

  // Add sources
  profile.sources = sources;

  // Ensure papers have proper structure with downloaded content
  if (!profile.recentPapers || profile.recentPapers.length === 0) {
    profile.recentPapers = papers.slice(0, 5).map((p) => ({
      title: p.title,
      year: p.year,
      abstract: p.abstract || '',
      url: p.url,
      venue: p.venue,
      pdfUrl: p.pdfUrl,
    }));
  }

  // Add fullText to papers
  profile.recentPapers = profile.recentPapers.map((paper: Paper) => {
    const content = paperContents.get(paper.title);
    if (content) {
      return { ...paper, fullText: content };
    }
    // Also check if we have the paper in our API results
    const apiPaper = papers.find(p => p.title === paper.title);
    if (apiPaper?.pdfUrl) {
      return { ...paper, pdfUrl: apiPaper.pdfUrl };
    }
    return paper;
  });

  onStatus('Professor research complete');

  return profile;
}
