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
  const browser = await getBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    const query = `"${professorName}" "${university}" professor site:.edu OR site:.ac.uk`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    
    await randomDelay(500, 1500);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await randomDelay(1000, 2000);

    const links = await page.evaluate(() => {
      const results: string[] = [];
      const anchors = document.querySelectorAll('a[href^="http"]');
      anchors.forEach((a) => {
        const href = a.getAttribute('href');
        if (href && !href.includes('google.com')) {
          results.push(href);
        }
      });
      return results;
    });

    // Filter for likely faculty pages
    for (const url of links) {
      if (
        url.includes('faculty') ||
        url.includes('people') ||
        url.includes('staff') ||
        url.includes('professor') ||
        url.includes('~') || // Personal pages often use ~username
        url.includes('team')
      ) {
        console.log(`✅ Found faculty page: ${url}`);
        return url;
      }
    }

    return links[0] || null;
  } catch (error) {
    console.error('Faculty page search failed:', error);
    return null;
  } finally {
    await context.close();
  }
}

/**
 * Scrape a faculty page for professor information
 */
export async function scrapeFacultyPage(url: string): Promise<FacultyPageInfo> {
  const browser = await getBrowser();
  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    console.log(`📄 Scraping faculty page: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await randomDelay(1000, 2000);

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
      const interestKeywords = ['research interest', 'research area', 'focus', 'expertise'];
      let researchSection = '';
      const sections = document.querySelectorAll('p, li, div');
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
      const positionKeywords = ['phd position', 'phd student', 'opening', 'hiring', 'seeking', 'looking for'];
      sections.forEach((el) => {
        const text = el.textContent?.toLowerCase() || '';
        if (positionKeywords.some(k => text.includes(k))) {
          openPositions = el.textContent?.trim() || null;
        }
      });
      
      return {
        bio: bodyText.slice(0, 3000), // First 3000 chars as bio
        researchSection,
        email,
        labUrl,
        labName,
        openPositions,
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
    console.error('Faculty page scrape failed:', error);
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
