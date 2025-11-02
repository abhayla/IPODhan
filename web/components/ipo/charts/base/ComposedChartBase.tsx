'use client';

import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { CurveType } from 'recharts/types/shape/Curve';

/**
 * Configuration for chart series (can be line, area, or bar)
 */
export interface ChartSeriesConfig {
  /** Type of series */
  type: 'line' | 'area' | 'bar';
  /** Key in the data object */
  dataKey: string;
  /** Display name */
  label: string;
  /** Color for the series */
  color: string;
  /** Which Y-axis to use ('left' | 'right', default: 'left') */
  yAxisId?: 'left' | 'right';
  /** Stroke width (for line/area, default: 2) */
  strokeWidth?: number;
  /** Fill opacity (for area, default: 0.6) */
  fillOpacity?: number;
  /** Curve type (for line/area, default: 'monotone') */
  curveType?: CurveType;
  /** Stack ID (for bar/area stacking, optional) */
  stackId?: string;
  /** Show dots (for line, default: true) */
  showDots?: boolean;
  /** Bar radius (for bar, default: [4, 4, 0, 0]) */
  radius?: number | [number, number, number, number];
}

/**
 * Configuration for Y-axis
 */
export interface YAxisConfig {
  /** Axis ID ('left' | 'right') */
  id: 'left' | 'right';
  /** Label for the axis */
  label?: string;
  /** Custom formatter function */
  formatter?: (value: number) => string;
  /** Orientation of the axis */
  orientation?: 'left' | 'right';
  /** Domain [min, max] (optional, auto by default) */
  domain?: [number | 'auto' | 'dataMin' | 'dataMax', number | 'auto' | 'dataMin' | 'dataMax'];
}

/**
 * Props for ComposedChartBase component
 */
export interface ComposedChartBaseProps {
  /** Data array for the chart */
  data: Record<string, any>[];
  /** Configuration for chart series */
  series: ChartSeriesConfig[];
  /** Key for X-axis data (default: 'name') */
  xAxisKey?: string;
  /** Label for X-axis */
  xAxisLabel?: string;
  /** Height of the chart in pixels (default: 300) */
  height?: number;
  /** Width of the chart (default: '100%') */
  width?: string | number;
  /** Show grid lines (default: true) */
  showGrid?: boolean;
  /** Show legend (default: true) */
  showLegend?: boolean;
  /** Custom tooltip formatter function */
  tooltipFormatter?: (value: number, name: string) => [string, string];
  /** Chart margin (default: { top: 5, right: 30, left: 20, bottom: 5 }) */
  margin?: {
    top?: number;
    right?: number;
    left?: number;
    bottom?: number;
  };
  /** Custom X-axis formatter */
  xAxisFormatter?: (value: any) => string;
  /** Y-axes configuration (supports dual Y-axis) */
  yAxes?: YAxisConfig[];
  /** Enable animations (default: true) */
  enableAnimations?: boolean;
  /** Animation duration in ms (default: 1500) */
  animationDuration?: number;
}

/**
 * ComposedChartBase - Reusable composed chart component using Recharts
 *
 * Features:
 * - Combine line, area, and bar charts
 * - Dual Y-axis support
 * - Customizable colors and styling
 * - Dark mode compatible
 * - Responsive design
 * - Custom formatters for axes and tooltips
 * - Configurable animations
 * - Stacking support for bars and areas
 *
 * @example
 * ```tsx
 * // Line + Bar chart with dual Y-axis
 * <ComposedChartBase
 *   data={[
 *     { month: 'Jan', revenue: 1000, profit: 200, margin: 20 },
 *     { month: 'Feb', revenue: 1500, profit: 300, margin: 20 },
 *   ]}
 *   series={[
 *     {
 *       type: 'bar',
 *       dataKey: 'revenue',
 *       label: 'Revenue',
 *       color: '#3b82f6',
 *       yAxisId: 'left',
 *     },
 *     {
 *       type: 'bar',
 *       dataKey: 'profit',
 *       label: 'Profit',
 *       color: '#10b981',
 *       yAxisId: 'left',
 *     },
 *     {
 *       type: 'line',
 *       dataKey: 'margin',
 *       label: 'Margin %',
 *       color: '#f59e0b',
 *       yAxisId: 'right',
 *     },
 *   ]}
 *   yAxes={[
 *     {
 *       id: 'left',
 *       label: 'Amount (₹ Cr)',
 *       orientation: 'left',
 *       formatter: (value) => `₹${value}`,
 *     },
 *     {
 *       id: 'right',
 *       label: 'Percentage',
 *       orientation: 'right',
 *       formatter: (value) => `${value}%`,
 *     },
 *   ]}
 *   xAxisKey="month"
 * />
 *
 * // Area + Line chart
 * <ComposedChartBase
 *   data={subscriptionData}
 *   series={[
 *     {
 *       type: 'area',
 *       dataKey: 'subscription',
 *       label: 'Subscription',
 *       color: '#3b82f6',
 *       fillOpacity: 0.3,
 *     },
 *     {
 *       type: 'line',
 *       dataKey: 'target',
 *       label: 'Target',
 *       color: '#ef4444',
 *       strokeWidth: 2,
 *     },
 *   ]}
 * />
 * ```
 */
