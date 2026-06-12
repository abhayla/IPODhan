const { Pool } = require('pg');

const pool = new Pool({
  host: '103.118.16.189',
  port: 5432,
  database: 'ipodhan',
  user: 'postgres',
  password: process.env.DB_PASSWORD
});

function randomDecimal(min, max) {
  return (Math.random() * (max - min) + min).toFixed(2);
}

(async () => {
  try {
    console.log('Populating financial data for all IPOs...');

    const ipos = await pool.query('SELECT id, sector FROM ipos');
    console.log(`Found ${ipos.rows.length} IPOs`);

    let count = 0;
    for (const ipo of ipos.rows) {
      // Generate industry PE based on sector
      const industryPeRanges = {
        'Technology': {min: 20, max: 50},
        'Pharmaceuticals': {min: 25, max: 45},
        'Infrastructure': {min: 15, max: 30},
        'Automobile': {min: 18, max: 35},
        'Renewable Energy': {min: 22, max: 40},
        'Financial Services': {min: 12, max: 25},
        'default': {min: 15, max: 35}
      };

      const range = industryPeRanges[ipo.sector] || industryPeRanges['default'];

      await pool.query(`
        INSERT INTO ipo_financials (
          ipo_id, revenue_fy1, revenue_fy2, revenue_fy3,
          profit_fy1, profit_fy2, profit_fy3,
          pe_ratio, roe_percentage, debt_to_equity,
          pb_ratio, roce_percentage, industry_pe,
          financial_year_end
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        ipo.id,
        randomDecimal(1000, 6000),
        randomDecimal(800, 4000),
        randomDecimal(600, 3000),
        randomDecimal(50, 500),
        randomDecimal(40, 400),
        randomDecimal(30, 300),
        randomDecimal(10, 50),
        randomDecimal(5, 25),
        randomDecimal(0, 2),
        randomDecimal(1.5, 4.0),
        randomDecimal(10, 25),
        randomDecimal(range.min, range.max),
        '31-Mar-24'  // varchar(10) constraint - max 10 chars
      ]);

      count++;
      if (count % 20 === 0) {
        console.log(`  Inserted ${count}/${ipos.rows.length}`);
      }
    }

    console.log(`✓ Populated financial data for ${count} IPOs`);

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    await pool.end();
    process.exit(1);
  }
})();
