/**
 * Upcoming IPO Table Component
 *
 * Displays upcoming IPOs with filing status
 * Features:
 * - Columns: Company Name | Status | Date
 * - Status: "Filed with SEBI" (MAINBOARD) or "Filed with Exchange" (SME)
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
import { IPOTableSkeleton } from './IPOTableSkeleton';

// ==================== TYPES ====================

export interface UpcomingIPOTableProps {
  /** Table title (e.g., "Upcoming Mainboard IPOs (Filed with SEBI)") */
  title: string;
  /** Array of upcoming IPO data to display */
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
 * Format date as "dd MMM" (e.g., "27 Oct")
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
 * Get status text from the IPO's actual approval state, not just its segment.
 *
 * Logic:
 * - segment === null → "N/A" (RIGHTS/InvITs/REITs offerings)
 * - a firm price band is set (priceMin AND issuePrice both present) → the IPO has
 *   cleared SEBI/exchange review and is approved to open, so it is NOT still at
 *   "filed" (DRHP) stage — e.g. an IPO opening tomorrow with an approved band
 *   (P2-6: this table previously mislabeled such rows as "Filed with SEBI/Exchange")
 * - otherwise → "Filed with SEBI" (MAINBOARD) or "Filed with Exchange" (SME),
 *   the genuine DRHP-filed stage
 *
 * AC#1: Components render correctly with proper data
 */
function getStatusText(ipo: Pick<HomeIPOTableData, 'segment' | 'priceMin' | 'issuePrice'>): string {
  if (!ipo.segment) return 'N/A';
  const hasPriceBand =
    ipo.priceMin != null && ipo.priceMin > 0 && ipo.issuePrice != null && ipo.issuePrice > 0;
  if (hasPriceBand) return 'Price Band Announced';
  return ipo.segment === 'MAINBOARD' ? 'Filed with SEBI' : 'Filed with Exchange';
}

// ==================== COMPONENT ====================

/**
 * Upcoming IPO Table Component
 *
 * Displays upcoming IPOs with filing status and expected dates
 *
 * @example
 * ```tsx
 * <UpcomingIPOTable
 *   title="Upcoming Mainboard IPOs (Filed with SEBI)"
 *   ipos={upcomingMainboardIPOs}
 *   moreLink="/dashboard?category=mainboard&status=upcoming"
 *   moreLinkText="More Upcoming Mainboard IPOs..."
 *   isLoading={false}
 * />
 * ```
 */
export function UpcomingIPOTable({
  title,
  ipos,
  moreLink,
  moreLinkText,
  isLoading = false,
}: UpcomingIPOTableProps) {
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
            <p className="font-medium text-foreground mb-1">Nothing filed yet</p>
            <p>
              Companies appear here as soon as they file with the exchanges.{' '}
              <Link href={moreLink} className="text-primary hover:underline">
                See all upcoming IPOs
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table Title - AC#1: Components render correctly */}
      <h2 className="text-base font-semibold text-foreground">{title}</h2>

      {/* AC#3: Tables are responsive and match reference design */}
      <div className="rounded-md border bg-card overflow-x-auto">
        <Table aria-label={title} className="min-w-full [&_td]:px-1.5 [&_th]:px-1.5 sm:[&_td]:px-2 sm:[&_th]:px-2">
          <TableHeader>
            {/* Quiet Screener/Levels header — unified light surface (R16 #1) */}
            <TableRow className="border-0 border-b border-border bg-gray-50 hover:bg-gray-50 [&>th]:text-[11px] [&>th]:font-medium [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-gray-500">
              <TableHead scope="col">
                Company Name
              </TableHead>
              <TableHead scope="col" className="whitespace-nowrap">
                Status
              </TableHead>
              <TableHead scope="col" className="whitespace-nowrap">
                Date
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ipos.map((ipo) => (
              <TableRow key={ipo.id} className="hover:bg-muted/50 transition-colors">
                <TableCell>
                  <Link
                    href={`/ipos/${ipo.slug}`}
                    className="font-medium hover:underline text-primary text-sm md:text-base block max-w-[100px] sm:max-w-none truncate"
                  >
                    {ipo.companyName}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm md:text-base">
                  {getStatusText(ipo)}
                </TableCell>
                <TableCell className="text-sm md:text-base whitespace-nowrap">
                  {formatDate(ipo.openDate)}
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
