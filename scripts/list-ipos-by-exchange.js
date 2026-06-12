const { Client } = require('pg');

const client = new Client({
  host: '103.118.16.189',
  port: 5432,
  user: 'postgres',
  password: process.env.DB_PASSWORD,
  database: 'ipodhan',
  connectionTimeoutMillis: 10000,
});

async function listIPOsByExchange() {
  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('✓ Connected successfully!\n');

    // Query all IPOs
    const allIPOsQuery = `
      SELECT
        id,
        company_name,
        symbol,
        category,
        sector,
        status,
        open_date,
        close_date,
        listing_date,
        price_range_min,
        price_range_max,
        listing_exchanges
      FROM ipos
      ORDER BY
        CASE
          WHEN status = 'OPEN' THEN 1
          WHEN status = 'UPCOMING' THEN 2
          WHEN status = 'CLOSED' THEN 3
          WHEN status = 'LISTED' THEN 4
          ELSE 5
        END,
        open_date DESC NULLS LAST
    `;

    console.log('Fetching all IPOs from database...\n');
    const result = await client.query(allIPOsQuery);

    if (result.rows.length === 0) {
      console.log('No IPOs found in the database.\n');
      await client.end();
      return;
    }

    console.log(`Total IPOs found: ${result.rows.length}\n`);

    // Group IPOs by exchange
    const nseIPOs = [];
    const bseIPOs = [];
    const bothExchanges = [];
    const noExchange = [];

    result.rows.forEach(ipo => {
      const exchanges = ipo.listing_exchanges || [];

      if (exchanges.length === 0) {
        noExchange.push(ipo);
      } else if (exchanges.includes('NSE') && exchanges.includes('BSE')) {
        bothExchanges.push(ipo);
      } else if (exchanges.includes('NSE')) {
        nseIPOs.push(ipo);
      } else if (exchanges.includes('BSE')) {
        bseIPOs.push(ipo);
      } else {
        noExchange.push(ipo);
      }
    });

    // Display grouped results
    console.log('=' .repeat(80));
    console.log('IPOs GROUPED BY EXCHANGE');
    console.log('=' .repeat(80));

    // NSE Only
    console.log('\n📊 NSE ONLY IPOs:', nseIPOs.length);
    console.log('-'.repeat(80));
    if (nseIPOs.length > 0) {
      displayIPOTable(nseIPOs);
    }

    // BSE Only
    console.log('\n📊 BSE ONLY IPOs:', bseIPOs.length);
    console.log('-'.repeat(80));
    if (bseIPOs.length > 0) {
      displayIPOTable(bseIPOs);
    }

    // Both Exchanges
    console.log('\n📊 BOTH NSE & BSE IPOs:', bothExchanges.length);
    console.log('-'.repeat(80));
    if (bothExchanges.length > 0) {
      displayIPOTable(bothExchanges);
    }

    // No Exchange Listed
    console.log('\n📊 NO EXCHANGE SPECIFIED:', noExchange.length);
    console.log('-'.repeat(80));
    if (noExchange.length > 0) {
      displayIPOTable(noExchange);
    }

    // Summary Statistics
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY STATISTICS');
    console.log('='.repeat(80));
    console.log(`Total IPOs: ${result.rows.length}`);
    console.log(`NSE Only: ${nseIPOs.length}`);
    console.log(`BSE Only: ${bseIPOs.length}`);
    console.log(`Both NSE & BSE: ${bothExchanges.length}`);
    console.log(`No Exchange Specified: ${noExchange.length}`);

    // Status breakdown
    const statusBreakdown = {};
    result.rows.forEach(ipo => {
      const status = ipo.status || 'UNKNOWN';
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    });

    console.log('\nStatus Breakdown:');
    Object.entries(statusBreakdown).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    await client.end();
    console.log('\n✓ Database connection closed');
  } catch (err) {
    console.error('✗ Error:', err.message);
    process.exit(1);
  }
}

function displayIPOTable(ipos) {
  if (ipos.length === 0) return;

  // Create formatted table
  ipos.slice(0, 10).forEach(ipo => {
    const priceRange = (ipo.price_range_min && ipo.price_range_max)
      ? `₹${ipo.price_range_min}-${ipo.price_range_max}`
      : 'TBA';
    const dates = ipo.open_date
      ? `${formatDate(ipo.open_date)} to ${formatDate(ipo.close_date)}`
      : 'TBA';
    const status = ipo.status || 'UNKNOWN';
    const symbol = ipo.symbol || 'N/A';

    console.log(`
Company: ${ipo.company_name}
Symbol: ${symbol}
Category: ${ipo.category || 'N/A'}
Sector: ${ipo.sector || 'N/A'}
Status: ${status}
Price Range: ${priceRange}
Dates: ${dates}
Listing Date: ${ipo.listing_date ? formatDate(ipo.listing_date) : 'TBA'}
`.trim());
    console.log('-'.repeat(40));
  });

  if (ipos.length > 10) {
    console.log(`... and ${ipos.length - 10} more IPOs`);
  }
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

// Run the script
listIPOsByExchange();