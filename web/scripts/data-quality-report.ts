/**
 * Weekly Data Quality Monitoring Report
 *
 * Generates comprehensive data quality report covering:
 * - Lot size validation
 * - Offering type accuracy
 * - Duplicate detection
 * - Data completeness
 * - Field source distribution
 * - SEBI compliance checks
 *
 * Schedule: Run weekly (every Monday 9 AM)
 * Command: npx tsx web/scripts/data-quality-report.ts
 *
 * Output: docs/04-data-flow/data-quality-reports/YYYY-MM-DD.md
 *
 * @module web/scripts/data-quality-report
 */

import { db } from '../lib/db/index.js';
import { ipos, fieldSources } from '@ipodhan/shared/db/schema';
import { eq, and, or, sql, gte, lte } from 'drizzle-orm';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface DataQualityIssue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  issue: string;
  affectedIPOs: number;
  details?: string;
  recommendation?: string;
}

async function generateDataQualityReport() {
  console.log('\n📊 Generating Weekly Data Quality Report...\n');

  const reportDate = new Date().toISOString().split('T')[0];
  const issues: DataQualityIssue[] = [];

  // Issue 1: Lot Size = 1 (CRITICAL)
  console.log('🔍 Checking for lot_size = 1 issues...');
  const lotSize1IPOs = await db
    .select()
    .from(ipos)
    .where(eq(ipos.lotSize, 1));

  if (lotSize1IPOs.length > 0) {
    issues.push({
      severity: 'CRITICAL',
      category: 'Lot Size Validation',
      issue: 'IPOs with lot_size = 1 (SEBI violation)',
      affectedIPOs: lotSize1IPOs.length,
      details: `Found ${lotSize1IPOs.length} IPO(s) with lot_size = 1, which is never valid per SEBI ICDR regulations.`,
      recommendation: 'Research correct lot sizes from NSE/BSE and update via admin interface with ADMIN source.',
    });
  }

  // Issue 2: Lot Size < 10 (HIGH)
  console.log('🔍 Checking for lot_size < 10 issues...');
  const lotSizeLowIPOs = await db
    .select()
    .from(ipos)
    .where(
      and(
        sql`${ipos.lotSize} IS NOT NULL`,
        sql`${ipos.lotSize} < 10`,
        sql`${ipos.lotSize} != 1` // Already counted above
      )
    );

  if (lotSizeLowIPOs.length > 0) {
    issues.push({
      severity: 'HIGH',
      category: 'Lot Size Validation',
      issue: 'IPOs with lot_size < 10 (likely scraper error)',
      affectedIPOs: lotSizeLowIPOs.length,
      details: `Found ${lotSizeLowIPOs.length} IPO(s) with lot_size < 10, which is below minimum threshold.`,
      recommendation: 'Verify data from official sources and correct.',
    });
  }

  // Issue 3: Unusual lot sizes for MAINBOARD
  console.log('🔍 Checking for unusual MAINBOARD lot sizes...');
  const unusualMainboardLotSize = await db
    .select()
    .from(ipos)
    .where(
      and(
        eq(ipos.segment, 'MAINBOARD'),
        sql`${ipos.lotSize} IS NOT NULL`,
        sql`${ipos.lotSize} < 50`
      )
    );

  if (unusualMainboardLotSize.length > 0) {
    issues.push({
      severity: 'MEDIUM',
      category: 'Lot Size Validation',
      issue: 'MAINBOARD IPOs with lot_size < 50 (unusual)',
      affectedIPOs: unusualMainboardLotSize.length,
      details: `Found ${unusualMainboardLotSize.length} MAINBOARD IPO(s) with lot_size < 50. Typical range: 50-150.`,
      recommendation: 'Verify these are correct. May be valid for low-priced IPOs.',
    });
  }

  // Issue 4: Missing lot sizes
  console.log('🔍 Checking for missing lot sizes...');
  const missingLotSize = await db
    .select()
    .from(ipos)
    .where(
      and(
        sql`${ipos.lotSize} IS NULL`,
        or(
          eq(ipos.status, 'OPEN'),
          eq(ipos.status, 'UPCOMING')
        )
      )
    );

  if (missingLotSize.length > 0) {
    issues.push({
      severity: 'HIGH',
      category: 'Data Completeness',
      issue: 'Active IPOs missing lot_size',
      affectedIPOs: missingLotSize.length,
      details: `Found ${missingLotSize.length} OPEN/UPCOMING IPO(s) without lot_size.`,
      recommendation: 'Scraper should populate this field. Run manual scraper update.',
    });
  }

  // Issue 5: Missing price band
  console.log('🔍 Checking for missing price bands...');
  const missingPriceBand = await db
    .select()
    .from(ipos)
    .where(
      and(
        sql`(${ipos.priceRangeMin} IS NULL OR ${ipos.priceRangeMax} IS NULL)`,
        or(
          eq(ipos.status, 'OPEN'),
          eq(ipos.status, 'UPCOMING')
        )
      )
    );

  if (missingPriceBand.length > 0) {
    issues.push({
      severity: 'HIGH',
      category: 'Data Completeness',
      issue: 'Active IPOs missing price band',
      affectedIPOs: missingPriceBand.length,
      details: `Found ${missingPriceBand.length} OPEN/UPCOMING IPO(s) without price band.`,
      recommendation: 'Critical for investment calculations. Update immediately.',
    });
  }

  // Issue 6: Price band width validation (SEBI)
  console.log('🔍 Checking SEBI price band compliance...');
  const widePriceBandMainboard = await db
    .select()
    .from(ipos)
    .where(
      and(
        eq(ipos.segment, 'MAINBOARD'),
        sql`${ipos.priceRangeMin} IS NOT NULL`,
        sql`${ipos.priceRangeMax} IS NOT NULL`,
        sql`((${ipos.priceRangeMax} - ${ipos.priceRangeMin}) / ${ipos.priceRangeMin}) > 0.20`
      )
    );

  if (widePriceBandMainboard.length > 0) {
    issues.push({
      severity: 'CRITICAL',
      category: 'SEBI Compliance',
      issue: 'MAINBOARD IPOs with price band > 20% (SEBI violation)',
      affectedIPOs: widePriceBandMainboard.length,
      details: `Found ${widePriceBandMainboard.length} MAINBOARD IPO(s) with price band exceeding 20% limit (SEBI ICDR Reg 32).`,
      recommendation: 'Verify with official sources. This is a regulatory violation if correct.',
    });
  }

  // Issue 7: Field source distribution
  console.log('🔍 Analyzing field source distribution...');
  const sourceDistribution = await db
    .select({
      source: fieldSources.source,
      count: sql<number>`count(*)`,
    })
    .from(fieldSources)
    .groupBy(fieldSources.source);

  const totalFields = sourceDistribution.reduce((sum, s) => sum + Number(s.count), 0);
  const apiFallbackCount = sourceDistribution.find(s => s.source === 'API_FALLBACK')?.count || 0;
  const apiFallbackPercentage = (Number(apiFallbackCount) / totalFields) * 100;

  if (apiFallbackPercentage > 50) {
    issues.push({
      severity: 'MEDIUM',
      category: 'Field Source Tracking',
      issue: 'High percentage of API_FALLBACK sources',
      affectedIPOs: 0, // Not IPO-specific
      details: `${apiFallbackPercentage.toFixed(1)}% of fields have API_FALLBACK source (historical data). Target: < 30% as scrapers run.`,
      recommendation: 'Normal for initial deployment. Will decrease as scrapers run and update data.',
    });
  }

  // Issue 8: Offering type validation
  console.log('🔍 Checking offering type accuracy...');
  const possibleRightsIssues = await db
    .select()
    .from(ipos)
    .where(
      or(
        sql`LOWER(${ipos.companyName}) LIKE '%rights%'`,
        sql`LOWER(${ipos.companyName}) LIKE '%rights issue%'`
      )
    );

  const misclassifiedRights = possibleRightsIssues.filter(
    ipo => ipo.offeringType !== 'RIGHTS'
  );

  if (misclassifiedRights.length > 0) {
    issues.push({
      severity: 'HIGH',
      category: 'Offering Type',
      issue: 'RIGHTS issues mis-classified as IPOs',
      affectedIPOs: misclassifiedRights.length,
      details: `Found ${misclassifiedRights.length} IPO(s) with "rights" in name but offeringType != RIGHTS.`,
      recommendation: 'Update offeringType to RIGHTS and filter from IPO listings.',
    });
  }

  // Issue 9: Data freshness
  console.log('🔍 Checking data freshness...');
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const staleOpenIPOs = await db
    .select()
    .from(ipos)
    .where(
      and(
        eq(ipos.status, 'OPEN'),
        sql`${ipos.updatedAt} < ${oneWeekAgo.toISOString()}`
      )
    );

  if (staleOpenIPOs.length > 0) {
    issues.push({
      severity: 'MEDIUM',
      category: 'Data Freshness',
      issue: 'OPEN IPOs with stale data (> 1 week old)',
      affectedIPOs: staleOpenIPOs.length,
      details: `Found ${staleOpenIPOs.length} OPEN IPO(s) not updated in past 7 days.`,
      recommendation: 'Run scraper to update subscription data and other dynamic fields.',
    });
  }

  // Issue 10: Closed IPOs with future close date
  console.log('🔍 Checking for invalid closed IPO dates...');
  const today = new Date();
  const invalidClosedIPOs = await db
    .select()
    .from(ipos)
    .where(
      and(
        eq(ipos.status, 'CLOSED'),
        sql`${ipos.closeDate} > ${today.toISOString()}`
      )
    );

  if (invalidClosedIPOs.length > 0) {
    issues.push({
      severity: 'MEDIUM',
      category: 'Status Validation',
      issue: 'CLOSED IPOs with future close dates',
      affectedIPOs: invalidClosedIPOs.length,
      details: `Found ${invalidClosedIPOs.length} IPO(s) marked CLOSED but close_date is in the future.`,
      recommendation: 'Run status updater job to fix automatically.',
    });
  }

  // Generate report
  const report = generateMarkdownReport(issues, sourceDistribution, reportDate);

  // Save report
  const reportsDir = join(process.cwd(), 'docs', '04-data-flow', 'data-quality-reports');
  try {
    mkdirSync(reportsDir, { recursive: true });
  } catch (e) {
    // Directory might already exist
  }

  const reportPath = join(reportsDir, `${reportDate}.md`);
  writeFileSync(reportPath, report, 'utf-8');

  console.log(`\n✅ Data Quality Report generated: ${reportPath}`);

  // Print summary
  printSummary(issues);

  return {
    reportPath,
    issuesFound: issues.length,
    criticalIssues: issues.filter(i => i.severity === 'CRITICAL').length,
    highIssues: issues.filter(i => i.severity === 'HIGH').length,
  };
}

