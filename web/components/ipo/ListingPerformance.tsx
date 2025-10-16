'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface ListingPerformanceProps {
  issuePrice: number;
  listingOpen: number;
  listingHigh: number;
  listingClose: number;
  listingDate: Date;
  listingGainPercent: number;
}

/**
 * Format currency with INR symbol and comma separators
 */
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

/**
 * Format percentage with + or - sign and color coding
 */
const formatPercentage = (percent: number): { text: string; isPositive: boolean } => {
  const isPositive = percent > 0;
  const sign = isPositive ? '+' : '';
  return {
    text: `${sign}${percent.toFixed(2)}%`,
    isPositive,
  };
};

/**
 * Calculate percentage gain from issue price
 */
const calculateGain = (currentPrice: number, issuePrice: number): number => {
  return ((currentPrice - issuePrice) / issuePrice) * 100;
};

/**
 * ListingPerformance Component
 *
 * Displays comprehensive listing day performance metrics:
 * - Issue Price
 * - Listing Open (with % gain)
 * - Listing High (with % gain)
 * - Listing Close (with % gain)
 * - Day Return (prominently displayed)
 * - Listing Date
 *
 * Features:
 * - Color-coded percentages (green for positive, red for negative)
 * - Responsive design (table on desktop, stacked on mobile)
 * - Only renders if listingDate is not null
 *
 * @param issuePrice - IPO issue price per share
 * @param listingOpen - Opening price on listing day
 * @param listingHigh - Highest price on listing day
 * @param listingClose - Closing price on listing day
 * @param listingDate - Date when IPO was listed
 * @param listingGainPercent - Pre-calculated listing gain percentage
 */
export function ListingPerformance({
  issuePrice,
  listingOpen,
  listingHigh,
  listingClose,
  listingDate,
  listingGainPercent,
}: ListingPerformanceProps) {
  // Don't render if listingDate is null
  if (!listingDate) {
    return null;
  }

  // Calculate percentage gains for each metric
  const openGain = calculateGain(listingOpen, issuePrice);
  const highGain = calculateGain(listingHigh, issuePrice);
  const closeGain = calculateGain(listingClose, issuePrice);

  // Format percentages
  const openGainFormatted = formatPercentage(openGain);
  const highGainFormatted = formatPercentage(highGain);
  const closeGainFormatted = formatPercentage(closeGain);
  const dayReturnFormatted = formatPercentage(listingGainPercent);

  // Format listing date
  const formattedDate = format(new Date(listingDate), 'dd MMM yyyy');

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Listing Day Performance</CardTitle>
        <p className="text-sm text-muted-foreground">
          Listing Date: <span className="font-medium">{formattedDate}</span>
        </p>
      </CardHeader>
      <CardContent>
        {/* Desktop View: Table Layout */}
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-semibold">Metric</TableHead>
                <TableHead className="text-right font-semibold">Price</TableHead>
                <TableHead className="text-right font-semibold">Gain</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Issue Price</TableCell>
                <TableCell className="text-right">{formatCurrency(issuePrice)}</TableCell>
                <TableCell className="text-right text-muted-foreground">-</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Listing Open</TableCell>
                <TableCell className="text-right">{formatCurrency(listingOpen)}</TableCell>
                <TableCell
                  className={cn(
                    'text-right font-semibold',
                    openGainFormatted.isPositive ? 'text-green-600' : 'text-red-600'
                  )}
                >
                  {openGainFormatted.text}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Listing High</TableCell>
                <TableCell className="text-right">{formatCurrency(listingHigh)}</TableCell>
                <TableCell
                  className={cn(
                    'text-right font-semibold',
                    highGainFormatted.isPositive ? 'text-green-600' : 'text-red-600'
                  )}
                >
                  {highGainFormatted.text}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Listing Close</TableCell>
                <TableCell className="text-right">{formatCurrency(listingClose)}</TableCell>
                <TableCell
                  className={cn(
                    'text-right font-semibold',
                    closeGainFormatted.isPositive ? 'text-green-600' : 'text-red-600'
                  )}
                >
                  {closeGainFormatted.text}
                </TableCell>
              </TableRow>
              <TableRow className="border-t-2 bg-muted/30">
                <TableCell className="font-bold text-lg">Day Return</TableCell>
                <TableCell className="text-right"></TableCell>
                <TableCell
                  className={cn(
                    'text-right font-bold text-xl',
                    dayReturnFormatted.isPositive ? 'text-green-600' : 'text-red-600'
                  )}
                >
                  {dayReturnFormatted.text}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Mobile View: Vertical Stacked Layout */}
        <div className="md:hidden space-y-4">
          {/* Issue Price */}
          <div className="flex justify-between items-center pb-3 border-b">
            <span className="font-medium text-muted-foreground">Issue Price</span>
            <div className="text-right">
              <p className="font-semibold text-lg">{formatCurrency(issuePrice)}</p>
            </div>
          </div>

          {/* Listing Open */}
          <div className="flex justify-between items-center pb-3 border-b">
            <span className="font-medium text-muted-foreground">Listing Open</span>
            <div className="text-right">
              <p className="font-semibold text-lg">{formatCurrency(listingOpen)}</p>
              <p
                className={cn(
                  'text-sm font-semibold',
                  openGainFormatted.isPositive ? 'text-green-600' : 'text-red-600'
                )}
              >
                {openGainFormatted.text}
              </p>
            </div>
          </div>

          {/* Listing High */}
          <div className="flex justify-between items-center pb-3 border-b">
            <span className="font-medium text-muted-foreground">Listing High</span>
            <div className="text-right">
              <p className="font-semibold text-lg">{formatCurrency(listingHigh)}</p>
              <p
                className={cn(
                  'text-sm font-semibold',
                  highGainFormatted.isPositive ? 'text-green-600' : 'text-red-600'
                )}
              >
                {highGainFormatted.text}
              </p>
            </div>
          </div>

          {/* Listing Close */}
          <div className="flex justify-between items-center pb-3 border-b">
            <span className="font-medium text-muted-foreground">Listing Close</span>
            <div className="text-right">
              <p className="font-semibold text-lg">{formatCurrency(listingClose)}</p>
              <p
                className={cn(
                  'text-sm font-semibold',
                  closeGainFormatted.isPositive ? 'text-green-600' : 'text-red-600'
                )}
              >
                {closeGainFormatted.text}
              </p>
            </div>
          </div>

          {/* Day Return (Prominent) */}
          <div className="flex justify-between items-center pt-2 pb-3 bg-muted/30 px-4 py-3 rounded-lg">
            <span className="font-bold text-lg">Day Return</span>
            <p
              className={cn(
                'font-bold text-2xl',
                dayReturnFormatted.isPositive ? 'text-green-600' : 'text-red-600'
              )}
            >
              {dayReturnFormatted.text}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
