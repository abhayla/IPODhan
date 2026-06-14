'use client';

import { IPO, FinancialData, ListingPerformance } from '@/lib/db/types';
import { cn, formatIssueSizeCrores } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface QuickStatsGridProps {
  ipo: IPO & {
    financialData?: FinancialData | null;
    listingPerformance?: ListingPerformance | null;
  };
  className?: string;
}

interface StatItem {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

/**
 * Quick Stats Grid
 * Phase 1: Visual Identity Revolution - Layer 2 (Hover State)
 *
 * Features:
 * - 4 key metrics in compact grid
 * - Trend indicators
 * - Color-coded values
 */
export function QuickStatsGrid({ ipo, className }: QuickStatsGridProps) {
  const formatCurrency = (amount: number | string | null) => {
    if (amount === null || amount === '') return 'N/A';
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return 'N/A';
    if (numAmount >= 1000) {
      return `₹${(numAmount / 1000).toFixed(0)}K Cr`;
    }
    return `₹${numAmount.toFixed(0)} Cr`;
  };

  const formatPercentage = (value: number | null) => {
    if (value === null) return 'N/A';
    return `${value.toFixed(1)}%`;
  };

  // Build stats array
  const stats: StatItem[] = [];

  // Stat 1: Issue Size
  if (ipo.issueSize) {
    stats.push({
      label: 'Issue Size',
      value: formatIssueSizeCrores(ipo.issueSize),
    });
  }

  // Stat 2: Lot Size
  if (ipo.lotSize) {
    stats.push({
      label: 'Lot Size',
      value: `${ipo.lotSize} shares`,
    });
  }

  // Stat 3: Listing Gains (if available)
  if (ipo.listingPerformance?.listingGainPercent !== null && ipo.listingPerformance?.listingGainPercent !== undefined) {
    const gain = typeof ipo.listingPerformance.listingGainPercent === 'string'
      ? parseFloat(ipo.listingPerformance.listingGainPercent)
      : ipo.listingPerformance.listingGainPercent;
    stats.push({
      label: 'Listing Gain',
      value: formatPercentage(gain),
      trend: gain > 0 ? 'up' : gain < 0 ? 'down' : 'neutral',
      color: gain > 0 ? 'text-success' : gain < 0 ? 'text-danger' : 'text-muted-foreground',
    });
  }

  // Stat 4: P/E Ratio or Face Value
  if (ipo.financialData?.peRatio) {
    const peRatio = typeof ipo.financialData.peRatio === 'string'
      ? parseFloat(ipo.financialData.peRatio)
      : ipo.financialData.peRatio;
    stats.push({
      label: 'P/E Ratio',
      value: peRatio.toFixed(1),
    });
  } else if (ipo.faceValue) {
    stats.push({
      label: 'Face Value',
      value: `₹${ipo.faceValue}`,
    });
  }

  // If we have less than 4 stats, fill with additional info
  if (stats.length < 4 && ipo.lotSize && ipo.priceRangeMax) {
    const minInvestment = ipo.lotSize * ipo.priceRangeMax;
    stats.push({
      label: 'Min Investment',
      value: `₹${minInvestment.toLocaleString('en-IN')}`,
    });
  }

  // Ensure we have exactly 4 stats (or less if not enough data)
  const displayStats = stats.slice(0, 4);

  const getTrendIcon = (trend?: 'up' | 'down' | 'neutral') => {
    if (trend === 'up') return <TrendingUp className="w-3 h-3" />;
    if (trend === 'down') return <TrendingDown className="w-3 h-3" />;
    if (trend === 'neutral') return <Minus className="w-3 h-3" />;
    return null;
  };

  if (displayStats.length === 0) {
    return (
      <div className={cn('text-xs text-muted-foreground text-center', className)}>
        No quick stats available
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      {displayStats.map((stat, index) => (
        <div key={index} className="space-y-1">
          <p className="text-xs text-muted-foreground">{stat.label}</p>
          <div className="flex items-center gap-1">
            <p className={cn('text-sm font-bold', stat.color || 'text-foreground')}>{stat.value}</p>
            {stat.trend && <span className={stat.color}>{getTrendIcon(stat.trend)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
