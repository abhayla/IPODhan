/**
 * Peer Companies Scraper
 *
 * Scrapes peer company data from Moneycontrol for comparative analysis
 * Data includes: P/E, EPS, ROE, RONW, NAV, Market Cap
 *
 * Source: Moneycontrol sector pages + individual company pages
 * Schedule: Daily at 4 AM IST
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { getSectorCode } from '../config/sector-codes.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry-utils.js';

export interface ScrapedPeerCompany {
  companyName: string;
  symbol: string | null;
  sector: string;
  isListed: boolean;
  marketCap?: number; // in Crores
  peRatio?: number;
  eps?: number;
  dilutedEps?: number;
  ronw?: number;
  nav?: number;
  pbvRatio?: number;
  dataSource: 'MONEYCONTROL' | 'SCREENER' | 'NSE' | 'CHITTORGARH';
}

export interface PeerMetrics {
  marketCap?: number;
  peRatio?: number;
  eps?: number;
  dilutedEps?: number;
  ronw?: number;
  nav?: number;
  pbvRatio?: number;
}

/**
 * Scrape peer companies for a given IPO
 *
 * @param ipoId - IPO identifier
 * @param sector - IPO sector (e.g., "FMCG", "IT Services")
 * @returns Array of scraped peer companies
 */
export async function scrapePeerCompanies(
  ipoId: string,
  sector: string
): Promise<ScrapedPeerCompany[]> {
  logger.info(`[Peer Companies] Starting scraping for IPO ${ipoId}, sector: ${sector}`);

  // Step 1: Get sector code mapping
  const sectorCode = getSectorCode(sector);
  if (!sectorCode) {
    logger.warn(`[Peer Companies] Unknown sector: ${sector}`);
    return [];
  }

  logger.info(`[Peer Companies] Sector code resolved: ${sector} → ${sectorCode}`);

  try {
    // Step 2: Scrape Moneycontrol sector page for top companies
    const peers = await scrapeSectorTopCompanies(sector, sectorCode);

    if (peers.length === 0) {
      logger.warn(`[Peer Companies] No peers found for sector: ${sector}`);
      return [];
    }

    logger.info(`[Peer Companies] Found ${peers.length} peer companies`);

    // Step 3: For each peer, get detailed metrics
    for (const peer of peers) {
      try {
        const metrics = await scrapePeerMetrics(peer.symbol || peer.companyName);
        Object.assign(peer, metrics);
        logger.debug(`[Peer Companies] Fetched metrics for: ${peer.companyName}`);
      } catch (error: any) {
        logger.warn(`[Peer Companies] Failed to fetch metrics for ${peer.companyName}: ${error.message}`);
        // Continue with partial data
      }
    }

    logger.info(`[Peer Companies] ✓ Successfully scraped ${peers.length} peer companies`);
    return peers;

  } catch (error: any) {
    logger.error(`[Peer Companies] Failed to scrape peers for sector ${sector}:`, error);
    throw error;
  }
}

/**
 * Scrape top companies from Moneycontrol sector page
 *
 * @param sector - Sector name
 * @param sectorCode - Moneycontrol sector code
 * @returns Array of basic peer company info
 */
async function scrapeSectorTopCompanies(
  sector: string,
  sectorCode: string
): Promise<ScrapedPeerCompany[]> {
  const url = `https://www.moneycontrol.com/stocks/marketstats/indcomp.php?optex=NSE&indcode=${sectorCode}`;

  logger.debug(`[Peer Companies] Fetching sector page: ${url}`);

  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);

  const peers: ScrapedPeerCompany[] = [];

  // Extract top 5 companies from sector table
  // Table structure: Company Name | Price | % Change | Market Cap | P/E
  $('table.tbldata14 tr').slice(1, 6).each((i, row) => {
    try {
      const $row = $(row);
      const $cells = $row.find('td');

      if ($cells.length >= 4) {
        const companyName = $cells.eq(0).find('a').text().trim() || $cells.eq(0).text().trim();
        const marketCapText = $cells.eq(3).text().trim();
        const peRatioText = $cells.eq(4).text().trim();

        if (companyName) {
          peers.push({
            companyName: cleanCompanyName(companyName),
            symbol: extractSymbol(companyName),
            sector,
            isListed: true,
            marketCap: parseMarketCap(marketCapText),
            peRatio: parseFloat(peRatioText) || undefined,
            dataSource: 'MONEYCONTROL'
          });
        }
      }
    } catch (error: any) {
      logger.warn(`[Peer Companies] Failed to parse row ${i}:`, error.message);
    }
  });

  return peers;
}

/**
 * Scrape detailed metrics for a peer company
 *
 * @param symbolOrName - Stock symbol or company name
 * @returns Peer metrics
 */
