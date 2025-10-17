import * as cheerio from 'cheerio';
import logger from './logger.js';
import { launchBrowser, closeBrowser } from './browser.js';
import type { Browser, Page } from 'puppeteer';

export type RenderingType = 'STATIC' | 'DYNAMIC';

export interface ScrapeOptions {
  url: string;
  testSelector: string;
  timeout?: number;
}

/**
 * Detect whether a page needs JavaScript rendering or can be scraped with static HTML
 * @param url - URL to check
 * @param testSelector - CSS selector to verify data presence
 * @returns 'STATIC' if data is in raw HTML, 'DYNAMIC' if JavaScript rendering needed
 */
export async function detectRenderingType(url: string, testSelector: string): Promise<RenderingType> {
  try {
    // Fetch raw HTML without JavaScript execution
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'Failed to fetch URL for rendering detection');
      return 'DYNAMIC'; // Default to Puppeteer on fetch failure
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Check if test selector exists in static HTML
    const elements = $(testSelector);

    if (elements.length > 0) {
      logger.debug({ url, selector: testSelector }, 'Static HTML rendering detected');
      return 'STATIC';
    }

    logger.debug({ url, selector: testSelector }, 'JavaScript rendering required');
    return 'DYNAMIC';

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn({ url, error: errorMsg }, 'Error detecting rendering type, defaulting to DYNAMIC');
    return 'DYNAMIC';
  }
}

/**
 * Scrape with automatic detection of static vs dynamic rendering
 * Uses Cheerio for static HTML (faster), Puppeteer for JavaScript-rendered content
 * @param options - Scraping options
 * @returns Cheerio instance with loaded HTML
 */
export async function scrapeWithAutoDetection(options: ScrapeOptions): Promise<cheerio.CheerioAPI> {
  const { url, testSelector, timeout = 10000 } = options;

  const renderingType = await detectRenderingType(url, testSelector);

  if (renderingType === 'STATIC') {
    return await scrapeWithCheerio(url);
  } else {
    return await scrapeWithPuppeteer(url, timeout);
  }
}

/**
 * Scrape using Cheerio (static HTML parsing)
 * 10x faster than Puppeteer for static content
 * @param url - URL to scrape
 * @returns Cheerio instance with loaded HTML
 */
export async function scrapeWithCheerio(url: string): Promise<cheerio.CheerioAPI> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    logger.debug({ url }, 'Successfully scraped with Cheerio');
    return $ as cheerio.CheerioAPI;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ url, error: errorMsg }, 'Failed to scrape with Cheerio');
    throw error;
  }
}

/**
 * Scrape using Puppeteer (JavaScript-rendered content)
 * Required when content is loaded dynamically via JavaScript
 * @param url - URL to scrape
 * @param timeout - Maximum wait time in milliseconds
 * @returns Cheerio instance with loaded HTML
 */
export async function scrapeWithPuppeteer(url: string, timeout: number = 10000): Promise<cheerio.CheerioAPI> {
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await launchBrowser();
    page = await browser.newPage();

    // Navigate to URL
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout
    });

    // Get rendered HTML
    const html = await page.content();
    const $ = cheerio.load(html);

    logger.debug({ url }, 'Successfully scraped with Puppeteer');
    return $ as cheerio.CheerioAPI;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ url, error: errorMsg }, 'Failed to scrape with Puppeteer');
    throw error;

  } finally {
    if (page) await page.close();
    if (browser) await closeBrowser(browser);
  }
}

/**
 * Normalize company name for deduplication matching
 * Removes common suffixes, standardizes spacing, converts to lowercase
 * @param name - Company name to normalize
 * @returns Normalized company name
 */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ') // Standardize whitespace
    .replace(/\blimited\b|\bltd\b|\binc\b|\bincorporated\b|\bcorp\b|\bcorporation\b|\bpvt\b|\bprivate\b/gi, '') // Remove suffixes
    .replace(/[^\w\s]/g, '') // Remove special characters
    .trim();
}

/**
 * Calculate fuzzy match score between two strings
 * Uses Levenshtein distance for similarity
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Similarity score (0-1, where 1 is exact match)
 */
export function fuzzyMatch(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Edit distance
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Retry a function with exponential backoff
 * @param fn - Function to retry
 * @param retries - Number of retry attempts (default: 3)
 * @param delayMs - Initial delay in milliseconds (default: 1000)
 * @returns Result of function execution
 */
export async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < retries) {
        const delay = delayMs * Math.pow(2, attempt); // Exponential: 1s, 2s, 4s
        logger.warn(
          { attempt: attempt + 1, delay, error: lastError.message },
          'Retry attempt failed, waiting before next retry'
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('All retry attempts failed');
}

/**
 * Parse Indian currency format to number
 * Handles Cr (Crores), Lakh, etc.
 * @param value - Currency string (e.g., "₹100 Cr", "500 Lakh")
 * @returns Number in basic units
 */
export function parseIndianCurrency(value: string): number {
  if (!value) return 0;

  // Remove currency symbols and trim
  const cleaned = value.replace(/[₹,\s]/g, '').toLowerCase();

  // Match number and unit
  const match = cleaned.match(/^([\d.]+)(cr|crore|lakh|l)?$/);
  if (!match) return 0;

  const num = parseFloat(match[1]);
  const unit = match[2];

  if (unit === 'cr' || unit === 'crore') {
    return num * 10000000; // 1 Crore = 10 Million
  } else if (unit === 'lakh' || unit === 'l') {
    return num * 100000; // 1 Lakh = 100 Thousand
  }

  return num;
}

/**
 * Parse date from various formats
 * Handles DD-MMM-YYYY, DD/MM/YYYY, etc.
 * @param dateStr - Date string
 * @returns ISO 8601 date string
 */
export function parseDate(dateStr: string): string {
  if (!dateStr) return '';

  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toISOString();
  } catch {
    return '';
  }
}

/**
 * Sanitize text content for safe database insertion
 * Removes HTML tags, trims whitespace
 * @param text - Text to sanitize
 * @returns Sanitized text
 */
export function sanitizeText(text: string): string {
  if (!text) return '';

  return text
    .replace(/<\/?[a-z][a-z0-9]*[^>]*>/gi, '') // Remove HTML tags
    .replace(/[<>]/g, '') // Remove remaining angle brackets
    .trim();
}
