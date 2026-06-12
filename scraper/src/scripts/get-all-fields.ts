/**
 * Query all fields for NSE scraped IPOs in tabular format
 */
import pkg from 'pg';
const { Client } = pkg;

async function getAllFields() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('✅ Connected to VPS Production Database\n');

    // Query recently scraped IPOs (last 2 hours)
    const result = await client.query(`
      SELECT
        company_name,
        symbol,
        status,
        TO_CHAR(open_date, 'YYYY-MM-DD') as open_date,
        TO_CHAR(close_date, 'YYYY-MM-DD') as close_date,
        listing_exchanges,
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
      WHERE last_scraped_at >= NOW() - INTERVAL '2 hours'
      ORDER BY company_name
    `);

    const ipos = result.rows;
    console.log(`📊 Found ${ipos.length} recently scraped IPOs\n`);
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    if (ipos.length === 0) {
      console.log('⚠️ No IPOs found in last 2 hours. Querying most recent 15 IPOs...\n');

      const fallbackResult = await client.query(`
        SELECT
          company_name,
          symbol,
          status,
          TO_CHAR(open_date, 'YYYY-MM-DD') as open_date,
          TO_CHAR(close_date, 'YYYY-MM-DD') as close_date,
          listing_exchanges,
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
        ORDER BY last_scraped_at DESC
        LIMIT 15
      `);

      console.log(`📊 Found ${fallbackResult.rows.length} most recent IPOs\n`);
      printTable(fallbackResult.rows);
    } else {
      printTable(ipos);
    }

    await client.end();

  } catch (error) {
    console.error('❌ Failed to query IPOs:', error);
    process.exit(1);
  }
}

function printTable(ipos: any[]) {
  // Print each IPO as a detailed block
  ipos.forEach((ipo, index) => {
    console.log(`\n${index + 1}. ${ipo.company_name}`);
    console.log('─'.repeat(79));
    console.log(`   Symbol:               ${ipo.symbol || 'NULL'}`);
    console.log(`   Status:               ${ipo.status || 'NULL'}`);
    console.log(`   Open Date:            ${ipo.open_date || 'NULL'}`);
    console.log(`   Close Date:           ${ipo.close_date || 'NULL'}`);
    console.log(`   Listing Exchange:     ${ipo.listing_exchanges || 'NULL'}`);
    console.log(`   Face Value:           ${ipo.face_value !== null ? ipo.face_value : 'NULL'}`);
    console.log(`   Lot Size:             ${ipo.lot_size !== null ? ipo.lot_size : 'NULL'}`);
    console.log(`   Price Range (Min):    ${ipo.price_range_min !== null ? '₹' + ipo.price_range_min : 'NULL'}`);
    console.log(`   Price Range (Max):    ${ipo.price_range_max !== null ? '₹' + ipo.price_range_max : 'NULL'}`);
    console.log(`   Issue Size:           ${ipo.issue_size !== null ? '₹' + parseFloat(ipo.issue_size).toFixed(2) + ' Cr' : 'NULL'}`);
    console.log(`   Segment:              ${ipo.segment || 'NULL'}`);
    console.log(`   ISIN:                 ${ipo.isin || 'NULL'}`);
    console.log(`   Sector:               ${ipo.sector || 'NULL'}`);
    console.log(`   Registrar ID:         ${ipo.registrar_id || 'NULL'}`);
    console.log(`   Allotment Date:       ${ipo.allotment_date || 'NULL'}`);
    console.log(`   Listing Date:         ${ipo.listing_date || 'NULL'}`);
    console.log(`   Rating:               ${ipo.rating !== null ? ipo.rating + '/10' : 'NULL'}`);
    console.log(`   Company Description:  ${ipo.company_description || 'NULL'}`);
    console.log(`   Lead Managers:        ${ipo.lead_managers && ipo.lead_managers.length > 0 ? ipo.lead_managers.join(', ') : 'NULL'}`);
    console.log(`   Offering Type:        ${ipo.offering_type || 'NULL'}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log(`\n📄 Total IPOs: ${ipos.length}\n`);
}

getAllFields().catch(console.error);
