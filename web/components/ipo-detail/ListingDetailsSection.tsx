/**
 * Listing Details Section
 * Displays listing information for IPOs that have been listed
 *
 * Features:
 * - Listing date and symbol
 * - Issue price vs listing price comparison
 * - Listing gain/loss percentage and amount
 * - Color-coded gains (green) and losses (red)
 *
 * @component
 * @note Only render for LISTED IPOs with listing performance data
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Calendar, DollarSign } from 'lucide-react';

interface ListingDetailsSectionProps {
  listingDate: string | null;
  symbol: string | null;
  issuePrice: number | null;
  listingPrice: number | null;
  listingGainPercent: number | null;
  listingGainAmount?: number | null;
  // Listing-day OHLC trading information (optional — only present once captured).
  listingOpenPrice?: number | null;
  listingHighPrice?: number | null;
  listingLowPrice?: number | null;
  listingClosePrice?: number | null;
  lastTradedPrice?: number | null;
}

/**
 * Format number with Indian numbering system
 */
function formatNumber(value: number): string {
  return value.toLocaleString('en-IN');
}

/**
 * Format currency with ₹ symbol
 */
function formatCurrency(value: number): string {
  return `₹${formatNumber(value)}`;
}

/**
 * Format date to readable format
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Format percentage
 */
function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function ListingDetailsSection({
  listingDate,
  symbol,
  issuePrice,
  listingPrice,
  listingGainPercent,
  listingGainAmount,
  listingOpenPrice,
  listingHighPrice,
  listingLowPrice,
  listingClosePrice,
  lastTradedPrice
}: ListingDetailsSectionProps) {
  const ohlc = [
    { label: 'Open', value: listingOpenPrice },
    { label: 'High', value: listingHighPrice },
    { label: 'Low', value: listingLowPrice },
    { label: 'Close', value: listingClosePrice },
    { label: 'Last Traded', value: lastTradedPrice },
  ].filter((r) => r.value !== undefined && r.value !== null) as {
    label: string;
    value: number;
  }[];
  // Don't render if no listing data available
  if (!listingDate && !listingPrice) {
    return null;
  }

  const isPositiveGain = listingGainPercent !== null && listingGainPercent > 0;
  const gainColor = isPositiveGain ? 'text-green-600' : 'text-red-600';
  const GainIcon = isPositiveGain ? TrendingUp : TrendingDown;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Listing Details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Listing Date */}
          {listingDate && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Listing Date</p>
              <p className="text-xl font-bold">{formatDate(listingDate)}</p>
            </div>
          )}

          {/* Stock Symbol */}
          {symbol && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Stock Symbol</p>
              <p className="text-xl font-bold font-mono">{symbol}</p>
            </div>
          )}

          {/* Issue Price */}
          {issuePrice && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Issue Price</p>
              <p className="text-xl font-bold">{formatCurrency(issuePrice)}</p>
              <p className="text-xs text-muted-foreground">per share</p>
            </div>
          )}

          {/* Listing Price */}
          {listingPrice && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Listing Price</p>
              <p className="text-xl font-bold">{formatCurrency(listingPrice)}</p>
              <p className="text-xs text-muted-foreground">on listing day</p>
            </div>
          )}

          {/* Listing Gain Percentage */}
          {listingGainPercent !== null && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Listing Gain/Loss</p>
              <div className="flex items-center gap-2">
                <p className={`text-2xl font-bold ${gainColor}`}>
                  {formatPercent(listingGainPercent)}
                </p>
                <GainIcon className={`h-6 w-6 ${gainColor}`} />
              </div>
              <p className="text-xs text-muted-foreground">
                {isPositiveGain ? 'profit' : 'loss'} on listing
              </p>
            </div>
          )}

          {/* Listing Gain Amount */}
          {listingGainAmount !== undefined && listingGainAmount !== null && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Gain/Loss Amount</p>
              <p className={`text-2xl font-bold ${gainColor}`}>
                {listingGainAmount >= 0 ? '+' : ''}{formatCurrency(listingGainAmount)}
              </p>
              <p className="text-xs text-muted-foreground">per share</p>
            </div>
          )}
        </div>

        {/* Listing-Day OHLC Trading Information */}
        {ohlc.length > 0 && (
          <div className="mt-6">
            <p className="text-sm font-semibold text-muted-foreground mb-3">
              Listing-Day Trading (OHLC)
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {ohlc.map((row) => (
                <div
                  key={row.label}
                  className="space-y-1 rounded-lg border bg-muted/30 p-3"
                >
                  <p className="text-xs text-muted-foreground">{row.label}</p>
                  <p className="text-lg font-bold">{formatCurrency(row.value)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Banner — neutral panel, not a colored alert; only the heading
            carries semantic color (R21 #5, quiet callouts) */}
        {listingGainPercent !== null && (
          <div className="mt-6 p-4 rounded-lg bg-muted/50">
            <p className={`font-semibold ${gainColor}`}>
              {isPositiveGain ? 'Positive Listing' : 'Negative Listing'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isPositiveGain
                ? 'Investors who received allotment made profits on listing day — the stock opened above the issue price.'
                : 'The stock listed below the issue price; allottees experienced losses on listing day.'}
            </p>
          </div>
        )}

        {/* Note */}
        <div className="mt-4 p-3 bg-muted/50 rounded-lg">
          <p className="text-xs text-muted-foreground">
            <strong>Note:</strong> Listing gain/loss is calculated based on the opening price on the listing day
            compared to the issue price. Actual gains may vary based on the allotment price and when shares were sold.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
