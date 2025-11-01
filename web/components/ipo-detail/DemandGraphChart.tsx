'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { HiInformationCircle, HiArrowTrendingUp, HiChartBar } from 'react-icons/hi2';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';

interface DemandGraphChartProps {
  ipoSlug: string;
  priceRangeMin?: number;
  priceRangeMax?: number;
}

interface DemandDataPoint {
  pricePoint: string;
  price: number | null;
  isCutOff: boolean;
  quantity: number;
  exchange: 'NSE' | 'BSE' | 'BOTH';
  timestamp: string;
}

interface DemandGraphData {
  slug: string;
  companyName: string;
  exchange: string;
  demandGraph: DemandDataPoint[];
  dataByExchange: {
    NSE: DemandDataPoint[];
    BSE: DemandDataPoint[];
    BOTH: DemandDataPoint[];
  };
  snapshot: {
    timestamp: string;
    totalCutOffBids: number;
    pricePoints: number;
  } | null;
  stats: {
    totalDataPoints: number;
    exchanges: string[];
    priceRange: {
      min: number;
      max: number;
    };
    cutOffBids: number;
    totalBids: number;
  };
}

export function DemandGraphChart({
  ipoSlug,
  priceRangeMin,
  priceRangeMax
}: DemandGraphChartProps) {
  const [data, setData] = useState<DemandGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedExchange, setSelectedExchange] = useState<'ALL' | 'NSE' | 'BSE' | 'BOTH'>('ALL');

  useEffect(() => {
    async function fetchDemandData() {
      try {
        setLoading(true);
        setError(null);

        const exchangeParam = selectedExchange === 'ALL' ? '' : `?exchange=${selectedExchange}`;
        const response = await fetch(`/api/ipos/${ipoSlug}/demand-graph${exchangeParam}`);

        if (!response.ok) {
          throw new Error('Failed to fetch demand graph data');
        }

        const result = await response.json();

        if (result.success) {
          setData(result.data);
        } else {
          setError(result.message || 'No data available');
        }
      } catch (err) {
        console.error('Failed to fetch demand graph:', err);
        setError('Failed to load demand graph data');
      } finally {
        setLoading(false);
      }
    }

    fetchDemandData();
  }, [ipoSlug, selectedExchange]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HiChartBar className="h-5 w-5" />
            Price-wise Demand Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <HiInformationCircle className="h-4 w-4" />
            <AlertDescription>
              {error || 'No demand graph data available for this IPO'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // Prepare chart data
  const chartData = data.demandGraph
    .filter(d => selectedExchange === 'ALL' || d.exchange === selectedExchange)
    .sort((a, b) => {
      if (a.isCutOff) return 1;
      if (b.isCutOff) return -1;
      return (a.price || 0) - (b.price || 0);
    })
    .map(d => ({
      name: d.pricePoint,
      price: d.price,
      demand: d.quantity / 1000000, // Convert to millions
      isCutOff: d.isCutOff,
    }));

  // Calculate cut-off percentage
  const cutOffPercentage = data.stats.totalBids > 0
    ? ((data.stats.cutOffBids / data.stats.totalBids) * 100).toFixed(1)
    : '0';

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload[0]) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border rounded-lg shadow-lg">
          <p className="font-semibold">
            {payload[0].payload.isCutOff ? 'Cut-Off Price' : `₹${label}`}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Demand: {payload[0].value.toFixed(2)}M shares
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <HiChartBar className="h-5 w-5" />
            Price-wise Demand Analysis
          </CardTitle>
          <div className="flex items-center gap-3">
            <Select value={selectedExchange} onValueChange={(value: any) => setSelectedExchange(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Exchanges</SelectItem>
                <SelectItem value="NSE">NSE Only</SelectItem>
                <SelectItem value="BSE">BSE Only</SelectItem>
                <SelectItem value="BOTH">Combined</SelectItem>
              </SelectContent>
            </Select>
            {data.snapshot && (
              <Badge variant="outline" className="text-xs">
                Updated: {new Date(data.snapshot.timestamp).toLocaleTimeString()}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">Cut-off Bids</p>
              <p className="text-lg font-semibold">
                {(data.stats.cutOffBids / 1000000).toFixed(2)}M
              </p>
              <p className="text-xs text-gray-500">{cutOffPercentage}% of total</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Bids</p>
              <p className="text-lg font-semibold">
                {(data.stats.totalBids / 1000000).toFixed(2)}M
              </p>
              <p className="text-xs text-gray-500">shares</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">Price Points</p>
              <p className="text-lg font-semibold">{data.snapshot?.pricePoints || 0}</p>
              <p className="text-xs text-gray-500">analyzed</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">Price Range</p>
              <p className="text-lg font-semibold">
                ₹{data.stats.priceRange.min}-{data.stats.priceRange.max}
              </p>
              <p className="text-xs text-gray-500">bid range</p>
            </div>
          </div>

          {/* Chart */}
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="demandGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  label={{
                    value: 'Demand (Million Shares)',
                    angle: -90,
                    position: 'insideLeft'
                  }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />

                {/* Reference lines for price range */}
                {priceRangeMin && (
                  <ReferenceLine
                    x={`${priceRangeMin}`}
                    stroke="#10b981"
                    strokeDasharray="5 5"
                    label={{ value: "Min Price", position: "top" }}
                  />
                )}
                {priceRangeMax && (
                  <ReferenceLine
                    x={`${priceRangeMax}`}
                    stroke="#ef4444"
                    strokeDasharray="5 5"
                    label={{ value: "Max Price", position: "top" }}
                  />
                )}

                <Area
                  type="monotone"
                  dataKey="demand"
                  name="Cumulative Demand"
                  stroke="#3b82f6"
                  fill="url(#demandGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Alert>
              <HiInformationCircle className="h-4 w-4" />
              <AlertDescription>
                No demand data available for the selected exchange
              </AlertDescription>
            </Alert>
          )}

          {/* Info Note */}
          <Alert>
            <HiArrowTrendingUp className="h-4 w-4" />
            <AlertDescription>
              <strong>How to read this chart:</strong> Higher demand at lower prices indicates strong investor interest.
              Cut-off bids ({cutOffPercentage}% of total) show investors willing to accept any price within the range.
            </AlertDescription>
          </Alert>
        </div>
      </CardContent>
    </Card>
  );
}