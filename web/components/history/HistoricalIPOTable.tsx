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
import { Badge } from '@/components/ui/badge';
import { HiArrowUp, HiArrowDown, HiArrowsUpDown } from 'react-icons/hi2';
import type { HistoricalIPO } from '@/lib/repositories/types';
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
    <HiArrowUp className="h-3 w-3 inline" />
  ) : (
    <HiArrowDown className="h-3 w-3 inline" />
  );
  const sign = isPositive ? '+' : '';

  return (
    <span className={`font-semibold ${color} flex items-center gap-1`}>
      {icon}
      {sign}
      {gain.toFixed(2)}%
    </span>
  );
};

export function HistoricalIPOTable({ ipos }: HistoricalIPOTableProps) {
  const { filters, setSort } = useHistoricalFilters();

  const handleSort = (column: 'listing_date' | 'listing_gain' | 'subscription') => {
    // Toggle sort order if clicking the same column
    const newSortOrder =
      filters.sort === column && filters.sortOrder === 'DESC' ? 'ASC' : 'DESC';
    setSort(column, newSortOrder);
  };

  const getSortIcon = (column: 'listing_date' | 'listing_gain' | 'subscription') => {
    if (filters.sort !== column) {
      return <HiArrowsUpDown className="h-4 w-4 ml-1 inline opacity-40" />;
    }
    return filters.sortOrder === 'DESC' ? (
      <HiArrowDown className="h-4 w-4 ml-1 inline" />
    ) : (
      <HiArrowUp className="h-4 w-4 ml-1 inline" />
    );
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="font-semibold">Company Name</TableHead>
            <TableHead className="font-semibold">Sector</TableHead>
            <TableHead
              className="font-semibold cursor-pointer hover:bg-muted/80 transition-colors"
              onClick={() => handleSort('listing_date')}
            >
              Listing Date
              {getSortIcon('listing_date')}
            </TableHead>
            <TableHead className="font-semibold text-right">Issue Price</TableHead>
            <TableHead className="font-semibold text-right">Listing Price</TableHead>
            <TableHead
              className="font-semibold cursor-pointer hover:bg-muted/80 transition-colors text-right"
              onClick={() => handleSort('listing_gain')}
            >
              Listing Gain %
              {getSortIcon('listing_gain')}
            </TableHead>
            <TableHead
              className="font-semibold cursor-pointer hover:bg-muted/80 transition-colors text-right"
              onClick={() => handleSort('subscription')}
            >
              Subscription
              {getSortIcon('subscription')}
            </TableHead>
            <TableHead className="font-semibold">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ipos.map((ipo) => (
            <TableRow key={ipo.id} className="hover:bg-muted/30 transition-colors">
              <TableCell>
                <Link
                  href={`/ipos/${ipo.slug}`}
                  className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {ipo.companyName}
                </Link>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">{ipo.sector}</span>
              </TableCell>
              <TableCell>{ipo.listingDate ? formatDate(ipo.listingDate) : 'N/A'}</TableCell>
              <TableCell className="text-right">
                {ipo.issuePrice !== null && ipo.issuePrice !== undefined ? formatCurrency(ipo.issuePrice) : 'N/A'}
              </TableCell>
              <TableCell className="text-right">
                {ipo.listingClose !== null && ipo.listingClose !== undefined ? formatCurrency(ipo.listingClose) : 'N/A'}
              </TableCell>
              <TableCell className="text-right">
                {ipo.listingGainPercent !== null && ipo.listingGainPercent !== undefined ? formatListingGain(ipo.listingGainPercent) : 'N/A'}
              </TableCell>
              <TableCell className="text-right">
                {ipo.subscriptionOverall !== null && ipo.subscriptionOverall !== undefined ? formatSubscription(ipo.subscriptionOverall) : 'N/A'}
              </TableCell>
              <TableCell>
                <Badge className="bg-purple-500 text-white">LISTED</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
