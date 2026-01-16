/**
 * Academic APIs - Semantic Scholar & OpenAlex
 * No scraping required, free APIs with open access PDF links
 */

// ============ Types ============

export interface AcademicPaper {
  title: string;
  year: number;
  abstract: string;
  authors: string[];
  venue: string;
  citationCount: number;
  url: string;
  pdfUrl?: string; // Open access PDF if available
  doi?: string;
}

export interface AuthorProfile {
  name: string;
  authorId: string;
  affiliation?: string;
  paperCount: number;
  citationCount: number;
  hIndex?: number;
  papers: AcademicPaper[];
}

// ============ Semantic Scholar API ============
// Docs: https://api.semanticscholar.org/api-docs/

const SEMANTIC_SCHOLAR_API = 'https://api.semanticscholar.org/graph/v1';

/**
 * Search for an author by name on Semantic Scholar
 */
export async function searchAuthorSemanticScholar(
  authorName: string,
  affiliation?: string
): Promise<AuthorProfile | null> {
  try {
    // Search for author
    const searchQuery = affiliation ? `${authorName} ${affiliation}` : authorName;
    const searchUrl = `${SEMANTIC_SCHOLAR_API}/author/search?query=${encodeURIComponent(searchQuery)}&limit=5`;
    
    console.log(`🔍 Semantic Scholar: Searching for "${searchQuery}"...`);
    
    const searchRes = await fetch(searchUrl, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!searchRes.ok) {
      console.log(`⚠️ Semantic Scholar search failed: ${searchRes.status}`);
      return null;
    }
    
    const searchData = await searchRes.json() as { data: { authorId: string; name: string }[] };
    
    if (!searchData.data || searchData.data.length === 0) {
      console.log(`⚠️ No authors found for "${authorName}"`);
      return null;
    }
    
    // Get first matching author (could improve with affiliation matching)
    const authorId = searchData.data[0].authorId;
    console.log(`✅ Found author ID: ${authorId}`);
    
    // Get author details with papers
    const authorUrl = `${SEMANTIC_SCHOLAR_API}/author/${authorId}?fields=name,affiliations,paperCount,citationCount,hIndex,papers.title,papers.year,papers.abstract,papers.venue,papers.citationCount,papers.url,papers.openAccessPdf,papers.externalIds`;
    
    const authorRes = await fetch(authorUrl, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!authorRes.ok) {
      console.log(`⚠️ Failed to get author details: ${authorRes.status}`);
      return null;
    }
    
    const authorData = await authorRes.json() as {
      name: string;
      authorId: string;
      affiliations?: string[];
      paperCount: number;
      citationCount: number;
      hIndex?: number;
      papers?: {
        title: string;
        year: number;
        abstract: string;
        venue: string;
        citationCount: number;
        url: string;
        openAccessPdf?: { url: string };
        externalIds?: { DOI?: string };
      }[];
    };
    
    // Transform papers
    const papers: AcademicPaper[] = (authorData.papers || [])
      .filter(p => p.year) // Filter out papers without year
      .sort((a, b) => (b.year || 0) - (a.year || 0)) // Sort by year descending
      .slice(0, 10) // Top 10 recent papers
      .map(p => ({
        title: p.title,
        year: p.year,
        abstract: p.abstract || '',
        authors: [], // Would need separate call to get full author list
        venue: p.venue || '',
        citationCount: p.citationCount || 0,
        url: p.url,
        pdfUrl: p.openAccessPdf?.url,
        doi: p.externalIds?.DOI,
      }));
    
    console.log(`✅ Found ${papers.length} papers, ${papers.filter(p => p.pdfUrl).length} with open access PDFs`);
    
    return {
      name: authorData.name,
      authorId: authorData.authorId,
      affiliation: authorData.affiliations?.[0],
      paperCount: authorData.paperCount,
      citationCount: authorData.citationCount,
      hIndex: authorData.hIndex,
      papers,
    };
  } catch (error) {
    console.error('Semantic Scholar API error:', error);
    return null;
  }
}

// ============ OpenAlex API ============
// Docs: https://docs.openalex.org/

const OPENALEX_API = 'https://api.openalex.org';

/**
 * Search for an author by name on OpenAlex (fallback)
 */
