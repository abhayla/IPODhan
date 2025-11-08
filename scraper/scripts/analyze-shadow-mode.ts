/**
 * Shadow Mode Analysis Script
 * Analyzes logs from Phase 2 shadow mode to validate consolidation service
 *
 * Usage:
 *   npx tsx scripts/analyze-shadow-mode.ts [--days=7] [--log-file=path/to/log]
 *
 * Purpose:
 *   - Validate consolidation service makes correct decisions
 *   - Measure performance (should be <500ms p95)
 *   - Detect critical conflicts (target: 0)
 *   - Compare consolidation vs legacy decisions
 *   - Provide go/no-go recommendation for Phase 3
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==================== TYPES ====================

interface ShadowModeLog {
  event: 'SHADOW_MODE_CONSOLIDATION';
  phase: number;
  ipoId: string;
  companyName: string;
  slug: string;
  source: string;
  metrics: {
    fieldsProcessed: number;
    fieldsUpdated: number;
    conflictsDetected: number;
    conflictsBySeverity: { INFO: number; WARNING: number; CRITICAL: number };
    performanceMs: number;
    errors: number;
  };
  decisions: {
    consolidatedData: Record<string, any>;
    legacyData: Record<string, any>;
    differencesCount: number;
    differences?: Array<{ field: string; consolidatedValue: any; legacyValue: any }>;
  };
}

interface AnalysisResult {
  totalRuns: number;
  totalConflicts: number;
  conflictsBySeverity: { INFO: number; WARNING: number; CRITICAL: number };
  avgPerformanceMs: number;
  p95PerformanceMs: number;
  p99PerformanceMs: number;
  maxPerformanceMs: number;
  totalDifferences: number;
  totalErrors: number;
  conflictRate: number;
  passRate: number;
  recommendation: 'GO' | 'NO_GO' | 'REVIEW';
  issues: string[];
}

// ==================== CLI ARGUMENTS ====================

const args = process.argv.slice(2);
const daysParam = args.find(arg => arg.startsWith('--days='))?.split('=')[1];
const logFileParam = args.find(arg => arg.startsWith('--log-file='))?.split('=')[1];

const DAYS_TO_ANALYZE = daysParam ? parseInt(daysParam) : 7;
const LOG_FILE_PATH = logFileParam || join(__dirname, '..', 'logs', 'scraper.log');

// ==================== PARSE LOGS ====================

console.log('📊 Shadow Mode Analysis Report');
console.log('=' .repeat(80));
console.log(`Log file: ${LOG_FILE_PATH}`);
console.log(`Analyzing last ${DAYS_TO_ANALYZE} days\n`);

if (!existsSync(LOG_FILE_PATH)) {
  console.error(`❌ Log file not found: ${LOG_FILE_PATH}`);
  console.error('\nPlease run scrapers in shadow mode first:');
  console.error('  cd scraper && npm run scraper:nse');
  process.exit(1);
}

const logContent = readFileSync(LOG_FILE_PATH, 'utf-8');
const shadowLogs: ShadowModeLog[] = logContent
  .split('\n')
  .filter(line => line.includes('SHADOW_MODE_CONSOLIDATION'))
  .map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter((log): log is ShadowModeLog => log !== null);

if (shadowLogs.length === 0) {
  console.log('⚠️  No shadow mode logs found.');
  console.log('\nMake sure:');
  console.log('  1. Shadow mode is enabled: SHADOW_MODE=true in .env');
  console.log('  2. Consolidation is enabled: ENABLE_DATA_CONSOLIDATION=true');
  console.log('  3. Scrapers have been run: npm run scraper:nse');
  process.exit(0);
}

// ==================== AGGREGATE METRICS ====================

const totalRuns = shadowLogs.length;
const performanceTimes = shadowLogs.map(log => log.metrics.performanceMs).sort((a, b) => a - b);

const analysis: AnalysisResult = {
  totalRuns,
  totalConflicts: shadowLogs.reduce((sum, log) => sum + log.metrics.conflictsDetected, 0),
  conflictsBySeverity: {
    INFO: shadowLogs.reduce((sum, log) => sum + log.metrics.conflictsBySeverity.INFO, 0),
    WARNING: shadowLogs.reduce((sum, log) => sum + log.metrics.conflictsBySeverity.WARNING, 0),
    CRITICAL: shadowLogs.reduce((sum, log) => sum + log.metrics.conflictsBySeverity.CRITICAL, 0),
  },
  avgPerformanceMs: performanceTimes.reduce((a, b) => a + b, 0) / totalRuns,
  p95PerformanceMs: performanceTimes[Math.floor(totalRuns * 0.95)] || 0,
  p99PerformanceMs: performanceTimes[Math.floor(totalRuns * 0.99)] || 0,
  maxPerformanceMs: Math.max(...performanceTimes),
  totalDifferences: shadowLogs.reduce((sum, log) => sum + log.decisions.differencesCount, 0),
  totalErrors: shadowLogs.reduce((sum, log) => sum + log.metrics.errors, 0),
  conflictRate: 0,
  passRate: 0,
  recommendation: 'REVIEW',
  issues: [],
};

// Calculate rates
const totalFieldsProcessed = shadowLogs.reduce((sum, log) => sum + log.metrics.fieldsProcessed, 0);
analysis.conflictRate = (analysis.totalConflicts / totalFieldsProcessed) * 100;
analysis.passRate = ((totalRuns - analysis.totalErrors) / totalRuns) * 100;

// ==================== VALIDATION & RECOMMENDATION ====================

// Check Phase 3 criteria
if (analysis.conflictsBySeverity.CRITICAL > 0) {
  analysis.issues.push(`⚠️  ${analysis.conflictsBySeverity.CRITICAL} CRITICAL conflicts detected - must fix priority matrix`);
}

if (analysis.p95PerformanceMs > 500) {
  analysis.issues.push(`⚠️  P95 performance ${analysis.p95PerformanceMs}ms exceeds 500ms target - optimize`);
}

if (analysis.conflictRate > 5) {
  analysis.issues.push(`⚠️  Conflict rate ${analysis.conflictRate.toFixed(2)}% exceeds 5% target - review rules`);
}

if (analysis.totalErrors > 0) {
  analysis.issues.push(`⚠️  ${analysis.totalErrors} errors occurred - investigate failures`);
}

if (totalRuns < 10) {
  analysis.issues.push(`⚠️  Only ${totalRuns} runs - need more data (minimum 10 recommended)`);
}

// Determine recommendation
if (analysis.issues.length === 0) {
  analysis.recommendation = 'GO';
} else if (analysis.conflictsBySeverity.CRITICAL > 0 || analysis.totalErrors > totalRuns * 0.1) {
  analysis.recommendation = 'NO_GO';
} else {
  analysis.recommendation = 'REVIEW';
}

// ==================== PRINT SUMMARY ====================

console.log('## Summary Statistics\n');
console.log(`Total consolidation runs: ${totalRuns}`);
console.log(`Total fields processed: ${totalFieldsProcessed.toLocaleString()}`);
console.log(`Total conflicts detected: ${analysis.totalConflicts}`);
console.log(`Conflict rate: ${analysis.conflictRate.toFixed(2)}% ${analysis.conflictRate < 5 ? '✅' : '❌'}`);
console.log();

console.log('## Conflict Breakdown\n');
console.log(`INFO (minor): ${analysis.conflictsBySeverity.INFO}`);
console.log(`WARNING (moderate): ${analysis.conflictsBySeverity.WARNING}`);
console.log(`CRITICAL (urgent): ${analysis.conflictsBySeverity.CRITICAL} ${analysis.conflictsBySeverity.CRITICAL === 0 ? '✅' : '❌'}`);
console.log();

console.log('## Performance Metrics\n');
console.log(`Average: ${analysis.avgPerformanceMs.toFixed(0)}ms`);
console.log(`P95: ${analysis.p95PerformanceMs}ms ${analysis.p95PerformanceMs < 500 ? '✅' : '❌'} (target: <500ms)`);
console.log(`P99: ${analysis.p99PerformanceMs}ms`);
console.log(`Max: ${analysis.maxPerformanceMs}ms`);
console.log();

console.log('## Decision Comparison\n');
console.log(`Consolidation vs Legacy differences: ${analysis.totalDifferences}`);
console.log(`Difference rate: ${((analysis.totalDifferences / totalFieldsProcessed) * 100).toFixed(2)}%`);
console.log();

// ==================== TOP CONFLICTS ====================

console.log('## Top 5 IPOs with Most Conflicts\n');
const ipoConflicts = shadowLogs
  .filter(log => log.metrics.conflictsDetected > 0)
  .sort((a, b) => b.metrics.conflictsDetected - a.metrics.conflictsDetected)
  .slice(0, 5);

if (ipoConflicts.length > 0) {
  ipoConflicts.forEach((log, i) => {
    console.log(`${i + 1}. ${log.companyName} (${log.source})`);
    console.log(`   Conflicts: ${log.metrics.conflictsDetected} (CRITICAL: ${log.metrics.conflictsBySeverity.CRITICAL})`);
    console.log(`   Performance: ${log.metrics.performanceMs}ms`);
  });
  console.log();
} else {
  console.log('✅ No conflicts detected!\n');
}

// ==================== SAMPLE DIFFERENCES ====================

console.log('## Sample Differences (Consolidation vs Legacy)\n');
const logsWithDifferences = shadowLogs.filter(log =>
  log.decisions.differences && log.decisions.differences.length > 0
).slice(0, 3);

if (logsWithDifferences.length > 0) {
  logsWithDifferences.forEach((log, i) => {
    console.log(`${i + 1}. ${log.companyName} (${log.source})`);
    log.decisions.differences!.forEach(diff => {
      console.log(`   Field: ${diff.field}`);
      console.log(`   Consolidation: ${JSON.stringify(diff.consolidatedValue)}`);
      console.log(`   Legacy: ${JSON.stringify(diff.legacyValue)}`);
    });
    console.log();
  });
} else {
  console.log('✅ No differences found - consolidation matches legacy perfectly!\n');
}

// ==================== SOURCE DISTRIBUTION ====================

console.log('## Source Distribution\n');
const sourceCounts: Record<string, number> = {};
shadowLogs.forEach(log => {
  sourceCounts[log.source] = (sourceCounts[log.source] || 0) + 1;
});

Object.entries(sourceCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([source, count]) => {
    const percentage = ((count / totalRuns) * 100).toFixed(1);
    console.log(`${source}: ${count} (${percentage}%)`);
  });
console.log();

// ==================== ISSUES & RECOMMENDATION ====================

console.log('## Validation Results\n');

if (analysis.issues.length > 0) {
  console.log('Issues found:\n');
  analysis.issues.forEach(issue => console.log(`  ${issue}`));
  console.log();
} else {
  console.log('✅ All validation criteria passed!\n');
}

// Final recommendation
console.log('=' .repeat(80));
if (analysis.recommendation === 'GO') {
  console.log('✅ RECOMMENDATION: GO FOR PHASE 3');
  console.log('\nShadow mode validation successful! Ready to enable consolidation in production.');
  console.log('\nNext steps:');
  console.log('  1. Set SHADOW_MODE=false in .env');
  console.log('  2. Set ENABLE_SOURCE_TRACKING=true');
  console.log('  3. Set ENABLE_CONFLICT_DETECTION=true');
  console.log('  4. Deploy and monitor closely for 24 hours');
} else if (analysis.recommendation === 'NO_GO') {
  console.log('❌ RECOMMENDATION: NO-GO - DO NOT PROCEED TO PHASE 3');
  console.log('\nCritical issues must be resolved before production rollout.');
  console.log('\nAction required:');
  console.log('  1. Fix all CRITICAL conflicts');
  console.log('  2. Investigate and resolve errors');
  console.log('  3. Re-run shadow mode for 7 days');
  console.log('  4. Re-analyze before attempting Phase 3');
} else {
  console.log('⚠️  RECOMMENDATION: REVIEW REQUIRED');
  console.log('\nSome issues detected - manual review recommended before Phase 3.');
  console.log('\nRecommended actions:');
  console.log('  1. Review issues listed above');
  console.log('  2. Optimize if needed');
  console.log('  3. Consider extended shadow mode period (14 days)');
  console.log('  4. Proceed to Phase 3 with caution and monitoring');
}
console.log('=' .repeat(80));

// Exit with appropriate code
process.exit(analysis.recommendation === 'NO_GO' ? 1 : 0);
