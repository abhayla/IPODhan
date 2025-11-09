/**
 * Quick Research Lot Size for Priority IPOs
 * Searches NSE/BSE for lot size data
 */

import { db } from '@/lib/db/index';
import { ipos } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';
import * as cheerio from 'cheerio';

interface IPOResearch {
  id: string;
  companyName: string;
  symbol: string | null;
  lotSize: number | null;
  source: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

const priorityIPOs = [
  { id: 'CUPID', symbol: 'CUPIDALBV', name: 'CUPID BREWERIES' },
  { id: 'SBEC', symbol: 'SBECSUG', name: 'SBEC SUGAR' },
  { id: 'SHAMROCK', symbol: 'SHAMROIN', name: 'SHAMROCK INDUSTRIAL' },
  { id: 'GARMENT', symbol: null, name: 'GARMENT MANTRA' },
];

/**
 * Search NSE for IPO lot size
 */
async function searchNSELotSize(symbol: string): Promise<number | null> {
  try {
    // NSE IPO detail API endpoint
    const url = `https://www.nseindia.com/api/ipo-detail?symbol=${symbol}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.nseindia.com/market-data/ipo-watch',
      },
    });

    if (!response.ok) {
      console.log(`  NSE API returned ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();

    if (data.lotSize) {
      return parseInt(data.lotSize, 10);
    }

    return null;
  } catch (error) {
    console.log(`  NSE search failed for ${symbol}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Search BSE for IPO lot size
 */
async function searchBSELotSize(symbol: string): Promise<number | null> {
  try {
    // BSE search - would need to scrape their pages
    // For now, return null - manual check needed
    console.log(`  BSE search for ${symbol} - manual check required`);
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Manual lot size entry with confirmation
 */
async function manualLotSizeEntry() {
  console.log('🔍 Researching lot sizes for 4 priority IPOs\n');
  console.log('=' .repeat(80));

  const results: IPOResearch[] = [];

  for (const ipo of priorityIPOs) {
    console.log(`\n${ipo.id}. ${ipo.name}`);
    console.log(`   Symbol: ${ipo.symbol || 'N/A'}`);

    if (ipo.symbol) {
      console.log(`   Searching NSE...`);
      const nseLotSize = await searchNSELotSize(ipo.symbol);

      if (nseLotSize) {
        console.log(`   ✅ Found on NSE: Lot Size = ${nseLotSize}`);
        results.push({
          id: ipo.id,
          companyName: ipo.name,
          symbol: ipo.symbol,
          lotSize: nseLotSize,
          source: 'NSE API',
          confidence: 'HIGH',
        });
        continue;
      }
    }

    console.log(`   ⚠️  Automatic search failed - Manual research needed`);
    console.log(`   NSE: https://www.nseindia.com/market-data/ipo-watch`);
    console.log(`   BSE: https://www.bseindia.com/markets/PublicIssues/IPOIssues_new.aspx`);

    results.push({
      id: ipo.id,
      companyName: ipo.name,
      symbol: ipo.symbol,
      lotSize: null,
      source: 'Manual Research Needed',
      confidence: 'LOW',
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n📊 Research Results:\n');

  results.forEach((result, idx) => {
    console.log(`${idx + 1}. ${result.companyName}`);
    console.log(`   Symbol: ${result.symbol || 'N/A'}`);
    console.log(`   Lot Size: ${result.lotSize || 'NOT FOUND'}`);
    console.log(`   Source: ${result.source}`);
    console.log(`   Confidence: ${result.confidence}\n`);
  });

  const foundCount = results.filter(r => r.lotSize !== null).length;
  console.log(`✅ Automated: ${foundCount}/4`);
  console.log(`⚠️  Manual: ${4 - foundCount}/4\n`);

  return results;
}

manualLotSizeEntry()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
