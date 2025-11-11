'use client';

import React from 'react';
import { Award, Star, TrendingUp } from 'lucide-react';

/**
 * PercentileRankingBadge - Phase 2: Data Intelligence Surface
 *
 * Displays percentile ranking showing "Better than X% of IPOs".
 * Provides social proof and competitive context.
 *
 * Features:
 * - Percentile-based tiers (Top 10%, Top 25%, etc.)
 * - Color-coded by performance tier
 * - Icons for premium tiers
 * - Compact and detailed variants
 */

export interface PercentileRankingProps {
  percentile: number;  // 0-100 (0 = worst, 100 = best)
  metric?: string;     // Optional metric name (e.g., "Score", "Subscription")
  variant?: 'default' | 'compact' | 'detailed';
  className?: string;
}

export function PercentileRankingBadge({
  percentile,
  metric,
  variant = 'default',
  className = ''
}: PercentileRankingProps) {
  // Get tier based on percentile
  const getTier = (): {
    label: string;
    bgColor: string;
    textColor: string;
    borderColor: string;
    icon: React.ReactNode;
  } => {
    if (percentile >= 90) {
      return {
        label: 'Top 10%',
        bgColor: 'bg-gradient-to-r from-yellow-500/20 to-amber-500/20',
        textColor: 'text-yellow-600 dark:text-yellow-500',
        borderColor: 'border-yellow-500/50',
        icon: <Award className="w-4 h-4" />
      };
    }

    if (percentile >= 75) {
      return {
        label: 'Top 25%',
        bgColor: 'bg-success/15',
        textColor: 'text-success',
        borderColor: 'border-success/40',
        icon: <Star className="w-4 h-4" />
      };
    }

    if (percentile >= 50) {
      return {
        label: 'Above Average',
        bgColor: 'bg-accent/15',
        textColor: 'text-accent',
        borderColor: 'border-accent/40',
        icon: <TrendingUp className="w-4 h-4" />
      };
    }

    if (percentile >= 25) {
      return {
        label: 'Below Average',
        bgColor: 'bg-muted/50',
        textColor: 'text-muted-foreground',
        borderColor: 'border-muted-foreground/30',
        icon: null
      };
    }

    return {
      label: 'Bottom 25%',
      bgColor: 'bg-danger/10',
      textColor: 'text-danger',
      borderColor: 'border-danger/30',
      icon: null
    };
  };

  const tier = getTier();

  // Compact variant for cards
  if (variant === 'compact') {
    return (
      <div
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${tier.bgColor} ${tier.textColor} ${tier.borderColor} ${className}`}
        title={`Better than ${percentile.toFixed(0)}% of ${metric || 'IPOs'}`}
      >
        {tier.icon}
        {tier.label}
      </div>
    );
  }

  // Detailed variant with full information
  if (variant === 'detailed') {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        {metric && (
          <div className="text-xs text-muted-foreground">{metric} Ranking</div>
        )}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${tier.bgColor} ${tier.borderColor}`}>
          {tier.icon && (
            <div className={tier.textColor}>
              {tier.icon}
            </div>
          )}
          <div className="flex flex-col">
            <span className={`text-sm font-semibold ${tier.textColor}`}>
              {tier.label}
            </span>
            <span className="text-xs text-muted-foreground">
              Better than {percentile.toFixed(0)}% of IPOs
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Default variant
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border ${tier.bgColor} ${tier.textColor} ${tier.borderColor} ${className}`}
      title={`Better than ${percentile.toFixed(0)}% of ${metric || 'IPOs'}`}
    >
      {tier.icon}
      <div className="flex flex-col">
        <span className="text-xs font-semibold leading-tight">
          {tier.label}
        </span>
        {percentile >= 50 && (
          <span className="text-[10px] opacity-80 leading-tight">
            Top {(100 - percentile).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * PercentileBar - Visual bar representation of percentile
 */
interface PercentileBarProps {
  percentile: number;
  metric?: string;
  className?: string;
}

export function PercentileBar({
  percentile,
  metric,
  className = ''
}: PercentileBarProps) {
  // Get color based on percentile
  const getColor = (): string => {
    if (percentile >= 75) return 'bg-success';
    if (percentile >= 50) return 'bg-accent';
    if (percentile >= 25) return 'bg-warning';
    return 'bg-danger';
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {metric && (
        <div className="text-xs text-muted-foreground">{metric} Percentile</div>
      )}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full ${getColor()} rounded-full transition-all duration-500`}
            style={{ width: `${percentile}%` }}
          />
        </div>
        <span className="text-xs font-mono font-semibold text-foreground min-w-[42px] text-right">
          {percentile.toFixed(0)}%
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground">
        Better than {percentile.toFixed(0)}% of IPOs
      </div>
    </div>
  );
}

/**
 * PercentileGrid - Display multiple percentile rankings
 */
interface PercentileMetric {
  metric: string;
  percentile: number;
}

interface PercentileGridProps {
  metrics: PercentileMetric[];
  className?: string;
}

export function PercentileGrid({
  metrics,
  className = ''
}: PercentileGridProps) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${className}`}>
      {metrics.map((m, index) => (
        <PercentileBar
          key={index}
          percentile={m.percentile}
          metric={m.metric}
        />
      ))}
    </div>
  );
}

export default PercentileRankingBadge;
