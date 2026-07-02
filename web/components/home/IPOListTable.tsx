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
import { IpoStatusChip } from '@/components/listing/ipo-status';
import { MobileMetricCard } from '@/components/shared/MobileMetricCard';
import { SubscriptionBar } from '@/components/shared/SubscriptionBar';
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

/** Subscription heat-bar + multiple (x). Null → em dash. */
function subscriptionCell(sub: number | null) {
  return <SubscriptionBar value={sub} />;
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

      {/* Desktop live table (spec H2): Status · Company | Price band | Open |
          Close | Subscription | GMP — the persona's #1 data. No row tints. */}
      <div className="hidden rounded-md border bg-card md:block">
        <Table aria-label={title} className="min-w-full [&_td]:px-2 [&_th]:px-2">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Company</TableHead>
              <TableHead scope="col" className="whitespace-nowrap">Status</TableHead>
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
                  <Link
                    href={`/ipos/${ipo.slug}`}
                    title={ipo.companyName}
                    className="block max-w-[240px] truncate font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {ipo.companyName}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <IpoStatusChip ipo={ipo} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {formatPriceBand(ipo.priceMin, ipo.issuePrice)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(ipo.openDate)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(ipo.closeDate)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {subscriptionCell(ipo.totalSubscription)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {gmpCell(ipo.gmp, ipo.gmpPercent)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile row-cards — keep Subscription + GMP visible (no h-scroll clip) */}
      <div className="space-y-2 md:hidden">
        {ipos.map((ipo) => (
          <MobileMetricCard
            key={ipo.id}
            href={`/ipos/${ipo.slug}`}
            title={ipo.companyName}
            status={<IpoStatusChip ipo={ipo} />}
            fields={[
              { label: 'Price band', value: formatPriceBand(ipo.priceMin, ipo.issuePrice) },
              { label: 'Open – Close', value: `${formatDate(ipo.openDate)} – ${formatDate(ipo.closeDate)}` },
              { label: 'Subscription', value: subscriptionCell(ipo.totalSubscription) },
              { label: 'GMP', value: gmpCell(ipo.gmp, ipo.gmpPercent) },
            ]}
          />
        ))}
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
