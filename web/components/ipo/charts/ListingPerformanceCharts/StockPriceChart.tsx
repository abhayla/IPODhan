'use client';

/**
 * StockPriceChart Component
 *
 * Displays post-listing stock price movement with performance period metrics
 */

import { useState } from 'react';
import { LineChartBase } from '../base/LineChartBase';
import { formatCurrency, formatPercent, getGainColorClass } from './utils';
import type { StockPriceChartProps, PerformancePeriod } from './types';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export function StockPriceChart({
  priceData,
  issuePrice,
  currentPrice,
  periods,
  weekHigh52,
  weekLow52,
  className,
}: StockPriceChartProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<string>('All');

  if (priceData.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/25 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Stock price data not available
        </p>
      </div>
    );
  }

  // Prepare chart data
  const chartData = priceData.map((point) => ({
    date: point.dateLabel,
    price: point.price,
    volume: point.volume || 0,
  }));

  // Chart lines
  const lines: any[] = [
    {
      dataKey: 'price',
      label: 'Stock Price',
      color: 'var(--chart-1)',
      stroke: 'var(--chart-1)',
      strokeWidth: 2,
      dot: false,
      name: 'Stock Price',
    },
  ];

  // Custom tooltip
  const customTooltip = (props: any) => {
    if (!props.active || !props.payload || props.payload.length === 0) {
      return null;
    }

    const data = props.payload[0].payload;
    const gainPercent = ((data.price - issuePrice) / issuePrice) * 100;

    return (
      <div className="rounded-lg border bg-background/95 backdrop-blur-sm p-3 shadow-lg">
        <p className="font-medium text-sm mb-2">{data.date}</p>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-4 text-xs">
            <span>Price:</span>
            <span className="font-bold">{formatCurrency(data.price)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-xs">
            <span>Gain vs Issue:</span>
            <span className={cn('font-medium', getGainColorClass(gainPercent))}>
              {formatPercent(gainPercent)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={className}>
      {/* Performance Period Buttons */}
      {periods.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {periods.map((period) => {
            const isActive = selectedPeriod === period.period;
            const isPositive = (period.gainPercent || 0) >= 0;
            const Icon = isPositive ? TrendingUp : TrendingDown;

            return (
              <button
                key={period.period}
                onClick={() => setSelectedPeriod(period.period)}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted hover:bg-muted/80'
                )}
              >
                <div className="flex flex-col items-center gap-1">
                  <span>{period.label}</span>
                  {period.gainPercent !== null && (
                    <span className={cn('text-xs', isActive ? 'opacity-90' : getGainColorClass(period.gainPercent))}>
                      <Icon className="inline h-3 w-3 mr-0.5" />
                      {formatPercent(period.gainPercent, false)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Current Price & 52-Week Range */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Current Price */}
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Current Price</p>
          <p className="text-2xl font-bold">
            {currentPrice ? formatCurrency(currentPrice) : 'N/A'}
          </p>
          {currentPrice && (
            <p className={cn('text-sm font-medium mt-1', getGainColorClass(((currentPrice - issuePrice) / issuePrice) * 100))}>
              {formatPercent(((currentPrice - issuePrice) / issuePrice) * 100)} vs Issue
            </p>
          )}
        </div>

        {/* 52-Week High */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground mb-1">52-Week High</p>
          <p className="text-xl font-bold">
            {weekHigh52 ? formatCurrency(weekHigh52) : 'N/A'}
          </p>
          {weekHigh52 && currentPrice && (
            <p className="text-xs text-muted-foreground mt-1">
              {((weekHigh52 - currentPrice) / currentPrice * 100).toFixed(1)}% above current
            </p>
          )}
        </div>

        {/* 52-Week Low */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground mb-1">52-Week Low</p>
          <p className="text-xl font-bold">
            {weekLow52 ? formatCurrency(weekLow52) : 'N/A'}
          </p>
          {weekLow52 && currentPrice && (
            <p className="text-xs text-muted-foreground mt-1">
              {((currentPrice - weekLow52) / weekLow52 * 100).toFixed(1)}% above low
            </p>
          )}
        </div>
      </div>

      {/* Line Chart */}
      <div className="rounded-lg border bg-card p-4">
        <h4 className="text-sm font-medium mb-4">Price Movement Since Listing</h4>
        <LineChartBase
          data={chartData}
          xAxisKey="date"
          lines={lines}
          height={300}
          showGrid={true}
          showLegend={false}
          enableAnimations={true}
          yAxisFormatter={(value: number) => `₹${value.toFixed(0)}`}
        />
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Dashed line represents issue price baseline
        </p>
      </div>
    </div>
  );
}
