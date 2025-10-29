import pkg from 'pg';
const { Client } = pkg;

async function checkISINSources() {
  const client = new Client({
    connectionString: 'postgresql://postgres:Papa3Monu%401234@103.118.16.189:5432/ipodhan'
  });

  await client.connect();

  // Check which exchanges have ISIN
  const result = await client.query(`
    SELECT
      listing_exchanges::text as exchange,
      COUNT(*) as total_ipos,
      COUNT(isin) as with_isin,
      ROUND(COUNT(isin)::numeric / COUNT(*)::numeric * 100, 2) as percentage
    FROM ipos
    GROUP BY listing_exchanges::text
    ORDER BY with_isin DESC
  `);

  console.log('\n📊 ISIN Population by Exchange:\n');
  result.rows.forEach(row => {
    console.log(`   ${row.exchange || 'NULL'}:`);
    console.log(`      Total: ${row.total_ipos}, With ISIN: ${row.with_isin} (${row.percentage}%)`);
  });

  // Show example IPOs with ISIN from different exchanges
  const examples = await client.query(`
    SELECT
      company_name,
      listing_exchanges::text as exchange,
      isin,
      symbol
    FROM ipos
    WHERE isin IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 10
  `);

  console.log('\n✅ Recent IPOs with ISIN (Top 10):\n');
  examples.rows.forEach((row, i) => {
    console.log(`   ${i+1}. ${row.company_name}`);
    console.log(`      Exchange: ${row.exchange}, ISIN: ${row.isin}, Symbol: ${row.symbol || 'N/A'}\n`);
  });

  await client.end();
}

checkISINSources().catch(console.error);
