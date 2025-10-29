/**
 * Query all fields for the specific 11 NSE scraped IPOs
 */
import pkg from 'pg';
const { Client } = pkg;

async function getNSEScrapedFields() {
  const client = new Client({
    connectionString: 'postgresql://postgres:Papa3Monu%401234@103.118.16.189:5432/ipodhan'
  });

  try {
    await client.connect();
    console.log('✅ Connected to VPS Production Database\n');

    // Query the 11 specific NSE scraped IPOs
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
      ORDER BY company_name
    `, [ipoNames]);

    const ipos = result.rows;
    console.log(`📊 Found ${ipos.length} NSE scraped IPOs (out of 11 expected)\n`);
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    if (ipos.length === 0) {
      console.log('❌ No NSE scraped IPOs found in database!\n');
      await client.end();
      return;
    }

    // Print as markdown table
    console.log('## NSE Scraped IPOs - All Fields\n');
    console.log('| # | Company Name | Symbol | Status | Open Date | Close Date |');
    console.log('|---|--------------|--------|--------|-----------|------------|');

    ipos.forEach((ipo, index) => {
      console.log(`| ${index + 1} | ${ipo.company_name} | ${ipo.symbol || 'NULL'} | ${ipo.status || 'NULL'} | ${ipo.open_date || 'NULL'} | ${ipo.close_date || 'NULL'} |`);
    });

    console.log('\n| # | Listing Exchange | Face Value | Lot Size | Price Min | Price Max |');
    console.log('|---|------------------|------------|----------|-----------|-----------|');

    ipos.forEach((ipo, index) => {
      console.log(`| ${index + 1} | ${ipo.listing_exchanges || 'NULL'} | ${ipo.face_value !== null ? ipo.face_value : 'NULL'} | ${ipo.lot_size !== null ? ipo.lot_size : 'NULL'} | ${ipo.price_range_min !== null ? '₹' + ipo.price_range_min : 'NULL'} | ${ipo.price_range_max !== null ? '₹' + ipo.price_range_max : 'NULL'} |`);
    });

    console.log('\n| # | Issue Size (Cr) | Segment | ISIN | Sector |');
    console.log('|---|-----------------|---------|------|--------|');

    ipos.forEach((ipo, index) => {
      const issueSize = ipo.issue_size !== null ? '₹' + parseFloat(ipo.issue_size).toFixed(2) : 'NULL';
      console.log(`| ${index + 1} | ${issueSize} | ${ipo.segment || 'NULL'} | ${ipo.isin || 'NULL'} | ${ipo.sector || 'NULL'} |`);
    });

    console.log('\n| # | Registrar ID | Allotment Date | Listing Date | Rating |');
    console.log('|---|--------------|----------------|--------------|--------|');

    ipos.forEach((ipo, index) => {
      const rating = ipo.rating !== null ? ipo.rating + '/10' : 'NULL';
      console.log(`| ${index + 1} | ${ipo.registrar_id || 'NULL'} | ${ipo.allotment_date || 'NULL'} | ${ipo.listing_date || 'NULL'} | ${rating} |`);
    });

    console.log('\n| # | Company Description | Lead Managers | Offering Type |');
    console.log('|---|---------------------|---------------|---------------|');

    ipos.forEach((ipo, index) => {
      const description = ipo.company_description || 'NULL';
      const truncatedDesc = description.length > 50 ? description.substring(0, 47) + '...' : description;
      const leadManagers = ipo.lead_managers && ipo.lead_managers.length > 0 ? ipo.lead_managers.join(', ') : 'NULL';
      console.log(`| ${index + 1} | ${truncatedDesc} | ${leadManagers} | ${ipo.offering_type || 'NULL'} |`);
    });

    console.log('\n═══════════════════════════════════════════════════════════════════════════════');

    // Print statistics
    const stats = {
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

    const total = ipos.length;

    console.log('\n## Field Population Statistics\n');
    console.log('### ✅ Fields 100% Populated:\n');
    Object.entries(stats).forEach(([field, count]) => {
      if (count === total) {
        console.log(`   ${field}: ${count}/${total} (100%)`);
      }
    });

    console.log('\n### ⚠️ Fields Partially Populated:\n');
    Object.entries(stats).forEach(([field, count]) => {
      if (count > 0 && count < total) {
        const percentage = Math.round((count / total) * 100);
        console.log(`   ${field}: ${count}/${total} (${percentage}%)`);
      }
    });

    console.log('\n### ❌ Fields 0% Populated (NULL):\n');
    Object.entries(stats).forEach(([field, count]) => {
      if (count === 0) {
        console.log(`   ${field}: ${count}/${total} (0%)`);
      }
    });

    console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');
    console.log(`📄 Total IPOs Analyzed: ${total}`);
    console.log(`📊 Total Fields Tracked: ${Object.keys(stats).length}\n`);

    await client.end();

  } catch (error) {
    console.error('❌ Failed to query IPOs:', error);
    process.exit(1);
  }
}

getNSEScrapedFields().catch(console.error);
