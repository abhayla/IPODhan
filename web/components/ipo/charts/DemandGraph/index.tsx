/**
 * IPO Demand Graph Component
 *
 * Visualizes price-wise demand distribution showing bid intensity across price buckets.
 * Displays cumulative quantity bid at each price point with exchange filtering.
 *
 * Features:
 * - Horizontal bar chart (desktop) / Vertical (mobile <768px)
 * - Exchange filter (NSE/BSE/BOTH)
 * - Top N buckets filter for large datasets
 * - Summary statistics
 * - Highlights cut-off price demand
 * - Color-coded by demand intensity
 *
 * Data source: ipo_demand_graph table
 * Phase 3: Main Visualizations
 */

'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  HiChartBar,
  HiInformationCircle,
  HiChevronDown,
  HiChevronUp,
} from 'react-icons/hi2';
import { BarChartBase } from '../base/BarChartBase';
import type { DemandGraphProps } from './types';
import {
  transformDemandData,
  calculateDemandSummary,
  formatDemandQuantity,
  formatCurrency,
  getDemandColor,
  validateDemandRecords,
} from './utils';

/**
 * Main DemandGraph component
 */
export function DemandGraph({
  demandRecords,
  companyName,
  priceRangeMax,
  defaultExchange = 'BOTH',
  defaultExpanded = false,
  showAdvanced = true,
}: DemandGraphProps) {
  // State management
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [selectedExchange, setSelectedExchange] = useState<'NSE' | 'BSE' | 'BOTH'>(defaultExchange);
  const [topN, setTopN] = useState<number>(20); // Default to top 20 buckets
  const [isMobile, setIsMobile] = useState(false);

  // Check for mobile viewport (client-side)
  useMemo(() => {
    if (typeof window !== 'undefined') {
      setIsMobile(window.innerWidth < 768);

      const handleResize = () => {
        setIsMobile(window.innerWidth < 768);
      };

      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  // Validate data
  const isValid = useMemo(() => validateDemandRecords(demandRecords), [demandRecords]);

  // Transform data for chart
  const chartData = useMemo(
    () => transformDemandData(demandRecords, selectedExchange, topN),
    [demandRecords, selectedExchange, topN]
  );

  // Calculate summary stats
  const summary = useMemo(
    () => calculateDemandSummary(demandRecords, selectedExchange),
    [demandRecords, selectedExchange]
  );

  // Empty state
  if (!demandRecords || demandRecords.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <HiChartBar className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Price-wise Demand Distribution</CardTitle>
          </div>
          <CardDescription>
            Bid demand across different price points
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Demand data not available yet
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
            <HiChartBar className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Price-wise Demand Distribution</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <HiInformationCircle className="h-4 w-4" />
            <AlertDescription>
              Demand data is incomplete or invalid. Please check data integrity.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Prepare chart config
  const bars = [
    {
      dataKey: 'cumulativeQuantity',
      name: 'Cumulative Demand',
      label: 'Cumulative Demand',
      fillColor: getDemandColor(50), // Default color, will be overridden per bar
      color: getDemandColor(50),
      unit: ' shares',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <HiChartBar className="h-5 w-5 text-muted-foreground" />
                <CardTitle>Price-wise Demand Distribution</CardTitle>
              </div>
              <CardDescription>
                Cumulative bid demand across price buckets for {companyName}
                {priceRangeMax && ` (Max: ${formatCurrency(priceRangeMax)})`}
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
                  <HiChevronUp className="mr-1 h-4 w-4" />
                  Collapse
                </>
              ) : (
                <>
                  <HiChevronDown className="mr-1 h-4 w-4" />
                  Expand
                </>
              )}
            </Button>
          </div>

          {/* Summary Stats */}
          {isExpanded && (
            <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/50 p-4 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Total Buckets</p>
                <p className="text-lg font-semibold">{summary.totalBuckets}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Max Demand</p>
                <p className="text-lg font-semibold">
                  {formatDemandQuantity(summary.maxDemand)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cut-Off Demand</p>
                <p className="text-lg font-semibold">
                  {summary.cutOffDemand ? formatDemandQuantity(summary.cutOffDemand) : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Most Demanded</p>
                <p className="text-lg font-semibold">
                  {summary.mostDemandedPrice ? formatCurrency(summary.mostDemandedPrice) : 'N/A'}
                </p>
              </div>
            </div>
          )}

          {/* Filters */}
          {showAdvanced && isExpanded && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {/* Exchange Filter */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Exchange:</label>
                <Select
                  value={selectedExchange}
                  onValueChange={(value) => setSelectedExchange(value as 'NSE' | 'BSE' | 'BOTH')}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BOTH">Both</SelectItem>
                    <SelectItem value="NSE">NSE</SelectItem>
                    <SelectItem value="BSE">BSE</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Top N Filter */}
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Show Top:</label>
                <Select
                  value={topN.toString()}
                  onValueChange={(value) => setTopN(parseInt(value))}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 Buckets</SelectItem>
                    <SelectItem value="20">20 Buckets</SelectItem>
                    <SelectItem value="30">30 Buckets</SelectItem>
                    <SelectItem value="0">All Buckets</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      </CardHeader>

      {/* Chart */}
      {isExpanded && (
        <CardContent>
          {chartData.length === 0 ? (
            <div className="flex h-64 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                No demand data for selected exchange
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Demand Chart */}
              <BarChartBase
                data={chartData}
                bars={bars}
                xAxisKey="priceLabel"
                height={Math.max(300, chartData.length * 25)} // Dynamic height based on bars
                layout={isMobile ? 'vertical' : 'horizontal'} // Horizontal on desktop, vertical on mobile
                showLegend={false}
                showGrid={true}
                useDynamicColors={true}
                barCategoryGap="5%"
              />

              {/* Info Note */}
              <Alert>
                <HiInformationCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  <strong>How to read:</strong> Cumulative demand shows total shares bid at each price <strong>and above</strong>.
                  Higher bars indicate stronger demand at that price point. Cut-off price typically shows highest demand.
                </AlertDescription>
              </Alert>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
