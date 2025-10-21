/**
 * Bulk IPO Score Recalculation Script (Phase 5)
 *
 * Recalculates real-time scores for all IPOs in the database.
 * Useful for:
 * - Initial score population
 * - Algorithm updates
 * - Data quality improvements
 * - Scheduled maintenance
 *
 * Usage:
 *   npx tsx scripts/recalculate-all-scores.ts
 *   npx tsx scripts/recalculate-all-scores.ts --status=OPEN
 *   npx tsx scripts/recalculate-all-scores.ts --limit=10
 *
 * @module recalculate-all-scores
 */

import { getDb } from '../lib/db';
import { ipos } from '../lib/db';
import { IPOScoreRealtimeRepository } from '../lib/repositories/ipo-score-realtime-repository';
import { getRedisClient } from '../lib/cache/redis-client';
import { eq, inArray } from 'drizzle-orm';

interface RecalculationOptions {
  status?: string[];
  limit?: number;
  skipCache?: boolean;
}

interface RecalculationStats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  duration: number;
  errors: Array<{
    ipoId: string;
    companyName: string;
    error: string;
  }>;
}

async function recalculateAllScores(
  options: RecalculationOptions = {}
): Promise<RecalculationStats> {
  const startTime = Date.now();
  const stats: RecalculationStats = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    errors: [],
  };

  console.log('========================================');
  console.log('IPO Score Bulk Recalculation (Phase 5)');
  console.log('========================================\n');

  try {
    // Initialize database and Redis
    const db = await getDb();
    const redis = getRedisClient();

    console.log('[DB] Connection established');

    // Get all IPOs (with optional filters)
    let query = db.select().from(ipos);

    if (options.status && options.status.length > 0) {
      query = query.where(
        inArray(ipos.status, options.status as any)
      ) as typeof query;
      console.log(`[Filter] Status: ${options.status.join(', ')}`);
    }

    if (options.limit) {
      query = query.limit(options.limit) as typeof query;
      console.log(`[Filter] Limit: ${options.limit}`);
    }

    const allIPOs = await query;
    stats.total = allIPOs.length;

    console.log(`\n[IPOs] Found ${stats.total} IPO(s) to process\n`);

    if (stats.total === 0) {
      console.log('No IPOs to process. Exiting.\n');
      return stats;
    }

    // Initialize repository
    const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

    // Process each IPO
    for (let i = 0; i < allIPOs.length; i++) {
      const ipo = allIPOs[i];
      const progress = `[${i + 1}/${stats.total}]`;

      try {
        console.log(
          `${progress} Processing: ${ipo.companyName} (${ipo.status})`
        );

        // Clear cache if requested
        if (options.skipCache) {
          await scoreRepo.invalidateScore(ipo.id);
        }

        // Calculate score
        const startCalc = Date.now();
        const score = await scoreRepo.getOrCalculateScore(ipo.id);
        const calcTime = Date.now() - startCalc;

        stats.success++;

        console.log(
          `${progress} ✓ Score: ${score.total.toFixed(1)}/10 (${score.rating}) - ${calcTime}ms`
        );
        console.log(
          `${progress}   Confidence: ${score.confidence}% | Components: F:${score.financialStrength.toFixed(1)} V:${score.valuation.toFixed(1)} S:${score.subscriptionDemand.toFixed(1)} M:${score.marketPerformance.toFixed(1)} C:${score.fundamentals.toFixed(1)}\n`
        );

        // Rate limit: 100ms delay between calculations
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        stats.failed++;
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';

        stats.errors.push({
          ipoId: ipo.id,
          companyName: ipo.companyName,
          error: errorMessage,
        });

        console.error(`${progress} ✗ Failed: ${errorMessage}\n`);
      }
    }

    stats.duration = Date.now() - startTime;

    // Print summary
    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    console.log(`Total IPOs:      ${stats.total}`);
    console.log(`✓ Successful:    ${stats.success} (${Math.round((stats.success / stats.total) * 100)}%)`);
    console.log(`✗ Failed:        ${stats.failed} (${Math.round((stats.failed / stats.total) * 100)}%)`);
    console.log(`Duration:        ${(stats.duration / 1000).toFixed(2)}s`);
    console.log(
      `Avg per IPO:     ${stats.total > 0 ? (stats.duration / stats.total).toFixed(0) : 0}ms`
    );

    if (stats.errors.length > 0) {
      console.log('\n========================================');
      console.log('ERRORS');
      console.log('========================================');
      stats.errors.forEach((err, index) => {
        console.log(`${index + 1}. ${err.companyName} (${err.ipoId})`);
        console.log(`   Error: ${err.error}\n`);
      });
    }

    console.log('========================================\n');

    return stats;
  } catch (error) {
    console.error('\n[FATAL] Bulk recalculation failed:', error);
    throw error;
  }
}

// ==================== CLI ARGUMENT PARSING ====================

function parseArgs(): RecalculationOptions {
  const args = process.argv.slice(2);
  const options: RecalculationOptions = {};

  args.forEach((arg) => {
    if (arg.startsWith('--status=')) {
      const statusStr = arg.split('=')[1];
      options.status = statusStr.split(',').map((s) => s.trim().toUpperCase());
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--skip-cache') {
      options.skipCache = true;
    }
  });

  return options;
}

// ==================== MAIN EXECUTION ====================

async function main() {
  const options = parseArgs();

  console.log('[CLI] Arguments:', JSON.stringify(options, null, 2), '\n');

  try {
    const stats = await recalculateAllScores(options);

    // Exit with appropriate code
    if (stats.failed === 0) {
      console.log('[CLI] ✓ All scores recalculated successfully\n');
      process.exit(0);
    } else {
      console.log('[CLI] ✗ Some scores failed to recalculate\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('[CLI] ✗ Fatal error:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { recalculateAllScores, type RecalculationOptions, type RecalculationStats };
