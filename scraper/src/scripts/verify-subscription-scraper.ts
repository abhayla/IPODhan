#!/usr/bin/env tsx
/**
 * Phase 5: Subscription Data Verification Script
 *
 * **Mission:** Investigate why 97.4% of subscription data is missing
 *
 * **Current State (from data-consistency-tests.md):**
 * - Total OPEN IPOs: 38
 * - IPOs with subscription data: 1 (2.6%)
 * - Missing subscription data: 37 (97.4%)
 * - **Overall coverage:** 0.4% (2/495 IPOs)
 *
 * **Investigation Areas:**
 * 1. NSE Scraper subscription extraction logic
 * 2. Database insertion validation
 * 3. API endpoint availability
 * 4. Scheduler frequency for subscription updates
 *
 * **Root Cause Analysis:**
 * - Test NSE API with sample OPEN IPOs
 * - Verify database schema compatibility
 * - Check for data validation rejections
 * - Identify if scraper is running at all
 *
 * **Success Criteria:**
 * - Identify root cause of 97.4% gap
 * - Provide actionable fix recommendations
 * - Test fix with sample OPEN IPO
 */

import { pathToFileURL } from 'node:url';
import { eq, inArray, desc, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { db } from '@ipodhan/shared/db';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { SubscriptionRepository } from '@ipodhan/shared/repositories/subscription-repository';
import type { SubscriptionInsert } from '@ipodhan/shared/repositories/types';
import logger from '../utils/logger.js';

export interface VerificationResult {
  // Current state
  totalIPOs: number;
  openIPOs: number;
  iposWithSubscriptionData: number;
  missingSubscriptionData: number;
  coveragePercent: number;

  // Root cause analysis
  rootCause: string;
  issues: Array<{
    category: string;
    description: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  }>;

  // Testing results
  nseAPIAvailable: boolean;
  nseAPITestResult: {
    success: boolean;
    subscriptionData: any | null;
    error: string | null;
  };

  // Fix recommendations
  recommendations: Array<{
    priority: number;
    action: string;
    implementation: string;
  }>;

  timestamp: string;
}

/**
 * Test NSE subscription API with a sample OPEN IPO
 */
async function testNSESubscriptionAPI(symbol: string): Promise<{
  success: boolean;
  subscriptionData: any | null;
  error: string | null;
}> {
  try {
    logger.info({ symbol }, 'Testing NSE subscription API');

    // NSE subscription API endpoint
    const url = `https://www.nseindia.com/api/ipo-detail?symbol=${symbol}`;

    const headers = {
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo',
      'X-Requested-With': 'XMLHttpRequest'
    };

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return {
        success: false,
        subscriptionData: null,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const data = await response.json();

    // Check if subscription data exists in response
    if (data && data.subscription) {
      return {
        success: true,
        subscriptionData: data.subscription,
        error: null
      };
    }

    return {
      success: false,
      subscriptionData: null,
      error: 'No subscription data in API response'
    };

  } catch (error) {
    return {
      success: false,
      subscriptionData: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Test database insertion with sample subscription data
 */
async function testDatabaseInsertion(ipoId: string, testData: any): Promise<{
  success: boolean;
  error: string | null;
}> {
  try {
    const redis = getRedisClient();
    const repository = new SubscriptionRepository(db, redis);

    // Create test subscription record
    const subscriptionRecord: SubscriptionInsert = {
      ipoId,
      timestamp: new Date(),
      qibSubscription: testData.qib ? testData.qib.toString() : null,
      niiSubscription: testData.nii ? testData.nii.toString() : null,
      retailSubscription: testData.retail ? testData.retail.toString() : null,
      totalSubscription: testData.total ? testData.total.toString() : null,
      employeeSubscription: null,
      othersSubscription: null,
      anchorInvestorSubscription: null,
      retailHNISubscription: null,
      retailOthersSubscription: null,
      bNIISubscription: null,
      sNIISubscription: null,
      totalApplications: testData.applications || null,
      totalSharesBid: testData.sharesBid || null,
      sharesOffered: testData.sharesOffered || null,
    };

    // Attempt insertion
    await repository.create(subscriptionRecord);

    return {
      success: true,
      error: null
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Analyze NSE scraper subscription extraction logic
 */
async function analyzeNSEScraperLogic(): Promise<Array<{
  category: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}>> {
  const issues: Array<{
    category: string;
    description: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  }> = [];

  // Check scraper logs for subscription-related errors
  try {
    const recentLogs = await db.query.scraperLogs.findMany({
      where: eq(schema.scraperLogs.source, 'NSE'),
      orderBy: desc(schema.scraperLogs.createdAt),
      limit: 10,
    });

    const failedLogs = recentLogs.filter(log => log.status === 'FAILURE' || log.status === 'PARTIAL');

    if (failedLogs.length > 0) {
      issues.push({
        category: 'Scraper Failures',
        description: `${failedLogs.length}/10 recent NSE scraper runs failed or partial`,
        severity: 'HIGH'
      });
    }

    const noRecordsProcessed = recentLogs.filter(log => log.recordsProcessed === 0);

    if (noRecordsProcessed.length > 0) {
      issues.push({
        category: 'No Records Processed',
        description: `${noRecordsProcessed.length}/10 recent runs processed 0 records`,
        severity: 'CRITICAL'
      });
    }

  } catch (error) {
    issues.push({
      category: 'Scraper Logs Unavailable',
      description: 'Could not fetch scraper logs for analysis',
      severity: 'MEDIUM'
    });
  }

  return issues;
}

/**
 * Main verification function
 */
export async function verifySubscriptionScraper(): Promise<VerificationResult> {
  const timestamp = new Date().toISOString();

  logger.info('Starting Phase 5: Subscription Data Verification');

  const issues: Array<{
    category: string;
    description: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  }> = [];

  const recommendations: Array<{
    priority: number;
    action: string;
    implementation: string;
  }> = [];

  try {
    // Step 1: Analyze current subscription data coverage
    logger.info('Analyzing current subscription data coverage');

    const totalCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.ipos);

    const totalIPOs = totalCount[0]?.count || 0;

    const openCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.ipos)
      .where(eq(schema.ipos.status, 'OPEN'));

    const openIPOs = openCount[0]?.count || 0;

    // Count IPOs with subscription data
    const uniqueIPOsWithSubscriptions = await db
      .selectDistinct({ ipoId: schema.subscriptions.ipoId })
      .from(schema.subscriptions);

    const iposWithSubscriptionData = uniqueIPOsWithSubscriptions.length;
    const missingSubscriptionData = openIPOs - iposWithSubscriptionData;
    const coveragePercent = openIPOs > 0 ? (iposWithSubscriptionData / openIPOs) * 100 : 0;

    logger.info({
      totalIPOs,
      openIPOs,
      iposWithSubscriptionData,
      missingSubscriptionData,
      coveragePercent
    }, 'Current subscription data coverage');

    // Issue 1: Extremely low coverage
    if (coveragePercent < 10) {
      issues.push({
        category: 'Data Coverage',
        description: `Only ${coveragePercent.toFixed(1)}% of OPEN IPOs have subscription data`,
        severity: 'CRITICAL'
      });
    }

    // Step 2: Test NSE API with a sample OPEN IPO
    logger.info('Testing NSE subscription API');

    const sampleOpenIPO = await db.query.ipos.findFirst({
      where: eq(schema.ipos.status, 'OPEN'),
      columns: {
        id: true,
        companyName: true,
        symbol: true,
      },
    });

    let nseAPIAvailable = false;
    let nseAPITestResult: VerificationResult['nseAPITestResult'] = {
      success: false,
      subscriptionData: null,
      error: 'No OPEN IPO found to test'
    };

    if (sampleOpenIPO && sampleOpenIPO.symbol) {
      nseAPITestResult = await testNSESubscriptionAPI(sampleOpenIPO.symbol);
      nseAPIAvailable = nseAPITestResult.success;

      if (!nseAPITestResult.success) {
        issues.push({
          category: 'NSE API',
          description: `NSE subscription API failed: ${nseAPITestResult.error}`,
          severity: 'CRITICAL'
        });

        recommendations.push({
          priority: 1,
          action: 'Fix NSE API integration',
          implementation: 'Update NSE scraper to use correct API endpoint or implement browser-based scraping'
        });
      } else {
        logger.info({ subscriptionData: nseAPITestResult.subscriptionData }, 'NSE API working correctly');

        // Test database insertion
        const insertionTest = await testDatabaseInsertion(
          sampleOpenIPO.id,
          nseAPITestResult.subscriptionData
        );

        if (!insertionTest.success) {
          issues.push({
            category: 'Database Insertion',
            description: `Database insertion failed: ${insertionTest.error}`,
            severity: 'HIGH'
          });

          recommendations.push({
            priority: 2,
            action: 'Fix database schema or validation',
            implementation: 'Review subscription table schema and adjust scraper data transformation'
          });
        }
      }
    } else {
      issues.push({
        category: 'Test Data',
        description: 'No OPEN IPO found with symbol to test API',
        severity: 'MEDIUM'
      });
    }

    // Step 3: Analyze scraper logs
    logger.info('Analyzing NSE scraper logs');

    const scraperIssues = await analyzeNSEScraperLogic();
    issues.push(...scraperIssues);

    // Step 4: Determine root cause
    let rootCause = 'Unknown - Multiple potential issues identified';

    if (issues.some(i => i.category === 'NSE API' && i.severity === 'CRITICAL')) {
      rootCause = 'NSE API subscription endpoint is not accessible or has changed structure';
      recommendations.push({
        priority: 1,
        action: 'Update NSE scraper subscription extraction',
        implementation: `
1. Reverse-engineer current NSE subscription API endpoint
2. Update nse-scraper.ts to use correct endpoint
3. Add proper error handling and logging
4. Test with multiple OPEN IPOs
        `.trim()
      });
    } else if (issues.some(i => i.category === 'No Records Processed')) {
      rootCause = 'NSE scraper is running but not processing any records';
      recommendations.push({
        priority: 1,
        action: 'Debug scraper data extraction logic',
        implementation: `
1. Check if NSE page structure has changed
2. Update selectors/parsing logic
3. Add debug logging to track data flow
4. Verify scraper is scheduled correctly
        `.trim()
      });
    } else if (issues.some(i => i.category === 'Database Insertion')) {
      rootCause = 'Data is being scraped but failing database validation or insertion';
      recommendations.push({
        priority: 2,
        action: 'Fix data transformation or schema validation',
        implementation: `
1. Review subscription table schema
2. Check for data type mismatches
3. Add validation error logging
4. Adjust scraper data transformation
        `.trim()
      });
    } else if (issues.some(i => i.category === 'Scraper Failures')) {
      rootCause = 'Scraper is failing frequently due to authentication or rate limiting';
      recommendations.push({
        priority: 1,
        action: 'Fix scraper reliability',
        implementation: `
1. Implement proper cookie management
2. Add retry logic with exponential backoff
3. Reduce scraping frequency if rate-limited
4. Consider using API instead of browser scraping
        `.trim()
      });
    }

    // Add general recommendations
    if (recommendations.length === 0) {
      recommendations.push({
        priority: 3,
        action: 'Enable subscription scraper if disabled',
        implementation: `
1. Check scheduler configuration
2. Verify scraper is enabled for OPEN IPOs
3. Increase scraping frequency for subscription updates (every 1 hour)
4. Add monitoring and alerting for subscription data freshness
        `.trim()
      });
    }

    const result: VerificationResult = {
      totalIPOs,
      openIPOs,
      iposWithSubscriptionData,
      missingSubscriptionData,
      coveragePercent,
      rootCause,
      issues,
      nseAPIAvailable,
      nseAPITestResult,
      recommendations,
      timestamp,
    };

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 5: SUBSCRIPTION DATA VERIFICATION REPORT');
    console.log('='.repeat(80));
    console.log(`Timestamp: ${timestamp}`);
    console.log('');
    console.log('Current State:');
    console.log(`  Total IPOs: ${totalIPOs}`);
    console.log(`  OPEN IPOs: ${openIPOs}`);
    console.log(`  IPOs with Subscription Data: ${iposWithSubscriptionData}`);
    console.log(`  Missing Subscription Data: ${missingSubscriptionData} (${(100 - coveragePercent).toFixed(1)}%)`);
    console.log(`  Coverage: ${coveragePercent.toFixed(1)}% ❌ (Target: 90%+)`);
    console.log('');
    console.log('Root Cause Analysis:');
    console.log(`  ${rootCause}`);
    console.log('');
    console.log(`Issues Found (${issues.length}):`);
    issues.forEach((issue, index) => {
      console.log(`  ${index + 1}. [${issue.severity}] ${issue.category}: ${issue.description}`);
    });
    console.log('');
    console.log('NSE API Test:');
    console.log(`  Available: ${nseAPIAvailable ? '✅ YES' : '❌ NO'}`);
    if (nseAPITestResult.error) {
      console.log(`  Error: ${nseAPITestResult.error}`);
    }
    if (nseAPITestResult.subscriptionData) {
      console.log(`  Sample Data: ${JSON.stringify(nseAPITestResult.subscriptionData, null, 2)}`);
    }
    console.log('');
    console.log(`Recommendations (${recommendations.length}):`);
    recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. [Priority ${rec.priority}] ${rec.action}`);
      console.log(`     ${rec.implementation.split('\n').join('\n     ')}`);
    });
    console.log('='.repeat(80) + '\n');

    logger.info(result, 'Subscription verification completed');

    return result;

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, 'Subscription verification failed');

    return {
      totalIPOs: 0,
      openIPOs: 0,
      iposWithSubscriptionData: 0,
      missingSubscriptionData: 0,
      coveragePercent: 0,
      rootCause: 'Verification script error: ' + (error instanceof Error ? error.message : String(error)),
      issues,
      nseAPIAvailable: false,
      nseAPITestResult: {
        success: false,
        subscriptionData: null,
        error: error instanceof Error ? error.message : String(error)
      },
      recommendations,
      timestamp,
    };
  }
}

/**
 * CLI entry point
 */
async function main() {
  try {
    await verifySubscriptionScraper();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Verification script failed');
    process.exit(1);
  }
}

// Run CLI if executed directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
