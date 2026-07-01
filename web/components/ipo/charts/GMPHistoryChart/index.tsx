/**
 * Enhanced GMP History Chart Component
 *
 * Displays 30-day Grey Market Premium trend with advanced analytics:
 * - Confidence bands (±10% shaded area)
 * - 7-day moving average trend line
 * - Expected listing price comparison
 * - Trend analysis (upward/downward/stable)
 * - Volatility indicators
 *
 * Features:
 * - Area chart with gradient fill
 * - Toggle confidence bands & moving average
 * - Responsive design (scales down for mobile)
 * - Trend summary statistics
 * - Expand/collapse functionality
 *
 * Data source: gmp_records table
 * Phase 3: Main Visualizations
 */

'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  TrendingUp,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AreaChartBase } from '../base/AreaChartBase';
import type { GMPHistoryChartProps } from './types';
import {
  transformGMPData,
  analyzeGMPTrend,
  formatCurrency,
  formatPercentage,
  getTrendIndicator,
  getVolatilityIndicator,
  validateGMPRecords,
} from './utils';

/**
 * Main GMPHistoryChart component
 */
export function GMPHistoryChart({
  gmpRecords,
  companyName,
  priceRangeMax,
  daysToShow = 30,
  defaultExpanded = false,
  showAdvanced = true,
  showListingPrice = true,
}: GMPHistoryChartProps) {
  // State management
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [showConfidenceBands, setShowConfidenceBands] = useState(true);
  const [showMovingAverage, setShowMovingAverage] = useState(true);
  const [showExpectedListing, setShowExpectedListing] = useState(showListingPrice);

  // Validate data
  const isValid = useMemo(() => validateGMPRecords(gmpRecords), [gmpRecords]);

  // Transform data for chart
  const chartData = useMemo(
    () => transformGMPData(gmpRecords, daysToShow),
    [gmpRecords, daysToShow]
  );

  // Analyze trend
  const trendAnalysis = useMemo(
    () => analyzeGMPTrend(gmpRecords),
    [gmpRecords]
  );

  const trendIndicator = useMemo(
    () => getTrendIndicator(trendAnalysis.trend),
    [trendAnalysis.trend]
  );

  const volatilityIndicator = useMemo(
    () => getVolatilityIndicator(trendAnalysis.volatility),
    [trendAnalysis.volatility]
  );

  // Empty state
  if (!gmpRecords || gmpRecords.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <CardTitle>GMP History & Trend Analysis</CardTitle>
          </div>
          <CardDescription>
            {daysToShow}-day Grey Market Premium trend with an illustrative ±10% range
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              GMP data not available yet
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Invalid data
  if (!isValid) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <CardTitle>GMP History & Trend Analysis</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <Info className="h-4 w-4" />
            <AlertDescription>
              GMP data is incomplete or invalid. Please check data integrity.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Prepare areas config for AreaChartBase
  const areas: any[] = [
    // Confidence band upper (hidden area, just for tooltip)
    ...(showConfidenceBands
      ? [
          {
            dataKey: 'gmpUpper',
            name: 'Illustrative +10% (not a forecast)',
            color: 'var(--chart-1)',
            fillOpacity: 0,
            strokeWidth: 0,
            type: 'monotone' as const,
          },
        ]
      : []),

    // Main GMP area
    {
      dataKey: 'gmp',
      name: 'Grey Market Premium',
      color: 'var(--chart-1)',
      fillOpacity: 0.3,
      strokeWidth: 2,
      type: 'monotone' as const,
      gradient: true,
      gradientId: 'gmpGradient',
      gradientStops: [
        { offset: '0%', stopColor: 'var(--chart-1)', stopOpacity: 0.8 },
        { offset: '100%', stopColor: 'var(--chart-1)', stopOpacity: 0.1 },
      ],
    },

    // Confidence band lower (hidden area)
    ...(showConfidenceBands
      ? [
          {
            dataKey: 'gmpLower',
            name: 'Illustrative −10% (not a forecast)',
            color: 'var(--chart-1)',
            fillOpacity: 0,
            strokeWidth: 0,
            type: 'monotone' as const,
          },
        ]
      : []),

    // 7-day moving average
    ...(showMovingAverage
      ? [
          {
            dataKey: 'movingAvg7',
            name: '7-Day Moving Average',
            color: 'var(--chart-2)',
            fillOpacity: 0,
            strokeWidth: 2,
            strokeDasharray: '5 5',
            type: 'monotone' as const,
          },
        ]
      : []),

    // Expected listing price
    ...(showExpectedListing
      ? [
          {
            dataKey: 'expectedListingPrice',
            name: 'Expected Listing Price',
            color: 'var(--chart-3)',
            fillOpacity: 0,
            strokeWidth: 1.5,
            strokeDasharray: '3 3',
            type: 'monotone' as const,
          },
        ]
      : []),
  ];

  const latestGMP = chartData[chartData.length - 1];
  const isPositive = latestGMP.gmp > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                <CardTitle>GMP History & Trend Analysis</CardTitle>
              </div>
              <CardDescription>
                {daysToShow}-day Grey Market Premium trend for {companyName}
                {priceRangeMax && ` (Issue Price: ${formatCurrency(priceRangeMax)})`}
              </CardDescription>
            </div>

            {/* Expand/Collapse Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="shrink-0"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="mr-1 h-4 w-4" />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronDown className="mr-1 h-4 w-4" />
                  Expand
                </>
              )}
            </Button>
          </div>

          {/* Trend Summary */}
          {isExpanded && (
            <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/50 p-4 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Latest GMP</p>
                <p className={`text-lg font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(trendAnalysis.latestGMP)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Trend</p>
                <p className={`text-lg font-semibold flex items-center gap-1 ${trendIndicator.color}`}>
                  <span>{trendIndicator.icon}</span>
                  <span>{formatPercentage(trendAnalysis.changePercent)}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Volatility</p>
                <p className={`text-sm font-semibold ${volatilityIndicator.color}`}>
                  {volatilityIndicator.label}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg GMP</p>
                <p className="text-lg font-semibold">
                  {formatCurrency(trendAnalysis.avgGMP)}
                </p>
              </div>
            </div>
          )}

          {/* Advanced Controls */}
          {showAdvanced && isExpanded && (
            <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center space-x-2">
                <Switch
                  id="confidence-bands"
                  checked={showConfidenceBands}
                  onCheckedChange={setShowConfidenceBands}
                />
                <Label htmlFor="confidence-bands" className="text-sm">
                  Illustrative ±10% range
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="moving-average"
                  checked={showMovingAverage}
                  onCheckedChange={setShowMovingAverage}
                />
                <Label htmlFor="moving-average" className="text-sm">
                  7-Day Moving Average
                </Label>
              </div>

              {showListingPrice && (
                <div className="flex items-center space-x-2">
                  <Switch
                    id="expected-listing"
                    checked={showExpectedListing}
                    onCheckedChange={setShowExpectedListing}
                  />
                  <Label htmlFor="expected-listing" className="text-sm">
                    Expected Listing Price
                  </Label>
                </div>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      {/* Chart */}
      {isExpanded && (
        <CardContent>
          <div className="space-y-4">
            {/* GMP Trend Chart */}
            <AreaChartBase
              data={chartData}
              areas={areas}
              xAxisKey="date"
              height={350}
              showLegend={true}
              showGrid={true}
            />

            {/* Info Note */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>How to read:</strong> The shaded area shows GMP trend with ±10% confidence bands.
                Dashed line represents 7-day moving average for smoothed trend. Grey market data is unofficial
                and for informational purposes only.
              </AlertDescription>
            </Alert>

            {/* Trend Insights */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-semibold">Trend Insights</p>
              <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">Min GMP:</span>
                  <span className="ml-2 font-semibold">{formatCurrency(trendAnalysis.minGMP)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Max GMP:</span>
                  <span className="ml-2 font-semibold">{formatCurrency(trendAnalysis.maxGMP)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Avg Volatility:</span>
                  <span className="ml-2 font-semibold">{formatPercentage(trendAnalysis.avgVolatility)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Price Change:</span>
                  <span className={`ml-2 font-semibold ${trendAnalysis.changePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatPercentage(trendAnalysis.changePercent)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
