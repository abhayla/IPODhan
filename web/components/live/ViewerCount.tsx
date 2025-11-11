'use client';

import React from 'react';
import { Users, Eye, TrendingUp, TrendingDown } from 'lucide-react';
import { useViewerCount } from '@/hooks/use-live-updates';
import { AnimatedScore } from '@/components/ipo/AnimatedScore';

/**
 * ViewerCount - Phase 3: Real-Time Experience
 *
 * Displays live count of concurrent viewers/investors on the platform.
 * Creates social proof and sense of activity.
 *
 * Features:
 * - Real-time viewer count
 * - Change indicator (increasing/decreasing)
 * - Smooth number animations
 * - Multiple display variants
 * - Connection status
 */

export interface ViewerCountProps {
  variant?: 'default' | 'compact' | 'badge';
  showChange?: boolean;
  className?: string;
}

export function ViewerCount({
  variant = 'default',
  showChange = true,
  className = '',
}: ViewerCountProps) {
  const { data, isConnected } = useViewerCount();

  // Determine if viewers are increasing or decreasing
  const isIncreasing = data && data.change > 0;
  const isDecreasing = data && data.change < 0;

  // Get change color
  const getChangeColor = (): string => {
    if (isIncreasing) return 'text-success';
    if (isDecreasing) return 'text-danger';
    return 'text-muted-foreground';
  };

  // Badge variant (minimal, inline)
  if (variant === 'badge') {
    return (
      <div
        className={`viewer-count-badge inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-muted/50 border border-border ${className}`}
      >
        <Eye className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-medium text-foreground">
          {data ? (
            <AnimatedScore value={data.total} decimals={0} />
          ) : (
            '--'
          )}
        </span>
        <span className="text-xs text-muted-foreground">viewing</span>

        {/* Live pulse indicator */}
        {isConnected && (
          <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
        )}
      </div>
    );
  }

  // Compact variant for headers/nav
  if (variant === 'compact') {
    return (
      <div className={`viewer-count-compact flex items-center gap-2 ${className}`}>
        {/* Icon */}
        <div className="relative">
          <Users className="w-5 h-5 text-primary" />
          {isConnected && (
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-success animate-pulse" />
          )}
        </div>

        {/* Count */}
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold text-foreground">
            {data ? (
              <AnimatedScore value={data.total} decimals={0} />
            ) : (
              '--'
            )}
          </span>

          {/* Change indicator */}
          {showChange && data && data.change !== 0 && (
            <span className={`text-xs font-medium ${getChangeColor()}`}>
              {isIncreasing ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
            </span>
          )}
        </div>

        {/* Label */}
        <span className="text-xs text-muted-foreground">online</span>
      </div>
    );
  }

  // Default variant (card style)
  return (
    <div
      className={`viewer-count-default rounded-lg border border-border bg-card p-4 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            Active Investors
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

      {/* Viewer count */}
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-3xl font-bold text-foreground">
          {data ? (
            <AnimatedScore value={data.total} decimals={0} />
          ) : (
            '--'
          )}
        </span>

        <span className="text-sm text-muted-foreground">investors online</span>
      </div>

      {/* Change indicator */}
      {showChange && data && data.change !== 0 && (
        <div className="flex items-center gap-1.5 p-2 rounded-md bg-muted/50">
          {isIncreasing ? (
            <TrendingUp className="w-4 h-4 text-success" />
          ) : (
            <TrendingDown className="w-4 h-4 text-danger" />
          )}
          <span className={`text-sm font-medium ${getChangeColor()}`}>
            {isIncreasing ? '+' : ''}
            {data.change} in last 5 minutes
          </span>
        </div>
      )}

      {/* Engagement message */}
      {data && data.total > 500 && (
        <div className="mt-3 text-xs text-muted-foreground">
          🔥 High activity right now
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

/**
 * ViewerCountBadge - Convenience component for badge variant
 */
export function ViewerCountBadge({ className }: { className?: string }) {
  return <ViewerCount variant="badge" className={className} />;
}

/**
 * ViewerCountCompact - Convenience component for compact variant
 */
export function ViewerCountCompact({
  showChange = true,
  className,
}: {
  showChange?: boolean;
  className?: string;
}) {
  return (
    <ViewerCount variant="compact" showChange={showChange} className={className} />
  );
}

export default ViewerCount;
