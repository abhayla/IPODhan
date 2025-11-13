'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';

/**
 * Configuration for a single bar series in the chart
 */
export interface BarConfig {
  /** Key in the data object for this bar */
  dataKey: string;
  /** Display name for the bar */
  label: string;
  /** Fill color of the bars */
  fillColor: string;
  /** Stack ID for stacked bars (optional) */
  stackId?: string;
  /** Radius of bar corners (default: [4, 4, 0, 0]) */
  radius?: number | [number, number, number, number];
  /** Show value labels on bars (default: false) */
  showLabels?: boolean;
  /** Custom label formatter */
  labelFormatter?: (value: number) => string;
}

/**
 * Props for BarChartBase component
 */
export interface BarChartBaseProps {
  /** Data array for the chart */
  data: Record<string, any>[];
  /** Configuration for bars to display */
  bars: BarConfig[];
  /** Key for X-axis/category data (default: 'name') */
  xAxisKey?: string;
  /** Chart layout: vertical or horizontal (default: 'vertical') */
  layout?: 'vertical' | 'horizontal';
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
  /** Custom X-axis formatter function */
  xAxisFormatter?: (value: any) => string;
  /** Custom tooltip formatter function */
  tooltipFormatter?: (value: number, name: string) => [string, string];
  /** Chart margin (default: { top: 20, right: 30, left: 20, bottom: 5 }) */
  margin?: {
    top?: number;
    right?: number;
    left?: number;
    bottom?: number;
  };
  /** Enable animations (default: true) */
  enableAnimations?: boolean;
  /** Animation duration in ms (default: 1500) */
  animationDuration?: number;
  /** Maximum bar size in pixels (optional) */
  maxBarSize?: number;
  /** Bar category gap as percentage (default: '20%') */
  barCategoryGap?: string | number;
  /** Use different colors for each bar (data must have 'color' property) */
  useDynamicColors?: boolean;
}

/**
 * BarChartBase - Reusable bar chart component using Recharts
 *
 * Features:
 * - Vertical and horizontal orientations
 * - Multiple bar series support (grouped or stacked)
 * - Customizable colors and styling
 * - Dark mode compatible
 * - Responsive design
 * - Custom formatters for axes and tooltips
 * - Configurable animations
 * - Value labels on bars
 *
 * @example
 * ```tsx
 * // Simple vertical bar chart
 * <BarChartBase
 *   data={[
 *     { category: 'QIB', value: 45.2 },
 *     { category: 'NII', value: 12.8 },
 *     { category: 'Retail', value: 2.3 },
 *   ]}
 *   bars={[
 *     {
 *       dataKey: 'value',
 *       label: 'Subscription',
 *       fillColor: '#3b82f6',
 *     },
 *   ]}
 *   xAxisKey="category"
 *   yAxisFormatter={(value) => `${value}x`}
 * />
 *
 * // Horizontal bar chart for comparisons
 * <BarChartBase
 *   layout="horizontal"
 *   data={peerData}
 *   bars={[
 *     {
 *       dataKey: 'peRatio',
 *       label: 'P/E Ratio',
 *       fillColor: '#10b981',
 *       showLabels: true,
 *     },
 *   ]}
 *   xAxisKey="company"
 * />
 *
 * // Stacked bar chart
 * <BarChartBase
 *   data={subscriptionData}
 *   bars={[
 *     {
 *       dataKey: 'qib',
 *       label: 'QIB',
 *       fillColor: '#3b82f6',
 *       stackId: 'a',
 *     },
 *     {
 *       dataKey: 'retail',
 *       label: 'Retail',
 *       fillColor: '#10b981',
 *       stackId: 'a',
 *     },
 *   ]}
 * />
 * ```
 */
export function BarChartBase({
  data,
  bars,
  xAxisKey = 'name',
  layout = 'vertical',
  xAxisLabel,
  yAxisLabel,
  height = 300,
  width = '100%',
  showGrid = true,
  showLegend = true,
  yAxisFormatter,
  xAxisFormatter,
  tooltipFormatter,
  margin = { top: 20, right: 30, left: 20, bottom: 5 },
  enableAnimations = true,
  animationDuration = 1500,
  maxBarSize,
  barCategoryGap = '20%',
  useDynamicColors = false,
}: BarChartBaseProps) {
  // Default formatters
  const defaultFormatter = (value: number | string) => {
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

  const yFormatter = yAxisFormatter || defaultFormatter;
  const xFormatter = xAxisFormatter || defaultFormatter;
  const tooltipFormatterFn = tooltipFormatter || defaultTooltipFormatter;

  return (
    <ResponsiveContainer width={width} height={height}>
      <BarChart data={data} layout={layout} margin={margin} barCategoryGap={barCategoryGap}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />}

        {layout === 'vertical' ? (
          <>
            <XAxis
              dataKey={xAxisKey}
              label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -5 } : undefined}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              tickFormatter={xFormatter}
            />
            <YAxis
              label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft' } : undefined}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              tickFormatter={yFormatter}
            />
          </>
        ) : (
          <>
            <XAxis
              type="number"
              label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -5 } : undefined}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              tickFormatter={yFormatter}
            />
            <YAxis
              type="category"
              dataKey={xAxisKey}
              label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft' } : undefined}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              tickFormatter={xFormatter}
            />
          </>
        )}

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
          cursor={{ fill: 'hsl(var(--muted))' }}
        />

        {showLegend && (
          <Legend
            wrapperStyle={{
              paddingTop: '10px',
              fontSize: '12px',
            }}
          />
        )}

        {bars.map((barConfig) => (
          <Bar
            key={barConfig.dataKey}
            dataKey={barConfig.dataKey}
            name={barConfig.label}
            fill={barConfig.fillColor}
            stackId={barConfig.stackId}
            radius={barConfig.radius || [4, 4, 0, 0]}
            maxBarSize={maxBarSize}
            isAnimationActive={enableAnimations}
            animationDuration={animationDuration}
          >
            {useDynamicColors &&
              data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color || barConfig.fillColor} />
              ))}

            {barConfig.showLabels && (
              <LabelList
                dataKey={barConfig.dataKey}
                position={layout === 'vertical' ? 'top' : 'right'}
                formatter={(barConfig.labelFormatter || defaultFormatter) as any}
                fontSize={11}
                fill="hsl(var(--foreground))"
              />
            )}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
