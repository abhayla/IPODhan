'use client';

import React from 'react';
import { TrendingUp, TrendingDown, DollarSign, Zap } from 'lucide-react';
import { useGMPUpdates } from '@/hooks/use-live-updates';
import { AnimatedScore } from '@/components/ipo/AnimatedScore';

/**
 * LiveGMPTicker - Phase 3: Real-Time Experience
 *
 * Displays live GMP (Grey Market Premium) updates with ticker-style animation.
 * Shows current price, change amount, and premium percentage.
 *
 * Features:
 * - Real-time GMP price updates
 * - Change indicators (up/down)
 * - Premium percentage display
 * - Smooth number animations
 * - Ticker-style visual design
 */

export interface LiveGMPTickerProps {
  ipoId?: string;
  variant?: 'default' | 'compact' | 'ticker';
  showPremium?: boolean;
  className?: string;
}

export function LiveGMPTicker({
  ipoId,
  variant = 'default',
  showPremium = true,
  className = '',
}: LiveGMPTickerProps) {
  const { data, isConnected, lastUpdate } = useGMPUpdates(ipoId);

  // Determine if price is increasing or decreasing
  const isIncreasing = data && data.change > 0;
  const isDecreasing = data && data.change < 0;

  // Get color based on change
  const getChangeColor = (): string => {
    if (isIncreasing) return 'text-success';
    if (isDecreasing) return 'text-danger';
    return 'text-muted-foreground';
  };

  // Get background color for ticker variant
  const getTickerBgColor = (): string => {
    if (isIncreasing) return 'bg-success/10 border-success/30';
    if (isDecreasing) return 'bg-danger/10 border-danger/30';
    return 'bg-muted/50 border-muted-foreground/20';
  };

  // Format last update time
  const getLastUpdateText = (): string => {
    if (!lastUpdate) return '';

    const seconds = Math.floor((Date.now() - lastUpdate) / 1000);
    if (seconds < 10) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  // Compact variant for cards
  if (variant === 'compact') {
    return (
      <div className={`live-gmp-ticker-compact flex items-center gap-2 ${className}`}>
        {/* Connection indicator */}
        <div
          className={`w-2 h-2 rounded-full ${
            isConnected ? 'bg-success animate-pulse' : 'bg-muted-foreground'
          }`}
        />

        {/* GMP price */}
        <div className="flex items-center gap-1">
          <DollarSign className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">
            {data ? (
              <AnimatedScore value={data.current} decimals={0} prefix="₹" />
            ) : (
              '₹--'
            )}
          </span>
        </div>

        {/* Change indicator */}
        {data && data.change !== 0 && (
          <span className={`text-xs font-medium ${getChangeColor()}`}>
            {isIncreasing ? '+' : ''}
            {data.change.toFixed(0)}
          </span>
        )}
      </div>
    );
  }

  // Ticker variant (scrolling/banner style)
  if (variant === 'ticker') {
    return (
      <div
        className={`live-gmp-ticker-banner rounded-full px-4 py-2 border ${getTickerBgColor()} ${className}`}
      >
        <div className="flex items-center gap-3">
          {/* Live indicator */}
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary">LIVE</span>
          </div>

          {/* GMP label */}
          <span className="text-xs font-medium text-muted-foreground">GMP:</span>

          {/* Price */}
          <span className="text-sm font-bold text-foreground">
            {data ? (
              <AnimatedScore value={data.current} decimals={0} prefix="₹" />
            ) : (
              '₹--'
            )}
          </span>

          {/* Change */}
          {data && data.change !== 0 && (
            <>
              {isIncreasing ? (
                <TrendingUp className="w-4 h-4 text-success" />
              ) : (
                <TrendingDown className="w-4 h-4 text-danger" />
              )}
              <span className={`text-sm font-semibold ${getChangeColor()}`}>
                {isIncreasing ? '+' : ''}
                {data.change.toFixed(0)}
              </span>
            </>
          )}

          {/* Premium percentage */}
          {showPremium && data && (
            <>
              <span className="text-xs text-muted-foreground">•</span>
              <span className="text-xs font-medium text-foreground">
                {data.premiumPercent.toFixed(1)}% premium
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  // Default variant
  return (
    <div
      className={`live-gmp-ticker rounded-lg border border-border bg-card p-4 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            Grey Market Premium
          </span>
        </div>

        {/* Connection status */}
        {isConnected && (
          <div className="flex items-center gap-1.5 text-xs text-success">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            LIVE
          </div>
        )}
      </div>

      {/* Current price */}
      <div className="mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-foreground">
            {data ? (
              <AnimatedScore value={data.current} decimals={0} prefix="₹" />
            ) : (
              '₹--'
            )}
          </span>

          {/* Change indicator */}
          {data && data.change !== 0 && (
            <div className="flex items-center gap-1">
              {isIncreasing ? (
                <TrendingUp className="w-4 h-4 text-success" />
              ) : (
                <TrendingDown className="w-4 h-4 text-danger" />
              )}
              <span className={`text-lg font-semibold ${getChangeColor()}`}>
                {isIncreasing ? '+' : ''}
                {data.change.toFixed(0)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Premium percentage */}
      {showPremium && data && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
          <span className="text-xs text-muted-foreground">Premium:</span>
          <span className="text-sm font-semibold text-foreground">
            {data.premiumPercent.toFixed(2)}%
          </span>
        </div>
      )}

      {/* Last update */}
      {isConnected && lastUpdate && (
        <div className="text-[10px] text-muted-foreground mt-2">
          Updated {getLastUpdateText()}
        </div>
      )}

      {/* Disconnected state */}
      {!isConnected && (
        <div className="flex items-center gap-2 mt-3 p-2 rounded-md bg-muted/50 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-muted-foreground" />
          <span>Reconnecting...</span>
        </div>
      )}
    </div>
  );
}

export default LiveGMPTicker;
