/**
 * IPO Details Table
 * Comprehensive table displaying all key IPO information
 *
 * Features:
 * - 12+ rows of IPO details
 * - Two-column responsive layout
 * - Clean card-based design
 * - Handles null/undefined values gracefully
 *
 * @component
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText } from 'lucide-react';
import { formatIssueSizeCrores } from '@/lib/utils';
import { formatPriceBand } from '@/lib/utils/kpi-formatters';

interface IPODetailsTableProps {
  issueSize: number | null;
  issueType: string | null;
  openDate: string | null;
  closeDate: string | null;
  allotmentDate: string | null;
  listingDate: string | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  lotSize: number | null;
  minBidQuantity: number | null;
  faceValue: number | null;
  freshIssueSize: number | null;
  offerForSaleSize: number | null;
}

/**
 * Format number with Indian numbering system
 */
function formatNumber(value: number): string {
  return value.toLocaleString('en-IN');
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

export function IPODetailsTable({
  issueSize,
  issueType,
  openDate,
  closeDate,
  allotmentDate,
  listingDate,
  priceRangeMin,
  priceRangeMax,
  lotSize,
  minBidQuantity,
  faceValue,
  freshIssueSize,
  offerForSaleSize
}: IPODetailsTableProps) {
  // Build details array
  const details = [
    {
      label: 'Issue Size',
      value: issueSize ? formatIssueSizeCrores(issueSize) : '-',
      highlight: true
    },
    {
      label: 'Issue Type',
      value: issueType || '-'
    },
    {
      label: 'Fresh Issue',
      value: freshIssueSize ? formatIssueSizeCrores(freshIssueSize) : '-'
    },
    {
      // Fresh Issue + OFS are stored in RUPEES like issue_size (they sum to it);
      // both render through the same rupees→crore SSOT so the table is unit-consistent (#8 sibling).
      label: 'Offer for Sale (OFS)',
      value: offerForSaleSize ? formatIssueSizeCrores(offerForSaleSize) : '-'
    },
    {
      label: 'Price Band',
      value: priceRangeMin || priceRangeMax
        ? formatPriceBand(priceRangeMin, priceRangeMax)
        : '-',
      highlight: true
    },
    {
      label: 'Face Value',
      value: faceValue ? `₹${formatNumber(faceValue)}` : '-'
    },
    {
      label: 'Lot Size',
      value: lotSize ? `${formatNumber(lotSize)} shares` : '-',
      highlight: true
    },
    {
      label: 'Minimum Bid Quantity',
      value: minBidQuantity ? `${formatNumber(minBidQuantity)} shares` : '-'
    },
    {
      label: 'Open Date',
      value: openDate ? formatDate(openDate) : '-',
      highlight: true
    },
    {
      label: 'Close Date',
      value: closeDate ? formatDate(closeDate) : '-',
      highlight: true
    },
    {
      label: 'Basis of Allotment',
      value: allotmentDate ? formatDate(allotmentDate) : 'TBA'
    },
    {
      label: 'Listing Date',
      value: listingDate ? formatDate(listingDate) : 'TBA',
      highlight: true
    },
  // Rows with no value render nothing — a grid of '-' placeholders reads as a
  // broken page (2026-07-02 reference review). Dates keep an explicit 'TBA'
  // (the persona plans around them); optional facts simply disappear.
  ].filter((d) => d.value !== '-');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          IPO Details
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Complete information about the public offering
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {details.map((detail, index) => (
            <div
              key={index}
              className={`flex justify-between items-center py-3 px-4 rounded-lg border ${
                detail.highlight
                  ? 'bg-primary/5 border-primary/20'
                  : 'bg-muted/30 border-muted'
              }`}
            >
              <span className="text-sm font-medium text-muted-foreground">
                {detail.label}
              </span>
              <span className={`font-semibold text-right ${
                detail.highlight ? 'text-primary' : ''
              }`}>
                {detail.value}
              </span>
            </div>
          ))}
        </div>

        {/* Additional Info */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-blue-900 dark:text-blue-100">
            <strong>Note:</strong> All dates are tentative and subject to market conditions and regulatory approvals.
            The company/merchant bankers reserve the right to revise the IPO timetable. Please refer to the DRHP/RHP
            for detailed terms and conditions.
          </p>
        </div>

        {/* Investment Reminder */}
        {lotSize && priceRangeMax && (
          <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <p className="text-sm text-green-900 dark:text-green-100">
              <strong>Minimum Investment:</strong> ₹{formatNumber(lotSize * priceRangeMax)} per lot
              ({lotSize} shares × ₹{formatNumber(priceRangeMax)})
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
