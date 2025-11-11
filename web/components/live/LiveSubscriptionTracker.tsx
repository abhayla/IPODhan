'use client';

import React from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { useSubscriptionUpdates } from '@/hooks/use-live-updates';
import { AnimatedScore } from '@/components/ipo/AnimatedScore';

/**
 * LiveSubscriptionTracker - Phase 3: Real-Time Experience
 *
 * Displays live subscription data with animated updates.
 * Shows overall subscription and category-wise breakdown (QIB, NII, Retail).
 *
 * Features:
 * - Real-time data via SSE
 * - Animated number transitions
 * - Trend indicators
 * - Connection status indicator
 * - Category-wise progress bars
 */

export interface LiveSubscriptionTrackerProps {
  ipoId?: string;
  variant?: 'default' | 'compact' | 'detailed';
  className?: string;
}

export function LiveSubscriptionTracker({
  ipoId,
  variant = 'default',
  className = '',
}: LiveSubscriptionTrackerProps) {
  const { data, isConnected, lastUpdate } = useSubscriptionUpdates(ipoId);

  // Format last update time
  const getLastUpdateText = (): string => {
    if (!lastUpdate) return 'Not updated';

    const seconds = Math.floor((Date.now() - lastUpdate) / 1000);
    if (seconds < 10) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    return 'Over 1h ago';
  };

  // Get trend icon
  const getTrendIcon = () => {
    if (!data) return null;

    if (data.trend === 'accelerating') {
      return <TrendingUp className="w-4 h-4 text-success" />;
    } else if (data.trend === 'slowing') {
      return <TrendingDown className="w-4 h-4 text-danger" />;
    }

    return null;
  };

  // Compact variant for cards
  if (variant === 'compact') {
    return (
      <div className={`live-subscription-tracker-compact ${className}`}>
        <div className="flex items-center gap-2">
          {/* Connection indicator */}
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-success animate-pulse' : 'bg-muted-foreground'
            }`}
            title={isConnected ? 'Live' : 'Disconnected'}
          />

          {/* Overall subscription */}
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold text-foreground">
              {data ? (
                <>
                  <AnimatedScore value={data.overall} decimals={2} suffix="x" />
                </>
              ) : (
                '-- x'
              )}
            </span>
            {getTrendIcon()}
          </div>

          {/* Live indicator */}
          {isConnected && (
            <span className="text-xs text-muted-foreground">LIVE</span>
          )}
        </div>
      </div>
    );
  }

  // Detailed variant with full breakdown
  if (variant === 'detailed') {
    return (
      <div
        className={`live-subscription-tracker-detailed rounded-lg border border-border bg-card p-4 ${className}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Live Subscription
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {/* Connection status */}
            <div
              className={`flex items-center gap-1.5 text-xs ${
                isConnected ? 'text-success' : 'text-muted-foreground'
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full ${
                  isConnected ? 'bg-success animate-pulse' : 'bg-muted-foreground'
                }`}
              />
              {isConnected ? 'LIVE' : 'Offline'}
            </div>

            {/* Last update */}
            <span className="text-xs text-muted-foreground">
              {getLastUpdateText()}
            </span>
          </div>
        </div>

        {/* Overall subscription */}
        <div className="mb-6">
          <div className="text-xs text-muted-foreground mb-1">
            Overall Subscription
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-foreground">
              {data ? (
                <AnimatedScore value={data.overall} decimals={2} />
              ) : (
                '--'
              )}
            </span>
            <span className="text-lg text-muted-foreground">times</span>
            {getTrendIcon()}
          </div>
          {data && (
            <div className="text-xs text-muted-foreground mt-1">
              {data.trend === 'accelerating' ? 'Accelerating' : 'Slowing down'}
            </div>
          )}
        </div>

        {/* Category breakdown */}
        <div className="space-y-3">
          {/* QIB */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">QIB (Institutions)</span>
              <span className="font-mono font-semibold text-foreground">
                {data ? `${data.qib.toFixed(2)}x` : '--'}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-500"
                style={{
                  width: data ? `${Math.min((data.qib / 15) * 100, 100)}%` : '0%',
                }}
              />
            </div>
          </div>

          {/* NII */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">NII (HNI)</span>
              <span className="font-mono font-semibold text-foreground">
                {data ? `${data.nii.toFixed(2)}x` : '--'}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{
                  width: data ? `${Math.min((data.nii / 10) * 100, 100)}%` : '0%',
                }}
              />
            </div>
          </div>

          {/* Retail */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Retail</span>
              <span className="font-mono font-semibold text-foreground">
                {data ? `${data.retail.toFixed(2)}x` : '--'}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-success transition-all duration-500"
                style={{
                  width: data ? `${Math.min((data.retail / 5) * 100, 100)}%` : '0%',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default variant
  return (
    <div
      className={`live-subscription-tracker rounded-md border border-border bg-card p-3 ${className}`}
    >
      <div className="flex items-center justify-between">
        {/* Overall subscription */}
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-success animate-pulse' : 'bg-muted-foreground'
            }`}
          />
          <div>
            <div className="text-xs text-muted-foreground">Subscription</div>
            <div className="flex items-center gap-1">
              <span className="text-lg font-bold text-foreground">
                {data ? (
                  <AnimatedScore value={data.overall} decimals={2} suffix="x" />
                ) : (
                  '-- x'
                )}
              </span>
              {getTrendIcon()}
            </div>
          </div>
        </div>

        {/* Mini category breakdown */}
        {data && (
          <div className="flex gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">QIB</div>
              <div className="font-mono font-semibold text-accent">
                {data.qib.toFixed(1)}x
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">NII</div>
              <div className="font-mono font-semibold text-primary">
                {data.nii.toFixed(1)}x
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Retail</div>
              <div className="font-mono font-semibold text-success">
                {data.retail.toFixed(1)}x
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Last update */}
      {isConnected && (
        <div className="text-[10px] text-muted-foreground mt-2">
          {getLastUpdateText()}
        </div>
      )}
    </div>
  );
}

export default LiveSubscriptionTracker;
