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
import { computeBidTiers } from '@/lib/utils/bid-tiers';
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

  // Bid-tier application table (Retail / sNII / bNII), valued at the upper band.
  const tiers = computeBidTiers(lotSize, priceRangeMax);
  const tierRows = tiers
    ? [
        { label: 'Retail (Min)', t: tiers.retail.min },
        { label: 'Retail (Max)', t: tiers.retail.max },
        { label: 'S-HNI (Min)', t: tiers.sNii.min },
        { label: 'S-HNI (Max)', t: tiers.sNii.max },
        { label: 'B-HNI (Min)', t: tiers.bNii.min },
      ]
    : [];

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

        {/* Bid-Tier Application Table (Retail / S-HNI / B-HNI) */}
        {tierRows.length > 0 && (
          <div className="mt-6">
            <p className="text-sm font-semibold text-muted-foreground mb-3">
              Application by Investor Category (at upper band)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Application</th>
                    <th className="py-2 pr-4 font-medium text-right">Lots</th>
                    <th className="py-2 pr-4 font-medium text-right">Shares</th>
                    <th className="py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {tierRows.map((row) => (
                    <tr key={row.label} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{row.label}</td>
                      <td className="py-2 pr-4 text-right">{formatNumber(row.t.lots)}</td>
                      <td className="py-2 pr-4 text-right">{formatNumber(row.t.shares)}</td>
                      <td className="py-2 text-right font-semibold">{formatCurrency(row.t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
