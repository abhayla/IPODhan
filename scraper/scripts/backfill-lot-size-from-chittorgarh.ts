/**
 * Backfill Lot Size from Chittorgarh - Scraper Enhancement Option B
 *
 * This script backfills missing lot_size data by scraping from Chittorgarh.com,
 * which maintains comprehensive historical IPO data even after IPOs are listed.
 *
 * **Why Chittorgarh?**
 * - BSE/NSE remove lot_size data after IPO lists
 * - Chittorgarh keeps complete historical records
 * - Their data format is consistent and reliable
 *
 * **Approach**:
 * 1. Fetch list of IPOs with missing lot_size from database
 * 2. Search Chittorgarh for each IPO by company name
 * 3. Extract lot_size from Chittorgarh's IPO detail page
 * 4. Update database with extracted lot_size
 * 5. Log successes/failures for manual review
 *
 * **Estimated Coverage**: 60-85% (200-290 of 342 IPOs)
 *
 * Usage:
 *   npm run backfill-lot-size              # Dry-run (preview only)
 *   npm run backfill-lot-size --execute    # Execute updates
 *   npm run backfill-lot-size --limit 10   # Test on 10 IPOs first
 */

import { db } from '@ipodhan/shared';
import { ipos } from '@ipodhan/shared/db/schema';
import { isNull, or, and, sql } from 'drizzle-orm';
import * as cheerio from 'cheerio';
import logger from '../src/utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

interface BackfillCandidate {
  id: string;
  companyName: string;
  symbol: string | null;
  segment: string | null;
  status: string;
  openDate: Date | null;
  closeDate: Date | null;
}

interface BackfillResult {
  id: string;
  companyName: string;
  success: boolean;
  lotSizeFound?: number;
  source?: string;
  error?: string;
  chittorgarhUrl?: string;
}

interface ChittorgarhIPO {
  companyName: string;
  lotSize: number;
  url: string;
  openDate: string;
  closeDate: string;
}

/**
 * Fetch Chittorgarh IPO list page and extract IPO URLs
 */
async function fetchChittorgarhIPOList(): Promise<Map<string, string>> {
  logger.info('Fetching Chittorgarh IPO list...');

  const baseUrl = 'https://www.chittorgarh.com';
  const listUrl = `${baseUrl}/report/ipo-list-ipo-summary/82/`;

  try {
    const response = await fetch(listUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const ipoMap = new Map<string, string>();

    // Extract IPO links from the table
    $('table tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length === 0) return;

      // First cell usually contains company name link
      const link = $(cells[0]).find('a').first();
      if (!link.length) return;

      const companyName = link.text().trim();
      const href = link.attr('href');

      if (href && companyName) {
        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
        ipoMap.set(companyName.toLowerCase(), fullUrl);
      }
    });

    logger.info({ count: ipoMap.size }, 'Fetched Chittorgarh IPO URLs');
    return ipoMap;
  } catch (error) {
    logger.error({ error }, 'Failed to fetch Chittorgarh IPO list');
    return new Map();
  }
}

/**
 * Search Chittorgarh for IPO by company name (fuzzy matching)
 */
function findChittorgarhIPO(
  companyName: string,
  ipoMap: Map<string, string>
): string | null {
  const normalized = companyName.toLowerCase()
    .replace(/\s+ipo$/i, '')
    .replace(/\s+ltd\.?$/i, '')
    .replace(/\s+limited$/i, '')
    .trim();

  // Exact match
  if (ipoMap.has(normalized)) {
    return ipoMap.get(normalized)!;
  }

  // Partial match (contains)
  for (const [key, url] of ipoMap.entries()) {
    if (key.includes(normalized) || normalized.includes(key)) {
      logger.debug({ companyName, match: key }, 'Found partial match');
      return url;
    }
  }

  return null;
}

/**
 * Scrape lot_size from Chittorgarh IPO detail page
 */
async function scrapeChittorgarhIPODetail(url: string): Promise<ChittorgarhIPO | null> {
  try {
    logger.debug({ url }, 'Scraping Chittorgarh detail page');

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      logger.warn({ url, status: response.status }, 'HTTP error');
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract company name
    const companyName = $('h1').first().text().trim();

    // Extract lot size (various possible labels)
    let lotSize = 0;
    const lotSizeLabels = ['Lot Size', 'Market Lot', 'Minimum Application', 'Application Size'];

    $('table tr, .ipo-detail-row').each((_, row) => {
      const label = $(row).find('td:first-child, .label').text().trim();
      const value = $(row).find('td:last-child, .value').text().trim();

      for (const searchLabel of lotSizeLabels) {
        if (label.includes(searchLabel)) {
          // Extract number from value (e.g., "100 shares" -> 100)
          const match = value.match(/(\d+)/);
          if (match) {
            lotSize = parseInt(match[1], 10);
            logger.debug({ label, value, lotSize }, 'Found lot size');
            return false; // break
          }
        }
      }
    });

    // Extract dates
    let openDate = '';
    let closeDate = '';

    $('table tr, .ipo-detail-row').each((_, row) => {
      const label = $(row).find('td:first-child, .label').text().trim();
      const value = $(row).find('td:last-child, .value').text().trim();

      if (label.includes('Open Date') || label.includes('Opening Date')) {
        openDate = value;
      }
      if (label.includes('Close Date') || label.includes('Closing Date')) {
        closeDate = value;
      }
    });

    if (lotSize === 0) {
      logger.warn({ url, companyName }, 'Lot size not found on page');
      return null;
    }

    return {
      companyName,
      lotSize,
      url,
      openDate,
      closeDate,
    };
  } catch (error) {
    logger.error({ url, error }, 'Error scraping Chittorgarh detail');
    return null;
  }
}

