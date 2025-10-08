'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import type { HistoricalIPO } from '@/lib/repositories/types';

interface HistoricalIPOTableProps {
  ipos: HistoricalIPO[];
  sortColumn?: 'listing_date' | 'listing_gain' | 'subscription';
  sortOrder?: 'asc' | 'desc';
  onSort: (column: 'listing_date' | 'listing_gain' | 'subscription') => void;
}

const formatCurrency = (amount: number | null) => {
  if (amount === null) return 'N/A';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (date: string | null) => {
  if (!date) return 'N/A';
  return format(new Date(date), 'dd MMM yyyy');
};

const formatGainPercent = (percent: number | null) => {
  if (percent === null) return 'N/A';
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
};

const getGainColor = (percent: number | null) => {
  if (percent === null) return 'text-muted-foreground';
  return percent >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold';
};

export function HistoricalIPOTable({
  ipos,
  sortColumn,
  sortOrder,
  onSort,
}: HistoricalIPOTableProps) {
  const SortIcon = ({ column }: { column: 'listing_date' | 'listing_gain' | 'subscription' }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="ml-2 h-4 w-4" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="ml-2 h-4 w-4" />
    ) : (
      <ArrowDown className="ml-2 h-4 w-4" />
    );
  };

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[250px]">Company</TableHead>
            <TableHead>Sector</TableHead>
            <TableHead className="text-right">Issue Price</TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSort('listing_date')}
                className="h-8 -ml-3 hover:bg-transparent"
              >
                Listing Date
                <SortIcon column="listing_date" />
              </Button>
            </TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSort('listing_gain')}
                className="h-8 -ml-3 hover:bg-transparent"
              >
                Listing Gain
                <SortIcon column="listing_gain" />
              </Button>
            </TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSort('subscription')}
                className="h-8 -ml-3 hover:bg-transparent"
              >
                Subscription
                <SortIcon column="subscription" />
              </Button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ipos.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                No historical IPOs found.
              </TableCell>
            </TableRow>
          ) : (
            ipos.map((ipo) => (
              <TableRow key={ipo.id} className="hover:bg-muted/50">
                <TableCell>
                  <Link
                    href={`/ipos/${ipo.slug}`}
                    className="font-medium hover:underline text-primary"
                  >
                    {ipo.companyName}
                  </Link>
                  <div className="mt-1">
                    <Badge variant="outline" className="text-xs">
                      {ipo.category}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {ipo.sector || 'N/A'}
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(ipo.issuePrice || null)}
                </TableCell>
                <TableCell>
                  {formatDate(ipo.listingDate)}
                </TableCell>
                <TableCell className={getGainColor(ipo.listingGainPercent || null)}>
                  {formatGainPercent(ipo.listingGainPercent || null)}
                </TableCell>
                <TableCell>
                  {ipo.subscription ? (
                    <span className="font-medium">{ipo.subscription.toFixed(2)}x</span>
                  ) : (
                    <span className="text-muted-foreground">N/A</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
