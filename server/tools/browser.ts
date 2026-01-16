/**
 * Browser utilities for faculty page scraping only
 * Google Scholar is replaced with academic APIs (see academic-api.ts)
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

let browserInstance: Browser | null = null;

// ============ Stealth Configuration ============

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// ============ Browser Management ============

async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  if (browserInstance) {
    console.log('⚠️ Browser was disconnected, relaunching...');
    browserInstance = null;
  }

  console.log('🌐 Launching browser...');
  browserInstance = await chromium.launch({
    headless: false, // Can be headless now since we're not dealing with Google
    channel: 'chrome',
    timeout: 60000,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  browserInstance.on('disconnected', () => {
    console.log('⚠️ Browser disconnected');
    browserInstance = null;
  });

  console.log('✅ Browser launched');
  return browserInstance;
}

async function createContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: randomChoice(USER_AGENTS),
    viewport: randomChoice(VIEWPORTS),
  });
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

// ============ Faculty Page Scraping ============

export interface FacultyPageInfo {
  bio: string;
  researchInterests: string[];
  email: string | null;
  labUrl: string | null;
  labName: string | null;
  openPositions: string | null;
  pageUrl: string;
}

/**
 * Search Google for a professor's faculty page
 */
export async function findFacultyPage(
  professorName: string,
  university: string
): Promise<string | null> {
  console.log(`\n🌐 === FACULTY PAGE SEARCH ===`);
  console.log(`   Professor: ${professorName}`);
  console.log(`   University: ${university}`);
  
  const browser = await getBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    // Use a broader search query with more TLDs
    const query = `"${professorName}" "${university}" professor`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    
    console.log(`   Search query: ${query}`);
    console.log(`   Navigating to Google...`);
    
    await randomDelay(500, 1500);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await randomDelay(2000, 3000); // Wait longer for results

    // Check page title and content for bot detection/CAPTCHA
    let title = await page.title();
    console.log(`   Page title: ${title}`);
    
    // Multiple detection methods for bot/CAPTCHA
    const pageContent = await page.content();
    const isCaptcha = title.toLowerCase().includes('captcha') || 
                      title.toLowerCase().includes('unusual traffic') ||
                      pageContent.includes('detected unusual traffic') ||
                      pageContent.includes('not a robot') ||
                      pageContent.includes('captcha');
    
    if (isCaptcha) {
      console.log(`\n⚠️  BOT/CAPTCHA DETECTED!`);
      console.log(`   Please solve the CAPTCHA in the browser window...`);
      console.log(`   Waiting 30 seconds for you to solve it...`);
      
      // Wait 30 seconds for user to solve CAPTCHA
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      // Check if page was updated after CAPTCHA solve
      title = await page.title();
      console.log(`   Page title after wait: ${title}`);
    }

    const links = await page.evaluate(() => {
      const results: string[] = [];
      const anchors = document.querySelectorAll('a[href^="http"]');
      anchors.forEach((a) => {
        const href = a.getAttribute('href');
        if (href && !href.includes('google.com') && !href.includes('youtube.com')) {
          results.push(href);
        }
      });
      return results;
    });
    
    console.log(`   Found ${links.length} links on page`);
    
    // If no links found, might still be blocked
    if (links.length === 0) {
      console.log(`⚠️ No links found - page might be blocked or CAPTCHA not solved`);
      return null;
    }

    // Filter for likely faculty pages - check multiple patterns
    const facultyPatterns = ['faculty', 'people', 'staff', 'professor', '~', 'team', 'researchers', 'members', 'profile'];
    
    for (const url of links) {
      if (facultyPatterns.some(p => url.toLowerCase().includes(p))) {
        console.log(`✅ Found faculty page: ${url}`);
        return url;
      }
    }

    // If no faculty-specific URL found, take first result that looks academic
    for (const url of links) {
      if (url.includes('.edu') || url.includes('.ac.') || url.includes('uni-') || url.includes('university')) {
        console.log(`⚠️ Using academic URL (not faculty-specific): ${url}`);
        return url;
      }
    }

    console.log(`⚠️ No faculty page found, returning first result`);
    return links[0] || null;
  } catch (error) {
    console.error('❌ Faculty page search failed:', error);
    return null;
  } finally {
    await context.close();
  }
}

/**
 * Scrape a faculty page for professor information
 */
