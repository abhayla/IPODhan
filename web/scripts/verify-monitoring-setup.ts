/**
 * Monitoring Setup Verification Script
 *
 * Verifies that all monitoring components are properly installed
 * and configured before production deployment.
 */

import fs from 'fs';
import path from 'path';

interface VerificationResult {
  component: string;
  status: 'OK' | 'WARNING' | 'MISSING';
  message: string;
}

const results: VerificationResult[] = [];

function checkFile(filePath: string, component: string): void {
  const fullPath = path.join(process.cwd(), filePath);
  if (fs.existsSync(fullPath)) {
    results.push({
      component,
      status: 'OK',
      message: `File exists: ${filePath}`,
    });
  } else {
    results.push({
      component,
      status: 'MISSING',
      message: `File missing: ${filePath}`,
    });
  }
}

function checkDirectory(dirPath: string, component: string): void {
  const fullPath = path.join(process.cwd(), dirPath);
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
    results.push({
      component,
      status: 'OK',
      message: `Directory exists: ${dirPath}`,
    });
  } else {
    results.push({
      component,
      status: 'MISSING',
      message: `Directory missing: ${dirPath}`,
    });
  }
}

function checkEnvVar(varName: string, component: string, required: boolean = false): void {
  if (process.env[varName]) {
    results.push({
      component,
      status: 'OK',
      message: `Environment variable set: ${varName}`,
    });
  } else {
    results.push({
      component,
      status: required ? 'MISSING' : 'WARNING',
      message: `Environment variable not set: ${varName} ${required ? '(REQUIRED)' : '(OPTIONAL)'}`,
    });
  }
}

function checkPackageDependency(pkgName: string, component: string): void {
  try {
    require.resolve(pkgName);
    results.push({
      component,
      status: 'OK',
      message: `Package installed: ${pkgName}`,
    });
  } catch (error) {
    results.push({
      component,
      status: 'MISSING',
      message: `Package not installed: ${pkgName}`,
    });
  }
}

console.log('='.repeat(60));
console.log('IPODhan Monitoring Setup Verification');
console.log('='.repeat(60));
console.log();

// Check core monitoring files
console.log('Checking Core Monitoring Files...');
checkFile('lib/logging/logger.ts', 'Structured Logging');
checkFile('lib/monitoring/instrumentation.ts', 'OpenTelemetry APM');
checkFile('lib/monitoring/alerts.ts', 'Alert System');
checkFile('lib/services/metrics-service.ts', 'Business Metrics');

// Check monitoring scripts
console.log('Checking Monitoring Scripts...');
checkFile('scripts/db-health-check.ts', 'Database Monitoring');
checkFile('scripts/monitor-redis.ts', 'Redis Monitoring');
checkFile('scripts/monitor-db-performance.sql', 'SQL Monitoring Queries');

// Check API endpoints
console.log('Checking API Endpoints...');
checkFile('app/api/health-detailed/route.ts', 'Enhanced Health Check');
checkFile('app/api/metrics/route.ts', 'Metrics API');

// Check log directory
console.log('Checking Log Directory...');
checkDirectory('logs', 'Log Storage');

// Check dependencies
console.log('Checking NPM Dependencies...');
checkPackageDependency('winston', 'Winston Logger');
checkPackageDependency('winston-daily-rotate-file', 'Log Rotation');
checkPackageDependency('@opentelemetry/api', 'OpenTelemetry API');
checkPackageDependency('@opentelemetry/sdk-node', 'OpenTelemetry SDK');
checkPackageDependency('@opentelemetry/exporter-prometheus', 'Prometheus Exporter');

// Check environment variables
console.log('Checking Environment Variables...');
checkEnvVar('LOG_LEVEL', 'Logging Configuration', false);
checkEnvVar('PROMETHEUS_PORT', 'Prometheus Configuration', false);
checkEnvVar('DISCORD_WEBHOOK_URL', 'Discord Alerts', false);
checkEnvVar('ADMIN_EMAIL', 'Email Alerts', false);

// Check optional integrations
console.log('Checking Optional Integrations...');
checkFile('instrumentation.ts', 'Next.js Instrumentation Hook');

// Print results
console.log();
console.log('='.repeat(60));
console.log('Verification Results');
console.log('='.repeat(60));
console.log();

const okCount = results.filter(r => r.status === 'OK').length;
const warningCount = results.filter(r => r.status === 'WARNING').length;
const missingCount = results.filter(r => r.status === 'MISSING').length;

// Group results by status
const grouped = {
  OK: results.filter(r => r.status === 'OK'),
  WARNING: results.filter(r => r.status === 'WARNING'),
  MISSING: results.filter(r => r.status === 'MISSING'),
};

// Print OK items
if (grouped.OK.length > 0) {
  console.log('✅ OK (%d):', grouped.OK.length);
  grouped.OK.forEach(r => console.log(`   - ${r.message}`));
  console.log();
}

// Print warnings
if (grouped.WARNING.length > 0) {
  console.log('⚠️  WARNING (%d):', grouped.WARNING.length);
  grouped.WARNING.forEach(r => console.log(`   - ${r.message}`));
  console.log();
}

// Print missing items
if (grouped.MISSING.length > 0) {
  console.log('❌ MISSING (%d):', grouped.MISSING.length);
  grouped.MISSING.forEach(r => console.log(`   - ${r.message}`));
  console.log();
}

// Summary
console.log('='.repeat(60));
console.log('Summary');
console.log('='.repeat(60));
console.log(`Total Checks: ${results.length}`);
console.log(`✅ OK: ${okCount}`);
console.log(`⚠️  Warnings: ${warningCount}`);
console.log(`❌ Missing: ${missingCount}`);
console.log();

// Recommendations
if (missingCount > 0 || warningCount > 0) {
  console.log('='.repeat(60));
  console.log('Recommendations');
  console.log('='.repeat(60));
  console.log();

  if (grouped.MISSING.some(r => r.message.includes('Package not installed'))) {
    console.log('📦 Install missing dependencies:');
    console.log('   npm install winston winston-daily-rotate-file \\');
    console.log('     @opentelemetry/api @opentelemetry/sdk-node \\');
    console.log('     @opentelemetry/auto-instrumentations-node \\');
    console.log('     @opentelemetry/exporter-prometheus \\');
    console.log('     @opentelemetry/sdk-metrics');
    console.log();
  }

  if (grouped.MISSING.some(r => r.message.includes('instrumentation.ts'))) {
    console.log('🔧 Create Next.js instrumentation hook:');
    console.log('   Create file: web/instrumentation.ts');
    console.log('   Content: See test-results/phase-5/enhanced-monitoring-report.md');
    console.log();
  }

  if (grouped.WARNING.some(r => r.message.includes('DISCORD_WEBHOOK_URL'))) {
    console.log('🔔 Configure Discord alerts (optional):');
    console.log('   Add to .env.local:');
    console.log('   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...');
    console.log();
  }

  if (grouped.WARNING.some(r => r.message.includes('LOG_LEVEL'))) {
    console.log('📝 Configure logging (optional):');
    console.log('   Add to .env.local:');
    console.log('   LOG_LEVEL=info');
    console.log('   PROMETHEUS_PORT=9464');
    console.log();
  }
}

// Exit code
const exitCode = missingCount > 0 ? 1 : 0;

if (exitCode === 0) {
  console.log('✅ All critical components verified!');
  console.log('   Warnings are optional and can be configured later.');
} else {
  console.log('❌ Some critical components are missing.');
  console.log('   Please address the missing items before production deployment.');
}

console.log();

process.exit(exitCode);
