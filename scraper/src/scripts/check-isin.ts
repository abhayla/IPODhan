import pkg from 'pg';
const { Client } = pkg;

async function checkISIN() {
  const client = new Client({
    connectionString: 'postgresql://postgres:***REMOVED-CREDENTIAL***@103.118.16.189:5432/ipodhan'
  });

  await client.connect();

  // Check how many IPOs have ISIN
  const result = await client.query(`
    SELECT
      COUNT(*) as total,
      COUNT(isin) as with_isin,
      COUNT(CASE WHEN isin IS NOT NULL AND isin != '' THEN 1 END) as with_valid_isin
    FROM ipos
  `);

  console.log('\n📊 ISIN Statistics:');
  console.log(`   Total IPOs: ${result.rows[0].total}`);
  console.log(`   With ISIN (not null): ${result.rows[0].with_isin}`);
  console.log(`   With valid ISIN (not empty): ${result.rows[0].with_valid_isin}`);

  // Show some examples
  const examples = await client.query(`
    SELECT company_name, symbol, isin, updated_at
    FROM ipos
    WHERE isin IS NOT NULL AND isin != ''
    ORDER BY updated_at DESC
    LIMIT 10
  `);

  console.log('\n✅ Recent IPOs with ISIN:');
  examples.rows.forEach((row, i) => {
    console.log(`   ${i+1}. ${row.company_name}`);
    console.log(`      Symbol: ${row.symbol || 'N/A'}, ISIN: ${row.isin}`);
  });

  // Check the 11 recently scraped NSE IPOs
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

  const nseResult = await client.query(`
    SELECT company_name, symbol, isin
    FROM ipos
    WHERE company_name = ANY($1::text[])
    ORDER BY company_name
  `, [nseIPOs]);

  console.log('\n🔍 Recently scraped NSE IPOs (11 total):');
  nseResult.rows.forEach((row, i) => {
    console.log(`   ${i+1}. ${row.company_name}`);
    console.log(`      Symbol: ${row.symbol || 'N/A'}, ISIN: ${row.isin || 'NOT SET'}`);
  });

  await client.end();
}

checkISIN().catch(console.error);
