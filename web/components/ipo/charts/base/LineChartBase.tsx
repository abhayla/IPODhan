'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts';
import { CurveType } from 'recharts/types/shape/Curve';

/**
 * Configuration for a single line in the chart
 */
export interface LineConfig {
  /** Key in the data object for this line */
  dataKey: string;
  /** Display name for the line */
  label: string;
  /** Color of the line (hex, rgb, or CSS color) */
  color: string;
  /** Stroke width (default: 2) */
  strokeWidth?: number;
  /** Show dots on data points (default: true) */
  showDots?: boolean;
  /** Radius of dots (default: 4) */
  dotRadius?: number;
  /** Type of line curve (default: 'monotone') */
  curveType?: CurveType;
}

/**
 * Props for LineChartBase component
 */
export interface LineChartBaseProps {
  /** Data array for the chart */
  data: Record<string, any>[];
  /** Configuration for lines to display */
  lines: LineConfig[];
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
  /** Chart margin (default: { top: 5, right: 30, left: 20, bottom: 5 }) */
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
}

/**
 * LineChartBase - Reusable line chart component using Recharts
 *
 * Features:
 * - Multiple lines support
 * - Customizable colors, labels, and styling
 * - Dark mode compatible
 * - Responsive design
 * - Custom formatters for axes and tooltips
 * - Configurable animations
 *
 * @example
 * ```tsx
 * <LineChartBase
 *   data={[
 *     { month: 'Jan', revenue: 1000, profit: 200 },
 *     { month: 'Feb', revenue: 1500, profit: 300 },
 *   ]}
 *   lines={[
 *     { dataKey: 'revenue', label: 'Revenue', color: '#3b82f6' },
 *     { dataKey: 'profit', label: 'Profit', color: '#10b981' },
 *   ]}
 *   xAxisKey="month"
 *   yAxisFormatter={(value) => `₹${value}`}
 * />
 * ```
 */
export function LineChartBase({
  data,
  lines,
  xAxisKey = 'name',
  xAxisLabel,
  yAxisLabel,
  height = 300,
  width = '100%',
  showGrid = true,
  showLegend = true,
  yAxisFormatter,
  tooltipFormatter,
  margin = { top: 5, right: 30, left: 20, bottom: 5 },
  xAxisFormatter,
  enableAnimations = true,
  animationDuration = 1500,
}: LineChartBaseProps) {
  // Default Y-axis formatter
  const defaultYAxisFormatter = (value: number) => {
    if (typeof value === 'number') {
      return value.toLocaleString('en-IN');
    }
    return String(value);
  };

  // Default tooltip formatter
  const defaultTooltipFormatter = (value: number, name: string): [string, string] => {
    const formattedValue =
      typeof value === 'number'
        ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 })
        : String(value);
    return [formattedValue, name];
  };

  const yFormatter = yAxisFormatter || defaultYAxisFormatter;
  const tooltipFormatterFn = tooltipFormatter || defaultTooltipFormatter;

  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart data={data} margin={margin}>
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

        {lines.map((lineConfig) => (
          <Line
            key={lineConfig.dataKey}
            type={lineConfig.curveType || 'monotone'}
            dataKey={lineConfig.dataKey}
            name={lineConfig.label}
            stroke={lineConfig.color}
            strokeWidth={lineConfig.strokeWidth || 2}
            dot={lineConfig.showDots !== false ? { r: lineConfig.dotRadius || 4 } : false}
            activeDot={lineConfig.showDots !== false ? { r: (lineConfig.dotRadius || 4) + 2 } : false}
            isAnimationActive={enableAnimations}
            animationDuration={animationDuration}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
