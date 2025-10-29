import pkg from 'pg';
const { Client } = pkg;

async function getCurrentStats() {
  const client = new Client({
    connectionString: 'postgresql://postgres:***REMOVED-CREDENTIAL***@103.118.16.189:5432/ipodhan'
  });

  await client.connect();

  // Query the 11 IPOs we know were recently scraped
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
    SELECT *
    FROM ipos
    WHERE company_name = ANY($1::text[])
  `, [ipoNames]);

  const ipos = result.rows;
  const total = ipos.length;

  console.log(`\n📊 Analyzing ${total} recently scraped IPOs\n`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Field statistics
  const stats = {
    company_name: ipos.filter(ipo => ipo.company_name).length,
    slug: ipos.filter(ipo => ipo.slug).length,
    status: ipos.filter(ipo => ipo.status).length,
    open_date: ipos.filter(ipo => ipo.open_date).length,
    close_date: ipos.filter(ipo => ipo.close_date).length,
    symbol: ipos.filter(ipo => ipo.symbol).length,
    listing_exchanges: ipos.filter(ipo => ipo.listing_exchanges).length,
    lot_size_valid: ipos.filter(ipo => ipo.lot_size && ipo.lot_size > 1).length,
    price_range_min: ipos.filter(ipo => ipo.price_range_min).length,
    price_range_max: ipos.filter(ipo => ipo.price_range_max).length,
    issue_size: ipos.filter(ipo => ipo.issue_size && parseFloat(ipo.issue_size) > 0).length,
    segment: ipos.filter(ipo => ipo.segment).length,
    isin: ipos.filter(ipo => ipo.isin).length,
    sector: ipos.filter(ipo => ipo.sector).length,
    face_value: ipos.filter(ipo => ipo.face_value).length,
    registrar_id: ipos.filter(ipo => ipo.registrar_id).length,
    allotment_date: ipos.filter(ipo => ipo.allotment_date).length,
    listing_date: ipos.filter(ipo => ipo.listing_date).length,
    rating: ipos.filter(ipo => ipo.rating).length,
    company_description: ipos.filter(ipo => ipo.company_description).length,
    lead_managers: ipos.filter(ipo => ipo.lead_managers && ipo.lead_managers.length > 0).length,
  };

  console.log('✅ FIELDS 100% POPULATED:\n');
  console.log(`   company_name:        ${stats.company_name}/${total} (${Math.round(stats.company_name/total*100)}%)`);
  console.log(`   slug:                ${stats.slug}/${total} (${Math.round(stats.slug/total*100)}%)`);
  console.log(`   status:              ${stats.status}/${total} (${Math.round(stats.status/total*100)}%)`);
  console.log(`   open_date:           ${stats.open_date}/${total} (${Math.round(stats.open_date/total*100)}%)`);
  console.log(`   close_date:          ${stats.close_date}/${total} (${Math.round(stats.close_date/total*100)}%)`);
  console.log(`   symbol:              ${stats.symbol}/${total} (${Math.round(stats.symbol/total*100)}%)`);
  console.log(`   listing_exchanges:   ${stats.listing_exchanges}/${total} (${Math.round(stats.listing_exchanges/total*100)}%)`);

  console.log('\n⚠️  FIELDS PARTIALLY POPULATED:\n');
  console.log(`   lot_size (valid):    ${stats.lot_size_valid}/${total} (${Math.round(stats.lot_size_valid/total*100)}%) - ${total - stats.lot_size_valid} have lot_size = 1 or NULL`);
  console.log(`   price_range_min:     ${stats.price_range_min}/${total} (${Math.round(stats.price_range_min/total*100)}%)`);
  console.log(`   price_range_max:     ${stats.price_range_max}/${total} (${Math.round(stats.price_range_max/total*100)}%)`);
  console.log(`   issue_size (>0):     ${stats.issue_size}/${total} (${Math.round(stats.issue_size/total*100)}%)`);

  console.log('\n❌ FIELDS 0% POPULATED:\n');
  console.log(`   segment:             ${stats.segment}/${total} (${Math.round(stats.segment/total*100 || 0)}%)`);
  console.log(`   isin:                ${stats.isin}/${total} (${Math.round(stats.isin/total*100 || 0)}%)`);
  console.log(`   sector:              ${stats.sector}/${total} (${Math.round(stats.sector/total*100 || 0)}%)`);
  console.log(`   face_value:          ${stats.face_value}/${total} (${Math.round(stats.face_value/total*100 || 0)}%)`);
  console.log(`   registrar_id:        ${stats.registrar_id}/${total} (${Math.round(stats.registrar_id/total*100 || 0)}%)`);
  console.log(`   allotment_date:      ${stats.allotment_date}/${total} (${Math.round(stats.allotment_date/total*100 || 0)}%)`);
  console.log(`   listing_date:        ${stats.listing_date}/${total} (${Math.round(stats.listing_date/total*100 || 0)}%)`);
  console.log(`   rating:              ${stats.rating}/${total} (${Math.round(stats.rating/total*100 || 0)}%)`);
  console.log(`   company_description: ${stats.company_description}/${total} (${Math.round(stats.company_description/total*100 || 0)}%)`);
  console.log(`   lead_managers:       ${stats.lead_managers}/${total} (${Math.round(stats.lead_managers/total*100 || 0)}%)`);

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  await client.end();
}

getCurrentStats().catch(console.error);
