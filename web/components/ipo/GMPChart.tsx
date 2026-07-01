'use client';

import { GMPRecord } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { AdvancedGMPMetrics } from './AdvancedGMPMetrics';

interface GMPChartProps {
  gmpRecords: GMPRecord[];
}

/**
 * GMPChart component displays 7-day GMP trend using Recharts
 * Shows historical grey market premium data with line chart visualization
 */
export function GMPChart({ gmpRecords }: GMPChartProps) {
  if (!gmpRecords || gmpRecords.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Grey Market Premium Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              No GMP data available yet
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort by timestamp and take last 7 days
  const sortedRecords = [...gmpRecords]
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    .slice(-7);

  // Format data for Recharts
  const chartData = sortedRecords.map((record) => ({
    date: format(new Date(record.timestamp), 'dd MMM'),
    gmp: record.gmp,
    expectedListingPrice: record.expectedListingPrice,
  }));

  // Get latest GMP for headline
  const latestGMP = sortedRecords[sortedRecords.length - 1];
  const isPositiveGMP = latestGMP.gmp > 0;

  const formatCurrency = (value: number | null) => {
    if (value === null) return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Grey Market Premium Trend</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Latest GMP:</span>
            <span
              className={`text-xl font-bold ${isPositiveGMP ? 'text-green-600' : 'text-red-600'}`}
            >
              {formatCurrency(latestGMP.gmp)}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
                tickFormatter={(value) => `₹${value}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                }}
                formatter={(value: number) => [formatCurrency(value), 'GMP']}
              />
              <Line
                type="monotone"
                dataKey="gmp"
                stroke={isPositiveGMP ? '#16a34a' : '#dc2626'}
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-4 border-t pt-4">
            <p className="text-sm text-muted-foreground">
              Expected Listing Price:{' '}
              <span className="font-semibold text-foreground">
                {formatCurrency(latestGMP.expectedListingPrice)}
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Advanced GMP Metrics (Story 4.13) */}
      <AdvancedGMPMetrics gmpRecords={gmpRecords} />
    </>
  );
}
