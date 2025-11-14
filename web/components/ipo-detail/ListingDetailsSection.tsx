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
  listingGainAmount
}: ListingDetailsSectionProps) {
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

        {/* Info Banner */}
        {listingGainPercent !== null && (
          <div className={`mt-6 p-4 rounded-lg border ${
            isPositiveGain
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          }`}>
            <div className="flex items-start gap-3">
              <DollarSign className={`h-5 w-5 mt-0.5 ${gainColor}`} />
              <div>
                <p className={`font-semibold ${gainColor}`}>
                  {isPositiveGain ? 'Positive Listing' : 'Negative Listing'}
                </p>
                <p className={`text-sm ${isPositiveGain ? 'text-green-900 dark:text-green-100' : 'text-red-900 dark:text-red-100'}`}>
                  {isPositiveGain
                    ? 'Investors who received allotment made profits on listing day. The stock opened above the issue price.'
                    : 'The stock listed below the issue price. Allottees experienced losses on listing day.'}
                </p>
              </div>
            </div>
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
