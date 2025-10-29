/**
 * Verification script for BSE scraper results
 * Checks data completeness for recently scraped IPOs
 */

import pkg from 'pg';
const { Client } = pkg;

async function verifyBSEResults() {
  const client = new Client({
    connectionString: 'postgresql://postgres:Papa3Monu%401234@103.118.16.189:5432/ipodhan'
  });

  await client.connect();

  console.log('=== BSE SCRAPER RESULTS VERIFICATION ===\n');

  const result = await client.query(`
    SELECT
      company_name, slug, segment, offering_type, status,
      open_date, close_date, price_range_min, price_range_max,
      lot_size, issue_size, listing_exchanges, isin, symbol,
      face_value, updated_at
    FROM ipos
    ORDER BY updated_at DESC
    LIMIT 25
  `);

  const recentIPOs = result.rows;

  console.log(`Total recent IPOs: ${recentIPOs.length}\n`);

  // Field completeness stats
  let segmentCount = 0;
  let offeringTypeCount = 0;
  let priceCount = 0;
  let lotSizeCount = 0;
  let issueSizeCount = 0;
  let isinCount = 0;
  let dualListedCount = 0;

  recentIPOs.forEach((ipo, i) => {
    if (ipo.segment) segmentCount++;
    if (ipo.offering_type) offeringTypeCount++;
    if (ipo.price_range_min && ipo.price_range_max) priceCount++;
    if (ipo.lot_size && ipo.lot_size > 1) lotSizeCount++;
    if (ipo.issue_size && ipo.issue_size > 0) issueSizeCount++;
    if (ipo.isin) isinCount++;
    if (ipo.listing_exchanges && ipo.listing_exchanges.length > 1) dualListedCount++;
  });

  console.log('📊 FIELD COMPLETENESS STATISTICS:\n');
  console.log(`  Segment:        ${segmentCount}/${recentIPOs.length} (${Math.round(segmentCount/recentIPOs.length*100)}%)`);
  console.log(`  Offering Type:  ${offeringTypeCount}/${recentIPOs.length} (${Math.round(offeringTypeCount/recentIPOs.length*100)}%)`);
  console.log(`  Price Range:    ${priceCount}/${recentIPOs.length} (${Math.round(priceCount/recentIPOs.length*100)}%)`);
  console.log(`  Lot Size (>1):  ${lotSizeCount}/${recentIPOs.length} (${Math.round(lotSizeCount/recentIPOs.length*100)}%)`);
  console.log(`  Issue Size:     ${issueSizeCount}/${recentIPOs.length} (${Math.round(issueSizeCount/recentIPOs.length*100)}%)`);
  console.log(`  ISIN:           ${isinCount}/${recentIPOs.length} (${Math.round(isinCount/recentIPOs.length*100)}%)`);
  console.log(`  Dual-Listed:    ${dualListedCount}/${recentIPOs.length}`);
  console.log('');

  console.log('=== SAMPLE RECORDS (First 5) ===\n');

  recentIPOs.slice(0, 5).forEach((ipo, i) => {
    console.log(`${i+1}. ${ipo.company_name}`);
    console.log(`   Slug: ${ipo.slug}`);
    console.log(`   Segment: ${ipo.segment || 'NULL'} | Type: ${ipo.offering_type || 'NULL'}`);
    console.log(`   Status: ${ipo.status} | Dates: ${ipo.open_date} to ${ipo.close_date}`);
    console.log(`   Price: ₹${ipo.price_range_min || 'N/A'}-${ipo.price_range_max || 'N/A'} | Lot: ${ipo.lot_size || 'NULL'} | FV: ₹${ipo.face_value || 'NULL'}`);
    console.log(`   Issue Size: ₹${ipo.issue_size ? ipo.issue_size.toLocaleString() : 'NULL'}`);
    console.log(`   Exchange: ${ipo.listing_exchanges?.join(', ') || 'NULL'} | Symbol: ${ipo.symbol || 'NULL'}`);
    console.log(`   ISIN: ${ipo.isin || 'NULL'}`);
    console.log(`   Updated: ${ipo.updated_at}`);
    console.log('');
  });

  await client.end();
  process.exit(0);
}

verifyBSEResults().catch(console.error);
