/**
 * Simplified IPO Scores Seed Script
 *
 * Generates realistic test IPO scores for all IPOs without repository dependencies
 * Usage: npx tsx scripts/seed-ipo-scores-simple.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

import { db } from '../lib/db/index';
import { ipos, ipoScores } from '../lib/db';
import { sql } from 'drizzle-orm';

const SAMPLE_REASONINGS = {
  APPLY: [
    'Strong fundamentals with healthy revenue growth. Industry-leading margins and experienced management. Positive sector outlook with fair valuation.',
    'Excellent financial metrics with consistent profitability. Well-positioned in growing market segment. Attractive pricing compared to peers.',
    'Solid business model with proven track record. Strong demand indicators and good subscription potential. Reasonable valuation multiples.',
  ],
  CONSIDER: [
    'Mixed signals with decent fundamentals but valuation concerns. Average market sentiment. Monitor subscription trends before deciding.',
    'Moderate financial performance with some operational challenges. Sector outlook neutral. Pricing at upper end of range.',
    'Established company but facing competitive pressures. Subscription interest moderate. Consider allocation carefully.',
  ],
  SKIP: [
    'Weak fundamentals with declining revenue trends. Poor profitability metrics. Overvalued compared to sector peers.',
    'Significant operational risks and high debt levels. Negative market sentiment. Unattractive risk-reward ratio.',
    'Loss-making entity with uncertain business model. Limited competitive advantages. Expensive valuation despite risks.',
  ],
};

interface ScoreConfig {
  totalScore: number;
  fundamentalScore: number;
  sentimentScore: number;
  subscriptionScore: number;
  sectorScore: number;
  verdict: 'APPLY' | 'CONSIDER' | 'SKIP';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

function generateScoreConfig(range: 'excellent' | 'good' | 'fair' | 'poor'): ScoreConfig {
  let totalScore: number;
  let verdict: 'APPLY' | 'CONSIDER' | 'SKIP';
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';

  switch (range) {
    case 'excellent':
      totalScore = 76 + Math.floor(Math.random() * 25); // 76-100
      verdict = 'APPLY';
      confidence = Math.random() > 0.3 ? 'HIGH' : 'MEDIUM';
      break;
    case 'good':
      totalScore = 51 + Math.floor(Math.random() * 25); // 51-75
      verdict = Math.random() > 0.5 ? 'APPLY' : 'CONSIDER';
      confidence = Math.random() > 0.4 ? 'MEDIUM' : 'HIGH';
      break;
    case 'fair':
      totalScore = 26 + Math.floor(Math.random() * 25); // 26-50
      verdict = Math.random() > 0.7 ? 'CONSIDER' : 'SKIP';
      confidence = Math.random() > 0.5 ? 'MEDIUM' : 'LOW';
      break;
    case 'poor':
      totalScore = Math.floor(Math.random() * 26); // 0-25
      verdict = 'SKIP';
      confidence = Math.random() > 0.6 ? 'LOW' : 'MEDIUM';
      break;
  }

  // Generate component scores that sum close to total
  const variation = 5;
  const baseScore = totalScore / 4;
  const fundamentalScore = Math.max(0, Math.min(100, Math.floor(baseScore + (Math.random() * variation * 2 - variation))));
  const sentimentScore = Math.max(0, Math.min(100, Math.floor(baseScore + (Math.random() * variation * 2 - variation))));
  const subscriptionScore = Math.max(0, Math.min(100, Math.floor(baseScore + (Math.random() * variation * 2 - variation))));
  const sectorScore = Math.max(0, Math.min(100, Math.floor(baseScore + (Math.random() * variation * 2 - variation))));

  return {
    totalScore,
    fundamentalScore,
    sentimentScore,
    subscriptionScore,
    sectorScore,
    verdict,
    confidence,
  };
}

function getRandomReasoning(verdict: 'APPLY' | 'CONSIDER' | 'SKIP'): string {
  const options = SAMPLE_REASONINGS[verdict];
  return options[Math.floor(Math.random() * options.length)];
}

async function main() {
  console.log('\n🌱 Starting IPO Score seed process (simplified)...\n');
  console.log('='.repeat(60));

  try {
    // First, add unique constraint if it doesn't exist
    console.log('\n📝 Ensuring unique constraint on ipo_id...');
    await db.execute(sql`
      DO $$
      BEGIN
          IF NOT EXISTS (
              SELECT 1
              FROM pg_constraint
              WHERE conname = 'ipo_scores_ipo_id_unique'
          ) THEN
              ALTER TABLE ipo_scores ADD CONSTRAINT ipo_scores_ipo_id_unique UNIQUE (ipo_id);
          END IF;
      END $$;
    `);
    console.log('✓ Unique constraint ensured');

    // Fetch all IPOs
    const allIPOs = await db.select().from(ipos);
    console.log(`\n✓ Found ${allIPOs.length} IPOs in database\n`);

    if (allIPOs.length === 0) {
      console.log('⚠️  No IPOs found. Please seed IPOs first.');
      return;
    }

    // Distribution: 20% excellent, 30% good, 30% fair, 20% poor
    const distribution = ['excellent', 'good', 'good', 'fair', 'fair', 'poor'];

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const ipo of allIPOs) {
      try {
        // Pick random score range
        const range = distribution[Math.floor(Math.random() * distribution.length)] as 'excellent' | 'good' | 'fair' | 'poor';
        const config = generateScoreConfig(range);
        const reasoning = getRandomReasoning(config.verdict);

        // Insert with ON CONFLICT DO UPDATE
        await db.execute(sql`
          INSERT INTO ipo_scores (
            ipo_id,
            total_score,
            fundamental_score,
            sentiment_score,
            subscription_score,
            sector_score,
            verdict,
            confidence,
            reasoning,
            algorithm_version
          ) VALUES (
            ${ipo.id},
            ${config.totalScore},
            ${config.fundamentalScore},
            ${config.sentimentScore},
            ${config.subscriptionScore},
            ${config.sectorScore},
            ${config.verdict},
            ${config.confidence},
            ${reasoning},
            ${'1.0.0'}
          )
          ON CONFLICT (ipo_id) DO UPDATE SET
            total_score = EXCLUDED.total_score,
            fundamental_score = EXCLUDED.fundamental_score,
            sentiment_score = EXCLUDED.sentiment_score,
            subscription_score = EXCLUDED.subscription_score,
            sector_score = EXCLUDED.sector_score,
            verdict = EXCLUDED.verdict,
            confidence = EXCLUDED.confidence,
            reasoning = EXCLUDED.reasoning,
            algorithm_version = EXCLUDED.algorithm_version,
            updated_at = CURRENT_TIMESTAMP
        `);

        created++;
        console.log(`✓ ${ipo.companyName}: Score ${config.totalScore} (${config.verdict}, ${config.confidence})`);
      } catch (error) {
        errors++;
        console.error(`✗ ${ipo.companyName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Seed Summary:');
    console.log(`   Processed: ${created}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Total IPOs: ${allIPOs.length}`);
    console.log('\n✅ Seed completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();
