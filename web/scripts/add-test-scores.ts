/**
 * Script to add test IPO scores for E2E testing
 * Ensures first 3 IPOs have score data for radar chart tests
 */

import { db } from '../lib/db/index.js';
import { ipos, ipoScores } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  console.log('Checking existing IPO scores...');

  // Get first 3 IPOs
  const ipoList = await db
    .select()
    .from(ipos)
    .limit(3);

  console.log(`Found ${ipoList.length} IPOs to process`);

  for (const ipo of ipoList) {
    // Check if score already exists
    const existingScore = await db
      .select()
      .from(ipoScores)
      .where(eq(ipoScores.ipoId, ipo.id))
      .limit(1);

    if (existingScore.length > 0) {
      console.log(`✓ Score exists for ${ipo.companyName}`);
      continue;
    }

    // Create test score
    console.log(`Creating score for ${ipo.companyName}...`);

    await db.insert(ipoScores).values({
      ipoId: ipo.id,
      totalScore: 75, // 0-100 scale
      fundamentalScore: 20, // 0-25 scale
      sentimentScore: 18, // 0-25 scale
      subscriptionScore: 22, // 0-25 scale
      sectorScore: 15, // 0-25 scale
      verdict: 'APPLY',
      confidence: 'HIGH',
      reasoning: 'Strong financials with good market demand. Company shows consistent growth and healthy fundamentals.',
      algorithmVersion: '1.0.0',
      calculatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`✓ Created score for ${ipo.companyName}`);
  }

  console.log('\n✅ All done!');
  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
