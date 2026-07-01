'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { CurveType } from 'recharts/types/shape/Curve';

/**
 * Configuration for a single area in the chart
 */
export interface AreaConfig {
  /** Key in the data object for this area */
  dataKey: string;
  /** Display name for the area */
  label: string;
  /** Fill color of the area (supports gradients) */
  fillColor: string;
  /** Stroke color of the area line */
  strokeColor: string;
  /** Stroke width (default: 2) */
  strokeWidth?: number;
  /** Fill opacity (default: 0.6) */
  fillOpacity?: number;
  /** Type of curve (default: 'monotone') */
  curveType?: CurveType;
  /** Stack ID for stacked areas (optional) */
  stackId?: string;
}

/**
 * Props for AreaChartBase component
 */
export interface AreaChartBaseProps {
  /** Data array for the chart */
  data: Record<string, any>[];
  /** Configuration for areas to display */
  areas: AreaConfig[];
  /** Key for X-axis data (default: 'name') */
  xAxisKey?: string;
  /** Label for X-axis */
  xAxisLabel?: string;
  /** Label for Y-axis */
  yAxisLabel?: string;
  /** Height of the chart in pixels (default: 300) */
  height?: number;
  /** Width of the chart (default: '100%') */
  width?: number | `${number}%`;
  /** Show grid lines (default: true) */
  showGrid?: boolean;
  /** Show legend (default: true) */
  showLegend?: boolean;
  /** Custom Y-axis formatter function */
  yAxisFormatter?: (value: number) => string;
  /** Custom tooltip formatter function */
  tooltipFormatter?: (value: number, name: string) => [string, string];
  /** Chart margin (default: { top: 10, right: 30, left: 0, bottom: 0 }) */
  margin?: {
    top?: number;
    right?: number;
    left?: number;
    bottom?: number;
  };
  /** Custom X-axis tick formatter */
  xAxisFormatter?: (value: any) => string;
  /** Enable animations (default: true) */
  enableAnimations?: boolean;
  /** Animation duration in ms (default: 1500) */
  animationDuration?: number;
  /** Type of stacking (default: none, can be 'none' | 'expand' | 'silhouette' | 'wiggle') */
  stackOffset?: 'expand' | 'none' | 'wiggle' | 'silhouette';
}

/**
 * AreaChartBase - Reusable area chart component using Recharts
 *
 * Features:
 * - Multiple areas support (stacked or overlapping)
 * - Customizable colors, gradients, and styling
 * - Dark mode compatible
 * - Responsive design
 * - Custom formatters for axes and tooltips
 * - Configurable animations
 * - Support for percentage stacking
 *
 * @example
 * ```tsx
 * // Simple area chart
 * <AreaChartBase
 *   data={[
 *     { month: 'Jan', value: 1000 },
 *     { month: 'Feb', value: 1500 },
 *   ]}
 *   areas={[
 *     {
 *       dataKey: 'value',
 *       label: 'Revenue',
 *       fillColor: '#3b82f680',
 *       strokeColor: '#3b82f6',
 *     },
 *   ]}
 *   xAxisKey="month"
 * />
 *
 * // Stacked area chart
 * <AreaChartBase
 *   data={data}
 *   areas={[
 *     {
 *       dataKey: 'qib',
 *       label: 'QIB',
 *       fillColor: '#3b82f680',
 *       strokeColor: '#3b82f6',
 *       stackId: '1',
 *     },
 *     {
 *       dataKey: 'retail',
 *       label: 'Retail',
 *       fillColor: '#10b98180',
 *       strokeColor: '#10b981',
 *       stackId: '1',
 *     },
 *   ]}
 *   stackOffset="expand"
 * />
 * ```
 */
export function AreaChartBase({
  data,
  areas,
  xAxisKey = 'name',
  xAxisLabel,
  yAxisLabel,
  height = 300,
  width = '100%',
  showGrid = true,
  showLegend = true,
  yAxisFormatter,
  tooltipFormatter,
  margin = { top: 10, right: 30, left: 0, bottom: 0 },
  xAxisFormatter,
  enableAnimations = true,
  animationDuration = 1500,
  stackOffset = 'none',
}: AreaChartBaseProps) {
  // Default Y-axis formatter
  const defaultYAxisFormatter = (value: number) => {
    if (typeof value === 'number') {
      if (stackOffset === 'expand') {
        // For percentage stacking
        return `${(value * 100).toFixed(0)}%`;
      }
      return value.toLocaleString('en-IN');
    }
    return String(value);
  };

  // Default tooltip formatter
  const defaultTooltipFormatter = (value: number, name: string): [string, string] => {
    if (typeof value === 'number') {
      if (stackOffset === 'expand') {
        return [`${(value * 100).toFixed(1)}%`, name];
      }
      const formattedValue = value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
      return [formattedValue, name];
    }
    return [String(value), name];
  };

  const yFormatter = yAxisFormatter || defaultYAxisFormatter;
  const tooltipFormatterFn = tooltipFormatter || defaultTooltipFormatter;

  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart data={data} margin={margin} stackOffset={stackOffset}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}

        <XAxis
          dataKey={xAxisKey}
          label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -5 } : undefined}
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
          tickFormatter={xAxisFormatter}
        />

        <YAxis
          label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft' } : undefined}
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
          tickFormatter={yFormatter}
        />

        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--background)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
          }}
          labelStyle={{
            color: 'var(--foreground)',
            fontWeight: 600,
          }}
          itemStyle={{
            color: 'var(--foreground)',
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

        {areas.map((areaConfig) => (
          <Area
            key={areaConfig.dataKey}
            type={areaConfig.curveType || 'monotone'}
            dataKey={areaConfig.dataKey}
            name={areaConfig.label}
            stackId={areaConfig.stackId}
            stroke={areaConfig.strokeColor}
            strokeWidth={areaConfig.strokeWidth || 2}
            fill={areaConfig.fillColor}
            fillOpacity={areaConfig.fillOpacity !== undefined ? areaConfig.fillOpacity : 0.6}
            isAnimationActive={enableAnimations}
            animationDuration={animationDuration}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
