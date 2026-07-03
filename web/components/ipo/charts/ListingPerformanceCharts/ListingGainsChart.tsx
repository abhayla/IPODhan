'use client';

/**
 * ListingGainsChart Component
 *
 * Displays listing day performance with gauge visualization and statistics
 */

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

      {/* R21 #5: the speedometer gauge was removed — a dated dataviz idiom none
          of the references would ship, and it triplicated the listing gain that
          the card above already shows. The two performance cards + the statistics
          strip carry the same information, quietly. */}

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
