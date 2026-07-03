'use client';

/**
 * ListingGainsChart Component
 *
 * Displays listing day performance with gauge visualization and statistics
 */

import { GaugeChartBase } from '../base/GaugeChartBase';
import { formatCurrency, formatPercent, getPerformanceRating } from './utils';
import type { ListingGainsChartProps } from './types';
import { TrendingUp, TrendingDown } from 'lucide-react';

export function ListingGainsChart({
  issuePrice,
  listingPrice,
  listingGainPercent,
  currentPrice,
  currentGainPercent,
  listingDayStats,
  className,
}: ListingGainsChartProps) {
  const rating = getPerformanceRating(listingGainPercent);
  const isPositive = listingGainPercent >= 0;

  // Calculate gauge value (normalize to 0-100 scale)
  // Map -50% to 0, 0% to 50, +100% to 100
  const normalizeGain = (gain: number): number => {
    if (gain <= -50) return 0;
    if (gain >= 100) return 100;
    // Linear interpolation: -50% = 0, 0% = 50, 100% = 100
    return ((gain + 50) / 150) * 100;
  };

  const gaugeValue = normalizeGain(listingGainPercent);

  // Color ranges for gauge
  const colorRanges = [
    { min: 0, max: 30, color: '#ef4444' }, // Red (poor)
    { min: 30, max: 45, color: '#f97316' }, // Orange (below avg)
    { min: 45, max: 55, color: '#eab308' }, // Yellow (avg)
    { min: 55, max: 70, color: '#84cc16' }, // Light green (good)
    { min: 70, max: 100, color: '#22c55e' }, // Green (excellent)
  ];

  return (
    <div className={className}>
      {/* Listing Performance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Listing Day Performance */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Listing Day Gain</p>
              <p className="text-3xl font-bold">
                {formatPercent(listingGainPercent)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {formatCurrency(listingPrice - issuePrice)} absolute gain
              </p>
            </div>
            {isPositive ? (
              <TrendingUp className="h-8 w-8 text-green-600" />
            ) : (
              <TrendingDown className="h-8 w-8 text-red-600" />
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Issue Price:</span>
              <span className="font-medium">{formatCurrency(issuePrice)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Listing Price:</span>
              <span className="font-medium">{formatCurrency(listingPrice)}</span>
            </div>
          </div>

          {/* Performance Rating Badge */}
          <div className="mt-4 pt-4 border-t">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm font-medium">
              <span>{rating.icon}</span>
              <span className={rating.color}>{rating.label} Performance</span>
            </div>
          </div>
        </div>

        {/* Current Performance */}
        {currentPrice && currentGainPercent !== null && (
          <div className="rounded-lg border bg-muted/30 p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Current Gain</p>
                <p className="text-3xl font-bold">
                  {formatPercent(currentGainPercent ?? null)}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {formatCurrency(currentPrice - issuePrice)} absolute gain
                </p>
              </div>
              {(currentGainPercent ?? 0) >= 0 ? (
                <TrendingUp className="h-8 w-8 text-green-600" />
              ) : (
                <TrendingDown className="h-8 w-8 text-red-600" />
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Current Price:</span>
                <span className="font-medium">{formatCurrency(currentPrice)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Change from Listing:</span>
                <span className={`font-medium ${currentPrice > listingPrice ? 'text-green-600' : 'text-red-600'}`}>
                  {formatPercent(((currentPrice - listingPrice) / listingPrice) * 100)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Gauge Visualization */}
      <div className="rounded-lg border bg-card p-6">
        <h4 className="text-sm font-medium mb-4">Listing Performance Gauge</h4>
        <GaugeChartBase
          value={gaugeValue}
          min={0}
          max={100}
          label="Listing gain"
          // Center shows the REAL gain, not the 0-100 dial position — a bare
          // "40.9" over "+11.33%" reads as an orphaned number (R18 #2).
          valueFormatter={() => formatPercent(listingGainPercent)}
          colorRanges={colorRanges}
          height={240}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-2 px-4">
          <span>Poor (-50%)</span>
          <span>Average (0%)</span>
          <span>Excellent (+100%)</span>
        </div>
      </div>

      {/* Listing Day Statistics */}
      {listingDayStats && (
        <div className="mt-6 rounded-lg border bg-card p-6">
          <h4 className="text-sm font-medium mb-4">Listing Day Statistics</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Open</p>
              <p className="text-lg font-bold">
                {formatCurrency(listingDayStats.openPrice)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">High</p>
              <p className="text-lg font-bold text-green-600">
                {formatCurrency(listingDayStats.highPrice)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Low</p>
              <p className="text-lg font-bold text-red-600">
                {formatCurrency(listingDayStats.lowPrice)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Close</p>
              <p className="text-lg font-bold">
                {formatCurrency(listingDayStats.closePrice)}
              </p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Intraday Volatility:</span>
              <span className="font-medium">{listingDayStats.volatility.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
