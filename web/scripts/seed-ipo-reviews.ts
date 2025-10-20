/**
 * Seed IPO Reviews Script
 *
 * Creates sample IPO reviews from popular analysts for recent IPOs
 * Populates the ipo_reviews table
 *
 * Strategy:
 * - Select top 50 recent IPOs (LISTED status)
 * - Create 1-2 reviews per IPO from well-known analysts
 * - Varied recommendations based on IPO scores
 *
 * Usage: npx tsx scripts/seed-ipo-reviews.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

import { db } from '../lib/db/index';
import { ipos, ipoReviews, ipoScores } from '../lib/db';
import { eq, desc } from 'drizzle-orm';

// Popular IPO Review Sources in India
const REVIEW_SOURCES = [
  'MoneyControl',
  'Economic Times',
  'Business Standard',
  'ICICI Direct',
  'Motilal Oswal',
  'Angel One',
  'Zerodha',
  'SMC Global',
  'Sharekhan',
  'Kotak Securities',
];

// Review content templates
const REVIEW_TEMPLATES = {
  Subscribe: [
    'The company shows strong fundamentals with impressive revenue growth and healthy profitability margins. Management has proven track record in the industry. Valuation appears reasonable compared to sector peers.',
    'Attractive business model with competitive advantages. Strong financial performance and promising growth prospects. IPO pricing is fair given the company\'s market position.',
    'Solid operational efficiency and consistent revenue growth. Good asset quality and healthy return ratios. Recommend subscribing for long-term wealth creation.',
  ],
  'May apply': [
    'The company has decent fundamentals but faces some challenges. Valuation is at higher end of range. Investors may consider applying with medium to long-term perspective.',
    'Mixed bag of positives and concerns. Good market opportunity but execution risks exist. Conservative investors may apply for partial allotment.',
    'Company operates in growing sector but faces stiff competition. Financial metrics are average. Moderate risk-reward ratio suggests cautious participation.',
  ],
  Avoid: [
    'High valuation multiples not justified by fundamentals. Concerns about profitability and business sustainability. Better opportunities available in the market.',
    'Weak financials with declining margins and high debt levels. Uncertain growth prospects and competitive pressure. Recommend avoiding this IPO.',
    'Overpriced issue with limited growth visibility. Poor asset quality and governance concerns. Not recommended for investment.',
  ],
  'Not Recommended': [
    'Company lacks competitive moat and faces severe industry headwinds. Poor track record and weak management commentary. Strong avoid.',
    'Fundamental concerns outweigh any potential upside. High execution risk and uncertain regulatory environment. Not advisable to participate.',
    'Significant red flags in financials and business model. Better to wait on sidelines. Clear pass on this IPO.',
  ],
};

function getRecommendation(score: number | null): 'Subscribe' | 'May apply' | 'Avoid' | 'Not Recommended' {
  if (!score) return 'May apply';

  if (score >= 70) return 'Subscribe';
  if (score >= 50) return 'May apply';
  if (score >= 30) return 'Avoid';
  return 'Not Recommended';
}

function getReviewContent(recommendation: 'Subscribe' | 'May apply' | 'Avoid' | 'Not Recommended'): string {
  const templates = REVIEW_TEMPLATES[recommendation];
  return templates[Math.floor(Math.random() * templates.length)];
}

function getReviewTitle(companyName: string, recommendation: string): string {
  const titleTemplates = [
    `${companyName} IPO: ${recommendation}`,
    `IPO Review: ${companyName} - ${recommendation}`,
    `${companyName} IPO Analysis: ${recommendation}`,
    `Should you subscribe to ${companyName} IPO? ${recommendation}`,
  ];
  return titleTemplates[Math.floor(Math.random() * titleTemplates.length)];
}

async function main() {
  console.log('\n🌱 Starting IPO Reviews Seed Process...\n');
  console.log('='.repeat(60));

  try {
    // Fetch top 50 recent LISTED IPOs with their scores
    const recentIPOs = await db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        segment: ipos.segment,
        listingDate: ipos.listingDate,
        score: ipoScores.totalScore,
      })
      .from(ipos)
      .leftJoin(ipoScores, eq(ipos.id, ipoScores.ipoId))
      .where(eq(ipos.status, 'LISTED'))
      .orderBy(desc(ipos.listingDate))
      .limit(50);

    console.log(`\n✓ Found ${recentIPOs.length} recent listed IPOs\n`);

    if (recentIPOs.length === 0) {
      console.log('⚠️  No listed IPOs found for review seeding.');
      return;
    }

    let reviewsCreated = 0;

    for (const ipo of recentIPOs) {
      // Skip IPOs without segment (RIGHTS/InvITs/REITs offerings)
      if (!ipo.segment) {
        continue;
      }

      try {
        // Create 1-2 reviews per IPO
        const numReviews = 1 + Math.floor(Math.random() * 2); // 1 or 2 reviews

        for (let i = 0; i < numReviews; i++) {
          const author = REVIEW_SOURCES[Math.floor(Math.random() * REVIEW_SOURCES.length)];
          const recommendation = getRecommendation(ipo.score);
          const title = getReviewTitle(ipo.companyName, recommendation);
          const content = getReviewContent(recommendation);

          // Calculate published date (within 7 days before listing date)
          const listingDate = ipo.listingDate ? new Date(ipo.listingDate) : new Date();
          const publishedDate = new Date(listingDate);
          publishedDate.setDate(publishedDate.getDate() - Math.floor(Math.random() * 7));

          await db.insert(ipoReviews).values({
            reviewTitle: title,
            author,
            recommendation,
            ipoId: ipo.id,
            publishedDate,
            year: publishedDate.getFullYear(),
            segment: ipo.segment,
            reviewUrl: `https://example.com/reviews/${ipo.id}`,
            reviewContent: content,
          });

          reviewsCreated++;
        }

        console.log(`✓ ${ipo.companyName}: ${numReviews} review(s) created`);
      } catch (error) {
        console.error(`✗ ${ipo.companyName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Seed Summary:');
    console.log(`   IPOs reviewed: ${recentIPOs.length}`);
    console.log(`   Total reviews created: ${reviewsCreated}`);
    console.log(`   Average reviews per IPO: ${(reviewsCreated / recentIPOs.length).toFixed(1)}`);
    console.log('\n✅ IPO Reviews Seed Complete!\n');

  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();
