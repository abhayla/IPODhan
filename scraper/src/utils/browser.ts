import puppeteer, { Browser, Page } from 'puppeteer';
import { config } from '../config.js';
import logger from './logger.js';

/**
 * Launch Puppeteer browser with stealth configuration
 * @returns Promise<Browser> - Launched browser instance
 */
export async function launchBrowser(): Promise<Browser> {
  logger.debug('Launching browser...');

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ],
    timeout: 30000
  });

  logger.debug('Browser launched successfully');
  return browser;
}

/**
 * Create new page with optimized settings
 * Blocks unnecessary resources for faster page load
 * @param browser - Browser instance
 * @returns Promise<Page> - Configured page instance
 */
export async function createPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();

  // Set viewport
  await page.setViewport({
    width: 1920,
    height: 1080
  });

  // Set user agent to avoid bot detection
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // Enable request interception to block unnecessary resources
  await page.setRequestInterception(true);

  page.on('request', (request) => {
    const resourceType = request.resourceType();

    // Block images, fonts, and stylesheets for performance
    if (['image', 'font', 'stylesheet'].includes(resourceType)) {
      request.abort();
    } else {
      request.continue();
    }
  });

  // Add error handlers
  page.on('error', (error) => {
    logger.error({ error: error.message }, 'Page crashed');
  });

  page.on('pageerror', (error) => {
    logger.warn({ error: error.message }, 'Page error (console error)');
  });

  logger.debug('Page created with optimized settings');
  return page;
}

/**
 * Close browser and cleanup resources
 * @param browser - Browser instance to close
 */
export async function closeBrowser(browser: Browser): Promise<void> {
  if (browser) {
    await browser.close();
    logger.debug('Browser closed');
  }
}

/**
 * Navigate to URL with timeout and retry logic
 * @param page - Page instance
 * @param url - URL to navigate to
 * @param timeout - Navigation timeout in milliseconds (default: 30s)
 * @returns Promise<void>
 */
export async function navigateToUrl(
  page: Page,
  url: string,
  timeout: number = config.scraper.timeout
): Promise<void> {
  logger.debug({ url, timeout }, 'Navigating to URL');

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout
  });

  logger.debug({ url }, 'Navigation successful');
}

/**
 * Wait for selector with custom timeout
 * @param page - Page instance
 * @param selector - CSS selector to wait for
 * @param timeout - Wait timeout in milliseconds (default: 30s)
 * @returns Promise<void>
 */
export async function waitForSelector(
  page: Page,
  selector: string,
  timeout: number = config.scraper.timeout
): Promise<void> {
  logger.debug({ selector, timeout }, 'Waiting for selector');

  await page.waitForSelector(selector, { timeout });

  logger.debug({ selector }, 'Selector found');
}
