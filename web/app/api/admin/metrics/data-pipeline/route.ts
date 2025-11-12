/**
 * Data Pipeline Metrics API
 * GET /api/admin/metrics/data-pipeline
 *
 * Provides real-time metrics for the complete data flow pipeline:
 * - IPO Detection (SEBI, NSE, BSE monitors)
 * - Data Consolidation (conflicts, processing)
 * - DRHP Extraction (confidence, failures)
 * - Data Quality (completeness, source tracking)
 *
 * Use Case: Monitoring dashboard showing pipeline health
 *
 * Response:
 * {
 *   detection: { last24h, avgLatencyHours, sources },
 *   consolidation: { processed, conflicts, conflictRate, avgLatencyMs },
 *   drhp: { extracted, avgConfidence, failures, queuedForReview },
 *   dataQuality: { fieldCompleteness, sourceTrackingCoverage, adminOverrides }
 * }
 *
 * Performance: <500ms target
 * Cache: 5 minutes TTL
 * Authentication: Admin-only (add middleware as needed)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ipos, documents, subscriptions, gmpRecords, financialData, listingPerformance, fieldSources } from '@ipodhan/shared/db/schema';
import { sql, gt, gte, eq, and, isNotNull } from 'drizzle-orm';
import { getRedisClient } from '@/lib/cache/redis-client';
import { DataConflictsRepository } from '@ipodhan/shared/repositories/data-conflicts-repository';

interface DetectionMetrics {
  last24h: number;
  avgLatencyHours: number;
  sources: {
    SEBI: number;
    NSE: number;
    BSE: number;
    MONEYCONTROL: number;
    OTHER: number;
  };
}

interface ConsolidationMetrics {
  processed: number;
  conflicts: number;
  conflictRate: string;
  avgLatencyMs: number;
  lockTimeouts: number;
}

interface DRHPMetrics {
  extracted: number;
  avgConfidence: number;
  failures: number;
  queuedForReview: number;
  pendingExtraction: number;
}

interface DataQualityMetrics {
  fieldCompleteness: string;
  sourceTrackingCoverage: string;
  adminOverrides: number;
  protectedFields: number;
  totalIPOs: number;
  withFinancials: number;
}

interface PipelineMetrics {
  detection: DetectionMetrics;
  consolidation: ConsolidationMetrics;
  drhp: DRHPMetrics;
  dataQuality: DataQualityMetrics;
  timestamp: string;
}

/**
 * GET /api/admin/metrics/data-pipeline
 * Fetch real-time pipeline metrics
 */
export async function GET(request: NextRequest) {
  try {
    const redis = getRedisClient();

    // Check cache first (5 min TTL)
    const cacheKey = 'metrics:pipeline';
    const cached = await redis.get(cacheKey).catch(() => null);

    if (cached) {
      return NextResponse.json({
        success: true,
        data: JSON.parse(cached),
        cached: true,
      }, { status: 200 });
    }

    // Gather metrics in parallel for performance
    const [
      detectionMetrics,
      consolidationMetrics,
      drhpMetrics,
      dataQualityMetrics,
    ] = await Promise.all([
      getDetectionMetrics(),
      getConsolidationMetrics(),
      getDRHPMetrics(),
      getDataQualityMetrics(),
    ]);

    const metrics: PipelineMetrics = {
      detection: detectionMetrics,
      consolidation: consolidationMetrics,
      drhp: drhpMetrics,
      dataQuality: dataQualityMetrics,
      timestamp: new Date().toISOString(),
    };

    // Cache for 5 minutes
    await redis.setex(cacheKey, 300, JSON.stringify(metrics)).catch(() => {
      console.warn('[Metrics] Failed to cache pipeline metrics');
    });

    return NextResponse.json({
      success: true,
      data: metrics,
      cached: false,
    }, { status: 200 });
  } catch (error) {
    console.error('Pipeline Metrics Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch pipeline metrics',
    }, { status: 500 });
  }
}

/**
 * Detection Metrics
 * Tracks IPO detection latency and sources
 */
async function getDetectionMetrics(): Promise<DetectionMetrics> {
  // IPOs detected in last 24 hours
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const recentIPOs = await db
    .select({
      id: ipos.id,
      companyName: ipos.companyName,
      createdAt: ipos.createdAt,
      openDate: ipos.openDate,
      // Use historical data source if available
      dataSource: ipos.historicalDataSource,
    })
    .from(ipos)
    .where(gte(ipos.createdAt, yesterday))
    .limit(1000);

  // Calculate average latency (time from creation to open date)
  let totalLatencyHours = 0;
  let latencyCount = 0;

  const sourceCounts = {
    SEBI: 0,
    NSE: 0,
    BSE: 0,
    MONEYCONTROL: 0,
    OTHER: 0,
  };

  for (const ipo of recentIPOs) {
    // Calculate latency if both dates exist
    if (ipo.createdAt && ipo.openDate) {
      const latency = (new Date(ipo.openDate).getTime() - new Date(ipo.createdAt).getTime()) / (1000 * 60 * 60);
      if (latency > 0 && latency < 24 * 90) { // Sanity check: < 90 days
        totalLatencyHours += latency;
        latencyCount++;
      }
    }

    // Determine source (from dataSource if available)
    if (ipo.dataSource && typeof ipo.dataSource === 'string') {
      const firstSource = ipo.dataSource.toUpperCase();

      if (firstSource) {
        if (firstSource === 'SEBI') sourceCounts.SEBI++;
        else if (firstSource === 'NSE') sourceCounts.NSE++;
        else if (firstSource === 'BSE') sourceCounts.BSE++;
        else if (firstSource === 'MONEYCONTROL') sourceCounts.MONEYCONTROL++;
        else sourceCounts.OTHER++;
      } else {
        sourceCounts.OTHER++;
      }
    } else {
      sourceCounts.OTHER++;
    }
  }

  return {
    last24h: recentIPOs.length,
    avgLatencyHours: latencyCount > 0 ? Math.round(totalLatencyHours / latencyCount * 10) / 10 : 0,
    sources: sourceCounts,
  };
}

