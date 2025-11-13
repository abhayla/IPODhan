'use client';

import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';

/**
 * Color range configuration for gauge
 */
export interface GaugeColorRange {
  /** Minimum value for this range (inclusive) */
  min: number;
  /** Maximum value for this range (exclusive) */
  max: number;
  /** Color for this range */
  color: string;
  /** Label for this range (e.g., "Poor", "Good", "Excellent") */
  label?: string;
}

/**
 * Props for GaugeChartBase component
 */
export interface GaugeChartBaseProps {
  /** Current value to display */
  value: number;
  /** Minimum value (default: 0) */
  min?: number;
  /** Maximum value (default: 10) */
  max?: number;
  /** Height of the chart in pixels (default: 200) */
  height?: number;
  /** Width of the chart (default: '100%') */
  width?: number | `${number}%`;
  /** Label to display above the value */
  label?: string;
  /** Sub-label to display below the value */
  subLabel?: string;
  /** Color ranges for the gauge (auto-color based on value if not provided) */
  colorRanges?: GaugeColorRange[];
  /** Show percentage value (default: false) */
  showPercentage?: boolean;
  /** Number of decimal places for value (default: 1) */
  decimals?: number;
  /** Custom formatter for the value display */
  valueFormatter?: (value: number) => string;
  /** Inner radius percentage (0-100, default: 70) */
  innerRadius?: number;
  /** Outer radius percentage (0-100, default: 90) */
  outerRadius?: number;
  /** Start angle in degrees (default: 180, creates semi-circle) */
  startAngle?: number;
  /** End angle in degrees (default: 0) */
  endAngle?: number;
  /** Show value label in center (default: true) */
  showValueLabel?: boolean;
  /** Custom class name for the container */
  className?: string;
  /** Enable animations (default: true) */
  enableAnimations?: boolean;
}

/**
 * Default color ranges for IPO score (0-10 scale)
 */
const DEFAULT_COLOR_RANGES: GaugeColorRange[] = [
  { min: 0, max: 3, color: '#ef4444', label: 'Poor' }, // red-500
  { min: 3, max: 4.5, color: '#f97316', label: 'Below Average' }, // orange-500
  { min: 4.5, max: 6, color: '#f59e0b', label: 'Average' }, // amber-500
  { min: 6, max: 7.5, color: '#84cc16', label: 'Good' }, // lime-500
  { min: 7.5, max: 9, color: '#22c55e', label: 'Strong' }, // green-500
  { min: 9, max: 11, color: '#10b981', label: 'Exceptional' }, // emerald-500
];

/**
 * GaugeChartBase - Reusable gauge/radial chart component using Recharts
 *
 * Features:
 * - Radial bar chart for gauge visualization
 * - Customizable color ranges
 * - Auto-coloring based on value
 * - Dark mode compatible
 * - Responsive design
 * - Center value display
 * - Labels and sub-labels
 * - Configurable angle and radius
 *
 * @example
 * ```tsx
 * // IPO Score gauge (0-10)
 * <GaugeChartBase
 *   value={8.5}
 *   label="IPO Score"
 *   subLabel="Strong (Consider)"
 *   min={0}
 *   max={10}
 * />
 *
 * // Subscription percentage gauge
 * <GaugeChartBase
 *   value={75}
 *   label="Subscription"
 *   min={0}
 *   max={100}
 *   showPercentage
 *   colorRanges={[
 *     { min: 0, max: 50, color: '#ef4444' },
 *     { min: 50, max: 100, color: '#10b981' },
 *   ]}
 * />
 *
 * // Custom formatter
 * <GaugeChartBase
 *   value={4.2}
 *   label="Rating"
 *   max={5}
 *   valueFormatter={(value) => `${value.toFixed(1)} ⭐`}
 * />
 * ```
 */
export function GaugeChartBase({
  value,
  min = 0,
  max = 10,
  height = 200,
  width = '100%',
  label,
  subLabel,
  colorRanges = DEFAULT_COLOR_RANGES,
  showPercentage = false,
  decimals = 1,
  valueFormatter,
  innerRadius = 70,
  outerRadius = 90,
  startAngle = 180,
  endAngle = 0,
  showValueLabel = true,
  className,
  enableAnimations = true,
}: GaugeChartBaseProps) {
  // Calculate percentage
  const percentage = ((value - min) / (max - min)) * 100;
  const clampedPercentage = Math.max(0, Math.min(100, percentage));

  // Determine color based on value and color ranges
  const getColorForValue = (val: number): string => {
    const range = colorRanges.find((r) => val >= r.min && val < r.max);
    return range?.color || colorRanges[colorRanges.length - 1].color;
  };

  const gaugeColor = getColorForValue(value);

  // Get range label
  const getRangeLabel = (val: number): string | undefined => {
    const range = colorRanges.find((r) => val >= r.min && val < r.max);
    return range?.label;
  };

  const rangeLabel = getRangeLabel(value);

  // Format value for display
  const formattedValue = valueFormatter
    ? valueFormatter(value)
    : showPercentage
    ? `${value.toFixed(decimals)}%`
    : value.toFixed(decimals);

  // Prepare data for RadialBarChart
  const chartData = [
    {
      name: 'value',
      value: clampedPercentage,
      fill: gaugeColor,
    },
  ];

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <ResponsiveContainer width={width} height={height}>
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius={`${innerRadius}%`}
          outerRadius={`${outerRadius}%`}
          data={chartData}
          startAngle={startAngle}
          endAngle={endAngle}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar
            background={{ fill: 'hsl(var(--muted))' }}
            dataKey="value"
            cornerRadius={10}
            isAnimationActive={enableAnimations}
          />
        </RadialBarChart>
      </ResponsiveContainer>

      {/* Center value label (positioned absolutely over the chart) */}
      {showValueLabel && (
        <div
          className="absolute flex flex-col items-center justify-center"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            marginTop: `${height * 0.15}px`, // Adjust based on chart height
          }}
        >
          {label && (
            <div className="text-xs text-muted-foreground mb-1 font-medium">{label}</div>
          )}
          <div className="text-3xl font-bold" style={{ color: gaugeColor }}>
            {formattedValue}
          </div>
          {subLabel && (
            <div className="text-xs text-muted-foreground mt-1">{subLabel}</div>
          )}
          {!subLabel && rangeLabel && (
            <div className="text-xs text-muted-foreground mt-1">{rangeLabel}</div>
          )}
        </div>
      )}
    </div>
  );
}
