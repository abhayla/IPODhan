/**
 * One-time Fix Script: Update Outdated IPO Statuses
 *
 * Fixes Phase 5 data quality issue: 29 IPOs with outdated status
 * - 6 UPCOMING → should be OPEN (open_date passed)
 * - 23 OPEN → should be CLOSED (close_date passed)
 *
 * Run this script once to fix existing issues:
 * npx tsx web/scripts/fix-outdated-statuses.ts
 *
 * After running, the status updater cron job will keep statuses current.
 *
 * @module web/scripts/fix-outdated-statuses
 */

import { updateIPOStatuses, getOutdatedStatusCount } from '../lib/services/status-updater-service';

async function main() {
  console.log('========================================');
  console.log('Fix Outdated IPO Statuses - One-Time Run');
  console.log('========================================\n');

  try {
    // Check current outdated count
    console.log('Step 1: Checking for outdated statuses...\n');
    const beforeCount = await getOutdatedStatusCount();

    console.log('Current outdated status breakdown:');
    console.log(`  - UPCOMING → OPEN: ${beforeCount.upcomingToOpen} IPOs`);
    console.log(`  - OPEN → CLOSED:   ${beforeCount.openToClosed} IPOs`);
    console.log(`  - CLOSED → LISTED: ${beforeCount.closedToListed} IPOs`);
    console.log(`  - TOTAL OUTDATED:  ${beforeCount.total} IPOs\n`);

    if (beforeCount.total === 0) {
      console.log('✅ No outdated statuses found. All IPO statuses are up to date!\n');
      process.exit(0);
    }

    // Run status updates
    console.log('Step 2: Updating outdated statuses...\n');
    const result = await updateIPOStatuses();

    console.log('✅ Status update completed!\n');
    console.log('Updates applied:');
    console.log(`  - UPCOMING → OPEN: ${result.upcomingToOpen} IPOs`);
    console.log(`  - OPEN → CLOSED:   ${result.openToClosed} IPOs`);
    console.log(`  - CLOSED → LISTED: ${result.closedToListed} IPOs`);
    console.log(`  - TOTAL UPDATED:   ${result.total} IPOs\n`);

    // Show detailed updates
    if (result.updatedIPOs.length > 0) {
      console.log('Detailed update log:');
      console.log('====================');
      result.updatedIPOs.forEach((update, index) => {
        console.log(`${index + 1}. ${update.companyName}`);
        console.log(`   Status: ${update.oldStatus} → ${update.newStatus}`);
      });
      console.log('');
    }

    // Verify fix
    console.log('Step 3: Verifying fix...\n');
    const afterCount = await getOutdatedStatusCount();

    console.log('Remaining outdated statuses:');
    console.log(`  - UPCOMING → OPEN: ${afterCount.upcomingToOpen} IPOs`);
    console.log(`  - OPEN → CLOSED:   ${afterCount.openToClosed} IPOs`);
    console.log(`  - CLOSED → LISTED: ${afterCount.closedToListed} IPOs`);
    console.log(`  - TOTAL OUTDATED:  ${afterCount.total} IPOs\n`);

    if (afterCount.total === 0) {
      console.log('✅ SUCCESS: All outdated statuses have been fixed!\n');
      console.log('The status updater cron job will now keep statuses current automatically.');
      console.log('Job runs hourly (production) or every 2 hours (dev mode).\n');
    } else {
      console.log(`⚠️  WARNING: ${afterCount.total} outdated statuses remain.`);
      console.log('This may indicate IPOs with data quality issues (missing dates, etc.).\n');
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR: Status update failed\n');
    console.error(error instanceof Error ? error.message : String(error));
    console.error('\nStack trace:');
    console.error(error instanceof Error ? error.stack : 'No stack trace available');
    process.exit(1);
  }
}

main();