/**
 * Consolidation Metrics
 * Tracks data consolidation and conflict resolution
 */
async function getConsolidationMetrics(): Promise<ConsolidationMetrics> {
  const redis = getRedisClient();
  const conflictsRepo = new DataConflictsRepository(db, redis);

  // Get conflict stats
  const stats = await conflictsRepo.getConflictStats();

  // Total IPOs processed (rough estimate based on total IPOs)
  const totalIPOs = await db
    .select({ count: sql<number>`count(*)` })
    .from(ipos)
    .then((result) => Number(result[0]?.count || 0));

  // Conflict rate
  const conflictRate = totalIPOs > 0
    ? ((stats.unresolved / totalIPOs) * 100).toFixed(2) + '%'
    : '0%';

  // Lock timeouts (would need to track this in production - placeholder for now)
  const lockTimeouts = 0; // TODO: Track this in consolidation service

  // Average latency (placeholder - would need timing logs)
  const avgLatencyMs = 0; // TODO: Track this via performance logging

  return {
    processed: totalIPOs,
    conflicts: stats.unresolved,
    conflictRate,
    avgLatencyMs,
    lockTimeouts,
  };
}

/**
 * DRHP Metrics
 * Tracks DRHP extraction performance
 */
async function getDRHPMetrics(): Promise<DRHPMetrics> {
  // Documents with DRHP type
  const drhpDocs = await db
    .select({
      id: documents.id,
      extractionStatus: documents.extractionStatus,
      extractionConfidence: documents.extractionConfidence,
      extractionError: documents.extractionError,
    })
    .from(documents)
    .where(eq(documents.type, 'DRHP'))
    .limit(10000);

  let extracted = 0;
  let failed = 0;
  let queuedForReview = 0;
  let pendingExtraction = 0;
  let totalConfidence = 0;
  let confidenceCount = 0;

  for (const doc of drhpDocs) {
    if (doc.extractionStatus === 'COMPLETED') {
      extracted++;
      if (doc.extractionConfidence !== null) {
        totalConfidence += Number(doc.extractionConfidence);
        confidenceCount++;
      }
    } else if (doc.extractionStatus === 'FAILED') {
      failed++;
    } else if (doc.extractionStatus === 'QUEUED_FOR_REVIEW') {
      queuedForReview++;
    } else if (doc.extractionStatus === 'PENDING') {
      pendingExtraction++;
    }
  }

  const avgConfidence = confidenceCount > 0
    ? Math.round((totalConfidence / confidenceCount) * 10) / 10
    : 0;

  return {
    extracted,
    avgConfidence,
    failures: failed,
    queuedForReview,
    pendingExtraction,
  };
}

/**
 * Data Quality Metrics
 * Tracks overall data completeness and source attribution
 */
async function getDataQualityMetrics(): Promise<DataQualityMetrics> {
  // Total IPOs
  const totalIPOs = await db
    .select({ count: sql<number>`count(*)` })
    .from(ipos)
    .then((result) => Number(result[0]?.count || 0));

  // IPOs with financial data (count distinct IPOs that have financial data records)
  const withFinancials = await db
    .select({ count: sql<number>`count(distinct ${financialData.ipoId})` })
    .from(financialData)
    .where(isNotNull(financialData.revenueFy2024))
    .then((result) => Number(result[0]?.count || 0));

  // IPOs with field_sources tracking (count distinct IPOs that have field source records)
  const withSourceTracking = await db
    .select({ count: sql<number>`count(distinct ${fieldSources.ipoId})` })
    .from(fieldSources)
    .then((result) => Number(result[0]?.count || 0));

  // Admin overrides (count distinct IPOs with ADMIN as source in field_sources)
  const adminOverrides = await db
    .select({ count: sql<number>`count(distinct ${fieldSources.ipoId})` })
    .from(fieldSources)
    .where(eq(fieldSources.source, 'ADMIN'))
    .then((result) => Number(result[0]?.count || 0));

  // Protected fields (would need field_protection_metadata table - placeholder)
  const protectedFields = 0; // TODO: Query field_protection_metadata table

  // Calculate percentages
  const fieldCompleteness = totalIPOs > 0
    ? ((withFinancials / totalIPOs) * 100).toFixed(1) + '%'
    : '0%';

  const sourceTrackingCoverage = totalIPOs > 0
    ? ((withSourceTracking / totalIPOs) * 100).toFixed(1) + '%'
    : '0%';

  return {
    fieldCompleteness,
    sourceTrackingCoverage,
    adminOverrides,
    protectedFields,
    totalIPOs,
    withFinancials,
  };
}
