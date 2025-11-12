/**
 * Filter Priority IPOs for Manual Entry
 *
 * Filters missing-data-worksheet.csv to show only high-priority IPOs:
 * - MAINBOARD segment
 * - OPEN or UPCOMING status
 *
 * Usage:
 *   npm run filter-priority-ipos
 */

import * as fs from 'fs';
import * as path from 'path';
import { db } from '@/lib/db/index';
import { ipos } from '@ipodhan/shared/db/schema';
import { isNull, and, or, eq, inArray } from 'drizzle-orm';

interface PriorityIPO {
  id: string;
  companyName: string;
  symbol: string | null;
  segment: string | null;
  status: string;
  openDate: Date | null;
  closeDate: Date | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
}

async function filterPriorityIPOs() {
  console.log('🔍 Filtering high-priority IPOs for manual entry\n');

  // Fetch high-priority IPOs (MAINBOARD, OPEN/UPCOMING, missing lot_size)
  const priorityIPOs = await db
    .select({
      id: ipos.id,
      companyName: ipos.companyName,
      symbol: ipos.symbol,
      segment: ipos.segment,
      status: ipos.status,
      openDate: ipos.openDate,
      closeDate: ipos.closeDate,
      priceRangeMin: ipos.priceRangeMin,
      priceRangeMax: ipos.priceRangeMax,
    })
    .from(ipos)
    .where(
      and(
        isNull(ipos.lotSize),
        eq(ipos.segment, 'MAINBOARD'),
        or(
          eq(ipos.status, 'OPEN'),
          eq(ipos.status, 'UPCOMING')
        )
      )
    )
    .orderBy(ipos.openDate);

  console.log(`Found ${priorityIPOs.length} high-priority IPOs\n`);

  if (priorityIPOs.length === 0) {
    console.log('✅ No high-priority IPOs with missing lot_size!');
    console.log('All MAINBOARD OPEN/UPCOMING IPOs have lot_size data.\n');
    return;
  }

  // Display results
  console.log('📋 High-Priority IPOs (MAINBOARD OPEN/UPCOMING):');
  console.log('='.repeat(80));

  priorityIPOs.forEach((ipo, idx) => {
    const openDateStr = ipo.openDate
      ? new Date(ipo.openDate).toISOString().split('T')[0]
      : 'N/A';
    const closeDateStr = ipo.closeDate
      ? new Date(ipo.closeDate).toISOString().split('T')[0]
      : 'N/A';

    console.log(`\n${idx + 1}. ${ipo.companyName}`);
    console.log(`   Symbol: ${ipo.symbol || 'N/A'}`);
    console.log(`   Status: ${ipo.status}`);
    console.log(`   Open: ${openDateStr} → Close: ${closeDateStr}`);
    console.log(`   Price Band: ₹${ipo.priceRangeMin || '?'} - ₹${ipo.priceRangeMax || '?'}`);
    console.log(`   NSE: https://www.nseindia.com/market-data/ipo-watch`);
    console.log(`   BSE: https://www.bseindia.com/markets/PublicIssues/IPOIssues_new.aspx`);
  });

  console.log('\n' + '='.repeat(80));

  // Create filtered CSV
  const logsDir = path.join(process.cwd(), 'logs');
  const csvPath = path.join(logsDir, 'priority-ipos-manual-entry.csv');

  const headers = [
    'ID',
    'Company Name',
    'Symbol',
    'Status',
    'Open Date',
    'Close Date',
    'Price Min',
    'Price Max',
    'NSE Link',
    'BSE Link',
    'LOT SIZE (TO FILL)',
    'Notes',
  ];

  const rows = priorityIPOs.map((ipo) => {
    const openDateStr = ipo.openDate
      ? new Date(ipo.openDate).toISOString().split('T')[0]
      : '';
    const closeDateStr = ipo.closeDate
      ? new Date(ipo.closeDate).toISOString().split('T')[0]
      : '';

    return [
      ipo.id,
      `"${ipo.companyName}"`,
      ipo.symbol || '',
      ipo.status,
      openDateStr,
      closeDateStr,
      ipo.priceRangeMin || '',
      ipo.priceRangeMax || '',
      'https://www.nseindia.com/market-data/ipo-watch',
      'https://www.bseindia.com/markets/PublicIssues/IPOIssues_new.aspx',
      '', // Lot size to fill
      '', // Notes
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  fs.writeFileSync(csvPath, csv, 'utf-8');

  console.log(`\n✅ Filtered CSV saved: ${csvPath}`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Open the CSV in Excel or manual-entry tool`);
  console.log(`   2. Research each IPO on NSE/BSE and fill LOT SIZE column`);
  console.log(`   3. Run: npm run manual-entry -- --csv`);
  console.log(`\nEstimated time: ${priorityIPOs.length} IPOs × 3-5 min = ${priorityIPOs.length * 3}-${priorityIPOs.length * 5} minutes\n`);
}

filterPriorityIPOs()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
