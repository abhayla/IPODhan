/**
 * Slack Alert Test Script
 *
 * Tests the Slack alert system configuration and delivery.
 * Run: npx tsx web/scripts/test-slack-alert.ts
 *
 * Prerequisites:
 * - Slack webhook URL configured in .env.local
 * - Required env var: SLACK_WEBHOOK_URL
 *
 * Setup Instructions:
 * 1. Go to: https://api.slack.com/messaging/webhooks
 * 2. Create a webhook for your workspace
 * 3. Add to .env.local: SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
 */

import {
  sendDRHPFailureAlert,
  sendSlowConsolidationAlert,
  sendHighConflictRateAlert,
  testSlackConfiguration
} from '../lib/alerts/slack-alerts';
import { logger } from '../lib/logging/logger';

async function main() {
  console.log('\n🧪 Slack Alert System Test');
  console.log('=' .repeat(60));

  // Step 1: Test configuration
  console.log('\n📋 Step 1: Testing Slack Configuration...');
  const configTest = await testSlackConfiguration();
  console.log(`   ${configTest.success ? '✅' : '❌'} ${configTest.message}`);

  if (!configTest.success) {
    console.log('\n❌ Slack configuration failed. Please check:');
    console.log('   - SLACK_WEBHOOK_URL is set in .env.local');
    console.log('\n💡 Setup Instructions:');
    console.log('   1. Go to: https://api.slack.com/messaging/webhooks');
    console.log('   2. Click "Create New Webhook"');
    console.log('   3. Select a channel (e.g., #dev-alerts)');
    console.log('   4. Copy the webhook URL');
    console.log('   5. Add to .env.local:');
    console.log('      SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ');
    process.exit(1);
  }

  // Give user time to check Slack
  console.log('\n✋ Please check your Slack channel for the test message.');
  console.log('   Continuing in 3 seconds...\n');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Step 2: Test DRHP failure alert (threshold: 8 > 5)
  console.log('📢 Step 2: Testing DRHP Failure Alert...');
  console.log('   Simulating 8 DRHP failures (threshold: 5)');
  const drhpResult = await sendDRHPFailureAlert(8, {
    last24Hours: 8,
    timeoutErrors: 3,
    downloadErrors: 2,
    extractionErrors: 3
  });
  console.log(`   ${drhpResult ? '✅' : '❌'} Alert ${drhpResult ? 'sent successfully' : 'failed'}`);

  if (drhpResult) {
    console.log('   💬 Check your Slack channel for the DRHP failure alert');
  }

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 3: Test slow consolidation alert (1200ms > 1000ms)
  console.log('\n📢 Step 3: Testing Slow Consolidation Alert...');
  console.log('   Simulating p95 latency of 1200ms (threshold: 1000ms)');
  const slowResult = await sendSlowConsolidationAlert(1200, {
    avgLatency: 450,
    p99Latency: 1500,
    slowestOperation: 'normalization',
    operationsLast1h: 245
  });
  console.log(`   ${slowResult ? '✅' : '❌'} Alert ${slowResult ? 'sent successfully' : 'failed'}`);

  if (slowResult) {
    console.log('   💬 Check your Slack channel for the performance alert');
  }

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 4: Test high conflict rate alert (6.5% > 5%)
  console.log('\n📢 Step 4: Testing High Conflict Rate Alert...');
  console.log('   Simulating 6.5% conflict rate (threshold: 5%)');
  const conflictResult = await sendHighConflictRateAlert(6.5, {
    totalIPOs: 200,
    iposWithConflicts: 13,
    mostConflictedFields: [
      { field: 'issue_price', count: 8 },
      { field: 'lot_size', count: 6 },
      { field: 'issue_size', count: 5 },
      { field: 'close_date', count: 4 },
      { field: 'listing_date', count: 3 }
    ]
  });
  console.log(`   ${conflictResult ? '✅' : '❌'} Alert ${conflictResult ? 'sent successfully' : 'failed'}`);

  if (conflictResult) {
    console.log('   💬 Check your Slack channel for the conflict rate alert');
  }

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 5: Test below-threshold (should NOT send)
  console.log('\n🔕 Step 5: Testing Threshold Logic (should NOT send)...');
  console.log('   Simulating 3 DRHP failures (below threshold of 5)');
  const belowThresholdResult = await sendDRHPFailureAlert(3);
  console.log(`   ${!belowThresholdResult ? '✅' : '❌'} Correctly ${!belowThresholdResult ? 'skipped' : 'sent (ERROR)'} alert`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary:');
  console.log(`   Configuration: ${configTest.success ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   DRHP Failure Alert: ${drhpResult ? '✅ SENT' : '❌ FAILED'}`);
  console.log(`   Slow Consolidation Alert: ${slowResult ? '✅ SENT' : '❌ FAILED'}`);
  console.log(`   High Conflict Rate Alert: ${conflictResult ? '✅ SENT' : '❌ FAILED'}`);
  console.log(`   Threshold Logic: ${!belowThresholdResult ? '✅ PASS' : '❌ FAIL'}`);

  const allPassed = configTest.success && drhpResult && slowResult && conflictResult && !belowThresholdResult;
  console.log(`\n${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  if (allPassed) {
    console.log('\n🎉 Slack alert system is fully operational!');
    console.log('   Next step: Configure alerts in monitoring API');
  } else {
    console.log('\n⚠️  Some tests failed. Review configuration and try again.');
  }

  console.log('=' .repeat(60) + '\n');
}

main().catch((error) => {
  console.error('\n❌ Test script failed:', error);
  logger.error('[Slack Alert Test] Script failed', { error });
  process.exit(1);
});
