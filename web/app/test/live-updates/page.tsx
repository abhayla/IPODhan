'use client';

import React from 'react';
import { useConnectionStatus } from '@/hooks/use-live-updates';
import { LiveSubscriptionTracker } from '@/components/live/LiveSubscriptionTracker';
import { LiveGMPTicker } from '@/components/live/LiveGMPTicker';
import { ViewerCount } from '@/components/live/ViewerCount';
import { MarketPulse } from '@/components/dashboard/MarketPulse';
import { HotRightNow } from '@/components/dashboard/HotRightNow';
import { VisualFilterBuilder, type FilterValue } from '@/components/filters/VisualFilterBuilder';
import { FilterPresets } from '@/components/filters/FilterPresets';
import { notFound } from 'next/navigation';

/**
 * Live Updates Test Page - Phase 3: Real-Time Experience
 *
 * Interactive test page for verifying WebSocket/SSE stability:
 * - Connection status monitoring
 * - Live component updates
 * - Reconnection testing
 * - Filter persistence testing
 *
 * Test Scenarios:
 * 1. Normal operation - all components updating live
 * 2. Connection drop - kill SSE endpoint, verify reconnection
 * 3. Network interruption - disable network, verify graceful handling
 * 4. Long-running connection - leave open for 30+ minutes
 * 5. Multiple concurrent components - verify no conflicts
 */

const DEFAULT_FILTERS: FilterValue = {
  segments: [],
  statuses: [],
  sectors: [],
  scoreRange: [0, 10],
  subscriptionRange: [0, 100],
  priceRange: [0, 10000],
};

export default function LiveUpdatesTestPage() {
  // Internal real-time test harness — never exposed in production (GitHub #11).
  if (process.env.NODE_ENV === 'production') notFound();

  const { status, isConnected, reconnect, disconnect } = useConnectionStatus();
  const [filters, setFilters] = React.useState<FilterValue>(DEFAULT_FILTERS);

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Live Updates Test Page
          </h1>
          <p className="text-muted-foreground">
            Phase 3: Real-Time Experience - Connection Stability Testing
          </p>
        </div>

        {/* Connection Status Card */}
        <div className="mb-8 p-6 rounded-lg border border-border bg-card">
          <h2 className="text-xl font-semibold text-foreground mb-4">
            Connection Status
          </h2>

          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  isConnected ? 'bg-success animate-pulse' : 'bg-danger'
                }`}
              />
              <span className="text-sm font-medium text-foreground">
                Status: {status.toUpperCase()}
              </span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={reconnect}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Reconnect
              </button>
              <button
                onClick={disconnect}
                className="px-4 py-2 rounded-md bg-danger text-danger-foreground text-sm font-medium hover:bg-danger/90 transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>

          <div className="p-3 rounded-md bg-muted/50 text-xs font-mono text-muted-foreground">
            <div>Endpoint: /api/live-updates</div>
            <div>Protocol: Server-Sent Events (SSE)</div>
            <div>Reconnection: Exponential backoff (1s → 30s max)</div>
            <div>Heartbeat: Every 15 seconds</div>
          </div>
        </div>

        {/* Live Components Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* LiveSubscriptionTracker */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">
              LiveSubscriptionTracker
            </h3>
            <LiveSubscriptionTracker variant="detailed" />
          </div>

          {/* LiveGMPTicker */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">
              LiveGMPTicker
            </h3>
            <LiveGMPTicker variant="default" showPremium />
          </div>

          {/* ViewerCount */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">
              ViewerCount
            </h3>
            <ViewerCount variant="default" showChange />
          </div>

          {/* GMP Ticker Banner */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">
              LiveGMPTicker (Ticker)
            </h3>
            <LiveGMPTicker variant="ticker" showPremium />
          </div>
        </div>

        {/* MarketPulse Dashboard */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            MarketPulse Dashboard
          </h3>
          <MarketPulse variant="default" />
        </div>

        {/* HotRightNow Section */}
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            HotRightNow Section
          </h3>
          <HotRightNow maxItems={3} autoRefresh refreshInterval={60000} />
        </div>

        {/* Filter Testing */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* VisualFilterBuilder */}
          <div className="lg:col-span-2">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              VisualFilterBuilder
            </h3>
            <div className="p-6 rounded-lg border border-border bg-card">
              <VisualFilterBuilder
                value={filters}
                onChange={setFilters}
              />
            </div>
          </div>

          {/* FilterPresets */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">
              FilterPresets
            </h3>
            <div className="p-4 rounded-lg border border-border bg-card">
              <FilterPresets
                currentFilters={filters}
                onLoadPreset={setFilters}
              />
            </div>
          </div>
        </div>

        {/* Testing Instructions */}
        <div className="mt-8 p-6 rounded-lg border border-border bg-muted/50">
          <h3 className="text-lg font-semibold text-foreground mb-3">
            Testing Instructions
          </h3>

          <div className="space-y-4 text-sm text-muted-foreground">
            <div>
              <h4 className="font-semibold text-foreground mb-1">
                1. Normal Operation Test
              </h4>
              <p>
                Verify all components are receiving live updates every 5-60 seconds.
                Check connection indicator shows "LIVE" with pulse animation.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-foreground mb-1">
                2. Reconnection Test
              </h4>
              <p>
                Click "Disconnect" button, wait 3 seconds, observe automatic reconnection.
                Verify exponential backoff (attempts: 1s, 1.5s, 2.25s, etc.)
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-foreground mb-1">
                3. Network Interruption Test
              </h4>
              <p>
                Open DevTools → Network tab → Toggle "Offline" mode.
                Verify connection status changes to "error" and reconnection attempts start.
                Re-enable network and verify recovery.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-foreground mb-1">
                4. Long-Running Connection Test
              </h4>
              <p>
                Leave page open for 30+ minutes. Verify heartbeat keeps connection alive.
                Check no memory leaks in DevTools → Memory profiler.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-foreground mb-1">
                5. Filter Persistence Test
              </h4>
              <p>
                Set filters, save as preset, reload page. Verify preset loads correctly.
                Test rename and delete operations.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
