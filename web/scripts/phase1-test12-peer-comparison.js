/**
 * Phase 1 - Test 12: Peer Comparison Data Validation
 *
 * Validates peer company comparison data:
 * - peer_companies table coverage
 * - Data completeness (market cap, PE ratio, ROE, debt-to-equity)
 * - Peer count per IPO (typically 3-5 peers)
 * - Data source tracking
 *
 * Success Criteria:
 * - ≥50% of IPOs have peer comparison data
 * - ≥80% of peer records have complete financial metrics
 * - Average of 3-5 peers per IPO
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

console.log('🔍 Phase 1 - Test 12: Peer Comparison Data Validation\n');
console.log(`⚠️  Running against VPS database: ${process.env.DATABASE_URL?.split('@')[1]}\n`);

async function runTest() {
  try {
    // Query 1: Count Total IPOs
    console.log('📊 Query 1: Total IPOs Count');
    console.log('='.repeat(80));

    const totalIPOs = await pool.query(`
      SELECT COUNT(*) as total
      FROM ipos
    `);

    const total = parseInt(totalIPOs.rows[0].total);
    console.log(`Total IPOs in database: ${total}\n`);

    // Query 2: Peer Companies Table Coverage
    console.log('📊 Query 2: Peer Companies Table Coverage');
    console.log('='.repeat(80));

    const peerStats = await pool.query(`
      SELECT
        COUNT(*) as total_peers,
        COUNT(DISTINCT ipo_id) as ipos_with_peers
      FROM peer_companies
    `);

    const stats = peerStats.rows[0];
    const coveragePercent = ((stats.ipos_with_peers / total) * 100).toFixed(2);

    console.log(`Total peer company records: ${stats.total_peers}`);
    console.log(`IPOs with peer data: ${stats.ipos_with_peers}/${total} (${coveragePercent}%)`);
    console.log(`  ${coveragePercent >= 50 ? '✅' : '❌'} Target: ≥50% of IPOs have peers\n`);

    // Query 3: Peer Count Distribution
    console.log('📊 Query 3: Peer Count Distribution (Peers per IPO)');
    console.log('='.repeat(80));

    const peerDistribution = await pool.query(`
      SELECT
        peer_count,
        COUNT(*) as ipo_count
      FROM (
        SELECT
          ipo_id,
          COUNT(*) as peer_count
        FROM peer_companies
        GROUP BY ipo_id
      ) subq
      GROUP BY peer_count
      ORDER BY peer_count
    `);

    console.log(`Peer Count Distribution:\n`);
    let totalWithPeers = 0;
    let totalPeerCount = 0;
    peerDistribution.rows.forEach(row => {
      const peerCount = parseInt(row.peer_count);
      const ipoCount = parseInt(row.ipo_count);
      totalWithPeers += ipoCount;
      totalPeerCount += peerCount * ipoCount;
      console.log(`  ${peerCount} peers: ${ipoCount} IPOs`);
    });

    const avgPeers = (totalPeerCount / totalWithPeers).toFixed(2);
    console.log(`\n  Average peers per IPO: ${avgPeers}`);
    console.log(`  ${avgPeers >= 3 && avgPeers <= 5 ? '✅' : '❌'} Target: 3-5 peers per IPO\n`);

    // Query 4: Data Completeness Analysis
    console.log('📊 Query 4: Financial Metrics Completeness');
    console.log('='.repeat(80));

    const completeness = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE pe_ratio IS NOT NULL) as has_pe_ratio,
        COUNT(*) FILTER (WHERE eps IS NOT NULL) as has_eps,
        COUNT(*) FILTER (WHERE ronw IS NOT NULL) as has_ronw,
        COUNT(*) FILTER (WHERE nav IS NOT NULL) as has_nav,
        COUNT(*) FILTER (WHERE pbv_ratio IS NOT NULL) as has_pbv_ratio,
        COUNT(*) FILTER (
          WHERE pe_ratio IS NOT NULL
            AND eps IS NOT NULL
            AND ronw IS NOT NULL
            AND pbv_ratio IS NOT NULL
        ) as has_all_metrics
      FROM peer_companies
    `);

    const comp = completeness.rows[0];
    const totalPeers = parseInt(comp.total);
    const peRatioPercent = ((comp.has_pe_ratio / totalPeers) * 100).toFixed(2);
    const epsPercent = ((comp.has_eps / totalPeers) * 100).toFixed(2);
    const ronwPercent = ((comp.has_ronw / totalPeers) * 100).toFixed(2);
    const navPercent = ((comp.has_nav / totalPeers) * 100).toFixed(2);
    const pbvPercent = ((comp.has_pbv_ratio / totalPeers) * 100).toFixed(2);
    const completePercent = ((comp.has_all_metrics / totalPeers) * 100).toFixed(2);

    console.log(`Financial Metrics Coverage:\n`);
    console.log(`  PE Ratio: ${comp.has_pe_ratio}/${totalPeers} (${peRatioPercent}%)`);
    console.log(`  EPS: ${comp.has_eps}/${totalPeers} (${epsPercent}%)`);
    console.log(`  RONW (Return on Net Worth): ${comp.has_ronw}/${totalPeers} (${ronwPercent}%)`);
    console.log(`  NAV (Net Asset Value): ${comp.has_nav}/${totalPeers} (${navPercent}%)`);
    console.log(`  PBV Ratio: ${comp.has_pbv_ratio}/${totalPeers} (${pbvPercent}%)`);
    console.log(`\n  Complete Records (PE + EPS + RONW + PBV): ${comp.has_all_metrics}/${totalPeers} (${completePercent}%)`);
    console.log(`  ${completePercent >= 80 ? '✅' : '❌'} Target: ≥80% complete records\n`);

    // Query 5: Data Source Analysis
    console.log('📊 Query 5: Data Source Distribution');
    console.log('='.repeat(80));

    const dataSources = await pool.query(`
      SELECT
        data_source,
        COUNT(*) as count
      FROM peer_companies
      WHERE data_source IS NOT NULL
      GROUP BY data_source
      ORDER BY count DESC
    `);

    console.log(`Data Source Distribution:\n`);
    dataSources.rows.forEach(row => {
      console.log(`  ${row.data_source}: ${row.count} records`);
    });
    console.log();

    // Query 6: Sample Peer Data
    console.log('📊 Query 6: Sample Peer Comparison Data (1 IPO)');
    console.log('='.repeat(80));

    const samplePeers = await pool.query(`
      SELECT
        i.company_name as ipo_company,
        pc.company_name as peer_company_name,
        pc.pe_ratio,
        pc.eps,
        pc.ronw,
        pc.nav,
        pc.pbv_ratio,
        pc.data_source
      FROM peer_companies pc
      JOIN ipos i ON pc.ipo_id = i.id
      WHERE pc.ipo_id = (
        SELECT ipo_id
        FROM peer_companies
        GROUP BY ipo_id
        HAVING COUNT(*) >= 3
        LIMIT 1
      )
      ORDER BY pc.company_name
      LIMIT 5
    `);

    if (samplePeers.rows.length > 0) {
      const ipoCompany = samplePeers.rows[0].ipo_company;
      console.log(`Sample: ${ipoCompany}\n`);
      console.log(`  Peer Companies:\n`);
      samplePeers.rows.forEach((row, idx) => {
        console.log(`    ${idx + 1}. ${row.peer_company_name}`);
        console.log(`       PE Ratio: ${row.pe_ratio || 'N/A'}`);
        console.log(`       EPS: ₹${row.eps || 'N/A'}`);
        console.log(`       RONW: ${row.ronw ? `${row.ronw}%` : 'N/A'}`);
        console.log(`       NAV: ₹${row.nav || 'N/A'}`);
        console.log(`       PBV Ratio: ${row.pbv_ratio || 'N/A'}`);
        console.log(`       Source: ${row.data_source || 'N/A'}\n`);
      });
    } else {
      console.log('  ❌ No peer comparison data found\n');
    }

    // Query 7: IPOs Without Peers
    console.log('📊 Query 7: IPOs Without Peer Data (Sample)');
    console.log('='.repeat(80));

    const noPeers = await pool.query(`
      SELECT
        i.company_name,
        i.status,
        i.segment
      FROM ipos i
      LEFT JOIN peer_companies pc ON i.id = pc.ipo_id
      WHERE pc.id IS NULL
      ORDER BY i.created_at DESC
      LIMIT 10
    `);

    if (noPeers.rows.length > 0) {
      console.log(`Sample IPOs without peer data (${total - stats.ipos_with_peers} total):\n`);
      noPeers.rows.forEach((row, idx) => {
        console.log(`  ${idx + 1}. ${row.company_name} (${row.status}, ${row.segment || 'N/A'})`);
      });
      console.log();
    }

    // Success Criteria Validation
    console.log('📊 Success Criteria Validation');
    console.log('='.repeat(80));

    const criteria = [
      {
        name: 'IPO Coverage ≥50%',
        actual: coveragePercent,
        target: 50,
        pass: coveragePercent >= 50
      },
      {
        name: 'Complete Financial Metrics ≥80%',
        actual: completePercent,
        target: 80,
        pass: completePercent >= 80
      },
      {
        name: 'Average Peers per IPO: 3-5',
        actual: avgPeers,
        target: '3-5',
        pass: avgPeers >= 3 && avgPeers <= 5
      },
      {
        name: 'Total Peer Records ≥1000',
        actual: totalPeers,
        target: 1000,
        pass: totalPeers >= 1000
      }
    ];

    criteria.forEach(c => {
      const displayValue = typeof c.actual === 'string' ? c.actual : (c.name.includes('Coverage') || c.name.includes('Metrics') ? `${c.actual}%` : c.actual);
      console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}: ${displayValue}`);
    });

    const allPass = criteria.every(c => c.pass);
    console.log(`\n  ${allPass ? '✅ ALL CRITERIA PASSED' : '❌ SOME CRITERIA FAILED'}\n`);

    if (!allPass) {
      console.log('  Recommendations:');
      console.log('    - Implement peer company scraper from financial data sources');
      console.log('    - Backfill peer data for IPOs without comparisons');
      console.log('    - Enhance financial metrics collection');
      console.log('    - Consider industry-based peer matching\n');
    }

    console.log('✅ Peer comparison data validation complete\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

runTest().catch(console.error);
