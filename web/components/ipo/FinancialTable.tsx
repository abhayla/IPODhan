'use client';

import { FinancialData, IpoFinancials } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HiArrowTrendingUp, HiArrowTrendingDown, HiMinus } from 'react-icons/hi2';
import { FinancialYearEndDisplay } from './FinancialYearEndDisplay';
import { PBRatioDisplay } from './PBRatioDisplay';
import { ROCEDisplay } from './ROCEDisplay';
import { IndustryPEComparison } from './IndustryPEComparison';
import { PeerCompaniesList } from './PeerCompaniesList';

interface FinancialTableProps {
  financialData: FinancialData | null;
  ipoFinancials?: IpoFinancials | null;
}

/**
 * FinancialTable component displays 3-year financial data in table format
 * Shows revenue, profit, EPS, P/E ratio, ROE, and NAV with trend indicators
 * Story 4.10: Enhanced with P/B Ratio, ROCE, Industry P/E, and Peer Companies
 */
export function FinancialTable({ financialData, ipoFinancials }: FinancialTableProps) {
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
    if (current === null || previous === null) return <HiMinus className="h-4 w-4 text-muted-foreground" />;
    const currNum = typeof current === 'string' ? parseFloat(current) : current;
    const prevNum = typeof previous === 'string' ? parseFloat(previous) : previous;
    if (isNaN(currNum) || isNaN(prevNum)) return <HiMinus className="h-4 w-4 text-muted-foreground" />;
    if (currNum > prevNum) return <HiArrowTrendingUp className="h-4 w-4 text-green-600" />;
    if (currNum < prevNum) return <HiArrowTrendingDown className="h-4 w-4 text-red-600" />;
    return <HiMinus className="h-4 w-4 text-muted-foreground" />;
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
      trend: <HiMinus className="h-4 w-4 text-muted-foreground" />,
    },
    {
      metric: 'P/E Ratio',
      fy2022: formatNumber(financialData.peRatio),
      fy2023: '-',
      fy2024: '-',
      trend: <HiMinus className="h-4 w-4 text-muted-foreground" />,
    },
    {
      metric: 'ROE (%)',
      fy2022: formatNumber(financialData.roe),
      fy2023: '-',
      fy2024: '-',
      trend: <HiMinus className="h-4 w-4 text-muted-foreground" />,
    },
    {
      metric: 'NAV (₹)',
      fy2022: formatCurrency(financialData.netWorth),
      fy2023: '-',
      fy2024: '-',
      trend: <HiMinus className="h-4 w-4 text-muted-foreground" />,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial Performance</CardTitle>
        <p className="text-sm text-muted-foreground">
          3-year financial data (in INR Crores)
        </p>
        {/* Story 4.10: Financial Year End Display at TOP */}
        {ipoFinancials?.financialYearEnd && (
          <div className="mt-3">
            <FinancialYearEndDisplay financialYearEnd={ipoFinancials.financialYearEnd} />
          </div>
        )}
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

        {/* Story 4.10: Enhanced Financial Metrics Section */}
        {ipoFinancials && (
          <div className="mt-6 border-t pt-6 space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Enhanced Metrics
            </h3>

            {/* P/B Ratio and ROCE in a row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border p-4 bg-muted/30">
                <PBRatioDisplay pbRatio={ipoFinancials.pbRatio} />
              </div>
              <div className="rounded-lg border p-4 bg-muted/30">
                <ROCEDisplay roce={ipoFinancials.rocePercentage} />
              </div>
            </div>

            {/* Industry P/E Comparison */}
            {ipoFinancials.industryPe && (
              <div className="rounded-lg border p-4 bg-muted/30">
                <IndustryPEComparison
                  companyPE={financialData.peRatio}
                  industryPE={ipoFinancials.industryPe}
                />
              </div>
            )}

            {/* Peer Companies List at BOTTOM */}
            {ipoFinancials.peerCompanies && ipoFinancials.peerCompanies.length > 0 && (
              <div className="rounded-lg border p-4 bg-muted/30">
                <PeerCompaniesList peerCompanies={ipoFinancials.peerCompanies} />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