/**
 * Backfill lot_size for missing IPOs
 */
async function backfillLotSizes(options: {
  dryRun: boolean;
  limit?: number;
}) {
  logger.info({ options }, 'Starting lot_size backfill from Chittorgarh');

  // Fetch candidates
  const candidates = await db
    .select({
      id: ipos.id,
      companyName: ipos.companyName,
      symbol: ipos.symbol,
      segment: ipos.segment,
      status: ipos.status,
      openDate: ipos.openDate,
      closeDate: ipos.closeDate,
    })
    .from(ipos)
    .where(isNull(ipos.lotSize))
    .orderBy(sql`${ipos.openDate} DESC NULLS LAST`)
    .limit(options.limit || 10000);

  logger.info({ total: candidates.length }, 'Found IPOs with missing lot_size');

  if (candidates.length === 0) {
    logger.info('No IPOs with missing lot_size found');
    return;
  }

  // Fetch Chittorgarh IPO map
  const chittorgarhMap = await fetchChittorgarhIPOList();

  if (chittorgarhMap.size === 0) {
    logger.error('Failed to fetch Chittorgarh IPO list - cannot proceed');
    return;
  }

  const results: BackfillResult[] = [];
  let successCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;

  // Process each candidate
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    logger.info(
      { progress: `${i + 1}/${candidates.length}`, companyName: candidate.companyName },
      'Processing IPO'
    );

    try {
      // Search for IPO on Chittorgarh
      const chittorgarhUrl = findChittorgarhIPO(candidate.companyName, chittorgarhMap);

      if (!chittorgarhUrl) {
        logger.warn({ companyName: candidate.companyName }, 'Not found on Chittorgarh');
        notFoundCount++;
        results.push({
          id: candidate.id,
          companyName: candidate.companyName,
          success: false,
          error: 'Not found on Chittorgarh',
        });
        continue;
      }

      // Scrape detail page
      const detail = await scrapeChittorgarhIPODetail(chittorgarhUrl);

      if (!detail || detail.lotSize === 0) {
        logger.warn({ companyName: candidate.companyName, url: chittorgarhUrl }, 'Lot size not found');
        notFoundCount++;
        results.push({
          id: candidate.id,
          companyName: candidate.companyName,
          success: false,
          error: 'Lot size not found on detail page',
          chittorgarhUrl,
        });
        continue;
      }

      logger.info(
        {
          companyName: candidate.companyName,
          lotSize: detail.lotSize,
          url: chittorgarhUrl,
        },
        'Found lot_size'
      );

      // Update database (if not dry-run)
      if (!options.dryRun) {
        await db
          .update(ipos)
          .set({
            lotSize: detail.lotSize,
            updatedAt: new Date(),
          })
          .where(sql`${ipos.id} = ${candidate.id}`);

        logger.info({ companyName: candidate.companyName, lotSize: detail.lotSize }, 'Updated database');
      }

      successCount++;
      results.push({
        id: candidate.id,
        companyName: candidate.companyName,
        success: true,
        lotSizeFound: detail.lotSize,
        source: 'Chittorgarh',
        chittorgarhUrl,
      });

      // Rate limiting - wait 1-2 seconds between requests
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));
    } catch (error) {
      logger.error({ companyName: candidate.companyName, error }, 'Error processing IPO');
      errorCount++;
      results.push({
        id: candidate.id,
        companyName: candidate.companyName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 Backfill Summary');
  console.log('='.repeat(80));
  console.log(`Total IPOs processed: ${candidates.length}`);
  console.log(`✅ Success: ${successCount} (${((successCount / candidates.length) * 100).toFixed(1)}%)`);
  console.log(`❌ Not found: ${notFoundCount} (${((notFoundCount / candidates.length) * 100).toFixed(1)}%)`);
  console.log(`⚠️  Errors: ${errorCount} (${((errorCount / candidates.length) * 100).toFixed(1)}%)`);
  console.log(`\nMode: ${options.dryRun ? 'DRY-RUN (no database updates)' : 'EXECUTE (database updated)'}`);
  console.log('='.repeat(80) + '\n');

  // Save results log
  const logsDir = path.join(process.cwd(), '../web/logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const logPath = path.join(logsDir, 'lot-size-backfill-results.json');
  const logData = {
    timestamp: new Date().toISOString(),
    dryRun: options.dryRun,
    summary: {
      total: candidates.length,
      success: successCount,
      notFound: notFoundCount,
      errors: errorCount,
      successRate: ((successCount / candidates.length) * 100).toFixed(1) + '%',
    },
    results,
  };

  fs.writeFileSync(logPath, JSON.stringify(logData, null, 2), 'utf-8');
  logger.info({ logPath }, 'Results log saved');

  return logData;
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--execute');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? parseInt(args[limitIndex + 1], 10) : undefined;

  if (dryRun) {
    console.log('🔍 DRY-RUN MODE: No database updates will be made\n');
    console.log('To execute updates, run: npm run backfill-lot-size:execute\n');
  } else {
    console.log('⚠️  EXECUTE MODE: Database will be updated\n');
  }

  if (limit) {
    console.log(`📊 Testing on first ${limit} IPOs\n`);
  }

  await backfillLotSizes({ dryRun, limit });

  console.log('\n✅ Backfill complete!\n');
  process.exit(0);
}

// Auto-run if this is the main module
const isMain = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  main().catch((error) => {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  });
}

export { backfillLotSizes, scrapeChittorgarhIPODetail, fetchChittorgarhIPOList };
