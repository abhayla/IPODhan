/**
 * Email Alert Test Script
 *
 * Tests the email alert system configuration and delivery.
 * Run: npx tsx web/scripts/test-email-alert.ts
 *
 * Prerequisites:
 * - SMTP credentials configured in .env.local
 * - Required env vars: SMTP_HOST, SMTP_USER, SMTP_PASSWORD, ADMIN_EMAIL
 */

import {
  sendCriticalConflictAlert,
  sendDuplicateIPOAlert,
  testEmailConfiguration
} from '../lib/alerts/email-alerts';
import { logger } from '../lib/logging/logger';

async function main() {
  console.log('\n🧪 Email Alert System Test');
  console.log('=' .repeat(60));

  // Step 1: Test configuration
  console.log('\n📋 Step 1: Testing Email Configuration...');
  const configTest = await testEmailConfiguration();
  console.log(`   ${configTest.success ? '✅' : '❌'} ${configTest.message}`);

  if (!configTest.success) {
    console.log('\n❌ Email configuration failed. Please check:');
    console.log('   - SMTP_HOST is set in .env.local');
    console.log('   - SMTP_USER is set in .env.local');
    console.log('   - SMTP_PASSWORD is set in .env.local');
    console.log('   - ADMIN_EMAIL is set in .env.local');
    console.log('\n💡 Example configuration:');
    console.log('   SMTP_HOST=smtp.gmail.com');
    console.log('   SMTP_PORT=587');
    console.log('   SMTP_USER=your-email@gmail.com');
    console.log('   SMTP_PASSWORD=your-app-password');
    console.log('   ADMIN_EMAIL=admin@yourcompany.com');
    process.exit(1);
  }

  // Step 2: Test CRITICAL conflict alert (threshold: 15 > 10)
  console.log('\n📧 Step 2: Testing CRITICAL Conflict Alert...');
  console.log('   Simulating 15 critical conflicts (threshold: 10)');
  const conflictResult = await sendCriticalConflictAlert(15);
  console.log(`   ${conflictResult ? '✅' : '❌'} Alert ${conflictResult ? 'sent successfully' : 'failed'}`);

  if (conflictResult) {
    console.log('   📬 Check your inbox for the critical conflict alert');
  }

  // Step 3: Test duplicate IPO alert
  console.log('\n📧 Step 3: Testing Duplicate IPO Alert...');
  console.log('   Simulating 2 duplicate IPOs detected');
  const duplicateResult = await sendDuplicateIPOAlert([
    { companyName: 'Test Corporation Ltd', count: 2 },
    { companyName: 'Demo Industries Inc', count: 3 }
  ]);
  console.log(`   ${duplicateResult ? '✅' : '❌'} Alert ${duplicateResult ? 'sent successfully' : 'failed'}`);

  if (duplicateResult) {
    console.log('   📬 Check your inbox for the duplicate IPO alert');
  }

  // Step 4: Test below-threshold (should NOT send)
  console.log('\n🔕 Step 4: Testing Threshold Logic (should NOT send)...');
  console.log('   Simulating 5 critical conflicts (below threshold of 10)');
  const belowThresholdResult = await sendCriticalConflictAlert(5);
  console.log(`   ${!belowThresholdResult ? '✅' : '❌'} Correctly ${!belowThresholdResult ? 'skipped' : 'sent (ERROR)'} alert`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary:');
  console.log(`   Configuration: ${configTest.success ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Critical Conflict Alert: ${conflictResult ? '✅ SENT' : '❌ FAILED'}`);
  console.log(`   Duplicate IPO Alert: ${duplicateResult ? '✅ SENT' : '❌ FAILED'}`);
  console.log(`   Threshold Logic: ${!belowThresholdResult ? '✅ PASS' : '❌ FAIL'}`);

  const allPassed = configTest.success && conflictResult && duplicateResult && !belowThresholdResult;
  console.log(`\n${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  if (allPassed) {
    console.log('\n🎉 Email alert system is fully operational!');
    console.log('   Next step: Configure alerts in monitoring API');
  } else {
    console.log('\n⚠️  Some tests failed. Review configuration and try again.');
  }

  console.log('=' .repeat(60) + '\n');
}

main().catch((error) => {
  console.error('\n❌ Test script failed:', error);
  logger.error('[Email Alert Test] Script failed', { error });
  process.exit(1);
});
