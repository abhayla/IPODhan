'use client';

/**
 * IPOListingsTable Component
 *
 * Displays comprehensive IPO listings with performance data in a sortable table.
 */

import React, { useState } from 'react';
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
import { HiArrowsUpDown, HiArrowUp, HiArrowDown } from 'react-icons/hi2';
import type { IPOListingData } from '@/lib/services/ipo-listings-service';

interface IPOListingsTableProps {
  data: IPOListingData[];
  onSort?: (field: string, order: 'asc' | 'desc') => void;
  currentSort?: { field: string; order: 'asc' | 'desc' };
}

export function IPOListingsTable({ data, onSort, currentSort }: IPOListingsTableProps) {
  const [sortField, setSortField] = useState(currentSort?.field || 'listingDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(currentSort?.order || 'desc');

  const handleSort = (field: string) => {
    const newOrder = sortField === field && sortOrder === 'desc' ? 'asc' : 'desc';
    setSortField(field);
    setSortOrder(newOrder);
    onSort?.(field, newOrder);
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <HiArrowsUpDown className="h-4 w-4 opacity-50" />;
    return sortOrder === 'asc' ? (
      <HiArrowUp className="h-4 w-4" />
    ) : (
      <HiArrowDown className="h-4 w-4" />
    );
  };

  const formatDate = (date: string | null) => {
    if (!date) return '-';
    try {
      return format(new Date(date), 'MMM dd, yyyy');
    } catch {
      return '-';
    }
  };

  const formatNumber = (num: number | null) => {
    if (num === null || num === undefined) return '-';
    return new Intl.NumberFormat('en-IN').format(num);
  };

  const formatPercent = (percent: number | null) => {
    if (percent === null || percent === undefined) return '-';
    const isPositive = percent >= 0;
    return (
      <span className={isPositive ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
        {isPositive ? '+' : ''}{percent.toFixed(2)}%
      </span>
    );
  };

  if (data.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-lg">No IPO listings found</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">
                <button
                  onClick={() => handleSort('companyName')}
                  className="flex items-center gap-2 font-semibold hover:text-primary"
                >
                  Company Name <SortIcon field="companyName" />
                </button>
              </TableHead>
              <TableHead className="min-w-[120px]">
                <button
                  onClick={() => handleSort('openDate')}
                  className="flex items-center gap-2 font-semibold hover:text-primary"
                >
                  Issue Open <SortIcon field="openDate" />
                </button>
              </TableHead>
              <TableHead className="min-w-[120px]">
                <button
                  onClick={() => handleSort('closeDate')}
                  className="flex items-center gap-2 font-semibold hover:text-primary"
                >
                  Issue Close <SortIcon field="closeDate" />
                </button>
              </TableHead>
              <TableHead className="min-w-[120px]">
                <button
                  onClick={() => handleSort('listingDate')}
                  className="flex items-center gap-2 font-semibold hover:text-primary"
                >
                  Listing Date <SortIcon field="listingDate" />
                </button>
              </TableHead>
              <TableHead className="text-right min-w-[100px]">
                Issue Price (₹)
              </TableHead>
              <TableHead className="text-right min-w-[120px]">
                <button
                  onClick={() => handleSort('issueSize')}
                  className="flex items-center gap-2 ml-auto font-semibold hover:text-primary"
                >
                  Issue Size (Cr) <SortIcon field="issueSize" />
                </button>
              </TableHead>
              <TableHead className="text-right min-w-[80px]">
                Lot Size
              </TableHead>
              <TableHead className="text-right min-w-[100px]">
                Overall
              </TableHead>
              <TableHead className="text-right min-w-[80px]">
                QIB
              </TableHead>
              <TableHead className="text-right min-w-[80px]">
                NII
              </TableHead>
              <TableHead className="text-right min-w-[80px]">
                Retail
              </TableHead>
              <TableHead className="text-right min-w-[80px]">
                GMP (₹)
              </TableHead>
              <TableHead className="min-w-[120px]">
                Allotment Date
              </TableHead>
              <TableHead className="text-right min-w-[120px]">
                Listing Close (₹)
              </TableHead>
              <TableHead className="text-right min-w-[100px]">
                <button
                  onClick={() => handleSort('listingDayGain')}
                  className="flex items-center gap-2 ml-auto font-semibold hover:text-primary"
                >
                  Listing Gain % <SortIcon field="listingDayGain" />
                </button>
              </TableHead>
              <TableHead className="text-right min-w-[120px]">
                Current Price BSE (₹)
              </TableHead>
              <TableHead className="text-right min-w-[120px]">
                Current Price NSE (₹)
              </TableHead>
              <TableHead className="text-right min-w-[100px]">
                <button
                  onClick={() => handleSort('currentGain')}
                  className="flex items-center gap-2 ml-auto font-semibold hover:text-primary"
                >
                  Current Gain % <SortIcon field="currentGain" />
                </button>
              </TableHead>
              <TableHead className="text-right min-w-[120px]">
                Market Cap (Cr)
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((ipo) => (
              <TableRow key={ipo.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/ipos/${ipo.slug}`}
                    className="text-primary hover:underline"
                  >
                    {ipo.companyName}
                  </Link>
                  <Badge variant="outline" className="ml-2 text-xs">
                    {ipo.category}
                  </Badge>
                </TableCell>
                <TableCell>{formatDate(ipo.openDate)}</TableCell>
                <TableCell>{formatDate(ipo.closeDate)}</TableCell>
                <TableCell>{formatDate(ipo.listingDate)}</TableCell>
                <TableCell className="text-right">{formatNumber(ipo.issuePrice)}</TableCell>
                <TableCell className="text-right">{formatNumber(ipo.issueSize)}</TableCell>
                <TableCell className="text-right">{formatNumber(ipo.lotSize)}</TableCell>
                <TableCell className="text-right">
                  {ipo.subscriptionOverall ? `${ipo.subscriptionOverall.toFixed(2)}x` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {ipo.subscriptionQIB ? `${ipo.subscriptionQIB.toFixed(2)}x` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {ipo.subscriptionNII ? `${ipo.subscriptionNII.toFixed(2)}x` : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {ipo.subscriptionRetail ? `${ipo.subscriptionRetail.toFixed(2)}x` : '-'}
                </TableCell>
                <TableCell className="text-right">{formatNumber(ipo.gmp)}</TableCell>
                <TableCell>{formatDate(ipo.allotmentDate)}</TableCell>
                <TableCell className="text-right">{formatNumber(ipo.listingDayClosePrice)}</TableCell>
                <TableCell className="text-right">{formatPercent(ipo.listingDayGainPercent)}</TableCell>
                <TableCell className="text-right">{formatNumber(ipo.currentPriceBSE)}</TableCell>
                <TableCell className="text-right">{formatNumber(ipo.currentPriceNSE)}</TableCell>
                <TableCell className="text-right">{formatPercent(ipo.currentGainPercent)}</TableCell>
                <TableCell className="text-right">{formatNumber(ipo.marketCap)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
