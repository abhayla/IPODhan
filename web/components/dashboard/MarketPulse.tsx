'use client';

import React from 'react';
import {
  TrendingUp,
  Calendar,
  CheckCircle,
  BarChart3,
  Activity,
  Zap,
} from 'lucide-react';
import { useMarketPulse } from '@/hooks/use-live-updates';
import { AnimatedScore } from '@/components/ipo/AnimatedScore';

/**
 * MarketPulse - Phase 3: Real-Time Experience
 *
 * Live dashboard showing overall IPO market metrics.
 * Displays 6 key indicators updated in real-time via SSE.
 *
 * Features:
 * - Real-time market metrics (Open, Coming Soon, Listed, Success Rate, Avg Subscription, Hot Sector)
 * - Grid layout with animated stat cards
 * - Connection status indicator
 * - Smooth number animations
 * - Color-coded metrics
 */

export interface MarketPulseProps {
  variant?: 'default' | 'compact';
  className?: string;
}

export function MarketPulse({ variant = 'default', className = '' }: MarketPulseProps) {
  const { data, isConnected, lastUpdate } = useMarketPulse();

  // Format last update time
  const getLastUpdateText = (): string => {
    if (!lastUpdate) return '';

    const seconds = Math.floor((Date.now() - lastUpdate) / 1000);
    if (seconds < 10) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    return 'Over 1h ago';
  };

  // Compact variant for sidebar
  if (variant === 'compact') {
    return (
      <div className={`market-pulse-compact ${className}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Market Pulse</span>
          </div>

          {isConnected && (
            <div className="flex items-center gap-1.5 text-xs text-success">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              LIVE
            </div>
          )}
        </div>

        {/* Compact stats */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Open</span>
            <span className="font-semibold text-foreground">
              {data ? <AnimatedScore value={data.openIPOs} decimals={0} /> : '--'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Coming</span>
            <span className="font-semibold text-foreground">
              {data ? <AnimatedScore value={data.comingSoon} decimals={0} /> : '--'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Listed</span>
            <span className="font-semibold text-foreground">
              {data ? <AnimatedScore value={data.listed} decimals={0} /> : '--'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Success</span>
            <span className="font-semibold text-success">
              {data ? <AnimatedScore value={data.successRate} decimals={1} suffix="%" /> : '--%'}
            </span>
          </div>
        </div>

        {/* Last update */}
        {isConnected && lastUpdate && (
          <div className="text-[10px] text-muted-foreground mt-2">
            {getLastUpdateText()}
          </div>
        )}
      </div>
    );
  }

  // Default variant (full dashboard)
  return (
    <div className={`market-pulse-dashboard ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Market Pulse</h2>
            <p className="text-sm text-muted-foreground">Live IPO market overview</p>
          </div>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-2">
          {isConnected ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/30">
              <Zap className="w-3.5 h-3.5 text-success" />
              <span className="text-xs font-semibold text-success">LIVE</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border border-border">
              <div className="w-2 h-2 rounded-full bg-muted-foreground" />
              <span className="text-xs text-muted-foreground">Connecting...</span>
            </div>
          )}
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Open IPOs */}
        <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/50 transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-md bg-success/10">
              <TrendingUp className="w-4 h-4 text-success" />
            </div>
            <div className="text-sm text-muted-foreground">Open IPOs</div>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {data ? <AnimatedScore value={data.openIPOs} decimals={0} /> : '--'}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Currently accepting applications</div>
        </div>

        {/* Coming Soon */}
        <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/50 transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-md bg-accent/10">
              <Calendar className="w-4 h-4 text-accent" />
            </div>
            <div className="text-sm text-muted-foreground">Coming Soon</div>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {data ? <AnimatedScore value={data.comingSoon} decimals={0} /> : '--'}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Upcoming in next 30 days</div>
        </div>

        {/* Recently Listed */}
        <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/50 transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-md bg-primary/10">
              <CheckCircle className="w-4 h-4 text-primary" />
            </div>
            <div className="text-sm text-muted-foreground">Recently Listed</div>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {data ? <AnimatedScore value={data.listed} decimals={0} /> : '--'}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Listed in last 90 days</div>
        </div>

        {/* Success Rate */}
        <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/50 transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-md bg-success/10">
              <BarChart3 className="w-4 h-4 text-success" />
            </div>
            <div className="text-sm text-muted-foreground">Success Rate</div>
          </div>
          <div className="text-2xl font-bold text-success">
            {data ? <AnimatedScore value={data.successRate} decimals={1} suffix="%" /> : '--%'}
          </div>
          <div className="text-xs text-muted-foreground mt-1">IPOs with positive listing</div>
        </div>

        {/* Average Subscription */}
        <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/50 transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-md bg-primary/10">
              <TrendingUp className="w-4 h-4 text-primary" />
            </div>
            <div className="text-sm text-muted-foreground">Avg Subscription</div>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {data ? (
              <AnimatedScore value={data.avgSubscription} decimals={1} suffix="x" />
            ) : (
              '--x'
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Average across all categories</div>
        </div>

        {/* Hot Sector */}
        <div className="rounded-lg border border-border bg-card p-4 hover:border-primary/50 transition-colors">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-md bg-danger/10">
              <Zap className="w-4 h-4 text-danger" />
            </div>
            <div className="text-sm text-muted-foreground">Hot Sector</div>
          </div>
          <div className="text-2xl font-bold text-foreground truncate">
            {data ? data.hotSector : '--'}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Most active this month</div>
        </div>
      </div>

      {/* Last update footer */}
      {isConnected && lastUpdate && (
        <div className="flex items-center justify-center gap-2 mt-6 text-xs text-muted-foreground">
          <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          <span>Updated {getLastUpdateText()}</span>
        </div>
      )}
    </div>
  );
}

export default MarketPulse;
