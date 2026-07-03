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

  // Collapse whole metric GROUPS when NO compared IPO has any value in them, so
  // the table isn't a wall of N/A (R33/R34 #6) — financial ratios are structurally
  // absent for pre-listing IPOs; subscription shows only once populated.
  const anyVal = (vals: (number | null | undefined)[]) =>
    vals.some((v) => v !== null && v !== undefined);
  const hasAnySubscription = comparisonData.some((c) =>
    anyVal([c.subscription.qib, c.subscription.nii, c.subscription.retail, c.subscription.total])
  );
  const hasAnyFinancials = comparisonData.some((c) =>
    anyVal([
      c.financials.peRatio, c.financials.roe, c.financials.eps, c.financials.revenueGrowth,
      c.ipoFinancials?.pbRatio, c.ipoFinancials?.rocePercentage, c.ipoFinancials?.industryPe,
    ])
  );

  // Metric list drives the MOBILE stacked view (one card per IPO) — a side-by-side
  // table cannot fit 2-3 value columns on a 390px phone, so mobile stacks the IPOs
  // and lists each one's metrics (R24 #1). Desktop keeps the comparison table.
  const mobileMetrics: { label: string; value: (c: IPOComparison) => string }[] = [
    { label: 'Price Range', value: (c) => `${formatCurrency(c.priceRange.min)} – ${formatCurrency(c.priceRange.max)}` },
    { label: 'Lot Size', value: (c) => (c.lotSize ? `${c.lotSize} shares` : 'N/A') },
    { label: 'Total Sub.', value: (c) => formatSubscription(c.subscription.total) },
    { label: 'Current GMP', value: (c) => formatCurrency(c.gmp) },
    { label: 'P/E Ratio', value: (c) => (c.financials.peRatio !== null ? c.financials.peRatio.toFixed(2) : 'N/A') },
    { label: 'ROE', value: (c) => formatPercentage(c.financials.roe) },
    { label: 'RoCE', value: (c) => formatPercentage(c.ipoFinancials?.rocePercentage ?? null) },
    { label: 'EPS', value: (c) => formatCurrency(c.financials.eps) },
    { label: 'Rating', value: (c) => (c.rating !== null ? `${c.rating}/5` : 'Not Rated') },
  ];

  return (
    <div className="space-y-4">
      {/* Table Header */}
      <div>
        <h2 className="text-lg font-semibold">IPO Comparison</h2>
        <p className="text-sm text-muted-foreground">
          Side-by-side comparison of key metrics
        </p>
      </div>

      {/* Mobile: one card per IPO (a side-by-side table can't fit on a phone).
          Suppress a metric across ALL cards when NO compared IPO has it (same
          all-N/A rule as desktop) so cards aren't a wall of N/A (R35 #1). */}
      {(() => {
        const visibleMetrics = mobileMetrics.filter((m) =>
          comparisonData.some((c) => {
            const v = m.value(c);
            return v !== 'N/A' && v !== 'Not Rated';
          })
        );
        return (
      <div className="space-y-4 md:hidden">
        {comparisonData.map((ipo) => (
          <div key={ipo.slug} className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="font-semibold leading-tight">{ipo.companyName}</span>
              <Badge variant={getStatusBadgeVariant(ipo.status)}>{ipo.status}</Badge>
            </div>
            {/* Show the FULL metric set for mobile↔desktop parity (R33 #4) — a
                comparison that silently drops metrics on mobile is degraded;
                N/A values are muted so the populated ones still stand out. */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              {visibleMetrics.map((m) => {
                const v = m.value(ipo);
                const muted = v === 'N/A' || v === 'Not Rated';
                return (
                  <div key={m.label} className="flex flex-col">
                    <dt className="text-xs text-muted-foreground">{m.label}</dt>
                    <dd className={cn('font-medium tabular-nums', muted && 'text-gray-400 font-normal')}>{v}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
        );
      })()}

      {/* Desktop: side-by-side comparison table */}
      <div className="relative hidden md:block">
        <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[96px] sticky left-0 bg-background z-10 md:min-w-[180px]">
                Metric
              </TableHead>
              {comparisonData.map((ipo) => (
                <TableHead key={ipo.slug} className="min-w-[128px] text-center md:min-w-[200px]">
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
                  {ipo.lotSize ? `${ipo.lotSize} shares` : <span className="text-gray-400">—</span>}
                </TableCell>
              ))}
            </TableRow>

            {/* Subscription group — hidden entirely when no compared IPO has it */}
            {hasAnySubscription && (<>
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
            </>)}

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

            {/* Financial-ratio group — hidden when no compared IPO has any of
                these (pre-listing IPOs structurally lack them) so the table isn't
                a wall of N/A (R34 #6). */}
            {hasAnyFinancials && (<>
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
            </>)}

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
