/**
 * BSE IPO Document Link Scraper
 *
 * Extracts document links from BSE IPO detail pages.
 * Supports both ACQDisp.aspx (MAINBOARD/SME) and DisplayIPO.aspx (RIGHTS/NCD) pages.
 */

import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';

export interface DocumentLink {
  title: string;
  url: string;
}

/**
 * Scrape document links from BSE detail page HTML
 *
 * @param html - Raw HTML from BSE detail page
 * @param baseUrl - Base URL for making relative URLs absolute (default: https://www.bseindia.com)
 * @returns Array of document links with titles and URLs
 *
 * @example
 * const docs = scrapeBSEDocuments(html, 'https://www.bseindia.com');
 * // Returns: [{ title: 'Draft Red Herring Prospectus', url: 'https://www.bseindia.com/...' }]
 */
export function scrapeBSEDocuments(
  html: string,
  baseUrl: string = 'https://www.bseindia.com'
): DocumentLink[] {
  if (!html || typeof html !== 'string') {
    logger.warn('Invalid HTML provided to scrapeBSEDocuments');
    return [];
  }

  try {
    const $ = cheerio.load(html);
    const documents: DocumentLink[] = [];

    // Strategy 1: Look for document links in tables
    // BSE uses tables with class 'TTRow_left' for data presentation
    $('table tr').each((_, row) => {
      const cells = $(row).find('td');

      if (cells.length >= 2) {
        // Check if any cell contains a link
        cells.each((_, cell) => {
          const link = $(cell).find('a[href]');

          if (link.length > 0) {
            const href = link.attr('href');
            const linkText = link.text().trim();

            if (href && linkText) {
              // Filter out navigation/menu links
              if (isDocumentLink(linkText, href)) {
                const absoluteUrl = makeAbsoluteUrl(href, baseUrl);
                documents.push({
                  title: linkText,
                  url: absoluteUrl,
                });
              }
            }
          }
        });
      }
    });

    // Strategy 2: Look for links with specific patterns (PDF, document keywords)
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      const linkText = $(element).text().trim();

      if (href && linkText && isDocumentLink(linkText, href)) {
        const absoluteUrl = makeAbsoluteUrl(href, baseUrl);

        // Avoid duplicates
        const exists = documents.some(
          (doc) => doc.url === absoluteUrl || doc.title === linkText
        );

        if (!exists) {
          documents.push({
            title: linkText,
            url: absoluteUrl,
          });
        }
      }
    });

    // Remove duplicates based on URL
    const uniqueDocuments = deduplicateDocuments(documents);

    logger.debug(
      { documentCount: uniqueDocuments.length },
      'Scraped BSE documents'
    );

    return uniqueDocuments;
  } catch (error) {
    logger.error({ error }, 'Error scraping BSE documents');
    return [];
  }
}

/**
 * Check if a link is a document link (not navigation/menu)
 *
 * @param linkText - Text content of the link
 * @param href - URL of the link
 * @returns True if link appears to be a document
 */
function isDocumentLink(linkText: string, href: string): boolean {
  const text = linkText.toLowerCase();
  const url = href.toLowerCase();

  // Document type keywords
  const documentKeywords = [
    'prospectus',
    'drhp',
    'rhp',
    'addendum',
    'corrigendum',
    'allotment',
    'basis of allotment',
    'supplement',
    'amendment',
    'audiovisual',
    'video',
  ];

  // Check if text contains document keywords
  const hasDocumentKeyword = documentKeywords.some((keyword) =>
    text.includes(keyword)
  );

  // Check if URL looks like a document (PDF, video, etc.)
  const isDocumentUrl =
    url.includes('.pdf') ||
    url.includes('.aspx?') ||
    url.includes('download') ||
    url.includes('document') ||
    url.includes('prospectus');

  // Exclude navigation/menu links
  const isNavigationLink =
    text.includes('home') ||
    text.includes('back') ||
    text.includes('search') ||
    text.includes('login') ||
    text.includes('help') ||
    text.includes('contact') ||
    text.length < 4; // Very short text is likely navigation

  return (hasDocumentKeyword || isDocumentUrl) && !isNavigationLink;
}

/**
 * Make relative URL absolute
 *
 * @param url - URL (absolute or relative)
 * @param baseUrl - Base URL to prepend if relative
 * @returns Absolute URL
 */
function makeAbsoluteUrl(url: string, baseUrl: string): string {
  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  // Protocol-relative URL
  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  // Relative URL starting with /
  if (url.startsWith('/')) {
    // Remove trailing slash from baseUrl if exists
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${base}${url}`;
  }

  // Relative URL without leading /
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}${url}`;
}

/**
 * Remove duplicate documents based on URL
 *
 * @param documents - Array of document links
 * @returns Deduplicated array
 */
function deduplicateDocuments(documents: DocumentLink[]): DocumentLink[] {
  const seen = new Set<string>();
  const unique: DocumentLink[] = [];

  for (const doc of documents) {
    // Normalize URL for comparison (remove trailing slashes, convert to lowercase)
    const normalizedUrl = doc.url.toLowerCase().replace(/\/$/, '');

    if (!seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      unique.push(doc);
    }
  }

  return unique;
}

/**
 * Extract document links from BSE detail page URL
 * Convenience wrapper that fetches HTML and scrapes documents
 *
 * @param url - BSE detail page URL
 * @returns Array of document links
 */
export async function fetchBSEDocuments(url: string): Promise<DocumentLink[]> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    return scrapeBSEDocuments(html);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ url, error: errorMsg }, 'Failed to fetch BSE documents');
    throw error;
  }
}
