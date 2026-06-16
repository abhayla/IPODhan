/**
 * Lot Details Section
 * Displays IPO lot size, price range, and investment calculations
 *
 * Features:
 * - Lot size and shares per lot
 * - Price band (min-max)
 * - Min/Max investment calculations
 * - Face value
 * - Min bid quantity (if available)
 *
 * @component
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatPriceBand } from '@/lib/utils/kpi-formatters';
import { Calculator } from 'lucide-react';

interface LotDetailsSectionProps {
  lotSize: number | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  faceValue: number | null;
  minBidQuantity?: number | null;
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

export function LotDetailsSection({
  lotSize,
  priceRangeMin,
  priceRangeMax,
  faceValue,
  minBidQuantity
}: LotDetailsSectionProps) {
  // Don't render if essential data is missing
  if (!lotSize || !priceRangeMin || !priceRangeMax) {
    return null;
  }

  // Calculate investment amounts
  const minInvestment = lotSize * priceRangeMin;
  const maxInvestment = lotSize * priceRangeMax;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Lot Details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Lot Size */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Lot Size</p>
            <p className="text-2xl font-bold">{formatNumber(lotSize)}</p>
            <p className="text-xs text-muted-foreground">shares per lot</p>
          </div>

          {/* Price Range */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Price Band</p>
            <p className="text-2xl font-bold">
              {formatPriceBand(priceRangeMin, priceRangeMax)}
            </p>
            <p className="text-xs text-muted-foreground">per share</p>
          </div>

          {/* Min Investment */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Minimum Investment</p>
            <p className="text-2xl font-bold text-green-600">{formatCurrency(minInvestment)}</p>
            <p className="text-xs text-muted-foreground">
              {formatNumber(lotSize)} shares × {formatCurrency(priceRangeMin)}
            </p>
          </div>

          {/* Max Investment */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Maximum Investment</p>
            <p className="text-2xl font-bold text-blue-600">{formatCurrency(maxInvestment)}</p>
            <p className="text-xs text-muted-foreground">
              {formatNumber(lotSize)} shares × {formatCurrency(priceRangeMax)}
            </p>
          </div>

          {/* Face Value */}
          {faceValue && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Face Value</p>
              <p className="text-2xl font-bold">{formatCurrency(faceValue)}</p>
              <p className="text-xs text-muted-foreground">per share</p>
            </div>
          )}

          {/* Min Bid Quantity */}
          {minBidQuantity && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Minimum Bid Quantity</p>
              <p className="text-2xl font-bold">{formatNumber(minBidQuantity)}</p>
              <p className="text-xs text-muted-foreground">shares</p>
            </div>
          )}
        </div>

        {/* Info Banner */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-sm text-blue-900 dark:text-blue-100">
            <strong>Note:</strong> Retail investors can apply for 1 lot (minimum) to a maximum as per their investment capacity.
            The application amount will be blocked in your bank account until allotment.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
