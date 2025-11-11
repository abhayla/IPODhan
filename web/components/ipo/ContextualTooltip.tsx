'use client';

import React, { useState } from 'react';
import { Info, TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * ContextualTooltip - Phase 2: Data Intelligence Surface
 *
 * Provides contextual intelligence for IPO metrics with hover tooltips.
 * Transforms bare numbers into insights with sector averages, percentiles, and explanations.
 *
 * Features:
 * - Hover-triggered tooltips
 * - Sector average comparisons
 * - Percentile rankings
 * - Trend indicators
 * - Plain language explanations
 */

export interface MetricContext {
  value: number | string;
  label: string;
  unit?: string;
  sectorAverage?: number;
  percentile?: number;  // 0-100
  trend?: 'up' | 'down' | 'stable';
  explanation?: string;
  isGood?: boolean;     // Whether higher/current value is good
}

interface ContextualTooltipProps {
  metric: MetricContext;
  className?: string;
}

export function ContextualTooltip({
  metric,
  className = ''
}: ContextualTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Calculate comparison with sector average
  const getComparison = (): { text: string; color: string; icon: React.ReactNode } | null => {
    if (metric.sectorAverage === undefined || typeof metric.value !== 'number') {
      return null;
    }

    const diff = ((metric.value - metric.sectorAverage) / metric.sectorAverage) * 100;
    const absDiff = Math.abs(diff);

    if (absDiff < 5) {
      return {
        text: 'At sector average',
        color: 'text-muted-foreground',
        icon: <Minus className="w-3 h-3" />
      };
    }

    const isAbove = diff > 0;
    const isPositive = metric.isGood ? isAbove : !isAbove;

    return {
      text: `${absDiff.toFixed(1)}% ${isAbove ? 'above' : 'below'} sector avg`,
      color: isPositive ? 'text-success' : 'text-danger',
      icon: isAbove ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />
    };
  };

  // Get percentile description
  const getPercentileDescription = (): string | null => {
    if (metric.percentile === undefined) return null;

    if (metric.percentile >= 90) return 'Top 10% of IPOs';
    if (metric.percentile >= 75) return 'Top 25% of IPOs';
    if (metric.percentile >= 50) return 'Above median';
    if (metric.percentile >= 25) return 'Below median';
    return 'Bottom 25% of IPOs';
  };

  // Get trend description
  const getTrendDescription = (): { text: string; color: string } | null => {
    if (!metric.trend) return null;

    switch (metric.trend) {
      case 'up':
        return { text: 'Trending upward', color: 'text-success' };
      case 'down':
        return { text: 'Trending downward', color: 'text-danger' };
      case 'stable':
        return { text: 'Stable', color: 'text-muted-foreground' };
      default:
        return null;
    }
  };

  const comparison = getComparison();
  const percentileDesc = getPercentileDescription();
  const trendDesc = getTrendDescription();

  return (
    <div className={`contextual-tooltip inline-flex items-center gap-1.5 ${className}`}>
      {/* Metric Value */}
      <span className="font-semibold text-foreground">
        {typeof metric.value === 'number' ? metric.value.toFixed(2) : metric.value}
        {metric.unit && <span className="ml-0.5">{metric.unit}</span>}
      </span>

      {/* Info Icon with Tooltip */}
      <div className="relative inline-flex">
        <button
          className="text-muted-foreground hover:text-foreground transition-colors cursor-help"
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
          onClick={() => setIsOpen(!isOpen)}
          aria-label={`More info about ${metric.label}`}
        >
          <Info className="w-4 h-4" />
        </button>

        {/* Tooltip Content */}
        {isOpen && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
            <div className="bg-popover text-popover-foreground border border-border rounded-lg shadow-xl p-3 min-w-[200px] max-w-[280px]">
              {/* Arrow */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                <div className="w-3 h-3 bg-popover border-r border-b border-border rotate-45 transform origin-center" />
              </div>

              {/* Title */}
              <div className="font-semibold text-sm mb-2">{metric.label}</div>

              {/* Comparison with sector */}
              {comparison && (
                <div className={`flex items-center gap-1.5 text-xs mb-2 ${comparison.color}`}>
                  {comparison.icon}
                  {comparison.text}
                </div>
              )}

              {/* Percentile */}
              {percentileDesc && (
                <div className="text-xs text-muted-foreground mb-2">
                  📊 {percentileDesc}
                </div>
              )}

              {/* Trend */}
              {trendDesc && (
                <div className={`text-xs mb-2 ${trendDesc.color}`}>
                  {metric.trend === 'up' && '📈 '}
                  {metric.trend === 'down' && '📉 '}
                  {metric.trend === 'stable' && '➡️ '}
                  {trendDesc.text}
                </div>
              )}

              {/* Explanation */}
              {metric.explanation && (
                <div className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-2 mt-2">
                  {metric.explanation}
                </div>
              )}

              {/* Sector Average (if available) */}
              {metric.sectorAverage !== undefined && (
                <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
                  Sector Avg: <span className="font-mono">{metric.sectorAverage.toFixed(2)}{metric.unit}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * MetricWithContext - Quick wrapper for common use cases
 */
export function MetricWithContext({
  label,
  value,
  unit,
  sectorAverage,
  percentile,
  trend,
  explanation,
  isGood = true,
  className = ''
}: MetricContext & { className?: string }) {
  return (
    <div className={`flex flex-col ${className}`}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <ContextualTooltip
        metric={{
          label,
          value,
          unit,
          sectorAverage,
          percentile,
          trend,
          explanation,
          isGood
        }}
      />
    </div>
  );
}

export default ContextualTooltip;
