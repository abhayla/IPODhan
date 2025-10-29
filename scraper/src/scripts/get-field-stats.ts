/**
 * Get accurate field population statistics for recently scraped IPOs
 */
import pkg from 'pg';
const { Client } = pkg;

async function getFieldStats() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:***REMOVED-CREDENTIAL***@103.118.16.189:5432/ipodhan'
  });

  try {
    await client.connect();
    console.log('✅ Connected to VPS Production Database\n');

    // Query recently scraped IPOs (last 2 hours to account for timezone)
    const result = await client.query(`
      SELECT *
      FROM ipos
      WHERE last_scraped_at >= NOW() - INTERVAL '2 hours'
      ORDER BY last_scraped_at DESC
    `);

    const ipos = result.rows;
    const total = ipos.length;

    console.log(`📊 Analyzing ${total} recently scraped IPOs\n`);
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    // Field statistics (using actual column names from schema)
    const stats = {
      // 100% populated
      company_name: ipos.filter(ipo => ipo.company_name).length,
      slug: ipos.filter(ipo => ipo.slug).length,
      status: ipos.filter(ipo => ipo.status).length,
      open_date: ipos.filter(ipo => ipo.open_date).length,
      close_date: ipos.filter(ipo => ipo.close_date).length,
      symbol: ipos.filter(ipo => ipo.symbol).length,
      listing_exchanges: ipos.filter(ipo => ipo.listing_exchanges).length,

      // Partially populated
      lot_size_valid: ipos.filter(ipo => ipo.lot_size && ipo.lot_size > 1).length,
      lot_size_total: ipos.filter(ipo => ipo.lot_size).length,
      price_range_min: ipos.filter(ipo => ipo.price_range_min).length,
      price_range_max: ipos.filter(ipo => ipo.price_range_max).length,
      issue_size: ipos.filter(ipo => ipo.issue_size && parseFloat(ipo.issue_size) > 0).length,

      // 0% populated
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

    console.log('✅ FIELDS SUCCESSFULLY POPULATED (100%):\n');
    console.log(`   company_name:        ${stats.company_name}/${total} (${Math.round(stats.company_name/total*100)}%)`);
    console.log(`   slug:                ${stats.slug}/${total} (${Math.round(stats.slug/total*100)}%)`);
    console.log(`   status:              ${stats.status}/${total} (${Math.round(stats.status/total*100)}%)`);
    console.log(`   open_date:           ${stats.open_date}/${total} (${Math.round(stats.open_date/total*100)}%)`);
    console.log(`   close_date:          ${stats.close_date}/${total} (${Math.round(stats.close_date/total*100)}%)`);
    console.log(`   symbol:              ${stats.symbol}/${total} (${Math.round(stats.symbol/total*100)}%)`);
    console.log(`   listing_exchanges:   ${stats.listing_exchanges}/${total} (${Math.round(stats.listing_exchanges/total*100)}%)`);

    console.log('\n⚠️  FIELDS PARTIALLY POPULATED:\n');
    console.log(`   lot_size (valid >1): ${stats.lot_size_valid}/${total} (${Math.round(stats.lot_size_valid/total*100)}%) - ${total - stats.lot_size_valid} have lot_size = 1`);
    console.log(`   price_range_min:     ${stats.price_range_min}/${total} (${Math.round(stats.price_range_min/total*100)}%)`);
    console.log(`   price_range_max:     ${stats.price_range_max}/${total} (${Math.round(stats.price_range_max/total*100)}%)`);
    console.log(`   issue_size (>0):     ${stats.issue_size}/${total} (${Math.round(stats.issue_size/total*100)}%)`);

    console.log('\n❌ FIELDS COMPLETELY MISSING (0%):\n');
    console.log(`   segment:             ${stats.segment}/${total} (${Math.round(stats.segment/total*100)}%)`);
    console.log(`   isin:                ${stats.isin}/${total} (${Math.round(stats.isin/total*100)}%)`);
    console.log(`   sector:              ${stats.sector}/${total} (${Math.round(stats.sector/total*100)}%)`);
    console.log(`   face_value:          ${stats.face_value}/${total} (${Math.round(stats.face_value/total*100)}%)`);
    console.log(`   registrar_id:        ${stats.registrar_id}/${total} (${Math.round(stats.registrar_id/total*100)}%)`);
    console.log(`   allotment_date:      ${stats.allotment_date}/${total} (${Math.round(stats.allotment_date/total*100)}%)`);
    console.log(`   listing_date:        ${stats.listing_date}/${total} (${Math.round(stats.listing_date/total*100)}%)`);
    console.log(`   rating:              ${stats.rating}/${total} (${Math.round(stats.rating/total*100)}%)`);
    console.log(`   company_description: ${stats.company_description}/${total} (${Math.round(stats.company_description/total*100)}%)`);
    console.log(`   lead_managers:       ${stats.lead_managers}/${total} (${Math.round(stats.lead_managers/total*100)}%)`);

    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
    console.log(`\n📄 Generated report for ${total} IPOs scraped in the last 2 hours`);

    await client.end();

    return { total, stats };

  } catch (error) {
    console.error('❌ Failed to get field stats:', error);
    process.exit(1);
  }
}

getFieldStats().catch(console.error);
