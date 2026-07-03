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
import { useRouter } from 'next/navigation';
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
import { IpoStatusChip, StatusDot } from '@/components/listing/ipo-status';
import { SubscriptionBar } from '@/components/shared/SubscriptionBar';
import { MonogramChip } from '@/components/shared/MonogramChip';
import { GmpDisplay } from '@/components/shared/GmpDisplay';
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

/** GMP cell: rich display (₹ + %, trend arrow, sparkline, freshness). */
function gmpCell(ipo: HomeIPOTableData) {
  return (
    <GmpDisplay
      gmp={ipo.gmp}
      gmpPercent={ipo.gmpPercent}
      gmpUpdatedAt={ipo.gmpUpdatedAt}
      gmpTrend={ipo.gmpTrend}
      gmpSeries={ipo.gmpSeries}
    />
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
  const router = useRouter();
  // AC#6: Loading states display properly
  if (isLoading) {
    return (
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <IPOTableSkeleton />
      </div>
    );
  }

  // AC#8: Empty states handled gracefully — informative, never a bare dead box
  if (ipos.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
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
      <h2 className="text-base font-semibold text-foreground">{title}</h2>

      {/* Desktop live table (spec H2): Status · Company | Price band | Open |
          Close | Subscription | GMP — the persona's #1 data. No row tints. */}
      <div className="relative">
      {/* Right-edge shadow — dark gradient reads as 'more columns →' (R29 #1) */}
      <div className="pointer-events-none absolute inset-y-0 right-0 z-30 w-8 rounded-r-md bg-gradient-to-l from-black/25 via-black/[0.06] to-transparent md:hidden" />
      <div className="rounded-md border bg-card overflow-x-auto">
        <Table aria-label={title} className="min-w-full [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:h-9">
          <TableHeader>
            {/* Quiet Screener/Levels header — unified light surface (R16 #1) */}
            <TableRow className="border-0 border-b border-border bg-gray-50 hover:bg-gray-50 [&>th]:text-[11px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
              {/* Value-first order (R22 #1): GMP + Sub right after Company/Status
                  so the decision data is visible on mobile, not scrolled off. */}
              <TableHead scope="col" className="sticky left-0 z-20 border-r bg-gray-50 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">Company</TableHead>
              <TableHead scope="col" className="hidden whitespace-nowrap md:table-cell">Status</TableHead>
              <TableHead scope="col" className="whitespace-nowrap text-right">
                GMP
              </TableHead>
              <TableHead scope="col" className="whitespace-nowrap text-right">
                Sub.
              </TableHead>
              <TableHead scope="col" className="whitespace-nowrap text-right">
                Price band
              </TableHead>
              <TableHead scope="col" className="whitespace-nowrap">Open</TableHead>
              <TableHead scope="col" className="whitespace-nowrap">Close</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ipos.map((ipo) => (
              <TableRow
                key={ipo.id}
                onClick={() => router.push(`/ipos/${ipo.slug}`)}
                className="cursor-pointer transition-colors hover:bg-primary/5"
              >
                <TableCell className="sticky left-0 z-10 border-r bg-card shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]">
                  <Link
                    href={`/ipos/${ipo.slug}`}
                    title={ipo.companyName}
                    className="flex items-center gap-2 font-medium text-foreground hover:text-primary"
                  >
                    <StatusDot ipo={ipo} className="md:hidden" />
                    <MonogramChip name={ipo.companyName} />
                    <span className="max-w-[128px] truncate hover:underline sm:max-w-[240px] md:max-w-[340px]">{ipo.companyName}</span>
                  </Link>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap md:table-cell">
                  <IpoStatusChip ipo={ipo} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {gmpCell(ipo)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {subscriptionCell(ipo.totalSubscription)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {formatPriceBand(ipo.priceMin, ipo.issuePrice)}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{formatDate(ipo.openDate)}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{formatDate(ipo.closeDate)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
