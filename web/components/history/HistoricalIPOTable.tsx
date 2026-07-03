'use client';

/**
 * Historical IPO Table Component
 *
 * Desktop table view for displaying historical IPOs with sortable columns
 * Shows listing performance data with color-coded gains/losses
 */

import React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import type { HistoricalIPO } from '@/lib/repositories/types';
import { MonogramChip } from '@/components/shared/MonogramChip';
import { useRouter } from 'next/navigation';
import { useHistoricalFilters } from '@/contexts/HistoricalFiltersContext';

interface HistoricalIPOTableProps {
  ipos: HistoricalIPO[];
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (date: Date | string) => {
  return format(new Date(date), 'dd MMM yyyy');
};

const formatSubscription = (value: number) => {
  return `${value.toFixed(1)}x`;
};

const formatListingGain = (gain: number) => {
  const isPositive = gain >= 0;
  const color = isPositive ? 'text-green-600' : 'text-red-600';
  const icon = isPositive ? (
    <ArrowUp className="h-3 w-3 inline" />
  ) : (
    <ArrowDown className="h-3 w-3 inline" />
  );
  const sign = isPositive ? '+' : '';

  return (
    <span className={`inline-flex items-center justify-end gap-1 font-semibold tabular-nums ${color}`}>
      {icon}
      {sign}
      {gain.toFixed(2)}%
    </span>
  );
};

/** Muted second line under the company name: "Mainboard · Jul 2026". */
const companySubline = (ipo: HistoricalIPO): string => {
  const board = ipo.segment === 'SME' ? 'SME' : 'Mainboard';
  const when = ipo.listingDate ? format(new Date(ipo.listingDate), 'MMM yyyy') : `${ipo.year}`;
  return `${board} · ${when}`;
};

export function HistoricalIPOTable({ ipos }: HistoricalIPOTableProps) {
  const router = useRouter();
  const { filters, setSort } = useHistoricalFilters();

  // Columns that are empty for EVERY visible row are dropped — a column of
  // pure N/A advertises missing data on each record (2026-07-02 blind review)
  const hasSector = ipos.some((ipo) => Boolean(ipo.sector));
  const hasSubscription = ipos.some(
    (ipo) => ipo.subscriptionOverall !== null && ipo.subscriptionOverall !== undefined
  );
  // Current price/gain only when at least one visible row has it (else drop the
  // pair rather than show a column of em dashes — the ledger's own rule).
  const hasCurrent = ipos.some(
    (ipo) => ipo.currentPriceLive !== null && ipo.currentPriceLive !== undefined
  );

  const handleSort = (column: 'listing_date' | 'listing_gain' | 'subscription') => {
    // Toggle sort order if clicking the same column
    const newSortOrder =
      filters.sort === column && filters.sortOrder === 'DESC' ? 'ASC' : 'DESC';
    setSort(column, newSortOrder);
  };

  const getSortIcon = (column: 'listing_date' | 'listing_gain' | 'subscription') => {
    if (filters.sort !== column) {
      return <ArrowUpDown className="ml-1 inline h-3.5 w-3.5 opacity-40" />;
    }
    return filters.sortOrder === 'DESC' ? (
      <ArrowDown className="ml-1 inline h-3 w-3 text-gray-800" />
    ) : (
      <ArrowUp className="ml-1 inline h-3 w-3 text-gray-800" />
    );
  };

  // Screener/Levels-style quiet header cell classes (R16 #1)
  const th = 'whitespace-nowrap border-b border-border text-[11px] font-medium uppercase tracking-wider text-gray-500';
  const thSort = `${th} cursor-pointer transition-colors hover:text-gray-800`;

  // Company column stays pinned while the rest scrolls horizontally on mobile
  // (Levels/Screener pattern, R19 #1) — one table system at every breakpoint.
  const stickyFirst =
    'sticky left-0 z-20 border-r shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]';

  return (
    <div className="relative">
      {/* Right-edge shadow — dark gradient reads as 'more columns →' (R29 #1) */}
      <div className="pointer-events-none absolute inset-y-0 right-0 z-30 w-8 rounded-r-lg bg-gradient-to-l from-black/25 via-black/[0.06] to-transparent md:hidden" />
      <div className="overflow-x-auto rounded-lg border border-border">
      <Table className="[&_td]:py-1.5 [&_th]:h-9">
        <TableHeader>
          <TableRow className="border-0 bg-gray-50 hover:bg-gray-50">
            <TableHead className={`${th} ${stickyFirst} bg-gray-50`}>Company</TableHead>
            {/* Listing gain is the headline — lead with it so it's visible on
                mobile right after the pinned Company column (R22 #1). */}
            <TableHead
              className={`${thSort} text-right`}
              onClick={() => handleSort('listing_gain')}
            >
              Listing gain %{getSortIcon('listing_gain')}
            </TableHead>
            {hasSector && <TableHead className={th}>Sector</TableHead>}
            <TableHead className={thSort} onClick={() => handleSort('listing_date')}>
              Listing date
              {getSortIcon('listing_date')}
            </TableHead>
            <TableHead className={`${th} text-right`}>Issue price</TableHead>
            <TableHead className={`${th} text-right`}>Listing price</TableHead>
            {hasCurrent && (
              <>
                <TableHead className={`${th} border-l text-right`}>
                  Current price
                </TableHead>
                <TableHead className={`${th} text-right`}>Current gain %</TableHead>
              </>
            )}
            {hasSubscription && (
              <TableHead
                className={`${thSort} text-right`}
                onClick={() => handleSort('subscription')}
              >
                Subscription
                {getSortIcon('subscription')}
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ipos.map((ipo, i) => (
            <TableRow
              key={ipo.id}
              onClick={() => router.push(`/ipos/${ipo.slug}`)}
              className={`cursor-pointer border-0 transition-colors hover:bg-primary/5 ${
                i % 2 === 1 ? 'bg-[#FAFBFC]' : 'bg-white'
              }`}
            >
              <TableCell className={`${stickyFirst} max-w-[144px] bg-inherit sm:max-w-[240px] md:max-w-none`}>
                <Link href={`/ipos/${ipo.slug}`} className="group flex items-center gap-2.5">
                  <MonogramChip name={ipo.companyName} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-gray-900 group-hover:text-primary group-hover:underline" title={ipo.companyName}>
                      {ipo.companyName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {companySubline(ipo)}
                    </span>
                  </span>
                </Link>
              </TableCell>
              <TableCell className="text-right">
                {ipo.listingGainPercent !== null && ipo.listingGainPercent !== undefined ? formatListingGain(ipo.listingGainPercent) : <span className="text-gray-400">—</span>}
              </TableCell>
              {hasSector && (
                <TableCell>
                  <span className="text-sm text-muted-foreground">{ipo.sector ?? '—'}</span>
                </TableCell>
              )}
              <TableCell className="tabular-nums">
                {ipo.listingDate ? formatDate(ipo.listingDate) : '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {ipo.issuePrice !== null && ipo.issuePrice !== undefined ? formatCurrency(ipo.issuePrice) : '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {ipo.listingClose !== null && ipo.listingClose !== undefined ? formatCurrency(ipo.listingClose) : '—'}
              </TableCell>
              {hasCurrent && (
                <>
                  <TableCell className="border-l border-border/60 text-right tabular-nums">
                    {ipo.currentPriceLive !== null && ipo.currentPriceLive !== undefined ? formatCurrency(ipo.currentPriceLive) : <span className="text-gray-400">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {ipo.currentGainLive !== null && ipo.currentGainLive !== undefined ? formatListingGain(ipo.currentGainLive) : <span className="text-gray-400">—</span>}
                  </TableCell>
                </>
              )}
              {hasSubscription && (
                <TableCell className="text-right tabular-nums">
                  {ipo.subscriptionOverall !== null && ipo.subscriptionOverall !== undefined ? formatSubscription(ipo.subscriptionOverall) : '—'}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