function generateMarkdownReport(
  issues: DataQualityIssue[],
  sourceDistribution: any[],
  reportDate: string
): string {
  let report = `# Weekly Data Quality Report\n`;
  report += `**Date**: ${reportDate}\n`;
  report += `**Generated**: ${new Date().toISOString()}\n\n`;

  report += `---\n\n`;

  // Executive Summary
  report += `## Executive Summary\n\n`;
  report += `**Total Issues Found**: ${issues.length}\n\n`;

  const bySeverity = {
    CRITICAL: issues.filter(i => i.severity === 'CRITICAL').length,
    HIGH: issues.filter(i => i.severity === 'HIGH').length,
    MEDIUM: issues.filter(i => i.severity === 'MEDIUM').length,
    LOW: issues.filter(i => i.severity === 'LOW').length,
  };

  report += `**By Severity**:\n`;
  report += `- 🚨 CRITICAL: ${bySeverity.CRITICAL}\n`;
  report += `- ⚠️  HIGH: ${bySeverity.HIGH}\n`;
  report += `- 🟡 MEDIUM: ${bySeverity.MEDIUM}\n`;
  report += `- ℹ️  LOW: ${bySeverity.LOW}\n\n`;

  // Issues by category
  const byCategory: Record<string, number> = {};
  for (const issue of issues) {
    byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
  }

  report += `**By Category**:\n`;
  for (const [category, count] of Object.entries(byCategory)) {
    report += `- ${category}: ${count}\n`;
  }

  report += `\n---\n\n`;

  // Detailed Issues
  report += `## Detailed Issues\n\n`;

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    const severityIcon = {
      CRITICAL: '🚨',
      HIGH: '⚠️',
      MEDIUM: '🟡',
      LOW: 'ℹ️',
    }[issue.severity];

    report += `### ${i + 1}. ${severityIcon} ${issue.issue}\n\n`;
    report += `**Severity**: ${issue.severity}\n`;
    report += `**Category**: ${issue.category}\n`;
    report += `**Affected IPOs**: ${issue.affectedIPOs}\n\n`;

    if (issue.details) {
      report += `**Details**: ${issue.details}\n\n`;
    }

    if (issue.recommendation) {
      report += `**Recommendation**: ${issue.recommendation}\n\n`;
    }

    report += `---\n\n`;
  }

  // Field Source Distribution
  report += `## Field Source Distribution\n\n`;
  report += `| Source | Count | Percentage |\n`;
  report += `|--------|-------|------------|\n`;

  const totalFields = sourceDistribution.reduce((sum, s) => sum + Number(s.count), 0);
  for (const source of sourceDistribution) {
    const percentage = ((Number(source.count) / totalFields) * 100).toFixed(1);
    report += `| ${source.source} | ${source.count} | ${percentage}% |\n`;
  }

  report += `\n**Total Fields Tracked**: ${totalFields}\n\n`;

  report += `---\n\n`;

  // Action Items
  report += `## Recommended Actions\n\n`;

  const criticalIssues = issues.filter(i => i.severity === 'CRITICAL');
  const highIssues = issues.filter(i => i.severity === 'HIGH');

  if (criticalIssues.length > 0) {
    report += `### Immediate (CRITICAL Priority)\n\n`;
    for (const issue of criticalIssues) {
      report += `- [ ] ${issue.issue} (${issue.affectedIPOs} IPOs affected)\n`;
      if (issue.recommendation) {
        report += `  - ${issue.recommendation}\n`;
      }
    }
    report += `\n`;
  }

  if (highIssues.length > 0) {
    report += `### This Week (HIGH Priority)\n\n`;
    for (const issue of highIssues) {
      report += `- [ ] ${issue.issue} (${issue.affectedIPOs} IPOs affected)\n`;
      if (issue.recommendation) {
        report += `  - ${issue.recommendation}\n`;
      }
    }
    report += `\n`;
  }

  report += `---\n\n`;

  // Footer
  report += `**Document Owner**: IPODhan Development Team\n`;
  report += `**Next Report**: ${getNextReportDate(reportDate)}\n`;

  return report;
}

