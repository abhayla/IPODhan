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
import { format, isWithinInterval, differenceInDays } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { HomeIPOTableData } from '@/lib/services/home-ipo-service';
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
 * Get row color class based on IPO status and dates
 *
 * Logic:
 * - Yellow: IPO closing within 2 days (has higher priority)
 * - Green: IPO currently open (today is between openDate and closeDate)
 * - White: Default (all other cases)
 *
 * AC#2: Color-coding works based on date logic
 */
function getRowColorClass(ipo: HomeIPOTableData): string {
  const today = new Date();
  const openDate = ipo.openDate ? new Date(ipo.openDate) : null;
  const closeDate = ipo.closeDate ? new Date(ipo.closeDate) : null;

  if (!openDate || !closeDate) {
    return 'hover:bg-muted/50';
  }

  // Yellow: closing today/tomorrow only — at <=2 days most short-window SME
  // issues qualified, highlighting 7 of 9 rows and destroying the signal
  // (2026-07-02 blind review)
  const daysUntilClose = differenceInDays(closeDate, today);
  if (daysUntilClose >= 0 && daysUntilClose <= 1) {
    return 'bg-yellow-50 hover:bg-yellow-100 border-l-4 border-yellow-500';
  }

  // Green: IPO currently open
  const isOpen = isWithinInterval(today, {
    start: openDate,
    end: closeDate,
  });
  if (isOpen) {
    return 'bg-green-50 hover:bg-green-100 border-l-4 border-green-500';
  }

  // White: Default
  return 'hover:bg-muted/50';
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
      {/* Table Title + row-color legend */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl md:text-2xl font-bold">{title}</h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-400" /> Open
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-yellow-400" /> Closing soon
          </span>
        </div>
      </div>

      {/* AC#3: Tables are responsive and match reference design */}
      <div className="rounded-md border bg-card overflow-x-auto">
        <Table aria-label={title} className="min-w-full [&_td]:px-1.5 [&_th]:px-1.5 sm:[&_td]:px-2 sm:[&_th]:px-2">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">
                Issuer Company
              </TableHead>
              <TableHead scope="col" className="whitespace-nowrap text-right">
                Price
              </TableHead>
              <TableHead scope="col" className="whitespace-nowrap">
                Open
              </TableHead>
              <TableHead scope="col" className="whitespace-nowrap">
                Close
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ipos.map((ipo) => (
              <TableRow
                key={ipo.id}
                className={cn('transition-colors', getRowColorClass(ipo))}
              >
                <TableCell>
                  <Link
                    href={`/ipos/${ipo.slug}`}
                    className="font-medium hover:underline text-primary text-sm md:text-base block max-w-[100px] sm:max-w-none truncate"
                  >
                    {ipo.companyName}
                  </Link>
                </TableCell>
                <TableCell className="text-sm md:text-base text-right whitespace-nowrap">
                  {ipo.issuePrice ? `₹${ipo.issuePrice}` : 'TBA'}
                </TableCell>
                <TableCell className="text-sm md:text-base whitespace-nowrap">
                  {formatDate(ipo.openDate)}
                </TableCell>
                <TableCell className="text-sm md:text-base whitespace-nowrap">
                  {formatDate(ipo.closeDate)}
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
