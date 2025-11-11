'use client';

import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * SectorComparisonBadge - Phase 2: Data Intelligence Surface
 *
 * Visual badge showing how an IPO metric compares to sector average.
 * Provides quick visual feedback without requiring hover.
 *
 * Features:
 * - Color-coded badges (green/red/gray)
 * - Trend icons (up/down/stable)
 * - Percentage difference
 * - Compact design for cards
 */

export interface SectorComparisonProps {
  value: number;
  sectorAverage: number;
  higherIsBetter?: boolean;
  label?: string;
  variant?: 'default' | 'compact';
  className?: string;
}

export function SectorComparisonBadge({
  value,
  sectorAverage,
  higherIsBetter = true,
  label,
  variant = 'default',
  className = ''
}: SectorComparisonProps) {
  // Calculate percentage difference
  const diff = ((value - sectorAverage) / sectorAverage) * 100;
  const absDiff = Math.abs(diff);
  const isAbove = diff > 0;

  // Determine if this is good or bad
  const isPositive = higherIsBetter ? isAbove : !isAbove;

  // Get color and icon based on comparison
  const getVariant = (): {
    bgColor: string;
    textColor: string;
    borderColor: string;
    icon: React.ReactNode;
  } => {
    // Within 5% is considered neutral
    if (absDiff < 5) {
      return {
        bgColor: 'bg-muted/50',
        textColor: 'text-muted-foreground',
        borderColor: 'border-muted-foreground/20',
        icon: <Minus className="w-3 h-3" />
      };
    }

    if (isPositive) {
      return {
        bgColor: 'bg-success/10',
        textColor: 'text-success',
        borderColor: 'border-success/30',
        icon: <TrendingUp className="w-3 h-3" />
      };
    }

    return {
      bgColor: 'bg-danger/10',
      textColor: 'text-danger',
      borderColor: 'border-danger/30',
      icon: <TrendingDown className="w-3 h-3" />
    };
  };

  const variantStyles = getVariant();

  // Format difference text
  const getDifferenceText = (): string => {
    if (absDiff < 5) return 'Avg';
    return `${isAbove ? '+' : ''}${diff.toFixed(1)}%`;
  };

  if (variant === 'compact') {
    // Compact version for cards
    return (
      <div
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${variantStyles.bgColor} ${variantStyles.textColor} ${variantStyles.borderColor} ${className}`}
        title={`${absDiff.toFixed(1)}% ${isAbove ? 'above' : 'below'} sector average`}
      >
        {variantStyles.icon}
        {getDifferenceText()}
      </div>
    );
  }

  // Default version with label
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && (
        <div className="text-xs text-muted-foreground">{label}</div>
      )}
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${variantStyles.bgColor} ${variantStyles.textColor} ${variantStyles.borderColor}`}
      >
        {variantStyles.icon}
        <div className="flex flex-col">
          <span className="text-sm font-semibold">
            {getDifferenceText()}
          </span>
          <span className="text-[10px] opacity-80">
            vs sector
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * SectorComparisonGroup - Display multiple sector comparisons
 */
export interface ComparisonMetric {
  label: string;
  value: number;
  sectorAverage: number;
  higherIsBetter?: boolean;
}

interface SectorComparisonGroupProps {
  metrics: ComparisonMetric[];
  className?: string;
}

export function SectorComparisonGroup({
  metrics,
  className = ''
}: SectorComparisonGroupProps) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {metrics.map((metric, index) => (
        <SectorComparisonBadge
          key={index}
          value={metric.value}
          sectorAverage={metric.sectorAverage}
          higherIsBetter={metric.higherIsBetter}
          label={metric.label}
          variant="compact"
        />
      ))}
    </div>
  );
}

export default SectorComparisonBadge;
