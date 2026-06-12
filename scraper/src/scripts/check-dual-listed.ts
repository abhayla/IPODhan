import pkg from 'pg';
const { Client } = pkg;

async function checkDualListed() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  await client.connect();

  const nseIPOs = [
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
      listing_exchanges::text as exchange,
      isin,
      symbol
    FROM ipos
    WHERE company_name = ANY($1::text[])
    ORDER BY company_name
  `, [nseIPOs]);

  console.log('\n🔍 Exchange Listing Status for 11 NSE IPOs:\n');

  let nseOnly = 0;
  let dualListed = 0;

  result.rows.forEach((row, i) => {
    const isDual = row.exchange && row.exchange.includes('BSE');
    if (isDual) dualListed++;
    else nseOnly++;

    const status = isDual ? '✅ DUAL-LISTED (NSE+BSE)' : '❌ NSE-ONLY';
    console.log(`${i+1}. ${row.company_name}`);
    console.log(`   Exchange: ${row.exchange || 'NULL'}`);
    console.log(`   Status: ${status}`);
    console.log(`   ISIN: ${row.isin || 'NOT SET'}`);
    console.log(`   Symbol: ${row.symbol || 'N/A'}\n`);
  });

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`📊 Summary:`);
  console.log(`   NSE-Only IPOs: ${nseOnly}`);
  console.log(`   Dual-Listed IPOs (NSE+BSE): ${dualListed}`);
  console.log(`\n🎯 Conclusion:`);
  if (dualListed > 0) {
    console.log(`   ✅ ${dualListed} IPO(s) can get ISIN from BSE scraper`);
  }
  if (nseOnly > 0) {
    console.log(`   ⚠️  ${nseOnly} IPO(s) need alternative source (SEBI/NSE website)`);
  }

  await client.end();
}

checkDualListed().catch(console.error);
