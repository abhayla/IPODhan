'use client';

import { GMPRecord } from '@/lib/db/types';
import { cn } from '@/lib/utils';

interface GMPSparklineProps {
  gmpRecords?: GMPRecord[];
  gmpData?: number[]; // Simple number array (alternative to gmpRecords)
  className?: string;
  height?: number;
  strokeWidth?: number;
}

/**
 * Mini GMP Sparkline
 * Phase 1: Visual Identity Revolution - Layer 2 (Hover State)
 *
 * Features:
 * - Compact 7-day GMP trend visualization
 * - SVG-based sparkline (no heavy chart library)
 * - Color-coded: Green (positive), Red (negative)
 * - Smooth line with rounded caps
 */
export function GMPSparkline({
  gmpRecords,
  gmpData,
  className,
  height = 40,
  strokeWidth = 2,
}: GMPSparklineProps) {
  // Handle both gmpData (simple numbers) and gmpRecords (full objects)
  const dataValues = gmpData || (gmpRecords?.map(r => r.gmp) ?? []);

  if (dataValues.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center text-xs text-muted-foreground', className)}
        style={{ height }}
      >
        No GMP data
      </div>
    );
  }

  // Take last 7 values
  const values = dataValues.slice(-7);

  // Calculate dimensions
  const width = 120; // Fixed width for consistency
  const padding = 4;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Get min/max for scaling
  const minGMP = Math.min(...values);
  const maxGMP = Math.max(...values);
  const range = maxGMP - minGMP || 1; // Avoid division by zero

  // Generate SVG path
  const points = values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * chartWidth;
    const y = padding + chartHeight - ((value - minGMP) / range) * chartHeight;
    return { x, y, gmp: value };
  });

  const pathData =
    points.length > 0
      ? `M ${points[0].x},${points[0].y} ` +
        points
          .slice(1)
          .map((p) => `L ${p.x},${p.y}`)
          .join(' ')
      : '';

  // Determine color based on latest GMP
  const latestGMP = values[values.length - 1] || 0;
  const strokeColor = latestGMP >= 0 ? 'var(--success)' : 'var(--danger)';

  return (
    <div className={cn('relative', className)}>
      <svg width={width} height={height} className="overflow-visible">
        {/* Sparkline path */}
        <path
          d={pathData}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-all duration-300"
        />
        {/* Dots for data points */}
        {points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={1.5}
            fill={strokeColor}
            className="transition-all duration-300"
          />
        ))}
      </svg>
    </div>
  );
}
