'use client';

/**
 * SectorComparisonChart Component
 *
 * Compares IPO listing performance against sector average
 * using horizontal bar chart visualization
 */

import { BarChartBase } from '../base/BarChartBase';
import { formatPercent } from './utils';
import type { SectorComparisonChartProps } from './types';
import { CheckCircle, XCircle } from 'lucide-react';

export function SectorComparisonChart({
  comparison,
  additionalMetrics,
  className,
}: SectorComparisonChartProps) {
  // Prepare data for horizontal bar chart
  const chartData = [
    {
      name: comparison.sector + ' Average',
      gain: comparison.sectorAverage,
      color: 'hsl(var(--chart-2))',
    },
    {
      name: 'This IPO',
      gain: comparison.ipoGain,
      color: comparison.outperformance ? 'hsl(var(--chart-1))' : 'hsl(var(--chart-3))',
    },
  ];

  const bars: any[] = [
    {
      dataKey: 'gain',
      fill: 'hsl(var(--chart-1))',
      radius: [0, 4, 4, 0] as [number, number, number, number],
      name: 'Listing Gain %',
      label: 'Listing Gain %',
      fillColor: 'hsl(var(--chart-1))',
    },
  ];

  // Custom tooltip
  const customTooltip = (props: any) => {
    if (!props.active || !props.payload || props.payload.length === 0) {
      return null;
    }

    const data = props.payload[0].payload;

    return (
      <div className="rounded-lg border bg-background/95 backdrop-blur-sm p-3 shadow-lg">
        <p className="font-medium text-sm mb-1">{data.name}</p>
        <p className="text-lg font-bold">{formatPercent(data.gain)}</p>
      </div>
    );
  };

  return (
    <div className={className}>
      {/* Comparison Summary */}
      <div className="rounded-lg border bg-card p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h4 className="text-sm font-medium mb-2">Performance vs Sector</h4>
            <p className="text-3xl font-bold mb-2">
              {formatPercent(Math.abs(comparison.difference))}
            </p>
            <p className="text-sm text-muted-foreground">
              {comparison.outperformance ? 'Outperformance' : 'Underperformance'} vs {comparison.sector} sector
            </p>
          </div>
          {comparison.outperformance ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle className="h-12 w-12 text-green-600" />
              <span className="text-xs font-medium text-green-600">Above Average</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <XCircle className="h-12 w-12 text-orange-600" />
              <span className="text-xs font-medium text-orange-600">Below Average</span>
            </div>
          )}
        </div>

        {/* Detailed Breakdown */}
        <div className="mt-6 pt-6 border-t grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">This IPO</p>
            <p className="text-2xl font-bold">{formatPercent(comparison.ipoGain)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">{comparison.sector} Average</p>
            <p className="text-2xl font-bold">{formatPercent(comparison.sectorAverage)}</p>
          </div>
        </div>
      </div>

      {/* Horizontal Bar Chart */}
      <div className="rounded-lg border bg-card p-4">
        <h4 className="text-sm font-medium mb-4">Visual Comparison</h4>
        <BarChartBase
          data={chartData}
          xAxisKey="name"
          bars={bars}
          height={200}
          showGrid={true}
          showLegend={false}
          layout="vertical"
          enableAnimations={true}
          xAxisFormatter={(value: number) => formatPercent(value, false)}
        />
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Listing day gain percentage comparison
        </p>
      </div>

      {/* Additional Metrics */}
      {additionalMetrics && additionalMetrics.length > 0 && (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          {additionalMetrics.map((metric, index) => (
            <div key={index} className="rounded-lg border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground mb-1">{metric.label}</p>
              <p className="text-xl font-bold">
                {metric.format === 'percent'
                  ? formatPercent(metric.value)
                  : metric.format === 'currency'
                  ? `₹${metric.value.toLocaleString('en-IN')}`
                  : metric.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Performance Insight */}
      <div className="mt-6 rounded-lg bg-muted/30 p-4">
        <p className="text-sm">
          {comparison.outperformance ? (
            <>
              <span className="font-semibold text-green-600">Strong performer:</span> This IPO's
              listing gain of <span className="font-medium">{formatPercent(comparison.ipoGain)}</span>{' '}
              exceeded the {comparison.sector} sector average by{' '}
              <span className="font-medium">{formatPercent(comparison.difference)}</span>.
            </>
          ) : (
            <>
              <span className="font-semibold text-orange-600">Below average:</span> This IPO's
              listing gain of <span className="font-medium">{formatPercent(comparison.ipoGain)}</span>{' '}
              was <span className="font-medium">{formatPercent(Math.abs(comparison.difference))}</span>{' '}
              lower than the {comparison.sector} sector average.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