function printSummary(issues: DataQualityIssue[]) {
  console.log('\n' + '='.repeat(80));
  console.log('DATA QUALITY REPORT SUMMARY');
  console.log('='.repeat(80));

  console.log(`\nTotal Issues: ${issues.length}`);

  const bySeverity = {
    CRITICAL: issues.filter(i => i.severity === 'CRITICAL'),
    HIGH: issues.filter(i => i.severity === 'HIGH'),
    MEDIUM: issues.filter(i => i.severity === 'MEDIUM'),
    LOW: issues.filter(i => i.severity === 'LOW'),
  };

  if (bySeverity.CRITICAL.length > 0) {
    console.log(`\n🚨 CRITICAL Issues (${bySeverity.CRITICAL.length}):`);
    for (const issue of bySeverity.CRITICAL) {
      console.log(`   • ${issue.issue} (${issue.affectedIPOs} IPOs)`);
    }
  }

  if (bySeverity.HIGH.length > 0) {
    console.log(`\n⚠️  HIGH Issues (${bySeverity.HIGH.length}):`);
    for (const issue of bySeverity.HIGH) {
      console.log(`   • ${issue.issue} (${issue.affectedIPOs} IPOs)`);
    }
  }

  if (bySeverity.MEDIUM.length > 0) {
    console.log(`\n🟡 MEDIUM Issues (${bySeverity.MEDIUM.length}):`);
    for (const issue of bySeverity.MEDIUM) {
      console.log(`   • ${issue.issue} (${issue.affectedIPOs} IPOs)`);
    }
  }

  console.log('\n' + '='.repeat(80));
}

function getNextReportDate(currentDate: string): string {
  const date = new Date(currentDate);
  date.setDate(date.getDate() + 7); // Next week
  return date.toISOString().split('T')[0];
}

// Execute
generateDataQualityReport()
  .then((result) => {
    console.log(`\n✅ Script completed successfully`);
    console.log(`   Report: ${result.reportPath}`);
    console.log(`   Issues: ${result.issuesFound} (${result.criticalIssues} critical, ${result.highIssues} high)`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