export async function searchAuthorOpenAlex(
  authorName: string,
  affiliation?: string
): Promise<AuthorProfile | null> {
  try {
    // Search for author
    const searchUrl = `${OPENALEX_API}/authors?search=${encodeURIComponent(authorName)}&per_page=5`;
    
    console.log(`🔍 OpenAlex: Searching for "${authorName}"...`);
    
    const searchRes = await fetch(searchUrl, {
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'PhDApply/1.0 (mailto:contact@example.com)' // OpenAlex asks for this
      }
    });
    
    if (!searchRes.ok) {
      console.log(`⚠️ OpenAlex search failed: ${searchRes.status}`);
      return null;
    }
    
    const searchData = await searchRes.json() as { 
      results: { 
        id: string; 
        display_name: string;
        last_known_institution?: { display_name: string };
        works_count: number;
        cited_by_count: number;
        summary_stats?: { h_index: number };
      }[] 
    };
    
    if (!searchData.results || searchData.results.length === 0) {
      console.log(`⚠️ No authors found on OpenAlex`);
      return null;
    }
    
    // Find best match (optionally by affiliation)
    let author = searchData.results[0];
    if (affiliation) {
      const affiliationLower = affiliation.toLowerCase();
      const matchingAuthor = searchData.results.find(a => 
        a.last_known_institution?.display_name?.toLowerCase().includes(affiliationLower)
      );
      if (matchingAuthor) author = matchingAuthor;
    }
    
    console.log(`✅ Found author: ${author.display_name} (${author.last_known_institution?.display_name || 'Unknown affiliation'})`);
    
    // Get author's works
    const worksUrl = `${OPENALEX_API}/works?filter=author.id:${author.id}&sort=publication_date:desc&per_page=10`;
    
    const worksRes = await fetch(worksUrl, {
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'PhDApply/1.0'
      }
    });
    
    if (!worksRes.ok) {
      console.log(`⚠️ Failed to get works: ${worksRes.status}`);
      return {
        name: author.display_name,
        authorId: author.id,
        affiliation: author.last_known_institution?.display_name,
        paperCount: author.works_count,
        citationCount: author.cited_by_count,
        hIndex: author.summary_stats?.h_index,
        papers: [],
      };
    }
    
    const worksData = await worksRes.json() as {
      results: {
        title: string;
        publication_year: number;
        abstract_inverted_index?: Record<string, number[]>;
        primary_location?: { source?: { display_name: string } };
        cited_by_count: number;
        doi?: string;
        open_access?: { oa_url?: string };
        authorships?: { author: { display_name: string } }[];
      }[];
    };
    
    // Transform papers
    const papers: AcademicPaper[] = worksData.results.map(w => ({
      title: w.title,
      year: w.publication_year,
      abstract: invertedIndexToText(w.abstract_inverted_index),
      authors: w.authorships?.map(a => a.author.display_name) || [],
      venue: w.primary_location?.source?.display_name || '',
      citationCount: w.cited_by_count,
      url: w.doi ? `https://doi.org/${w.doi}` : '',
      pdfUrl: w.open_access?.oa_url,
      doi: w.doi,
    }));
    
    console.log(`✅ Found ${papers.length} papers, ${papers.filter(p => p.pdfUrl).length} with open access`);
    
    return {
      name: author.display_name,
      authorId: author.id,
      affiliation: author.last_known_institution?.display_name,
      paperCount: author.works_count,
      citationCount: author.cited_by_count,
      hIndex: author.summary_stats?.h_index,
      papers,
    };
  } catch (error) {
    console.error('OpenAlex API error:', error);
    return null;
  }
}

/**
 * Convert OpenAlex inverted index abstract to text
 */
function invertedIndexToText(invertedIndex?: Record<string, number[]>): string {
  if (!invertedIndex) return '';
  
  const words: [string, number][] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words.push([word, pos]);
    }
  }
  
  words.sort((a, b) => a[1] - b[1]);
  return words.map(w => w[0]).join(' ');
}

// ============ Combined Search ============

/**
 * Search for author using Semantic Scholar first, then OpenAlex as fallback
 */
export async function searchAuthor(
  authorName: string, 
  affiliation?: string
): Promise<AuthorProfile | null> {
  // Try Semantic Scholar first (better paper data)
  let result = await searchAuthorSemanticScholar(authorName, affiliation);
  
  // Fallback to OpenAlex if no results
  if (!result || result.papers.length === 0) {
    console.log('📚 Trying OpenAlex as fallback...');
    result = await searchAuthorOpenAlex(authorName, affiliation);
  }
  
  return result;
}

/**
 * Download PDF from open access URL
 */
export async function downloadOpenAccessPdf(url: string): Promise<Uint8Array | null> {
  try {
    console.log(`📥 Downloading open access PDF: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      console.log(`⚠️ PDF download failed: ${response.status}`);
      return null;
    }
    
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/pdf')) {
      console.log(`⚠️ Not a PDF: ${contentType}`);
      return null;
    }
    
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 10000) {
      console.log(`⚠️ PDF too small: ${buffer.byteLength} bytes`);
      return null;
    }
    
    console.log(`✅ Downloaded PDF: ${buffer.byteLength} bytes`);
    return new Uint8Array(buffer);
  } catch (error) {
    console.log(`⚠️ PDF download error: ${error}`);
    return null;
  }
}
