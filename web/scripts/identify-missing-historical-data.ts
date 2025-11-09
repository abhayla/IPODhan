/**
 * Identify Missing Historical Data - Priority 2
 *
 * Generates a structured worksheet for manual data entry of:
 * - IPOs missing lot_size (23 expected)
 * - IPOs missing price_band (2 expected)
 *
 * Output: CSV file for easy manual entry tracking
 *
 * Usage:
 *   npm run identify-missing-data
 */

import { db } from '@/lib/db/index';
import { ipos } from '@ipodhan/shared/db/schema';
import { isNull, or, and, eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

interface MissingDataIPO {
  id: string;
  companyName: string;
  symbol: string | null;
  segment: string | null;
  status: string;
  openDate: Date | null;
  closeDate: Date | null;
  lotSize: number | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  issueSize: number | null;
  isin: string | null;
  missingFields: string[];
  researchLinks: {
    nse?: string;
    bse?: string;
    moneycontrol?: string;
  };
}

async function identifyMissingData() {
  console.log('🔍 Identifying IPOs with missing historical data...\n');

  // Find IPOs missing lot_size OR price_band
  const missingDataIPOs = await db
    .select({
      id: ipos.id,
      companyName: ipos.companyName,
      symbol: ipos.symbol,
      segment: ipos.segment,
      status: ipos.status,
      openDate: ipos.openDate,
      closeDate: ipos.closeDate,
      lotSize: ipos.lotSize,
      priceRangeMin: ipos.priceRangeMin,
      priceRangeMax: ipos.priceRangeMax,
      issueSize: ipos.issueSize,
      isin: ipos.isin,
      slug: ipos.slug,
    })
    .from(ipos)
    .where(
      or(
        isNull(ipos.lotSize),
        and(
          isNull(ipos.priceRangeMin),
          isNull(ipos.priceRangeMax)
        )
      )
    )
    .orderBy(ipos.openDate);

  console.log(`Found ${missingDataIPOs.length} IPOs with missing data\n`);

  // Categorize by missing fields
  const results: MissingDataIPO[] = missingDataIPOs.map(ipo => {
    const missingFields: string[] = [];

    if (ipo.lotSize === null) {
      missingFields.push('lot_size');
    }

    if (ipo.priceRangeMin === null || ipo.priceRangeMax === null) {
      missingFields.push('price_band');
    }

    // Generate research links
    const researchLinks: MissingDataIPO['researchLinks'] = {};

    if (ipo.symbol) {
      // NSE IPO page (if symbol exists)
      researchLinks.nse = `https://www.nseindia.com/market-data/ipo-watch`;

      // BSE IPO page
      researchLinks.bse = `https://www.bseindia.com/markets/PublicIssues/IPOIssues_new.aspx`;

      // Moneycontrol search
      const searchQuery = encodeURIComponent(ipo.companyName);
      researchLinks.moneycontrol = `https://www.moneycontrol.com/india/stockpricequote/${searchQuery}`;
    }

    return {
      ...ipo,
      missingFields,
      researchLinks,
    };
  });

  // Summary statistics
  const missingLotSize = results.filter(r => r.missingFields.includes('lot_size'));
  const missingPriceBand = results.filter(r => r.missingFields.includes('price_band'));
  const missingBoth = results.filter(r =>
    r.missingFields.includes('lot_size') && r.missingFields.includes('price_band')
  );

  console.log('📊 Summary Statistics:');
  console.log(`   Missing lot_size: ${missingLotSize.length}`);
  console.log(`   Missing price_band: ${missingPriceBand.length}`);
  console.log(`   Missing both: ${missingBoth.length}`);
  console.log(`   Total IPOs: ${results.length}\n`);

  // Segment breakdown
  const segments = results.reduce((acc, ipo) => {
    const seg = ipo.segment || 'NULL';
    acc[seg] = (acc[seg] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('📈 Segment Breakdown:');
  Object.entries(segments).forEach(([seg, count]) => {
    console.log(`   ${seg}: ${count}`);
  });
  console.log();

  // Generate CSV worksheet
  await generateCSVWorksheet(results);

  // Generate JSON report
  await generateJSONReport(results);

  // Display first 5 for preview
  console.log('📋 Preview (first 5 IPOs):');
  results.slice(0, 5).forEach((ipo, idx) => {
    const openDateStr = ipo.openDate
      ? (ipo.openDate instanceof Date ? ipo.openDate.toISOString().split('T')[0] : String(ipo.openDate).split('T')[0])
      : 'N/A';

    console.log(`\n${idx + 1}. ${ipo.companyName}`);
    console.log(`   Symbol: ${ipo.symbol || 'N/A'}`);
    console.log(`   Segment: ${ipo.segment || 'NULL'}`);
    console.log(`   Status: ${ipo.status}`);
    console.log(`   Open Date: ${openDateStr}`);
    console.log(`   Missing: ${ipo.missingFields.join(', ')}`);
    console.log(`   Research Links:`);
    if (ipo.researchLinks.nse) console.log(`      NSE: ${ipo.researchLinks.nse}`);
    if (ipo.researchLinks.bse) console.log(`      BSE: ${ipo.researchLinks.bse}`);
    if (ipo.researchLinks.moneycontrol) console.log(`      MC: ${ipo.researchLinks.moneycontrol}`);
  });

  console.log('\n✅ Files generated:');
  console.log('   - web/logs/missing-data-worksheet.csv');
  console.log('   - web/logs/missing-data-report.json\n');

  return results;
}

async function generateCSVWorksheet(ipos: MissingDataIPO[]) {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const csvPath = path.join(logsDir, 'missing-data-worksheet.csv');

  // CSV Headers
  const headers = [
    'Priority',
    'Company Name',
    'Symbol',
    'Segment',
    'Status',
    'Open Date',
    'Close Date',
    'Missing Fields',
    'Current Lot Size',
    'Current Price Min',
    'Current Price Max',
    'ISIN',
    'Research NSE',
    'Research BSE',
    'Research MC',
    'Found Lot Size',
    'Found Price Min',
    'Found Price Max',
    'Notes',
  ];

  // CSV Rows
  const rows = ipos.map((ipo, idx) => {
    const priority = ipo.missingFields.length === 2 ? 'HIGH' :
                     ipo.missingFields.includes('lot_size') ? 'MEDIUM' : 'LOW';

    return [
      priority,
      `"${ipo.companyName}"`,
      ipo.symbol || '',
      ipo.segment || 'NULL',
      ipo.status,
      ipo.openDate ? (ipo.openDate instanceof Date ? ipo.openDate.toISOString().split('T')[0] : String(ipo.openDate).split('T')[0]) : '',
      ipo.closeDate ? (ipo.closeDate instanceof Date ? ipo.closeDate.toISOString().split('T')[0] : String(ipo.closeDate).split('T')[0]) : '',
      ipo.missingFields.join('+'),
      ipo.lotSize || '',
      ipo.priceRangeMin || '',
      ipo.priceRangeMax || '',
      ipo.isin || '',
      ipo.researchLinks.nse || '',
      ipo.researchLinks.bse || '',
      ipo.researchLinks.moneycontrol || '',
      '', // Found Lot Size (to be filled)
      '', // Found Price Min (to be filled)
      '', // Found Price Max (to be filled)
      '', // Notes (to be filled)
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');

  fs.writeFileSync(csvPath, csv, 'utf-8');
  console.log(`📄 CSV worksheet saved: ${csvPath}`);
}

async function generateJSONReport(ipos: MissingDataIPO[]) {
  const logsDir = path.join(process.cwd(), 'logs');
  const jsonPath = path.join(logsDir, 'missing-data-report.json');

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: ipos.length,
      missingLotSize: ipos.filter(r => r.missingFields.includes('lot_size')).length,
      missingPriceBand: ipos.filter(r => r.missingFields.includes('price_band')).length,
      missingBoth: ipos.filter(r =>
        r.missingFields.includes('lot_size') && r.missingFields.includes('price_band')
      ).length,
    },
    ipos: ipos.map(ipo => ({
      id: ipo.id,
      companyName: ipo.companyName,
      symbol: ipo.symbol,
      segment: ipo.segment,
      status: ipo.status,
      openDate: ipo.openDate,
      closeDate: ipo.closeDate,
      missingFields: ipo.missingFields,
      currentData: {
        lotSize: ipo.lotSize,
        priceRangeMin: ipo.priceRangeMin,
        priceRangeMax: ipo.priceRangeMax,
        isin: ipo.isin,
      },
      researchLinks: ipo.researchLinks,
    })),
  };

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`📄 JSON report saved: ${jsonPath}`);
}

// Run if executed directly
if (require.main === module) {
  identifyMissingData()
    .then(() => {
      console.log('✅ Missing data identification complete!\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Error identifying missing data:', error);
      process.exit(1);
    });
}

export { identifyMissingData };