async function scrapePeerMetrics(symbolOrName: string): Promise<PeerMetrics> {
  // Try to scrape from Moneycontrol company page
  const url = `https://www.moneycontrol.com/india/stockpricequote/${symbolOrName}`;

  try {
    const html = await fetchWithRetry(url);
    const $ = cheerio.load(html);

    const metrics: PeerMetrics = {};

    // Extract metrics from "Key Ratios" section
    // Pattern: <span class="nseinfovalue">Value</span>
    $('div.keyratio tr').each((_, row) => {
      const $row = $(row);
      const label = $row.find('td').first().text().trim().toLowerCase();
      const value = $row.find('td').last().text().trim();

      if (label.includes('p/e ratio')) {
        metrics.peRatio = parseFloat(value);
      } else if (label.includes('eps')) {
        metrics.eps = parseFloat(value);
      } else if (label.includes('diluted eps')) {
        metrics.dilutedEps = parseFloat(value);
      } else if (label.includes('ronw') || label.includes('return on net worth')) {
        metrics.ronw = parseFloat(value);
      } else if (label.includes('nav') || label.includes('book value')) {
        metrics.nav = parseFloat(value);
      } else if (label.includes('p/b') || label.includes('price to book')) {
        metrics.pbvRatio = parseFloat(value);
      } else if (label.includes('market cap')) {
        metrics.marketCap = parseMarketCap(value);
      }
    });

    return metrics;

  } catch (error: any) {
    logger.debug(`[Peer Companies] Failed to scrape Moneycontrol metrics: ${error.message}`);

    // Fallback: Try Screener.in
    return await scrapePeerMetricsFromScreener(symbolOrName);
  }
}

/**
 * Fallback: Scrape peer metrics from Screener.in
 *
 * @param symbol - Stock symbol
 * @returns Peer metrics
 */
async function scrapePeerMetricsFromScreener(symbol: string): Promise<PeerMetrics> {
  const url = `https://www.screener.in/company/${symbol}/`;

  try {
    const html = await fetchWithRetry(url);
    const $ = cheerio.load(html);

    const metrics: PeerMetrics = {};

    // Extract metrics from Screener's ratio section
    $('ul.ratios li').each((_, li) => {
      const $li = $(li);
      const label = $li.find('span.name').text().trim().toLowerCase();
      const value = $li.find('span.value').text().trim();

      if (label.includes('stock p/e')) {
        metrics.peRatio = parseFloat(value);
      } else if (label.includes('eps')) {
        metrics.eps = parseFloat(value);
      } else if (label.includes('roe') || label.includes('return on equity')) {
        metrics.ronw = parseFloat(value);
      } else if (label.includes('book value')) {
        metrics.nav = parseFloat(value);
      } else if (label.includes('price to book')) {
        metrics.pbvRatio = parseFloat(value);
      }
    });

    metrics.dataSource = 'SCREENER' as any;
    return metrics;

  } catch (error: any) {
    logger.warn(`[Peer Companies] Failed to scrape Screener metrics: ${error.message}`);
    return {};
  }
}

/**
 * Fetch URL with retry logic
 */
async function fetchWithRetry(url: string): Promise<string> {
  return withRetry(
    async () => {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br'
        },
        timeout: 30000
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.data;
    },
    {
      maxRetries: 3,
      initialDelay: 1000,
      backoffMultiplier: 2,
      onRetry: (attempt, error) => {
        logger.warn(`[Peer Companies] Retry attempt ${attempt} for ${url}: ${error.message}`);
      }
    }
  );
}

/**
 * Clean company name (remove exchange codes, etc.)
 */
function cleanCompanyName(name: string): string {
  return name
    .replace(/\s*\([A-Z0-9]+\)\s*$/, '') // Remove (NSE) suffix
    .replace(/\s+Ltd\.?\s*$/i, ' Ltd')   // Normalize Ltd
    .replace(/\s+Limited\s*$/i, ' Limited')
    .trim();
}

/**
 * Extract stock symbol from company name
 * Pattern: "Company Name (SYMBOL)"
 */
function extractSymbol(companyName: string): string | null {
  const match = companyName.match(/\(([A-Z0-9]+)\)/);
  return match ? match[1] : null;
}

/**
 * Parse market cap text to number (in Crores)
 * Examples: "₹1,234 Cr", "₹5.6 L Cr", "1234.56"
 */
function parseMarketCap(text: string): number | undefined {
  if (!text) return undefined;

  // Remove currency symbols and commas
  const cleaned = text.replace(/[₹,]/g, '').trim();

  // Handle "L Cr" (Lakh Crores)
  if (cleaned.includes('L Cr')) {
    const value = parseFloat(cleaned.replace(/[^\d.]/g, ''));
    return value * 100000; // Convert lakh crores to crores
  }

  // Handle "Cr" (Crores)
  if (cleaned.includes('Cr')) {
    return parseFloat(cleaned.replace(/[^\d.]/g, ''));
  }

  // Plain number (assume crores)
  return parseFloat(cleaned) || undefined;
}

/**
 * Batch scrape peer companies for multiple IPOs
 *
 * @param ipos - Array of IPO objects with id and sector
 * @returns Map of ipoId to peer companies
 */
export async function batchScrapePeerCompanies(
  ipos: Array<{ id: string; sector: string | null; companyName: string }>
): Promise<Map<string, ScrapedPeerCompany[]>> {
  const results = new Map<string, ScrapedPeerCompany[]>();

  for (const ipo of ipos) {
    if (!ipo.sector) {
      logger.warn(`[Peer Companies] Skipping ${ipo.companyName} - no sector`);
      continue;
    }

    try {
      const peers = await scrapePeerCompanies(ipo.id, ipo.sector);
      results.set(ipo.id, peers);

      // Rate limiting: wait 2 seconds between IPOs
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error: any) {
      logger.error(`[Peer Companies] Failed for ${ipo.companyName}:`, error);
      results.set(ipo.id, []); // Store empty array for failed scrapes
    }
  }

  return results;
}
