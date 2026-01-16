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
 * Searches by name only, then matches by affiliation if provided
 */
export async function searchAuthorSemanticScholar(
  authorName: string,
  affiliation?: string
): Promise<AuthorProfile | null> {
  try {
    // Search by name only (not including university to avoid mismatches)
    const searchUrl = `${SEMANTIC_SCHOLAR_API}/author/search?query=${encodeURIComponent(authorName)}&limit=10`;
    
    console.log(`🔍 Semantic Scholar: Searching for "${authorName}"...`);
    
    const searchRes = await fetch(searchUrl, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!searchRes.ok) {
      console.log(`⚠️ Semantic Scholar search failed: ${searchRes.status}`);
      return null;
    }
    
    const searchData = await searchRes.json() as { data: { authorId: string; name: string; affiliations?: string[] }[] };
    
    if (!searchData.data || searchData.data.length === 0) {
      console.log(`⚠️ No authors found for "${authorName}"`);
      return null;
    }
    
    console.log(`📋 Found ${searchData.data.length} author candidates`);
    
    // Try to find best match by affiliation
    const firstResult = searchData.data[0];
    let authorId = firstResult?.authorId ?? '';
    let matchedByAffiliation = false;
    
    if (affiliation) {
      const affiliationLower = affiliation.toLowerCase();
      for (const author of searchData.data) {
        // Need to get full details to check affiliation
        const detailUrl = `${SEMANTIC_SCHOLAR_API}/author/${author.authorId}?fields=name,affiliations`;
        try {
          const detailRes = await fetch(detailUrl, { headers: { 'Accept': 'application/json' } });
          if (detailRes.ok) {
            const detail = await detailRes.json() as { affiliations?: string[] };
            if (detail.affiliations?.some(a => a.toLowerCase().includes(affiliationLower))) {
              authorId = author.authorId;
              matchedByAffiliation = true;
              console.log(`✅ Matched author by affiliation: ${author.name}`);
              break;
            }
          }
        } catch {
          // Continue with next candidate
        }
      }
    }
    
    if (!matchedByAffiliation && firstResult) {
      console.log(`⚠️ Could not match by affiliation, using first result: ${firstResult.name}`);
    }
    
    console.log(`✅ Selected author ID: ${authorId}`);
    
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
    
    console.log(`📊 Author Profile:`);
    console.log(`   Name: ${authorData.name}`);
    console.log(`   Affiliations: ${authorData.affiliations?.join(', ') || 'Unknown'}`);
    console.log(`   Total Papers: ${authorData.paperCount}`);
    console.log(`   Citations: ${authorData.citationCount}`);
    console.log(`   H-Index: ${authorData.hIndex || 'Unknown'}`);
    
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
    
    console.log(`📚 Found ${papers.length} papers, ${papers.filter(p => p.pdfUrl).length} with open access PDFs`);
    papers.slice(0, 3).forEach((p, i) => {
      console.log(`   ${i+1}. "${p.title.slice(0, 60)}..." (${p.year})`);
    });
    
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
 * Search for an author by name on OpenAlex
 * Uses institution IDs to get proper affiliations
 */
export async function searchAuthorOpenAlex(
  authorName: string,
  affiliation?: string
): Promise<AuthorProfile | null> {
  try {
    // Search for author with more fields
    const searchUrl = `${OPENALEX_API}/authors?search=${encodeURIComponent(authorName)}&per_page=10`;
    
    console.log(`🔍 OpenAlex: Searching for "${authorName}"...`);
    
    const searchRes = await fetch(searchUrl, {
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'PhDApply/1.0 (mailto:contact@example.com)'
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
        last_known_institutions?: Array<{ id: string; display_name: string; country_code?: string }>;
        last_known_institution?: { id: string; display_name: string; country_code?: string };
        affiliations?: Array<{ institution: { id: string; display_name: string } }>;
        works_count: number;
        cited_by_count: number;
        summary_stats?: { h_index: number };
      }[] 
    };
    
    if (!searchData.results || searchData.results.length === 0) {
      console.log(`⚠️ No authors found on OpenAlex`);
      return null;
    }
    
    // Find best match by affiliation
    let author = searchData.results[0];
    if (!author) {
      console.log(`⚠️ No author data available`);
      return null;
    }
    
    if (affiliation) {
      const affiliationLower = affiliation.toLowerCase();
      const matchingAuthor = searchData.results.find(a => {
        // Check last_known_institution
        if (a.last_known_institution?.display_name?.toLowerCase().includes(affiliationLower)) {
          return true;
        }
        // Check last_known_institutions array
        if (a.last_known_institutions?.some(inst => 
          inst.display_name?.toLowerCase().includes(affiliationLower)
        )) {
          return true;
        }
        // Check affiliations array
        if (a.affiliations?.some(aff => 
          aff.institution?.display_name?.toLowerCase().includes(affiliationLower)
        )) {
          return true;
        }
        return false;
      });
      if (matchingAuthor) {
        author = matchingAuthor;
        console.log(`✅ Matched by affiliation!`);
      }
    }
    
    // Get the best available affiliation
    const authorAffiliation = 
      author.last_known_institution?.display_name ||
      author.last_known_institutions?.[0]?.display_name ||
      author.affiliations?.[0]?.institution?.display_name ||
      'Unknown';
    
    console.log(`✅ Found author: ${author.display_name} (${authorAffiliation})`);
    
    // Get author's works - fetch BOTH recent AND most cited
    console.log(`📚 Fetching papers: 5 most recent + 5 most cited...`);
    
    // 1. Get 10 most recent papers
    const recentUrl = `${OPENALEX_API}/works?filter=author.id:${author.id}&sort=publication_date:desc&per_page=10`;
    
    // 2. Get 10 most cited papers
    const citedUrl = `${OPENALEX_API}/works?filter=author.id:${author.id}&sort=cited_by_count:desc&per_page=10`;
    
    const [recentRes, citedRes] = await Promise.all([
      fetch(recentUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'PhDApply/1.0' } }),
      fetch(citedUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'PhDApply/1.0' } })
    ]);
    
    if (!recentRes.ok && !citedRes.ok) {
      console.log(`⚠️ Failed to get works`);
      return {
        name: author.display_name,
        authorId: author.id,
        affiliation: authorAffiliation,
        paperCount: author.works_count,
        citationCount: author.cited_by_count,
        hIndex: author.summary_stats?.h_index,
        papers: [],
      };
    }
    
    // Define work structure type
    interface WorkResult {
      title: string;
      publication_year: number;
      abstract_inverted_index?: Record<string, number[]>;
      primary_location?: { 
        source?: { display_name: string };
        pdf_url?: string;
      };
      best_oa_location?: {
        pdf_url?: string;
        landing_page_url?: string;
      };
      locations?: Array<{
        pdf_url?: string;
        landing_page_url?: string;
      }>;
      cited_by_count: number;
      doi?: string;
      open_access?: { 
        is_oa: boolean;
        oa_url?: string;
      };
      authorships?: { author: { display_name: string } }[];
    }
    
    // Parse both responses
    const recentData = recentRes.ok ? await recentRes.json() as { results: WorkResult[] } : { results: [] };
    const citedData = citedRes.ok ? await citedRes.json() as { results: WorkResult[] } : { results: [] };
    
    // Helper to validate PDF URL (must be actual PDF, not landing page)
    const isValidPdfUrl = (url?: string): boolean => {
      if (!url) return false;
      if (!url.startsWith('http')) return false;
      const urlLower = url.toLowerCase();
      if (urlLower.endsWith('.pdf')) return true;
      if (urlLower.includes('arxiv.org/pdf/')) return true;
      if (urlLower.includes('aclanthology.org') && urlLower.endsWith('.pdf')) return true;
      if (urlLower.includes('/pdf/') || urlLower.includes('/pdfs/')) return true;
      if (urlLower.includes('doi.org/10.')) return false;
      return false;
    };
    
    // Transform work to paper
    const transformWork = (w: WorkResult): AcademicPaper => {
      let pdfUrl: string | undefined;
      
      if (isValidPdfUrl(w.best_oa_location?.pdf_url)) {
        pdfUrl = w.best_oa_location!.pdf_url;
      } else if (isValidPdfUrl(w.primary_location?.pdf_url)) {
        pdfUrl = w.primary_location!.pdf_url;
      } else if (w.locations) {
        for (const loc of w.locations) {
          if (isValidPdfUrl(loc.pdf_url)) {
            pdfUrl = loc.pdf_url;
            break;
          }
        }
      }
      
      return {
        title: w.title,
        year: w.publication_year,
        abstract: invertedIndexToText(w.abstract_inverted_index),
        authors: w.authorships?.map(a => a.author.display_name) || [],
        venue: w.primary_location?.source?.display_name || '',
        citationCount: w.cited_by_count,
        url: w.doi ? `https://doi.org/${w.doi}` : '',
        pdfUrl,
        doi: w.doi,
      };
    };
    
    // Get unique papers by title (combine recent and cited)
    const seenTitles = new Set<string>();
    const allPapers: AcademicPaper[] = [];
    
    // Add 5 most recent with PDFs first
    const recentWithPdf = recentData.results
      .map(transformWork)
      .filter(p => p.pdfUrl)
      .slice(0, 5);
    
    console.log(`   📅 ${recentWithPdf.length} recent papers with open access PDFs`);
    for (const p of recentWithPdf) {
      if (!seenTitles.has(p.title.toLowerCase())) {
        seenTitles.add(p.title.toLowerCase());
        allPapers.push(p);
      }
    }
    
    // Add 5 most cited with PDFs
    const citedWithPdf = citedData.results
      .map(transformWork)
      .filter(p => p.pdfUrl)
      .slice(0, 5);
    
    console.log(`   📊 ${citedWithPdf.length} cited papers with open access PDFs`);
    for (const p of citedWithPdf) {
      if (!seenTitles.has(p.title.toLowerCase())) {
        seenTitles.add(p.title.toLowerCase());
        allPapers.push(p);
      }
    }
    
    console.log(`✅ Found ${allPapers.length} unique papers with open access PDFs (5 recent + 5 cited, deduplicated)`);
    
    // Log the papers for debugging
    allPapers.forEach((p, i) => {
      console.log(`   ${i + 1}. "${p.title.slice(0, 50)}..." (${p.year}, ${p.citationCount} cites)`);
    });
    
    return {
      name: author.display_name,
      authorId: author.id,
      affiliation: authorAffiliation,
      paperCount: author.works_count,
      citationCount: author.cited_by_count,
      hIndex: author.summary_stats?.h_index,
      papers: allPapers,
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
 * Search for author using OpenAlex FIRST (provides affiliations), then Semantic Scholar as fallback
 */
export async function searchAuthor(
  authorName: string, 
  affiliation?: string
): Promise<AuthorProfile | null> {
  // Try OpenAlex first (provides affiliations in API responses)
  console.log('\n📚 === ACADEMIC API SEARCH ===');
  let result = await searchAuthorOpenAlex(authorName, affiliation);
  
  // Verify we got good results (more than just a couple papers)
  if (result && result.papers.length >= 3) {
    console.log(`✅ OpenAlex found good results: ${result.papers.length} papers`);
    return result;
  }
  
  // Fallback to Semantic Scholar if OpenAlex didn't give good results
  console.log('📚 Trying Semantic Scholar as fallback...');
  const ssResult = await searchAuthorSemanticScholar(authorName, affiliation);
  
  // Use whichever has more papers
  if (ssResult && (!result || ssResult.papers.length > result.papers.length)) {
    console.log(`✅ Semantic Scholar has better results: ${ssResult.papers.length} papers`);
    return ssResult;
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

// ============ Search Paper by Title ============

/**
 * Search for a specific paper by title using OpenAlex
 * Returns the best matching paper with a valid PDF URL, or null if not found
 */
export async function searchPaperByTitle(
  title: string, 
  keywords?: string[]
): Promise<AcademicPaper | null> {
  try {
    // Build search query from title and optional keywords
    let query = title;
    if (keywords && keywords.length > 0) {
      query = `${title} ${keywords.join(' ')}`;
    }
    
    console.log(`🔍 Searching for paper: "${title.slice(0, 50)}..."`);
    
    const searchUrl = `${OPENALEX_API}/works?search=${encodeURIComponent(query)}&per_page=5`;
    
    const response = await fetch(searchUrl, {
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'PhDApply/1.0 (mailto:contact@example.com)'
      }
    });
    
    if (!response.ok) {
      console.log(`⚠️ OpenAlex search failed: ${response.status}`);
      return null;
    }
    
    interface WorkResult {
      title: string;
      publication_year: number;
      abstract_inverted_index?: Record<string, number[]>;
      primary_location?: { 
        source?: { display_name: string };
        pdf_url?: string;
      };
      best_oa_location?: {
        pdf_url?: string;
      };
      locations?: Array<{
        pdf_url?: string;
      }>;
      cited_by_count: number;
      doi?: string;
      authorships?: { author: { display_name: string } }[];
    }
    
    const data = await response.json() as { results: WorkResult[] };
    
    if (!data.results || data.results.length === 0) {
      console.log(`⚠️ No papers found for: "${title.slice(0, 40)}..."`);
      return null;
    }
    
    // Helper to validate PDF URL (must be actual PDF, not landing page)
    const isValidPdfUrl = (url?: string): boolean => {
      if (!url) return false;
      if (!url.startsWith('http')) return false;
      const urlLower = url.toLowerCase();
      if (urlLower.endsWith('.pdf')) return true;
      if (urlLower.includes('arxiv.org/pdf/')) return true;
      if (urlLower.includes('aclanthology.org') && urlLower.endsWith('.pdf')) return true;
      if (urlLower.includes('/pdf/') || urlLower.includes('/pdfs/')) return true;
      if (urlLower.includes('doi.org/10.')) return false;
      return false;
    };
    
    // Find the best match - look for title similarity and valid PDF
    const titleLower = title.toLowerCase();
    
    for (const work of data.results) {
      // Check if title is similar (contains key words)
      const workTitleLower = work.title?.toLowerCase() || '';
      const titleWords = titleLower.split(/\s+/).filter(w => w.length > 3);
      const matchingWords = titleWords.filter(w => workTitleLower.includes(w));
      const similarity = matchingWords.length / Math.max(titleWords.length, 1);
      
      // Require at least 50% word overlap
      if (similarity < 0.5) continue;
      
      // Find valid PDF URL
      let pdfUrl: string | undefined;
      
      if (isValidPdfUrl(work.best_oa_location?.pdf_url)) {
        pdfUrl = work.best_oa_location!.pdf_url;
      } else if (isValidPdfUrl(work.primary_location?.pdf_url)) {
        pdfUrl = work.primary_location!.pdf_url;
      } else if (work.locations) {
        for (const loc of work.locations) {
          if (isValidPdfUrl(loc.pdf_url)) {
            pdfUrl = loc.pdf_url;
            break;
          }
        }
      }
      
      if (!pdfUrl) {
        console.log(`⚠️ Found paper but no valid PDF: "${work.title?.slice(0, 40)}..."`);
        continue;
      }
      
      // Convert inverted index abstract to text
      let abstract = '';
      if (work.abstract_inverted_index) {
        const words: [string, number][] = [];
        for (const [word, positions] of Object.entries(work.abstract_inverted_index)) {
          for (const pos of positions) {
            words.push([word, pos]);
          }
        }
        words.sort((a, b) => a[1] - b[1]);
        abstract = words.map(w => w[0]).join(' ');
      }
      
      const paper: AcademicPaper = {
        title: work.title,
        year: work.publication_year,
        abstract,
        authors: work.authorships?.map(a => a.author.display_name) || [],
        venue: work.primary_location?.source?.display_name || '',
        citationCount: work.cited_by_count,
        url: work.doi ? `https://doi.org/${work.doi}` : '',
        pdfUrl,
        doi: work.doi,
      };
      
      console.log(`✅ Found paper with PDF: "${paper.title.slice(0, 50)}..." (${paper.year})`);
      return paper;
    }
    
    console.log(`⚠️ No papers with valid PDF found for: "${title.slice(0, 40)}..."`);
    return null;
  } catch (error) {
    console.log(`⚠️ Paper search error: ${error}`);
    return null;
  }
}