export function ComposedChartBase({
  data,
  series,
  xAxisKey = 'name',
  xAxisLabel,
  height = 300,
  width = '100%',
  showGrid = true,
  showLegend = true,
  tooltipFormatter,
  margin = { top: 5, right: 30, left: 20, bottom: 5 },
  xAxisFormatter,
  yAxes = [{ id: 'left', orientation: 'left' }],
  enableAnimations = true,
  animationDuration = 1500,
}: ComposedChartBaseProps) {
  // Default formatters
  const defaultYAxisFormatter = (value: number) => {
    if (typeof value === 'number') {
      return value.toLocaleString('en-IN');
    }
    return String(value);
  };

  const defaultTooltipFormatter = (value: number, name: string): [string, string] => {
    const formattedValue =
      typeof value === 'number'
        ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 })
        : String(value);
    return [formattedValue, name];
  };

  const tooltipFormatterFn = tooltipFormatter || defaultTooltipFormatter;

  return (
    <ResponsiveContainer width={width} height={height}>
      <ComposedChart data={data} margin={margin}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}

        <XAxis
          dataKey={xAxisKey}
          label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -5 } : undefined}
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
          tickFormatter={xAxisFormatter}
        />

        {yAxes.map((yAxisConfig) => (
          <YAxis
            key={yAxisConfig.id}
            yAxisId={yAxisConfig.id}
            orientation={yAxisConfig.orientation || yAxisConfig.id}
            label={yAxisConfig.label ? { value: yAxisConfig.label, angle: -90, position: 'insideLeft' } : undefined}
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
            tickFormatter={yAxisConfig.formatter || defaultYAxisFormatter}
            domain={yAxisConfig.domain}
          />
        ))}

        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--background))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px',
          }}
          labelStyle={{
            color: 'hsl(var(--foreground))',
            fontWeight: 600,
          }}
          itemStyle={{
            color: 'hsl(var(--foreground))',
          }}
          formatter={tooltipFormatterFn}
        />

        {showLegend && (
          <Legend
            wrapperStyle={{
              paddingTop: '10px',
              fontSize: '12px',
            }}
          />
        )}

        {series.map((seriesConfig) => {
          const baseProps = {
            key: seriesConfig.dataKey,
            dataKey: seriesConfig.dataKey,
            name: seriesConfig.label,
            yAxisId: seriesConfig.yAxisId || 'left',
            isAnimationActive: enableAnimations,
            animationDuration: animationDuration,
          };

          switch (seriesConfig.type) {
            case 'line':
              return (
                <Line
                  {...baseProps}
                  type={seriesConfig.curveType || 'monotone'}
                  stroke={seriesConfig.color}
                  strokeWidth={seriesConfig.strokeWidth || 2}
                  dot={seriesConfig.showDots !== false ? { r: 4 } : false}
                  activeDot={seriesConfig.showDots !== false ? { r: 6 } : false}
                />
              );

            case 'area':
              return (
                <Area
                  {...baseProps}
                  type={seriesConfig.curveType || 'monotone'}
                  stroke={seriesConfig.color}
                  strokeWidth={seriesConfig.strokeWidth || 2}
                  fill={seriesConfig.color}
                  fillOpacity={seriesConfig.fillOpacity !== undefined ? seriesConfig.fillOpacity : 0.6}
                  stackId={seriesConfig.stackId}
                />
              );

            case 'bar':
              return (
                <Bar
                  {...baseProps}
                  fill={seriesConfig.color}
                  radius={seriesConfig.radius || [4, 4, 0, 0]}
                  stackId={seriesConfig.stackId}
                />
              );

            default:
              return null;
          }
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
