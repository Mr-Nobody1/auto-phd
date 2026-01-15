import { chromium, type Browser } from 'playwright';

let browserInstance: Browser | null = null;

/**
 * Get or create browser instance
 * Checks if existing browser is still connected before returning
 */
async function getBrowser(): Promise<Browser> {
  // Check if browser exists and is still connected
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  
  // Clean up disconnected browser reference
  if (browserInstance) {
    console.log('⚠️ Browser was disconnected, relaunching...');
    browserInstance = null;
  }
  
  console.log('🌐 Launching browser...');
  try {
    browserInstance = await chromium.launch({
      headless: false,
      channel: 'chrome',
      timeout: 60000,
      args: ['--remote-debugging-port=0'], // Use WebSocket instead of pipe
    });
    
    // Handle browser disconnect event
    browserInstance.on('disconnected', () => {
      console.log('⚠️ Browser disconnected');
      browserInstance = null;
    });
    
    console.log('✅ Browser launched successfully');
  } catch (error) {
    console.error('❌ Failed to launch browser:', error);
    throw error;
  }
  
  return browserInstance;
}

/**
 * Close browser instance
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Scrape a webpage and extract text content
 */
export async function scrapeUrl(url: string): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait a bit for dynamic content
    await page.waitForTimeout(2000);

    // Extract main text content
    const content = await page.evaluate(() => {
      // Remove script and style elements
      const scripts = document.querySelectorAll('script, style, nav, footer, header');
      scripts.forEach((el: Element) => el.remove());

      // Get text from main content areas
      const main = document.querySelector('main, article, .content, #content, .main');
      if (main) {
        return main.textContent || '';
      }

      return document.body.textContent || '';
    });

    return content.replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error(`Failed to scrape ${url}:`, error);
    throw new Error(`Failed to scrape URL: ${error}`);
  } finally {
    await context.close();
  }
}

/**
 * Search Google and get top results
 */
export async function searchGoogle(query: string, numResults: number = 5): Promise<string[]> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForTimeout(2000);

    // Extract search result URLs
    const links = await page.evaluate(() => {
      const results: string[] = [];
      const anchors = document.querySelectorAll('a[href^="http"]');

      anchors.forEach((a: Element) => {
        const href = a.getAttribute('href');
        if (
          href &&
          !href.includes('google.com') &&
          !href.includes('youtube.com') &&
          !href.includes('maps.google')
        ) {
          results.push(href);
        }
      });

      return results;
    });

    return links.slice(0, numResults);
  } catch (error) {
    console.error('Google search failed:', error);
    return [];
  } finally {
    await context.close();
  }
}

/**
 * Search Google Scholar for papers
 */
export async function searchGoogleScholar(
  query: string,
  numResults: number = 5
): Promise<{ title: string; url: string; snippet: string }[]> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    const searchUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForTimeout(3000);

    // Extract paper information
    const papers = await page.evaluate(() => {
      const results: { title: string; url: string; snippet: string }[] = [];
      const items = document.querySelectorAll('.gs_ri');

      items.forEach((item: Element) => {
        const titleEl = item.querySelector('.gs_rt a');
        const snippetEl = item.querySelector('.gs_rs');

        if (titleEl) {
          results.push({
            title: titleEl.textContent || '',
            url: titleEl.getAttribute('href') || '',
            snippet: snippetEl?.textContent || '',
          });
        }
      });

      return results;
    });

    return papers.slice(0, numResults);
  } catch (error) {
    console.error('Scholar search failed:', error);
    return [];
  } finally {
    await context.close();
  }
}

/**
 * Find professor's faculty page
 */
export async function findFacultyPage(
  professorName: string,
  university: string
): Promise<string | null> {
  const query = `"${professorName}" "${university}" professor site:.edu OR site:.ac.uk OR site:.de`;
  const results = await searchGoogle(query, 5);

  // Filter for likely faculty pages
  for (const url of results) {
    if (
      url.includes('faculty') ||
      url.includes('people') ||
      url.includes('staff') ||
      url.includes('professor') ||
      url.includes('team')
    ) {
      return url;
    }
  }

  return results[0] || null;
}

/**
 * Find professor's Google Scholar profile
 */
export async function findScholarProfile(professorName: string): Promise<string | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    const searchUrl = `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(
      professorName
    )}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForTimeout(2000);

    // Get first author profile link
    const profileUrl = await page.evaluate(() => {
      const link = document.querySelector('.gs_ai_name a');
      return link ? 'https://scholar.google.com' + link.getAttribute('href') : null;
    });

    return profileUrl;
  } catch (error) {
    console.error('Scholar profile search failed:', error);
    return null;
  } finally {
    await context.close();
  }
}

/**
 * Scrape papers from a Google Scholar profile
 */
export async function scrapeScholarPapers(
  profileUrl: string,
  numPapers: number = 5
): Promise<{ title: string; year: string; citations: string; url: string }[]> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // Sort by date to get recent papers
    const sortedUrl = profileUrl.includes('?')
      ? `${profileUrl}&sortby=pubdate`
      : `${profileUrl}?sortby=pubdate`;

    await page.goto(sortedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.waitForTimeout(3000);

    // Extract paper information
    const papers = await page.evaluate(() => {
      const results: { title: string; year: string; citations: string; url: string }[] = [];
      const rows = document.querySelectorAll('.gsc_a_tr');

      rows.forEach((row: Element) => {
        const titleEl = row.querySelector('.gsc_a_at');
        const yearEl = row.querySelector('.gsc_a_y span');
        const citationsEl = row.querySelector('.gsc_a_c a');

        if (titleEl) {
          results.push({
            title: titleEl.textContent || '',
            year: yearEl?.textContent || '',
            citations: citationsEl?.textContent || '0',
            url: titleEl.getAttribute('href')
              ? 'https://scholar.google.com' + titleEl.getAttribute('href')
              : '',
          });
        }
      });

      return results;
    });

    return papers.slice(0, numPapers);
  } catch (error) {
    console.error('Scholar papers scrape failed:', error);
    return [];
  } finally {
    await context.close();
  }
}
