/**
 * IPO List Table Component
 *
 * Displays active IPOs (OPEN or CLOSED within last 30 days)
 * Features:
 * - Color-coding: Green (open), Yellow (closing ≤2 days), White (default)
 * - Columns: Issuer Company | Open | Close
 * - Clickable rows navigate to IPO detail page
 * - "More..." link to dashboard with filters
 *
 * Story 9.2: Home Page IPO Tables - UI Components
 */

'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { HomeIPOTableData } from '@/lib/services/home-ipo-service';
import { formatPriceBand } from '@/lib/utils/kpi-formatters';
import { IpoStatusDot } from '@/components/listing/ipo-status';
import { IPOTableSkeleton } from './IPOTableSkeleton';

// ==================== TYPES ====================

export interface IPOListTableProps {
  /** Table title (e.g., "IPO 2025 List (Mainboard)") */
  title: string;
  /** Array of IPO data to display */
  ipos: HomeIPOTableData[];
  /** Link to dashboard with filters */
  moreLink: string;
  /** Text for "More..." link */
  moreLinkText: string;
  /** Loading state */
  isLoading?: boolean;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Format date as "dd MMM" (e.g., "15 Oct")
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return 'N/A';
  try {
    return format(new Date(dateString), 'dd MMM');
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'N/A';
  }
}

/**
 * GMP cell: real grey-market premium (₹ + %), colored by sign. Null → em dash.
 * A positive premium is the bullish signal the persona scans for first.
 */
function gmpCell(gmp: number | null, gmpPercent: number | null) {
  if (gmp === null || gmp === undefined) return <span className="text-gray-400">—</span>;
  const positive = gmp >= 0;
  return (
    <span className={positive ? 'font-medium text-green-600' : 'font-medium text-red-600'}>
      {positive ? '+' : ''}₹{gmp}
      {gmpPercent !== null && gmpPercent !== undefined && (
        <span className="ml-1 text-xs text-muted-foreground">
          ({positive ? '+' : ''}
          {gmpPercent.toFixed(1)}%)
        </span>
      )}
    </span>
  );
}

/** Subscription multiple (x). Null → em dash. */
function subscriptionCell(sub: number | null) {
  if (sub === null || sub === undefined) return <span className="text-gray-400">—</span>;
  return <span className="font-medium tabular-nums">{sub.toFixed(2)}x</span>;
}

// ==================== COMPONENT ====================

/**
 * IPO List Table Component
 *
 * Displays active IPOs with color-coding based on status
 *
 * @example
 * ```tsx
 * <IPOListTable
 *   title="IPO 2025 List (Mainboard)"
 *   ipos={mainboardIPOs}
 *   moreLink="/dashboard?category=mainboard"
 *   moreLinkText="More Mainboard IPOs..."
 *   isLoading={false}
 * />
 * ```
 */
export function IPOListTable({
  title,
  ipos,
  moreLink,
  moreLinkText,
  isLoading = false,
}: IPOListTableProps) {
  // AC#6: Loading states display properly
  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl md:text-2xl font-bold">{title}</h2>
        <IPOTableSkeleton />
      </div>
    );
  }

  // AC#8: Empty states handled gracefully — informative, never a bare dead box
  if (ipos.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl md:text-2xl font-bold">{title}</h2>
        <div className="rounded-md border border-dashed bg-card">
          <div className="text-center py-10 px-4 text-muted-foreground text-sm">
            <p className="font-medium text-foreground mb-1">No active issues right now</p>
            <p>
              New IPOs appear here the moment they are announced.{' '}
              <Link href={moreLink} className="text-primary hover:underline">
                Browse all listings
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl md:text-2xl font-bold">{title}</h2>

      {/* Live table (spec H2): status dot + Company | Price band | Open | Close |
          Subscription | GMP — the persona's #1 data. No row tints. */}
      <div className="rounded-md border bg-card overflow-x-auto">
        <Table aria-label={title} className="min-w-full [&_td]:px-1.5 [&_th]:px-1.5 sm:[&_td]:px-2 sm:[&_th]:px-2">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Company</TableHead>
              <TableHead scope="col" className="whitespace-nowrap text-right">
                Price band
              </TableHead>
              <TableHead scope="col" className="whitespace-nowrap">Open</TableHead>
              <TableHead scope="col" className="whitespace-nowrap">Close</TableHead>
              <TableHead scope="col" className="whitespace-nowrap text-right">
                Sub.
              </TableHead>
              <TableHead scope="col" className="whitespace-nowrap text-right">
                GMP
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ipos.map((ipo) => (
              <TableRow key={ipo.id} className="transition-colors hover:bg-muted/50">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <IpoStatusDot ipo={ipo} />
                    <Link
                      href={`/ipos/${ipo.slug}`}
                      className="block max-w-[120px] truncate text-sm font-medium text-foreground hover:text-primary hover:underline sm:max-w-none md:text-base"
                    >
                      {ipo.companyName}
                    </Link>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-sm md:text-base">
                  {formatPriceBand(ipo.priceMin, ipo.issuePrice)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm md:text-base">
                  {formatDate(ipo.openDate)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm md:text-base">
                  {formatDate(ipo.closeDate)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-sm md:text-base">
                  {subscriptionCell(ipo.totalSubscription)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-sm md:text-base">
                  {gmpCell(ipo.gmp, ipo.gmpPercent)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* AC#4: "More..." links navigate to dashboard with correct filters */}
      <div className="text-right">
        <Link
          href={moreLink}
          className="text-primary hover:text-primary/80 hover:underline font-medium flex items-center gap-1 justify-end"
        >
          {moreLinkText}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
