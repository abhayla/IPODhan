/**
 * Seed IPO Scores Script (Story 4.7)
 *
 * Generates realistic test IPO scores for development and testing
 * Usage: npm run seed:scores
 */

import { db } from '../lib/db/index';
import { ipos, ipoScores } from '../lib/db';
import { IPOScoreRepository } from '../lib/repositories/ipo-score-repository';
import { getRedisClient } from '../lib/cache/redis-client';
import { eq } from 'drizzle-orm';

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
  console.log('🌱 Starting IPO Score seed process...\n');

  try {
    // Fetch all IPOs
    const allIPOs = await db.select().from(ipos);
    console.log(`Found ${allIPOs.length} IPOs in database\n`);

    if (allIPOs.length === 0) {
      console.log('⚠️  No IPOs found. Please seed IPOs first.');
      return;
    }

    // Initialize repository
    const redis = getRedisClient();
    const scoreRepository = new IPOScoreRepository(db, redis);

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

        // Upsert score
        const score = await scoreRepository.upsert({
          ipoId: ipo.id,
          totalScore: config.totalScore,
          fundamentalScore: config.fundamentalScore,
          sentimentScore: config.sentimentScore,
          subscriptionScore: config.subscriptionScore,
          sectorScore: config.sectorScore,
          verdict: config.verdict,
          confidence: config.confidence,
          reasoning: reasoning,
          algorithmVersion: '1.0.0',
        });

        // Check if it was an update or create by querying
        const existing = await db
          .select()
          .from(ipoScores)
          .where(eq(ipoScores.id, score.id))
          .limit(1);

        if (existing.length > 0 && existing[0].createdAt < existing[0].updatedAt) {
          updated++;
        } else {
          created++;
        }

        console.log(`✓ ${ipo.companyName}: Score ${config.totalScore} (${config.verdict}, ${config.confidence})`);
      } catch (error) {
        errors++;
        console.error(`✗ ${ipo.companyName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('\n📊 Seed Summary:');
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Total: ${allIPOs.length}`);
    console.log('\n✅ Seed completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();
