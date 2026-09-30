'use client';

/**
 * Data Pipeline Monitoring Dashboard
 * Real-time visibility into the complete IPO data flow
 *
 * Features:
 * - Live pipeline metrics (Detection, Consolidation, DRHP, Quality)
 * - Auto-refresh every 5 minutes
 * - Visual health indicators
 * - Trend analysis (last 24h)
 * - Quick actions for common admin tasks
 *
 * Data Sources:
 * - GET /api/admin/metrics/data-pipeline
 *
 * Metrics Tracked:
 * 1. Detection: IPO discovery latency and sources
 * 2. Consolidation: Conflict resolution and processing
 * 3. DRHP: Extraction success and confidence
 * 4. Data Quality: Completeness and source attribution
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { adminGet } from '@/lib/admin/admin-api-client';

interface PipelineMetrics {
  detection: {
    last24h: number;
    avgLatencyHours: number;
    sources: {
      SEBI: number;
      NSE: number;
      BSE: number;
      MONEYCONTROL: number;
      OTHER: number;
    };
  };
  consolidation: {
    processed: number;
    conflicts: number;
    conflictRate: string;
    avgLatencyMs: number;
    lockTimeouts: number;
  };
  drhp: {
    extracted: number;
    avgConfidence: number;
    failures: number;
    queuedForReview: number;
    pendingExtraction: number;
  };
  dataQuality: {
    fieldCompleteness: string;
    sourceTrackingCoverage: string;
    adminOverrides: number;
    protectedFields: number;
    totalIPOs: number;
    withFinancials: number;
  };
  timestamp: string;
}

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  /**
   * Fetch pipeline metrics
   */
  const fetchMetrics = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await adminGet('/api/admin/metrics/data-pipeline');
      setMetrics(data.data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchMetrics();
  }, []);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchMetrics();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [autoRefresh]);

  /**
   * Get health status color
   */
  const getHealthColor = (value: number, thresholds: { good: number; warning: number }): string => {
    if (value >= thresholds.good) return 'text-green-400';
    if (value >= thresholds.warning) return 'text-yellow-400';
    return 'text-red-400';
  };

  /**
   * Get health indicator
   */
  const getHealthIndicator = (value: number, thresholds: { good: number; warning: number }): string => {
    if (value >= thresholds.good) return '🟢';
    if (value >= thresholds.warning) return '🟡';
    return '🔴';
  };

  /**
   * Format time since last refresh
   */
  const getTimeSinceRefresh = (): string => {
    const seconds = Math.floor((new Date().getTime() - lastRefresh.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  if (loading && !metrics) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="p-8">
        <div className="bg-red-900/50 border border-red-600 rounded-lg p-6">
          <h2 className="text-xl font-bold text-red-200 mb-2">Failed to Load Metrics</h2>
          <p className="text-red-300">{error}</p>
          <button
            onClick={fetchMetrics}
            className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-white">Data Pipeline Monitoring</h1>
          <p className="text-gray-400 mt-1">
            Real-time metrics for IPO detection, consolidation, and data quality
          </p>
          <div className="flex items-center space-x-4 mt-3">
            <span className="text-sm text-gray-400">
              Last updated: <span className="text-white font-medium">{getTimeSinceRefresh()}</span>
            </span>
            <label className="flex items-center space-x-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4"
              />
              <span>Auto-refresh (5m)</span>
            </label>
          </div>
        </div>

        <button
          onClick={fetchMetrics}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors disabled:opacity-50 flex items-center space-x-2"
        >
          <span>{loading ? '⏳' : '🔄'}</span>
          <span>Refresh Now</span>
        </button>
      </div>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Detection Card */}
        <div className="bg-gray-800 rounded-lg p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-gray-400 text-sm font-medium">IPO Detection</h3>
            <span className="text-2xl">📡</span>
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {metrics.detection.last24h}
          </div>
          <div className="text-sm text-gray-400">
            detected last 24h
          </div>
          <div className="mt-3 text-sm">
            <span className="text-gray-400">Avg latency:</span>{' '}
            <span className="text-white font-medium">
              {metrics.detection.avgLatencyHours.toFixed(1)}h
            </span>
          </div>
        </div>

        {/* Consolidation Card */}
        <div className="bg-gray-800 rounded-lg p-6 border-l-4 border-green-500">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-gray-400 text-sm font-medium">Consolidation</h3>
            <span className="text-2xl">⚙️</span>
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {metrics.consolidation.processed}
          </div>
          <div className="text-sm text-gray-400">
            IPOs processed
          </div>
          <div className="mt-3 text-sm">
            <span className="text-gray-400">Conflicts:</span>{' '}
            <span className="text-white font-medium">
              {metrics.consolidation.conflicts} ({metrics.consolidation.conflictRate})
            </span>
          </div>
        </div>

        {/* DRHP Card */}
        <div className="bg-gray-800 rounded-lg p-6 border-l-4 border-purple-500">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-gray-400 text-sm font-medium">DRHP Extraction</h3>
            <span className="text-2xl">📄</span>
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {metrics.drhp.extracted}
          </div>
          <div className="text-sm text-gray-400">
            successfully extracted
          </div>
          <div className="mt-3 text-sm">
            <span className="text-gray-400">Avg confidence:</span>{' '}
            <span className={`font-medium ${getHealthColor(
              metrics.drhp.avgConfidence,
              { good: 90, warning: 75 }
            )}`}>
              {metrics.drhp.avgConfidence.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Data Quality Card */}
        <div className="bg-gray-800 rounded-lg p-6 border-l-4 border-yellow-500">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-gray-400 text-sm font-medium">Data Quality</h3>
            <span className="text-2xl">✓</span>
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {metrics.dataQuality.fieldCompleteness}
          </div>
          <div className="text-sm text-gray-400">
            field completeness
          </div>
          <div className="mt-3 text-sm">
            <span className="text-gray-400">Source tracking:</span>{' '}
            <span className="text-white font-medium">
              {metrics.dataQuality.sourceTrackingCoverage}
            </span>
          </div>
        </div>
      </div>

      {/* Detection Sources Breakdown */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-bold text-white mb-4">Detection Sources (Last 24h)</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center p-4 bg-gray-700 rounded">
            <div className="text-3xl font-bold text-indigo-400">
              {metrics.detection.sources.SEBI}
            </div>
            <div className="text-sm text-gray-400 mt-1">SEBI</div>
          </div>
          <div className="text-center p-4 bg-gray-700 rounded">
            <div className="text-3xl font-bold text-blue-400">
              {metrics.detection.sources.NSE}
            </div>
            <div className="text-sm text-gray-400 mt-1">NSE</div>
          </div>
          <div className="text-center p-4 bg-gray-700 rounded">
            <div className="text-3xl font-bold text-green-400">
              {metrics.detection.sources.BSE}
            </div>
            <div className="text-sm text-gray-400 mt-1">BSE</div>
          </div>
          <div className="text-center p-4 bg-gray-700 rounded">
            <div className="text-3xl font-bold text-yellow-400">
              {metrics.detection.sources.MONEYCONTROL}
            </div>
            <div className="text-sm text-gray-400 mt-1">Moneycontrol</div>
          </div>
          <div className="text-center p-4 bg-gray-700 rounded">
            <div className="text-3xl font-bold text-gray-400">
              {metrics.detection.sources.OTHER}
            </div>
            <div className="text-sm text-gray-400 mt-1">Other</div>
          </div>
        </div>
      </div>

      {/* DRHP Extraction Status */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-bold text-white mb-4">DRHP Extraction Pipeline</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 bg-green-900/30 border border-green-600 rounded">
            <div className="text-3xl font-bold text-green-400">
              {metrics.drhp.extracted}
            </div>
            <div className="text-sm text-gray-300 mt-1">Extracted</div>
            <div className="text-xs text-gray-400 mt-2">
              Avg confidence: {metrics.drhp.avgConfidence.toFixed(1)}%
            </div>
          </div>

          <div className="p-4 bg-yellow-900/30 border border-yellow-600 rounded">
            <div className="text-3xl font-bold text-yellow-400">
              {metrics.drhp.pendingExtraction}
            </div>
            <div className="text-sm text-gray-300 mt-1">Pending</div>
            <div className="text-xs text-gray-400 mt-2">
              Awaiting extraction
            </div>
          </div>

          <div className="p-4 bg-orange-900/30 border border-orange-600 rounded">
            <div className="text-3xl font-bold text-orange-400">
              {metrics.drhp.queuedForReview}
            </div>
            <div className="text-sm text-gray-300 mt-1">Review Queue</div>
            <div className="text-xs text-gray-400 mt-2">
              Low confidence (&lt;75%)
            </div>
          </div>

          <div className="p-4 bg-red-900/30 border border-red-600 rounded">
            <div className="text-3xl font-bold text-red-400">
              {metrics.drhp.failures}
            </div>
            <div className="text-sm text-gray-300 mt-1">Failures</div>
            <div className="text-xs text-gray-400 mt-2">
              Extraction errors
            </div>
          </div>
        </div>
      </div>

      {/* System Health Indicators */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-bold text-white mb-4">System Health Indicators</h2>
        <div className="space-y-4">
          {/* Detection Health */}
          <div className="flex items-center justify-between p-4 bg-gray-700 rounded">
            <div className="flex items-center space-x-3">
              <span className="text-2xl">
                {getHealthIndicator(
                  metrics.detection.last24h,
                  { good: 3, warning: 1 }
                )}
              </span>
              <div>
                <div className="text-white font-medium">IPO Detection Rate</div>
                <div className="text-sm text-gray-400">
                  {metrics.detection.last24h} IPOs detected in last 24h
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className={`text-lg font-bold ${getHealthColor(
                metrics.detection.last24h,
                { good: 3, warning: 1 }
              )}`}>
                {metrics.detection.last24h >= 3 ? 'Healthy' : metrics.detection.last24h >= 1 ? 'Low Activity' : 'No Activity'}
              </div>
            </div>
          </div>

          {/* Conflict Rate Health */}
          <div className="flex items-center justify-between p-4 bg-gray-700 rounded">
            <div className="flex items-center space-x-3">
              <span className="text-2xl">
                {getHealthIndicator(
                  100 - parseFloat(metrics.consolidation.conflictRate),
                  { good: 95, warning: 90 }
                )}
              </span>
              <div>
                <div className="text-white font-medium">Data Conflict Rate</div>
                <div className="text-sm text-gray-400">
                  {metrics.consolidation.conflicts} unresolved ({metrics.consolidation.conflictRate})
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className={`text-lg font-bold ${getHealthColor(
                100 - parseFloat(metrics.consolidation.conflictRate),
                { good: 95, warning: 90 }
              )}`}>
                {parseFloat(metrics.consolidation.conflictRate) < 5 ? 'Healthy' : parseFloat(metrics.consolidation.conflictRate) < 10 ? 'Moderate' : 'High'}
              </div>
            </div>
          </div>

          {/* DRHP Success Rate */}
          <div className="flex items-center justify-between p-4 bg-gray-700 rounded">
            <div className="flex items-center space-x-3">
              <span className="text-2xl">
                {getHealthIndicator(
                  metrics.drhp.avgConfidence,
                  { good: 90, warning: 75 }
                )}
              </span>
              <div>
                <div className="text-white font-medium">DRHP Extraction Quality</div>
                <div className="text-sm text-gray-400">
                  Average confidence: {metrics.drhp.avgConfidence.toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className={`text-lg font-bold ${getHealthColor(
                metrics.drhp.avgConfidence,
                { good: 90, warning: 75 }
              )}`}>
                {metrics.drhp.avgConfidence >= 90 ? 'Excellent' : metrics.drhp.avgConfidence >= 75 ? 'Good' : 'Needs Review'}
              </div>
            </div>
          </div>

          {/* Data Completeness */}
          <div className="flex items-center justify-between p-4 bg-gray-700 rounded">
            <div className="flex items-center space-x-3">
              <span className="text-2xl">
                {getHealthIndicator(
                  parseFloat(metrics.dataQuality.fieldCompleteness),
                  { good: 80, warning: 60 }
                )}
              </span>
              <div>
                <div className="text-white font-medium">Field Completeness</div>
                <div className="text-sm text-gray-400">
                  {metrics.dataQuality.withFinancials} / {metrics.dataQuality.totalIPOs} IPOs have financial data
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className={`text-lg font-bold ${getHealthColor(
                parseFloat(metrics.dataQuality.fieldCompleteness),
                { good: 80, warning: 60 }
              )}`}>
                {metrics.dataQuality.fieldCompleteness}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-bold text-white mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/admin/conflicts"
            className="p-4 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center justify-between group"
          >
            <div>
              <div className="text-white font-medium">Resolve Conflicts</div>
              <div className="text-blue-200 text-sm mt-1">
                {metrics.consolidation.conflicts} unresolved
              </div>
            </div>
            <span className="text-2xl group-hover:scale-110 transition-transform">→</span>
          </Link>

          <Link
            href="/admin/audit"
            className="p-4 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors flex items-center justify-between group"
          >
            <div>
              <div className="text-white font-medium">Audit Log</div>
              <div className="text-gray-300 text-sm mt-1">
                View recent changes
              </div>
            </div>
            <span className="text-2xl group-hover:scale-110 transition-transform">→</span>
          </Link>
        </div>
      </div>

      {/* Footer Info */}
      <div className="text-center text-sm text-gray-400">
        Data refreshes automatically every 5 minutes. Last refresh: {new Date(metrics.timestamp).toLocaleString('en-IN')}
      </div>
    </div>
  );
}
