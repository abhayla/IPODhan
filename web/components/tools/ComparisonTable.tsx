/**
 * Comparison Table Component
 *
 * Displays side-by-side comparison of 2-3 IPOs with all key metrics.
 * Features:
 * - Responsive design with horizontal scroll on mobile
 * - Value highlighting (best values in each row)
 * - Loading skeleton during data fetch
 * - Error state handling
 * - Formatted numbers (currency, percentages)
 *
 * @component
 */

'use client';

import * as React from 'react';
import { TrendingUp, TrendingDown, Info } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { IPOComparison } from '@/lib/types/comparison';
import { cn } from '@/lib/utils';

// ==================== PROPS INTERFACE ====================

export interface ComparisonTableProps {
  /** Comparison data for 2-3 IPOs */
  comparisonData: IPOComparison[];
  /** Loading state during data fetching */
  isLoading?: boolean;
  /** Error message if data fetch failed */
  error?: string | null;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Format currency (Indian Rupees)
 */
function formatCurrency(value: number | null): string {
  if (value === null) return 'N/A';
  return `₹${value.toLocaleString('en-IN')}`;
}

/**
 * Format percentage
 */
function formatPercentage(value: number | null, decimals = 2): string {
  if (value === null) return 'N/A';
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format subscription times (e.g., 2.5x)
 */
function formatSubscription(value: number | null): string {
  if (value === null) return 'N/A';
  return `${value.toFixed(2)}x`;
}

/**
 * Get status badge variant
 */
function getStatusBadgeVariant(status: string): 'default' | 'secondary' | 'outline' {
  switch (status) {
    case 'OPEN':
      return 'default';
    case 'UPCOMING':
      return 'secondary';
    case 'CLOSED':
      return 'outline';
    default:
      return 'outline';
  }
}

/**
 * Find best value in a row (for highlighting)
 * Returns index of IPO with best value, or null if not applicable
 */
function findBestValue(
  values: (number | null)[],
  preferHigher: boolean
): number | null {
  const validValues = values
    .map((val, idx) => ({ val, idx }))
    .filter((item) => item.val !== null) as { val: number; idx: number }[];

  if (validValues.length === 0) return null;

  const best = preferHigher
    ? validValues.reduce((max, item) => (item.val > max.val ? item : max))
    : validValues.reduce((min, item) => (item.val < min.val ? item : min));

  return best.idx;
}

// ==================== COMPONENT ====================

export function ComparisonTable({
  comparisonData,
  isLoading = false,
  error = null,
}: ComparisonTableProps) {
  // Loading State
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="border border-destructive/50 rounded-lg p-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  // Empty State
  if (comparisonData.length === 0) {
    return (
      <div className="border border-dashed rounded-lg p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No comparison data available. Please select at least 2 IPOs to compare.
        </p>
      </div>
    );
  }

  // Determine best values for highlighting
  const ratings = comparisonData.map((c) => c.rating);
  const peRatios = comparisonData.map((c) => c.financials.peRatio);
  const roes = comparisonData.map((c) => c.financials.roe);
  const gmps = comparisonData.map((c) => c.gmp);
  const totalSubs = comparisonData.map((c) => c.subscription.total);
  // Story 4.10: Enhanced financial metrics
  const pbRatios = comparisonData.map((c) => c.ipoFinancials?.pbRatio ?? null);
  const roces = comparisonData.map((c) => c.ipoFinancials?.rocePercentage ?? null);
  const industryPEs = comparisonData.map((c) => c.ipoFinancials?.industryPe ?? null);

  const bestRating = findBestValue(ratings, true);
  const bestPE = findBestValue(peRatios, false); // Lower is better
  const bestROE = findBestValue(roes, true);
  const bestGMP = findBestValue(gmps, true);
  const bestSub = findBestValue(totalSubs, true);
  // Story 4.10: Best values for new metrics
  const bestPB = findBestValue(pbRatios, false); // Lower is better
  const bestROCE = findBestValue(roces, true); // Higher is better
  const bestIndustryPE = findBestValue(industryPEs, false); // Lower is better (but informational)

  return (
    <div className="space-y-4">
      {/* Table Header */}
      <div>
        <h2 className="text-lg font-semibold">IPO Comparison</h2>
        <p className="text-sm text-muted-foreground">
          Side-by-side comparison of key metrics
        </p>
      </div>

      {/* Mobile Scroll Indicator */}
      <div className="md:hidden">
        <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertDescription className="text-sm text-blue-900 dark:text-blue-100">
            Scroll horizontally to see all comparison data
          </AlertDescription>
        </Alert>
      </div>

      {/* Responsive Table Container */}
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[180px] sticky left-0 bg-background z-10">
                Metric
              </TableHead>
              {comparisonData.map((ipo) => (
                <TableHead key={ipo.slug} className="min-w-[200px] text-center">
                  <div className="font-semibold">{ipo.companyName}</div>
                  <Badge
                    variant={getStatusBadgeVariant(ipo.status)}
                    className="mt-1"
                  >
                    {ipo.status}
                  </Badge>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {/* Price Range */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                Price Range
              </TableCell>
              {comparisonData.map((ipo) => (
                <TableCell key={ipo.slug} className="text-center">
                  {formatCurrency(ipo.priceRange.min)} -{' '}
                  {formatCurrency(ipo.priceRange.max)}
                </TableCell>
              ))}
            </TableRow>

            {/* Lot Size */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                Lot Size
              </TableCell>
              {comparisonData.map((ipo) => (
                <TableCell key={ipo.slug} className="text-center">
                  {ipo.lotSize} shares
                </TableCell>
              ))}
            </TableRow>

            {/* Subscription - QIB */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                QIB Subscription
              </TableCell>
              {comparisonData.map((ipo) => (
                <TableCell key={ipo.slug} className="text-center">
                  {formatSubscription(ipo.subscription.qib)}
                </TableCell>
              ))}
            </TableRow>

            {/* Subscription - NII */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                NII Subscription
              </TableCell>
              {comparisonData.map((ipo) => (
                <TableCell key={ipo.slug} className="text-center">
                  {formatSubscription(ipo.subscription.nii)}
                </TableCell>
              ))}
            </TableRow>

            {/* Subscription - Retail */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                Retail Subscription
              </TableCell>
              {comparisonData.map((ipo) => (
                <TableCell key={ipo.slug} className="text-center">
                  {formatSubscription(ipo.subscription.retail)}
                </TableCell>
              ))}
            </TableRow>

            {/* Subscription - Total (Highlighted) */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                Total Subscription
              </TableCell>
              {comparisonData.map((ipo, idx) => (
                <TableCell
                  key={ipo.slug}
                  className={cn(
                    'text-center font-medium',
                    idx === bestSub && 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400'
                  )}
                >
                  {formatSubscription(ipo.subscription.total)}
                  {idx === bestSub && ipo.subscription.total !== null && (
                    <TrendingUp className="inline-block ml-1 h-3 w-3" />
                  )}
                </TableCell>
              ))}
            </TableRow>

            {/* GMP (Highlighted) */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                Current GMP
              </TableCell>
              {comparisonData.map((ipo, idx) => (
                <TableCell
                  key={ipo.slug}
                  className={cn(
                    'text-center font-medium',
                    idx === bestGMP && ipo.gmp !== null && 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400'
                  )}
                >
                  {formatCurrency(ipo.gmp)}
                  {idx === bestGMP && ipo.gmp !== null && (
                    <TrendingUp className="inline-block ml-1 h-3 w-3" />
                  )}
                </TableCell>
              ))}
            </TableRow>

            {/* P/E Ratio (Highlighted - lower is better) */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                P/E Ratio
              </TableCell>
              {comparisonData.map((ipo, idx) => (
                <TableCell
                  key={ipo.slug}
                  className={cn(
                    'text-center',
                    idx === bestPE && ipo.financials.peRatio !== null && 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 font-medium'
                  )}
                >
                  {ipo.financials.peRatio !== null
                    ? ipo.financials.peRatio.toFixed(2)
                    : 'N/A'}
                  {idx === bestPE && ipo.financials.peRatio !== null && (
                    <TrendingDown className="inline-block ml-1 h-3 w-3" />
                  )}
                </TableCell>
              ))}
            </TableRow>

            {/* ROE (Highlighted) */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                Return on Equity (ROE)
              </TableCell>
              {comparisonData.map((ipo, idx) => (
                <TableCell
                  key={ipo.slug}
                  className={cn(
                    'text-center',
                    idx === bestROE && ipo.financials.roe !== null && 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 font-medium'
                  )}
                >
                  {formatPercentage(ipo.financials.roe)}
                  {idx === bestROE && ipo.financials.roe !== null && (
                    <TrendingUp className="inline-block ml-1 h-3 w-3" />
                  )}
                </TableCell>
              ))}
            </TableRow>

            {/* Story 4.10: P/B Ratio (Highlighted - lower is better) */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                Price-to-Book (P/B) Ratio
              </TableCell>
              {comparisonData.map((ipo, idx) => {
                const pbRatio = ipo.ipoFinancials?.pbRatio ?? null;
                return (
                  <TableCell
                    key={ipo.slug}
                    className={cn(
                      'text-center',
                      idx === bestPB && pbRatio !== null && 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 font-medium'
                    )}
                  >
                    {pbRatio !== null ? pbRatio.toFixed(2) : 'N/A'}
                    {idx === bestPB && pbRatio !== null && (
                      <TrendingDown className="inline-block ml-1 h-3 w-3" />
                    )}
                  </TableCell>
                );
              })}
            </TableRow>

            {/* Story 4.10: ROCE % (Highlighted - higher is better) */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                Return on Capital Employed (ROCE)
              </TableCell>
              {comparisonData.map((ipo, idx) => {
                const roce = ipo.ipoFinancials?.rocePercentage ?? null;
                return (
                  <TableCell
                    key={ipo.slug}
                    className={cn(
                      'text-center',
                      idx === bestROCE && roce !== null && 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 font-medium'
                    )}
                  >
                    {formatPercentage(roce)}
                    {idx === bestROCE && roce !== null && (
                      <TrendingUp className="inline-block ml-1 h-3 w-3" />
                    )}
                  </TableCell>
                );
              })}
            </TableRow>

            {/* Story 4.10: Industry P/E (Informational) */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                Industry P/E (Avg)
              </TableCell>
              {comparisonData.map((ipo) => {
                const industryPE = ipo.ipoFinancials?.industryPe ?? null;
                return (
                  <TableCell key={ipo.slug} className="text-center">
                    {industryPE !== null ? industryPE.toFixed(2) : 'N/A'}
                  </TableCell>
                );
              })}
            </TableRow>

            {/* Revenue Growth */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                Revenue Growth (CAGR)
              </TableCell>
              {comparisonData.map((ipo) => (
                <TableCell key={ipo.slug} className="text-center">
                  {formatPercentage(ipo.financials.revenueGrowth)}
                </TableCell>
              ))}
            </TableRow>

            {/* EPS */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                Earnings Per Share (EPS)
              </TableCell>
              {comparisonData.map((ipo) => (
                <TableCell key={ipo.slug} className="text-center">
                  {formatCurrency(ipo.financials.eps)}
                </TableCell>
              ))}
            </TableRow>

            {/* Rating (Highlighted) */}
            <TableRow>
              <TableCell className="sticky left-0 bg-background font-medium">
                IPODhan Rating
              </TableCell>
              {comparisonData.map((ipo, idx) => (
                <TableCell
                  key={ipo.slug}
                  className={cn(
                    'text-center',
                    idx === bestRating && ipo.rating !== null && 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 font-medium'
                  )}
                >
                  {ipo.rating !== null ? (
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1">
                        <span className="text-lg">{ipo.rating}/5</span>
                        {idx === bestRating && (
                          <TrendingUp className="h-3 w-3" />
                        )}
                      </div>
                      {ipo.ratingRationale && (
                        <span className="text-xs text-muted-foreground max-w-[180px] line-clamp-2">
                          {ipo.ratingRationale}
                        </span>
                      )}
                    </div>
                  ) : (
                    'Not Rated'
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded" />
          <span>Best value</span>
        </div>
        <span>•</span>
        <span>N/A = Data not available</span>
      </div>
    </div>
  );
}
