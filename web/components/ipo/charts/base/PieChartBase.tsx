'use client';

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Label,
} from 'recharts';

/**
 * Data structure for pie chart
 */
export interface PieDataItem {
  /** Name/label of the segment */
  name: string;
  /** Value of the segment */
  value: number;
  /** Color for this segment (optional, will use default colors if not provided) */
  color?: string;
}

/**
 * Props for PieChartBase component
 */
export interface PieChartBaseProps {
  /** Data array for the pie chart */
  data: PieDataItem[];
  /** Height of the chart in pixels (default: 300) */
  height?: number;
  /** Width of the chart (default: '100%') */
  width?: number | `${number}%`;
  /** Show legend (default: true) */
  showLegend?: boolean;
  /** Legend position (default: 'right') */
  legendPosition?: 'top' | 'bottom' | 'left' | 'right';
  /** Custom tooltip formatter function */
  tooltipFormatter?: (value: number, entry: PieDataItem) => [string, string];
  /** Enable animations (default: true) */
  enableAnimations?: boolean;
  /** Animation duration in ms (default: 1500) */
  animationDuration?: number;
  /** Inner radius percentage for donut chart (0-100, default: 0 for full pie) */
  innerRadius?: number;
  /** Outer radius percentage (0-100, default: 80) */
  outerRadius?: number;
  /** Custom colors array (will cycle through if more data than colors) */
  colors?: string[];
  /** Show percentage labels on segments (default: false) */
  showLabels?: boolean;
  /** Label position ('inside' | 'outside', default: 'outside') */
  labelPosition?: 'inside' | 'outside';
  /** Center label for donut chart (e.g., "Total: ₹100Cr") */
  centerLabel?: string;
  /** Center label sub-text */
  centerSubLabel?: string;
  /** Start angle in degrees (default: 0) */
  startAngle?: number;
  /** End angle in degrees (default: 360) */
  endAngle?: number;
  /** Padding angle between segments (default: 0) */
  paddingAngle?: number;
}

// Default color palette (Material Design inspired)
const DEFAULT_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#84cc16', // lime-500
];

/**
 * PieChartBase - Reusable pie/donut chart component using Recharts
 *
 * Features:
 * - Full pie or donut chart modes
 * - Customizable colors
 * - Dark mode compatible
 * - Responsive design
 * - Custom tooltip formatters
 * - Configurable animations
 * - Percentage labels
 * - Center labels for donut charts
 *
 * @example
 * ```tsx
 * // Simple pie chart
 * <PieChartBase
 *   data={[
 *     { name: 'QIB', value: 45.2 },
 *     { name: 'NII', value: 12.8 },
 *     { name: 'Retail', value: 2.3 },
 *   ]}
 * />
 *
 * // Donut chart with center label
 * <PieChartBase
 *   data={issueBreakdown}
 *   innerRadius={60}
 *   centerLabel="Total"
 *   centerSubLabel="₹500 Cr"
 *   showLabels
 * />
 *
 * // Custom colors
 * <PieChartBase
 *   data={categoryData}
 *   colors={['#3b82f6', '#10b981', '#f59e0b']}
 *   showLabels
 *   labelPosition="inside"
 * />
 * ```
 */
export function PieChartBase({
  data,
  height = 300,
  width = '100%',
  showLegend = true,
  legendPosition = 'right',
  tooltipFormatter,
  enableAnimations = true,
  animationDuration = 1500,
  innerRadius = 0,
  outerRadius = 80,
  colors = DEFAULT_COLORS,
  showLabels = false,
  labelPosition = 'outside',
  centerLabel,
  centerSubLabel,
  startAngle = 0,
  endAngle = 360,
  paddingAngle = 0,
}: PieChartBaseProps) {
  // Calculate total for percentage calculation
  const total = data.reduce((sum, item) => sum + item.value, 0);

  // Default tooltip formatter
  const defaultTooltipFormatter = (value: number, entry: PieDataItem): [string, string] => {
    const percentage = ((value / total) * 100).toFixed(1);
    const formattedValue = value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    return [`${formattedValue} (${percentage}%)`, entry.name];
  };

  const tooltipFormatterFn = tooltipFormatter || defaultTooltipFormatter;

  // Custom label rendering function
  const renderLabel = (entry: any) => {
    const percentage = ((entry.value / total) * 100).toFixed(1);
    return `${percentage}%`;
  };

  return (
    <ResponsiveContainer width={width} height={height}>
      <PieChart>
        <Pie
          data={data as any}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={`${innerRadius}%`}
          outerRadius={`${outerRadius}%`}
          startAngle={startAngle}
          endAngle={endAngle}
          paddingAngle={paddingAngle}
          label={showLabels ? renderLabel : false}
          labelLine={showLabels && labelPosition === 'outside'}
          isAnimationActive={enableAnimations}
          animationDuration={animationDuration}
        >
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.color || colors[index % colors.length]}
            />
          ))}

          {/* Center label for donut chart */}
          {innerRadius > 0 && centerLabel && (
            <Label
              value={centerLabel}
              position="center"
              style={{
                fontSize: '14px',
                fontWeight: 600,
                fill: 'var(--foreground)',
              }}
              dy={centerSubLabel ? -10 : 0}
            />
          )}

          {innerRadius > 0 && centerSubLabel && (
            <Label
              value={centerSubLabel}
              position="center"
              style={{
                fontSize: '18px',
                fontWeight: 700,
                fill: 'var(--foreground)',
              }}
              dy={15}
            />
          )}
        </Pie>

        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--background)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
          }}
          itemStyle={{
            color: 'var(--foreground)',
          }}
          formatter={(value: number, name: string, entry: any) => {
            const [formattedValue, label] = tooltipFormatterFn(value, entry.payload);
            return [formattedValue, label];
          }}
        />

        {showLegend && (
          <Legend
            layout={legendPosition === 'top' || legendPosition === 'bottom' ? 'horizontal' : 'vertical'}
            verticalAlign={legendPosition === 'top' ? 'top' : legendPosition === 'bottom' ? 'bottom' : 'middle'}
            align={legendPosition === 'left' ? 'left' : legendPosition === 'right' ? 'right' : 'center'}
            wrapperStyle={{
              fontSize: '12px',
              paddingTop: legendPosition === 'bottom' ? '10px' : '0',
              paddingBottom: legendPosition === 'top' ? '10px' : '0',
            }}
          />
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}
