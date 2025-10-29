/**
 * Query all fields for MAINBOARD and SME IPOs only (exclude RIGHTS)
 */
import pkg from 'pg';
const { Client } = pkg;

async function getMainboardSMEFields() {
  const client = new Client({
    connectionString: 'postgresql://postgres:Papa3Monu%401234@103.118.16.189:5432/ipodhan'
  });

  try {
    await client.connect();
    console.log('✅ Connected to VPS Production Database\n');

    // Query the 11 specific NSE scraped IPOs, filtering for MAINBOARD and SME only
    const ipoNames = [
      'Cool Caps Industries Limited',
      'Capital Trust Limited',
      'Utkarsh Small Finance Bank Limited',
      'SEPC Limited - Call Money',
      'Indian Emulsifiers Limited',
      'Delphi World Money Limited',
      'Shreeji Global FMCG Limited',
      'Jayesh Logistics Limited',
      'Studds Accessories Limited',
      'Lenskart Solutions Limited',
      'Orkla India Limited'
    ];

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
      WHERE company_name = ANY($1::text[])
        AND segment IS NOT NULL
        AND offering_type = 'IPO'
      ORDER BY segment, company_name
    `, [ipoNames]);

    const ipos = result.rows;
    console.log(`📊 Found ${ipos.length} MAINBOARD/SME IPOs (out of 11 total)\n`);
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    if (ipos.length === 0) {
      console.log('❌ No MAINBOARD or SME IPOs found in database!\n');
      await client.end();
      return;
    }

    // Print as detailed blocks
    console.log('## MAINBOARD and SME IPOs - All Fields\n');

    // Group by segment
    const mainboardIPOs = ipos.filter(ipo => ipo.segment === 'MAINBOARD');
    const smeIPOs = ipos.filter(ipo => ipo.segment === 'SME');

    if (mainboardIPOs.length > 0) {
      console.log('### 🏢 MAINBOARD IPOs (' + mainboardIPOs.length + ')\n');
      printIPOTable(mainboardIPOs);
    }

    if (smeIPOs.length > 0) {
      console.log('\n### 🏭 SME IPOs (' + smeIPOs.length + ')\n');
      printIPOTable(smeIPOs);
    }

    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
    console.log(`\n📊 Summary:`);
    console.log(`   MAINBOARD IPOs: ${mainboardIPOs.length}`);
    console.log(`   SME IPOs: ${smeIPOs.length}`);
    console.log(`   Total: ${ipos.length}`);
    console.log(`   RIGHTS offerings excluded: ${11 - ipos.length}\n`);

    await client.end();

  } catch (error) {
    console.error('❌ Failed to query IPOs:', error);
    process.exit(1);
  }
}

function printIPOTable(ipos: any[]) {
  console.log('| # | Company Name | Symbol | Status | Segment |');
  console.log('|---|--------------|--------|--------|---------|');
  ipos.forEach((ipo, index) => {
    console.log(`| ${index + 1} | ${ipo.company_name} | ${ipo.symbol || 'NULL'} | ${ipo.status || 'NULL'} | ${ipo.segment || 'NULL'} |`);
  });

  console.log('\n| # | Open Date | Close Date | Listing Exchange | Face Value | Lot Size |');
  console.log('|---|-----------|------------|------------------|------------|----------|');
  ipos.forEach((ipo, index) => {
    console.log(`| ${index + 1} | ${ipo.open_date || 'NULL'} | ${ipo.close_date || 'NULL'} | ${ipo.listing_exchanges || 'NULL'} | ${ipo.face_value !== null ? ipo.face_value : 'NULL'} | ${ipo.lot_size !== null ? ipo.lot_size : 'NULL'} |`);
  });

  console.log('\n| # | Price Min | Price Max | Issue Size (Cr) | Offering Type |');
  console.log('|---|-----------|-----------|-----------------|---------------|');
  ipos.forEach((ipo, index) => {
    const issueSize = ipo.issue_size !== null ? '₹' + parseFloat(ipo.issue_size).toFixed(2) : 'NULL';
    console.log(`| ${index + 1} | ${ipo.price_range_min !== null ? '₹' + ipo.price_range_min : 'NULL'} | ${ipo.price_range_max !== null ? '₹' + ipo.price_range_max : 'NULL'} | ${issueSize} | ${ipo.offering_type || 'NULL'} |`);
  });

  console.log('\n| # | ISIN | Sector | Registrar ID | Rating |');
  console.log('|---|------|--------|--------------|--------|');
  ipos.forEach((ipo, index) => {
    const rating = ipo.rating !== null ? ipo.rating + '/10' : 'NULL';
    console.log(`| ${index + 1} | ${ipo.isin || 'NULL'} | ${ipo.sector || 'NULL'} | ${ipo.registrar_id || 'NULL'} | ${rating} |`);
  });

  console.log('\n| # | Allotment Date | Listing Date | Company Description | Lead Managers |');
  console.log('|---|----------------|--------------|---------------------|---------------|');
  ipos.forEach((ipo, index) => {
    const description = ipo.company_description || 'NULL';
    const truncatedDesc = description.length > 30 ? description.substring(0, 27) + '...' : description;
    const leadManagers = ipo.lead_managers && ipo.lead_managers.length > 0 ? ipo.lead_managers.join(', ') : 'NULL';
    const truncatedManagers = leadManagers.length > 30 ? leadManagers.substring(0, 27) + '...' : leadManagers;
    console.log(`| ${index + 1} | ${ipo.allotment_date || 'NULL'} | ${ipo.listing_date || 'NULL'} | ${truncatedDesc} | ${truncatedManagers} |`);
  });
}

getMainboardSMEFields().catch(console.error);
