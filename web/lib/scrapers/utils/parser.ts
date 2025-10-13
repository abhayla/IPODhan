/**
 * HTML Parser Utilities
 *
 * Utilities for parsing and extracting data from HTML
 */

import * as cheerio from 'cheerio';

export type CheerioAPI = ReturnType<typeof cheerio.load>;

/**
 * Load HTML and return Cheerio instance
 */
export function parseHTML(html: string): CheerioAPI {
  return cheerio.load(html);
}

/**
 * Clean text by removing extra whitespace and trimming
 */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extract number from text (e.g., "¹1,234.56 Cr" -> 1234.56)
 */
export function extractNumber(text: string): number | null {
  const cleaned = text.replace(/[¹,\s]/g, '');
  const match = cleaned.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * Extract date from various formats
 */
export function parseDate(dateStr: string): Date | null {
  try {
    // Try parsing common Indian date formats
    const formats = [
      // DD-MM-YYYY
      /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/,
      // DD Month YYYY (e.g., "15 Jan 2025")
      /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/,
    ];

    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        if (format.source.includes('[A-Za-z]')) {
          // Month name format
          const [, day, month, year] = match;
          const monthMap: Record<string, number> = {
            jan: 0, january: 0,
            feb: 1, february: 1,
            mar: 2, march: 2,
            apr: 3, april: 3,
            may: 4,
            jun: 5, june: 5,
            jul: 6, july: 6,
            aug: 7, august: 7,
            sep: 8, september: 8,
            oct: 9, october: 9,
            nov: 10, november: 10,
            dec: 11, december: 11,
          };
          const monthNum = monthMap[month.toLowerCase()];
          if (monthNum !== undefined) {
            return new Date(parseInt(year), monthNum, parseInt(day));
          }
        } else {
          // Numeric format (DD-MM-YYYY)
          const [, day, month, year] = match;
          return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        }
      }
    }

    // Fallback to native Date parsing
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Extract table data as array of objects
 */
export function extractTable(
  $: CheerioAPI,
  tableSelector: string,
  options: {
    headerRow?: number;
    skipRows?: number[];
  } = {}
): Record<string, string>[] {
  const { headerRow = 0, skipRows = [] } = options;
  const results: Record<string, string>[] = [];

  const rows = $(tableSelector).find('tr');
  if (rows.length === 0) return results;

  // Extract headers
  const headerCells = rows.eq(headerRow).find('th, td');
  const headers: string[] = [];
  headerCells.each((_, cell) => {
    headers.push(cleanText($(cell).text()));
  });

  // Extract data rows
  rows.each((index, row) => {
    if (index <= headerRow || skipRows.includes(index)) return;

    const cells = $(row).find('td');
    if (cells.length === 0) return;

    const rowData: Record<string, string> = {};
    cells.each((cellIndex, cell) => {
      const header = headers[cellIndex] || `column_${cellIndex}`;
      rowData[header] = cleanText($(cell).text());
    });

    if (Object.keys(rowData).length > 0) {
      results.push(rowData);
    }
  });

  return results;
}

/**
 * Extract links from HTML
 */
export function extractLinks(
  $: CheerioAPI,
  selector: string,
  baseUrl?: string
): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];

  $(selector).each((_, element) => {
    const href = $(element).attr('href');
    const text = cleanText($(element).text());

    if (href) {
      const fullUrl = baseUrl && !href.startsWith('http')
        ? new URL(href, baseUrl).toString()
        : href;

      links.push({ href: fullUrl, text });
    }
  });

  return links;
}

/**
 * Extract meta tags
 */
export function extractMeta($: CheerioAPI, name: string): string | null {
  const metaTag = $(`meta[name="${name}"], meta[property="${name}"]`);
  return metaTag.attr('content') || null;
}

/**
 * Remove HTML tags and get plain text
 */
export function stripHTML(html: string): string {
  const $ = parseHTML(html);
  return cleanText($.text());
}

/**
 * Check if element exists
 */
export function elementExists($: CheerioAPI, selector: string): boolean {
  return $(selector).length > 0;
}

/**
 * Get element attribute
 */
export function getAttribute($: CheerioAPI, selector: string, attribute: string): string | null {
  return $(selector).attr(attribute) || null;
}
