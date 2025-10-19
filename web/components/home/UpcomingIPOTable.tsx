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
 * Get status text based on segment
 *
 * Logic:
 * - MAINBOARD → "Filed with SEBI"
 * - SME → "Filed with Exchange"
 *
 * AC#1: Components render correctly with proper data
 */
function getStatusText(segment: string): string {
  return segment === 'MAINBOARD' ? 'Filed with SEBI' : 'Filed with Exchange';
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
 *   moreLinkText="More Upcoming Mainline IPO..."
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
        <h2 className="text-xl md:text-2xl font-bold">{title}</h2>
        <IPOTableSkeleton />
      </div>
    );
  }

  // AC#8: Empty states handled gracefully
  if (ipos.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl md:text-2xl font-bold">{title}</h2>
        <div className="rounded-md border bg-card">
          <div className="text-center py-12 text-muted-foreground">
            No IPOs available
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table Title - AC#1: Components render correctly */}
      <h2 className="text-xl md:text-2xl font-bold">{title}</h2>

      {/* AC#3: Tables are responsive and match reference design */}
      <div className="rounded-md border bg-card">
        <Table aria-label={title}>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-[40%]">
                Company Name
              </TableHead>
              <TableHead scope="col" className="w-[35%]">
                Status
              </TableHead>
              <TableHead scope="col" className="w-[25%]">
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
                    className="font-medium hover:underline text-primary text-sm md:text-base"
                  >
                    {ipo.companyName}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm md:text-base">
                  {getStatusText(ipo.segment)}
                </TableCell>
                <TableCell className="text-sm md:text-base">
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
