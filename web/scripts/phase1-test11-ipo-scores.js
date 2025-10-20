/**
 * Phase 1 - Test 11: IPO Scoring System Validation
 *
 * Validates the AI-powered IPO scoring system data:
 * - ipo_scores table coverage
 * - Score distribution (totalScore, fundamentalScore, sentimentScore, subscriptionScore, sectorScore)
 * - Verdict distribution (STRONG_BUY, BUY, HOLD, AVOID)
 * - Confidence level distribution
 * - Algorithm version tracking
 *
 * Success Criteria:
 * - ≥80% of IPOs have scores
 * - All scores are within valid ranges (0-100 total, 0-25 components)
 * - Verdict distribution is reasonable
 * - Recent IPOs have up-to-date scores
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

console.log('🔍 Phase 1 - Test 11: IPO Scoring System Validation\n');
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

    // Query 2: IPO Scores Coverage
    console.log('📊 Query 2: IPO Scores Coverage');
    console.log('='.repeat(80));

    const scoresCount = await pool.query(`
      SELECT COUNT(*) as total
      FROM ipo_scores
    `);

    const scoresTotal = parseInt(scoresCount.rows[0].total);
    const coveragePercent = ((scoresTotal / total) * 100).toFixed(2);

    console.log(`Total IPO scores: ${scoresTotal}/${total} (${coveragePercent}%)`);
    console.log(`  ${coveragePercent >= 80 ? '✅' : '❌'} Target: ≥80% coverage\n`);

    // Query 3: Score Range Validation
    console.log('📊 Query 3: Score Range Validation');
    console.log('='.repeat(80));

    const scoreRanges = await pool.query(`
      SELECT
        MIN(total_score) as min_total,
        MAX(total_score) as max_total,
        AVG(total_score)::numeric(5,2) as avg_total,
        MIN(fundamental_score) as min_fundamental,
        MAX(fundamental_score) as max_fundamental,
        MIN(sentiment_score) as min_sentiment,
        MAX(sentiment_score) as max_sentiment,
        MIN(subscription_score) as min_subscription,
        MAX(subscription_score) as max_subscription,
        MIN(sector_score) as min_sector,
        MAX(sector_score) as max_sector,
        COUNT(*) FILTER (WHERE total_score < 0 OR total_score > 100) as invalid_total,
        COUNT(*) FILTER (WHERE fundamental_score < 0 OR fundamental_score > 25) as invalid_fundamental,
        COUNT(*) FILTER (WHERE sentiment_score < 0 OR sentiment_score > 25) as invalid_sentiment,
        COUNT(*) FILTER (WHERE subscription_score < 0 OR subscription_score > 25) as invalid_subscription,
        COUNT(*) FILTER (WHERE sector_score < 0 OR sector_score > 25) as invalid_sector
      FROM ipo_scores
    `);

    const ranges = scoreRanges.rows[0];
    console.log(`Score Range Statistics:\n`);
    console.log(`  Total Score (0-100):`);
    console.log(`    Min: ${ranges.min_total}, Max: ${ranges.max_total}, Avg: ${ranges.avg_total}`);
    console.log(`    ${ranges.invalid_total === '0' ? '✅' : '❌'} Invalid scores: ${ranges.invalid_total}`);

    console.log(`\n  Component Scores (0-25 each):`);
    console.log(`    Fundamental: Min=${ranges.min_fundamental}, Max=${ranges.max_fundamental} ${ranges.invalid_fundamental === '0' ? '✅' : '❌'}`);
    console.log(`    Sentiment: Min=${ranges.min_sentiment}, Max=${ranges.max_sentiment} ${ranges.invalid_sentiment === '0' ? '✅' : '❌'}`);
    console.log(`    Subscription: Min=${ranges.min_subscription}, Max=${ranges.max_subscription} ${ranges.invalid_subscription === '0' ? '✅' : '❌'}`);
    console.log(`    Sector: Min=${ranges.min_sector}, Max=${ranges.max_sector} ${ranges.invalid_sector === '0' ? '✅' : '❌'}\n`);

    // Query 4: Verdict Distribution
    console.log('📊 Query 4: Verdict Distribution');
    console.log('='.repeat(80));

    const verdictDist = await pool.query(`
      SELECT
        verdict,
        COUNT(*) as count,
        ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ipo_scores)), 2) as percentage
      FROM ipo_scores
      GROUP BY verdict
      ORDER BY count DESC
    `);

    console.log(`Verdict Distribution:\n`);
    verdictDist.rows.forEach(row => {
      console.log(`  ${row.verdict}: ${row.count} (${row.percentage}%)`);
    });
    console.log();

    // Query 5: Confidence Level Distribution
    console.log('📊 Query 5: Confidence Level Distribution');
    console.log('='.repeat(80));

    const confidenceDist = await pool.query(`
      SELECT
        confidence,
        COUNT(*) as count,
        ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ipo_scores)), 2) as percentage
      FROM ipo_scores
      GROUP BY confidence
      ORDER BY
        CASE confidence
          WHEN 'HIGH' THEN 1
          WHEN 'MEDIUM' THEN 2
          WHEN 'LOW' THEN 3
        END
    `);

    console.log(`Confidence Level Distribution:\n`);
    confidenceDist.rows.forEach(row => {
      console.log(`  ${row.confidence}: ${row.count} (${row.percentage}%)`);
    });
    console.log();

    // Query 6: Algorithm Version Tracking
    console.log('📊 Query 6: Algorithm Version Tracking');
    console.log('='.repeat(80));

    const algorithmVersions = await pool.query(`
      SELECT
        algorithm_version,
        COUNT(*) as count,
        MIN(calculated_at) as first_calculation,
        MAX(calculated_at) as last_calculation
      FROM ipo_scores
      GROUP BY algorithm_version
      ORDER BY last_calculation DESC
    `);

    console.log(`Algorithm Versions:\n`);
    algorithmVersions.rows.forEach(row => {
      console.log(`  Version ${row.algorithm_version}: ${row.count} scores`);
      console.log(`    First: ${new Date(row.first_calculation).toLocaleString()}`);
      console.log(`    Last: ${new Date(row.last_calculation).toLocaleString()}\n`);
    });

    // Query 7: Recent IPO Score Coverage
    console.log('📊 Query 7: Recent IPO Score Coverage (Last 30 Days)');
    console.log('='.repeat(80));

    const recentCoverage = await pool.query(`
      SELECT
        COUNT(DISTINCT i.id) as recent_ipos,
        COUNT(DISTINCT s.ipo_id) as scored_ipos,
        ROUND((COUNT(DISTINCT s.ipo_id) * 100.0 / COUNT(DISTINCT i.id)), 2) as coverage_percent
      FROM ipos i
      LEFT JOIN ipo_scores s ON i.id = s.ipo_id
      WHERE i.created_at >= NOW() - INTERVAL '30 days'
    `);

    const recent = recentCoverage.rows[0];
    console.log(`Recent IPOs (last 30 days): ${recent.recent_ipos}`);
    console.log(`Scored: ${recent.scored_ipos}/${recent.recent_ipos} (${recent.coverage_percent}%)`);
    console.log(`  ${recent.coverage_percent >= 80 ? '✅' : '❌'} Target: ≥80% recent coverage\n`);

    // Query 8: Sample Scores
    console.log('📊 Query 8: Sample IPO Scores (Top 5 by Total Score)');
    console.log('='.repeat(80));

    const sampleScores = await pool.query(`
      SELECT
        i.company_name,
        i.status,
        s.total_score,
        s.fundamental_score,
        s.sentiment_score,
        s.subscription_score,
        s.sector_score,
        s.verdict,
        s.confidence
      FROM ipo_scores s
      JOIN ipos i ON s.ipo_id = i.id
      ORDER BY s.total_score DESC
      LIMIT 5
    `);

    if (sampleScores.rows.length > 0) {
      console.log(`Top-Scored IPOs:\n`);
      sampleScores.rows.forEach((row, idx) => {
        console.log(`  ${idx + 1}. ${row.company_name} (${row.status})`);
        console.log(`     Total: ${row.total_score}/100 | Fund: ${row.fundamental_score} | Sent: ${row.sentiment_score} | Subs: ${row.subscription_score} | Sect: ${row.sector_score}`);
        console.log(`     Verdict: ${row.verdict} | Confidence: ${row.confidence}\n`);
      });
    } else {
      console.log('  ❌ No scored IPOs found\n');
    }

    // Success Criteria Validation
    console.log('📊 Success Criteria Validation');
    console.log('='.repeat(80));

    const criteria = [
      {
        name: 'IPO Scores Coverage ≥80%',
        actual: coveragePercent,
        target: 80,
        pass: coveragePercent >= 80
      },
      {
        name: 'No Invalid Score Ranges',
        actual: parseInt(ranges.invalid_total) + parseInt(ranges.invalid_fundamental) + parseInt(ranges.invalid_sentiment) + parseInt(ranges.invalid_subscription) + parseInt(ranges.invalid_sector),
        target: 0,
        pass: (parseInt(ranges.invalid_total) + parseInt(ranges.invalid_fundamental) + parseInt(ranges.invalid_sentiment) + parseInt(ranges.invalid_subscription) + parseInt(ranges.invalid_sector)) === 0
      },
      {
        name: 'Recent IPO Coverage ≥80%',
        actual: recent.coverage_percent,
        target: 80,
        pass: recent.coverage_percent >= 80
      },
      {
        name: 'Multiple Verdicts Present',
        actual: verdictDist.rows.length,
        target: 3,
        pass: verdictDist.rows.length >= 3
      }
    ];

    criteria.forEach(c => {
      console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}: ${c.actual}${typeof c.actual === 'string' && c.actual.includes('%') ? '' : (c.name.includes('Coverage') ? '%' : '')}`);
    });

    const allPass = criteria.every(c => c.pass);
    console.log(`\n  ${allPass ? '✅ ALL CRITERIA PASSED' : '❌ SOME CRITERIA FAILED'}\n`);

    if (!allPass) {
      console.log('  Recommendations:');
      console.log('    - Implement automated IPO scoring for new listings');
      console.log('    - Backfill scores for unscored IPOs');
      console.log('    - Review score calculation algorithm for edge cases');
      console.log('    - Monitor score distribution for anomalies\n');
    }

    console.log('✅ IPO scoring system validation complete\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

runTest().catch(console.error);