export async function scrapeFacultyPage(url: string): Promise<FacultyPageInfo> {
  console.log(`\n📄 === SCRAPING FACULTY PAGE ===`);
  console.log(`   URL: ${url}`);
  
  const browser = await getBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(2000, 3000); // Wait for content to load
    
    const title = await page.title();
    console.log(`   Page title: ${title}`);

    const info = await page.evaluate(() => {
      // Get page text
      const bodyText = document.body.innerText || '';
      
      // Extract email using regex patterns
      const emailPatterns = [
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
      ];
      
      let email: string | null = null;
      for (const pattern of emailPatterns) {
        const matches = bodyText.match(pattern) || document.body.innerHTML.match(pattern);
        if (matches && matches.length > 0) {
          email = matches[0].replace('mailto:', '');
          break;
        }
      }
      
      // Look for research interests section
      const interestKeywords = ['research interest', 'research area', 'focus', 'expertise', 'research topics', 'working on'];
      let researchSection = '';
      const sections = document.querySelectorAll('p, li, div, span');
      sections.forEach((el) => {
        const text = el.textContent?.toLowerCase() || '';
        if (interestKeywords.some(k => text.includes(k))) {
          researchSection += ' ' + (el.textContent || '');
        }
      });
      
      // Look for lab links
      let labUrl: string | null = null;
      let labName: string | null = null;
      const labKeywords = ['lab', 'group', 'research group', 'team'];
      document.querySelectorAll('a').forEach((a) => {
        const text = a.textContent?.toLowerCase() || '';
        if (labKeywords.some(k => text.includes(k))) {
          labUrl = a.href;
          labName = a.textContent?.trim() || null;
        }
      });
      
      // Check for open positions
      let openPositions: string | null = null;
      const positionKeywords = ['phd position', 'phd student', 'opening', 'hiring', 'seeking', 'looking for', 'join us', 'open position'];
      sections.forEach((el) => {
        const text = el.textContent?.toLowerCase() || '';
        if (positionKeywords.some(k => text.includes(k))) {
          openPositions = el.textContent?.trim() || null;
        }
      });
      
      // Get page title for context
      const pageTitle = document.title;
      
      return {
        bio: bodyText.slice(0, 5000), // First 5000 chars as bio (increased)
        researchSection,
        email,
        labUrl,
        labName,
        openPositions,
        pageTitle,
      };
    });

    // Extract research interests from the research section
    const researchInterests: string[] = [];
    if (info.researchSection) {
      // Simple extraction - split by common delimiters
      const parts = info.researchSection.split(/[,;•\n]/);
      for (const part of parts) {
        const cleaned = part.trim();
        if (cleaned.length > 5 && cleaned.length < 100) {
          researchInterests.push(cleaned);
        }
      }
    }
    
    // Log extracted info
    console.log(`\n📊 SCRAPED FACULTY PAGE INFO:`);
    console.log(`   Page Title: ${info.pageTitle}`);
    console.log(`   Email: ${info.email || 'Not found'}`);
    console.log(`   Lab Name: ${info.labName || 'Not found'}`);
    console.log(`   Lab URL: ${info.labUrl || 'Not found'}`);
    console.log(`   Open Positions: ${info.openPositions ? 'Yes' : 'Not mentioned'}`);
    console.log(`   Research Interests: ${researchInterests.length > 0 ? researchInterests.slice(0, 3).join('; ') + '...' : 'Not extracted'}`);
    console.log(`   Bio length: ${info.bio.length} chars`);
    console.log(`   Bio preview: ${info.bio.slice(0, 200).replace(/\n/g, ' ')}...`);

    return {
      bio: info.bio,
      researchInterests: researchInterests.slice(0, 10),
      email: info.email,
      labUrl: info.labUrl,
      labName: info.labName,
      openPositions: info.openPositions,
      pageUrl: url,
    };
  } catch (error) {
    console.error('❌ Faculty page scrape failed:', error);
    return {
      bio: '',
      researchInterests: [],
      email: null,
      labUrl: null,
      labName: null,
      openPositions: null,
      pageUrl: url,
    };
  } finally {
    await context.close();
  }
}

/**
 * Scrape any URL and extract text content
 */
export async function scrapeUrl(url: string): Promise<string> {
  const browser = await getBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(1000, 2000);

    const content = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script, style, nav, footer');
      scripts.forEach((el) => el.remove());
      
      const main = document.querySelector('main, article, .content, #content');
      return main ? main.textContent || '' : document.body.textContent || '';
    });

    return content.replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error(`Failed to scrape ${url}:`, error);
    throw error;
  } finally {
    await context.close();
  }
}
