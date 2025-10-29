/**
 * Display NSE scraped IPOs in cli-table3 format
 * Shows all 20 requested fields with separate tables for MAINBOARD and SME
 */
import Table from 'cli-table3';
import pkg from 'pg';
const { Client } = pkg;

interface IPORecord {
  company_name: string;
  symbol: string | null;
  status: string | null;
  open_date: string | null;
  close_date: string | null;
  listing_exchanges: string | null;
  face_value: number | null;
  lot_size: number | null;
  price_range_min: number | null;
  price_range_max: number | null;
  issue_size: string | null;
  segment: string | null;
  isin: string | null;
  sector: string | null;
  registrar_id: string | null;
  allotment_date: string | null;
  listing_date: string | null;
  rating: number | null;
  company_description: string | null;
  lead_managers: string[] | null;
  offering_type: string | null;
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'number') return value.toString();
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : 'N/A';
  }
  if (typeof value === 'string' && value.trim() === '') return 'N/A';
  return value;
}

function truncateText(text: string, maxLength: number = 30): string {
  if (text === 'N/A') return text;
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function createIPOTable(ipos: IPORecord[], title: string): void {
  if (ipos.length === 0) {
    console.log(`\n${title}: No IPOs found\n`);
    return;
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`${title} (${ipos.length} IPO${ipos.length > 1 ? 's' : ''})`);
  console.log(`${'='.repeat(80)}\n`);

  // Table 1: Core Information
  const coreTable = new Table({
    head: ['#', 'Company Name', 'Symbol', 'Status', 'Segment'],
    colWidths: [5, 35, 12, 12, 12],
    wordWrap: true,
    style: {
      head: ['cyan', 'bold'],
      border: ['gray']
    }
  });

  ipos.forEach((ipo, index) => {
    coreTable.push([
      (index + 1).toString(),
      truncateText(formatValue(ipo.company_name), 33),
      formatValue(ipo.symbol),
      formatValue(ipo.status),
      formatValue(ipo.segment)
    ]);
  });

  console.log('📋 Core Information:');
  console.log(coreTable.toString());

  // Table 2: Dates
  const datesTable = new Table({
    head: ['#', 'Open Date', 'Close Date', 'Allotment Date', 'Listing Date'],
    colWidths: [5, 15, 15, 17, 15],
    style: {
      head: ['cyan', 'bold'],
      border: ['gray']
    }
  });

  ipos.forEach((ipo, index) => {
    datesTable.push([
      (index + 1).toString(),
      formatValue(ipo.open_date),
      formatValue(ipo.close_date),
      formatValue(ipo.allotment_date),
      formatValue(ipo.listing_date)
    ]);
  });

  console.log('\n📅 Important Dates:');
  console.log(datesTable.toString());

  // Table 3: Financial Details
  const financialTable = new Table({
    head: ['#', 'Face Value', 'Lot Size', 'Price Min', 'Price Max', 'Issue Size (Cr)'],
    colWidths: [5, 13, 12, 12, 12, 18],
    style: {
      head: ['cyan', 'bold'],
      border: ['gray']
    }
  });

  ipos.forEach((ipo, index) => {
    const faceValue = ipo.face_value !== null ? `₹${ipo.face_value}` : 'N/A';
    const priceMin = ipo.price_range_min !== null ? `₹${ipo.price_range_min}` : 'N/A';
    const priceMax = ipo.price_range_max !== null ? `₹${ipo.price_range_max}` : 'N/A';
    const issueSize = ipo.issue_size !== null ? `₹${parseFloat(ipo.issue_size).toFixed(2)}` : 'N/A';

    // Highlight invalid lot size
    const lotSize = ipo.lot_size !== null
      ? (ipo.lot_size === 1 ? `${ipo.lot_size} ⚠️` : ipo.lot_size.toString())
      : 'N/A';

    financialTable.push([
      (index + 1).toString(),
      faceValue,
      lotSize,
      priceMin,
      priceMax,
      issueSize
    ]);
  });

  console.log('\n💰 Financial Details:');
  console.log(financialTable.toString());

  // Table 4: Additional Information
  const additionalTable = new Table({
    head: ['#', 'Exchange', 'ISIN', 'Sector', 'Offering Type'],
    colWidths: [5, 12, 15, 20, 15],
    wordWrap: true,
    style: {
      head: ['cyan', 'bold'],
      border: ['gray']
    }
  });

  ipos.forEach((ipo, index) => {
    additionalTable.push([
      (index + 1).toString(),
      formatValue(ipo.listing_exchanges),
      formatValue(ipo.isin),
      truncateText(formatValue(ipo.sector), 18),
      formatValue(ipo.offering_type)
    ]);
  });

  console.log('\n📊 Additional Information:');
  console.log(additionalTable.toString());

  // Table 5: Metadata
  const metadataTable = new Table({
    head: ['#', 'Registrar ID', 'Rating', 'Lead Managers'],
    colWidths: [5, 40, 10, 35],
    wordWrap: true,
    style: {
      head: ['cyan', 'bold'],
      border: ['gray']
    }
  });

  ipos.forEach((ipo, index) => {
    const rating = ipo.rating !== null ? `${ipo.rating}/10` : 'N/A';
    const leadManagers = ipo.lead_managers && ipo.lead_managers.length > 0
      ? truncateText(ipo.lead_managers.join(', '), 33)
      : 'N/A';

    metadataTable.push([
      (index + 1).toString(),
      formatValue(ipo.registrar_id),
      rating,
      leadManagers
    ]);
  });

  console.log('\n🏢 Metadata:');
  console.log(metadataTable.toString());

  // Table 6: Company Description (separate due to length)
  const descriptionTable = new Table({
    head: ['#', 'Company Description'],
    colWidths: [5, 75],
    wordWrap: true,
    style: {
      head: ['cyan', 'bold'],
      border: ['gray']
    }
  });

  ipos.forEach((ipo, index) => {
    descriptionTable.push([
      (index + 1).toString(),
      truncateText(formatValue(ipo.company_description), 73)
    ]);
  });

  console.log('\n📝 Company Description:');
  console.log(descriptionTable.toString());
}

function printFieldStatistics(ipos: IPORecord[]): void {
  const total = ipos.length;
  if (total === 0) return;

  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 FIELD POPULATION STATISTICS');
  console.log(`${'='.repeat(80)}\n`);

  const stats: Record<string, number> = {
    company_name: ipos.filter(ipo => ipo.company_name).length,
    symbol: ipos.filter(ipo => ipo.symbol).length,
    status: ipos.filter(ipo => ipo.status).length,
    open_date: ipos.filter(ipo => ipo.open_date).length,
    close_date: ipos.filter(ipo => ipo.close_date).length,
    listing_exchanges: ipos.filter(ipo => ipo.listing_exchanges).length,
    face_value: ipos.filter(ipo => ipo.face_value !== null).length,
    lot_size_valid: ipos.filter(ipo => ipo.lot_size && ipo.lot_size > 1).length,
    lot_size_total: ipos.filter(ipo => ipo.lot_size !== null).length,
    price_range_min: ipos.filter(ipo => ipo.price_range_min !== null).length,
    price_range_max: ipos.filter(ipo => ipo.price_range_max !== null).length,
    issue_size: ipos.filter(ipo => ipo.issue_size !== null && parseFloat(ipo.issue_size) > 0).length,
    segment: ipos.filter(ipo => ipo.segment).length,
    isin: ipos.filter(ipo => ipo.isin).length,
    sector: ipos.filter(ipo => ipo.sector).length,
    registrar_id: ipos.filter(ipo => ipo.registrar_id).length,
    allotment_date: ipos.filter(ipo => ipo.allotment_date).length,
    listing_date: ipos.filter(ipo => ipo.listing_date).length,
    rating: ipos.filter(ipo => ipo.rating !== null).length,
    company_description: ipos.filter(ipo => ipo.company_description).length,
    lead_managers: ipos.filter(ipo => ipo.lead_managers && ipo.lead_managers.length > 0).length,
    offering_type: ipos.filter(ipo => ipo.offering_type).length,
  };

  const statsTable = new Table({
    head: ['Field Name', 'Populated', 'Missing', 'Percentage'],
    colWidths: [25, 12, 12, 12],
    style: {
      head: ['cyan', 'bold'],
      border: ['gray']
    }
  });

  // Sort by population percentage (high to low)
  const sortedStats = Object.entries(stats).sort((a, b) => b[1] - a[1]);

  sortedStats.forEach(([field, count]) => {
    const missing = total - count;
    const percentage = Math.round((count / total) * 100);

    // Color code based on percentage
    let percentageStr = `${percentage}%`;
    if (percentage === 100) percentageStr = `✅ ${percentage}%`;
    else if (percentage >= 50) percentageStr = `🟡 ${percentage}%`;
    else if (percentage > 0) percentageStr = `🟠 ${percentage}%`;
    else percentageStr = `❌ ${percentage}%`;

    statsTable.push([
      field,
      `${count}/${total}`,
      missing.toString(),
      percentageStr
    ]);
  });

  console.log(statsTable.toString());

  // Summary
  const fullyPopulated = Object.values(stats).filter(count => count === total).length;
  const partiallyPopulated = Object.values(stats).filter(count => count > 0 && count < total).length;
  const notPopulated = Object.values(stats).filter(count => count === 0).length;

  console.log(`\n📈 Summary:`);
  console.log(`   ✅ Fully Populated (100%): ${fullyPopulated} fields`);
  console.log(`   🟡 Partially Populated: ${partiallyPopulated} fields`);
  console.log(`   ❌ Not Populated (0%): ${notPopulated} fields`);
  console.log(`   📊 Total Fields: ${Object.keys(stats).length}`);
}

async function displayNSEScrapedFields() {
  const client = new Client({
    connectionString: 'postgresql://postgres:***REMOVED-CREDENTIAL***@103.118.16.189:5432/ipodhan'
  });

  try {
    await client.connect();
    console.log('\n✅ Connected to VPS Production Database');

    // Query IPOs scraped by NSE (updated in last 24 hours for recent data)
    const result = await client.query<IPORecord>(`
      SELECT
        company_name,
        symbol,
        status,
        TO_CHAR(open_date, 'YYYY-MM-DD') as open_date,
        TO_CHAR(close_date, 'YYYY-MM-DD') as close_date,
        listing_exchanges::text as listing_exchanges,
        face_value,
        lot_size,
        price_range_min,
        price_range_max,
        issue_size,
        segment,
        isin,
        sector,
        registrar_id,
        TO_CHAR(allotment_date, 'YYYY-MM-DD') as allotment_date,
        TO_CHAR(listing_date, 'YYYY-MM-DD') as listing_date,
        rating,
        company_description,
        lead_managers,
        offering_type
      FROM ipos
      WHERE (
        listing_exchanges::text LIKE '%NSE%'
        OR listing_exchanges::text = '"NSE"'
        OR listing_exchanges::text = 'NSE'
      )
      AND updated_at >= NOW() - INTERVAL '24 hours'
      ORDER BY
        CASE
          WHEN segment = 'MAINBOARD' THEN 1
          WHEN segment = 'SME' THEN 2
          ELSE 3
        END,
        company_name
      LIMIT 50
    `);

    const allIPOs = result.rows;
    console.log(`\n📊 Found ${allIPOs.length} NSE IPOs (updated in last 24 hours)\n`);

    if (allIPOs.length === 0) {
      console.log('❌ No recently scraped IPOs found! Run NSE scraper first.\n');
      await client.end();
      return;
    }

    // Separate by segment
    const mainboardIPOs = allIPOs.filter(ipo => ipo.segment === 'MAINBOARD');
    const smeIPOs = allIPOs.filter(ipo => ipo.segment === 'SME');
    const otherIPOs = allIPOs.filter(ipo => !ipo.segment || (ipo.segment !== 'MAINBOARD' && ipo.segment !== 'SME'));

    // Display MAINBOARD IPOs
    createIPOTable(mainboardIPOs, '🏛️  MAINBOARD IPOs');

    // Display SME IPOs
    createIPOTable(smeIPOs, '🏢 SME IPOs');

    // Display Other/Unknown IPOs
    if (otherIPOs.length > 0) {
      createIPOTable(otherIPOs, '📦 Other IPOs (RIGHTS/InvITs/REITs)');
    }

    // Print overall statistics
    printFieldStatistics(allIPOs);

    console.log(`\n${'='.repeat(80)}\n`);
    await client.end();

  } catch (error) {
    console.error('❌ Failed to query IPOs:', error);
    process.exit(1);
  }
}

displayNSEScrapedFields().catch(console.error);
