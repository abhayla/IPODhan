/**
 * AnchorInvestorsSection Component (Story 11.10)
 * Displays anchor investor allocation data with lock-in periods
 * and individual investor details table
 */

'use client';

import { HiExclamationCircle, HiUsers as HiAnchor, HiCalendar, HiLockClosed, HiArrowTrendingUp, HiUsers } from 'react-icons/hi2';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { IndividualInvestor } from '@ipodhan/shared/db/schema';

interface AnchorInvestorsSectionProps {
  bidDate: string | null;
  totalSharesOffered: number | null;
  totalAmountRaised: number | null; // in ₹ Crores
  anchorInvestorsCount: number | null;
  lockIn50PercentDate: string | null;
  lockInRemainingDate: string | null;
  investorList: IndividualInvestor[] | null;
}

/**
 * Format date to DD MMM YYYY
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return 'N/A';

  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return 'N/A';
  }
}

/**
 * Format number with thousand separators
 */
function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-IN').format(num);
}

/**
 * Format amount in crores with 2 decimal places
 */
function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Empty State Component
 */
function AnchorDataEmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-6">
        <div className="flex flex-col items-center justify-center gap-3 text-center py-6">
          <HiAnchor className="h-10 w-10 text-muted-foreground/50" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Anchor Data Not Available Yet
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Anchor investor allocation details will be available after the anchor
              bidding date.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Main Anchor Investors Section Component
 */
export function AnchorInvestorsSection({
  bidDate,
  totalSharesOffered,
  totalAmountRaised,
  anchorInvestorsCount,
  lockIn50PercentDate,
  lockInRemainingDate,
  investorList,
}: AnchorInvestorsSectionProps) {
  // Show empty state if no data
  if (
    !bidDate ||
    totalSharesOffered === null ||
    totalAmountRaised === null ||
    anchorInvestorsCount === null
  ) {
    return <AnchorDataEmptyState />;
  }

  const hasInvestorList = investorList && investorList.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <HiAnchor className="h-5 w-5 text-primary" />
          <CardTitle>Anchor Investors Details</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Aggregate Summary */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Bid Date */}
            <div className="space-y-2 p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <HiCalendar className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">
                  Anchor Bid Date
                </p>
              </div>
              <p className="text-lg font-bold text-foreground">
                {formatDate(bidDate)}
              </p>
            </div>

            {/* Shares Offered */}
            <div className="space-y-2 p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <HiArrowTrendingUp className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">
                  Shares Offered
                </p>
              </div>
              <p className="text-lg font-bold text-foreground">
                {formatNumber(totalSharesOffered)}
              </p>
            </div>

            {/* Anchor Portion Amount */}
            <div className="space-y-2 p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <HiArrowTrendingUp className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">
                  Anchor Portion
                </p>
              </div>
              <p className="text-lg font-bold text-foreground">
                ₹{formatAmount(totalAmountRaised)} Cr
              </p>
            </div>

            {/* Total Investors */}
            <div className="space-y-2 p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <HiUsers className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">
                  Total Investors
                </p>
              </div>
              <p className="text-lg font-bold text-foreground">
                {anchorInvestorsCount}
              </p>
            </div>
          </div>

          {/* Lock-in Period Section */}
          <div className="p-4 rounded-lg border bg-blue-50 dark:bg-blue-950/20">
            <div className="flex items-start gap-3">
              <HiLockClosed className="h-5 w-5 mt-0.5 text-blue-600 dark:text-blue-400" />
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground mb-2">
                    Lock-in Period Details
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        50% Lock-in Expires
                      </p>
                      <p className="text-sm font-medium text-foreground">
                        {formatDate(lockIn50PercentDate)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        (30 days from bid date)
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">
                        Remaining 50% Lock-in Expires
                      </p>
                      <p className="text-sm font-medium text-foreground">
                        {formatDate(lockInRemainingDate)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        (90 days from bid date)
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Anchor investors are subject to a lock-in period where 50% of shares
                  can be sold after 30 days and the remaining 50% after 90 days from
                  the anchor bid date.
                </p>
              </div>
            </div>
          </div>

          {/* Investor List Table */}
          {hasInvestorList && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Individual Investor Allocations
              </h3>
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[200px]">Investor Name</TableHead>
                        <TableHead className="min-w-[120px]">Type</TableHead>
                        <TableHead className="text-right min-w-[120px]">
                          Shares Allocated
                        </TableHead>
                        <TableHead className="text-right min-w-[120px]">
                          Amount (₹ Cr)
                        </TableHead>
                        <TableHead className="text-right min-w-[100px]">
                          % of Issue
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {investorList.map((investor, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">
                            {investor.name}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary">
                              {investor.type}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {formatNumber(investor.shares)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ₹{formatAmount(investor.amount)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {investor.percentOfIssue.toFixed(2)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {/* No Investor List Message */}
          {!hasInvestorList && (
            <div className="p-4 rounded-lg border border-dashed">
              <div className="flex items-start gap-3">
                <HiExclamationCircle className="h-5 w-5 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Individual Investor Details Not Available
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Detailed allocation breakdown for individual anchor investors is not
                    yet available.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Helper Text */}
          <div className="text-xs text-muted-foreground border-t pt-4">
            <p>
              <strong>Note:</strong> Anchor investor data is sourced from the
              company&apos;s anchor allotment details published by stock exchanges.
              Anchor allocation helps assess institutional confidence in the IPO.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
