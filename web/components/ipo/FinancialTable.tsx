'use client';

import { FinancialData } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface FinancialTableProps {
  financialData: FinancialData | null;
}

/**
 * FinancialTable component displays 3-year financial data in table format
 * Shows revenue, profit, EPS, P/E ratio, ROE, and NAV with trend indicators
 */
export function FinancialTable({ financialData }: FinancialTableProps) {
  if (!financialData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Financial Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Financial data not available
          </p>
        </CardContent>
      </Card>
    );
  }

  const formatCurrency = (amount: string | number | null) => {
    if (amount === null) return 'N/A';
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
      notation: 'compact',
      compactDisplay: 'short',
    }).format(numAmount);
  };

  const formatNumber = (num: string | number | null) => {
    if (num === null) return 'N/A';
    const numValue = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(numValue)) return 'N/A';
    return numValue.toFixed(2);
  };

  const getTrendIcon = (current: string | number | null, previous: string | number | null) => {
    if (current === null || previous === null) return <Minus className="h-4 w-4 text-muted-foreground" />;
    const currNum = typeof current === 'string' ? parseFloat(current) : current;
    const prevNum = typeof previous === 'string' ? parseFloat(previous) : previous;
    if (isNaN(currNum) || isNaN(prevNum)) return <Minus className="h-4 w-4 text-muted-foreground" />;
    if (currNum > prevNum) return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (currNum < prevNum) return <TrendingDown className="h-4 w-4 text-red-600" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const rows = [
    {
      metric: 'Revenue',
      fy2022: formatCurrency(financialData.revenueFy2022),
      fy2023: formatCurrency(financialData.revenueFy2023),
      fy2024: formatCurrency(financialData.revenueFy2024),
      trend: getTrendIcon(
        financialData.revenueFy2024,
        financialData.revenueFy2022
      ),
    },
    {
      metric: 'Net Profit',
      fy2022: formatCurrency(financialData.profitFy2022),
      fy2023: formatCurrency(financialData.profitFy2023),
      fy2024: formatCurrency(financialData.profitFy2024),
      trend: getTrendIcon(
        financialData.profitFy2024,
        financialData.profitFy2022
      ),
    },
    {
      metric: 'EPS (₹)',
      fy2022: formatNumber(financialData.eps),
      fy2023: '-',
      fy2024: '-',
      trend: <Minus className="h-4 w-4 text-muted-foreground" />,
    },
    {
      metric: 'P/E Ratio',
      fy2022: formatNumber(financialData.peRatio),
      fy2023: '-',
      fy2024: '-',
      trend: <Minus className="h-4 w-4 text-muted-foreground" />,
    },
    {
      metric: 'ROE (%)',
      fy2022: formatNumber(financialData.roe),
      fy2023: '-',
      fy2024: '-',
      trend: <Minus className="h-4 w-4 text-muted-foreground" />,
    },
    {
      metric: 'NAV (₹)',
      fy2022: formatCurrency(financialData.netWorth),
      fy2023: '-',
      fy2024: '-',
      trend: <Minus className="h-4 w-4 text-muted-foreground" />,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial Performance</CardTitle>
        <p className="text-sm text-muted-foreground">
          3-year financial data (in INR Crores)
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Metric</TableHead>
                <TableHead className="text-right">FY 2022</TableHead>
                <TableHead className="text-right">FY 2023</TableHead>
                <TableHead className="text-right">FY 2024</TableHead>
                <TableHead className="text-center">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.metric}>
                  <TableCell className="font-medium">{row.metric}</TableCell>
                  <TableCell className="text-right">{row.fy2022}</TableCell>
                  <TableCell className="text-right">{row.fy2023}</TableCell>
                  <TableCell className="text-right">{row.fy2024}</TableCell>
                  <TableCell className="flex justify-center">
                    {row.trend}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 border-t pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Debt to Equity</p>
              <p className="text-lg font-semibold">
                {formatNumber(financialData.debtToEquity)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Assets</p>
              <p className="text-lg font-semibold">
                {formatCurrency(financialData.totalAssets)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Borrowing</p>
              <p className="text-lg font-semibold">
                {formatCurrency(financialData.totalBorrowing)}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
