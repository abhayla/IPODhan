/**
 * ChartSkeleton Component
 *
 * Skeleton loading state for chart components.
 * Provides visual feedback while data is loading.
 *
 * Industry standard: Skeleton screens reduce perceived loading time by 30%+
 * and improve user experience compared to blank screens or spinners.
 *
 * @example
 * ```tsx
 * {isLoading ? (
 *   <ChartSkeleton variant="line" height={300} />
 * ) : (
 *   <LineChart data={data} />
 * )}
 * ```
 */

'use client';

import { cn } from '@/lib/utils';

export interface ChartSkeletonProps {
  /** Chart variant for optimized skeleton shape */
  variant?: 'line' | 'bar' | 'pie' | 'area' | 'composed' | 'gauge' | 'timeline';
  /** Height in pixels (default: 300) */
  height?: number;
  /** Custom className for styling */
  className?: string;
  /** Show title skeleton (default: true) */
  showTitle?: boolean;
  /** Show legend skeleton (default: true) */
  showLegend?: boolean;
  /** Animation speed: 'slow' | 'normal' | 'fast' (default: 'normal') */
  animationSpeed?: 'slow' | 'normal' | 'fast';
}

/**
 * ChartSkeleton Component
 *
 * Displays an animated skeleton placeholder while chart data loads.
 * Variant-specific shapes provide visual continuity.
 */
export function ChartSkeleton({
  variant = 'line',
  height = 300,
  className = '',
  showTitle = true,
  showLegend = true,
  animationSpeed = 'normal',
}: ChartSkeletonProps) {
  // Animation duration based on speed
  const animationDuration = {
    slow: 'duration-[2000ms]',
    normal: 'duration-[1500ms]',
    fast: 'duration-[1000ms]',
  }[animationSpeed];

  // Base skeleton classes with shimmer animation
  const skeletonBase = cn(
    'animate-pulse bg-gradient-to-r from-muted via-muted/50 to-muted',
    'bg-[length:200%_100%]',
    animationDuration,
    'rounded-md'
  );

  return (
    <div
      className={cn('w-full space-y-4', className)}
      role="status"
      aria-label="Loading chart"
      aria-live="polite"
    >
      {/* Title Skeleton */}
      {showTitle && (
        <div className="space-y-2">
          <div className={cn(skeletonBase, 'h-6 w-1/3')} />
          <div className={cn(skeletonBase, 'h-4 w-1/2')} />
        </div>
      )}

      {/* Chart Area Skeleton */}
      <div
        className={cn('relative w-full overflow-hidden rounded-lg border bg-card', className)}
        style={{ height: `${height}px` }}
      >
        {/* Variant-specific skeleton shapes */}
        {variant === 'line' && <LineChartSkeleton skeletonBase={skeletonBase} />}
        {variant === 'bar' && <BarChartSkeleton skeletonBase={skeletonBase} />}
        {variant === 'pie' && <PieChartSkeleton skeletonBase={skeletonBase} />}
        {variant === 'area' && <AreaChartSkeleton skeletonBase={skeletonBase} />}
        {variant === 'composed' && <ComposedChartSkeleton skeletonBase={skeletonBase} />}
        {variant === 'gauge' && <GaugeChartSkeleton skeletonBase={skeletonBase} />}
        {variant === 'timeline' && <TimelineChartSkeleton skeletonBase={skeletonBase} />}
      </div>

      {/* Legend Skeleton */}
      {showLegend && (
        <div className="flex items-center justify-center gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={cn(skeletonBase, 'h-3 w-3 rounded-full')} />
              <div className={cn(skeletonBase, 'h-4 w-16')} />
            </div>
          ))}
        </div>
      )}

      {/* Screen reader text */}
      <span className="sr-only">Loading chart data, please wait...</span>
    </div>
  );
}

// ==================== Variant-Specific Skeletons ====================

function LineChartSkeleton({ skeletonBase }: { skeletonBase: string }) {
  return (
    <div className="absolute inset-0 flex items-end justify-around gap-2 p-6">
      {/* Simulated line chart with varying heights */}
      {[40, 60, 45, 70, 55, 80, 65, 75, 60, 85].map((height, i) => (
        <div key={i} className="flex flex-1 flex-col justify-end">
          <div
            className={cn(skeletonBase, 'w-full')}
            style={{ height: `${height}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function BarChartSkeleton({ skeletonBase }: { skeletonBase: string }) {
  return (
    <div className="absolute inset-0 flex items-end justify-around gap-3 p-6">
      {/* Simulated bar chart */}
      {[60, 80, 45, 70, 90, 55, 75].map((height, i) => (
        <div
          key={i}
          className={cn(skeletonBase, 'w-full')}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

function PieChartSkeleton({ skeletonBase }: { skeletonBase: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      {/* Simulated pie chart (circle) */}
      <div
        className={cn(skeletonBase, 'rounded-full')}
        style={{ width: '200px', height: '200px' }}
      />
    </div>
  );
}

function AreaChartSkeleton({ skeletonBase }: { skeletonBase: string }) {
  return (
    <div className="absolute inset-0 p-6">
      {/* Simulated area chart with gradient */}
      <svg className="h-full w-full" viewBox="0 0 400 200" preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaSkeleton" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="stop-muted" stopOpacity="0.8" />
            <stop offset="100%" className="stop-muted" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <path
          d="M 0,160 L 50,140 L 100,120 L 150,100 L 200,80 L 250,100 L 300,90 L 350,70 L 400,50 L 400,200 L 0,200 Z"
          fill="url(#areaSkeleton)"
          className={cn(skeletonBase, 'opacity-50')}
        />
      </svg>
    </div>
  );
}

function ComposedChartSkeleton({ skeletonBase }: { skeletonBase: string }) {
  return (
    <div className="absolute inset-0 flex items-end justify-around gap-2 p-6">
      {/* Combination of bars and lines */}
      {[40, 60, 45, 70, 55, 80, 65].map((height, i) => (
        <div key={i} className="flex flex-1 flex-col justify-end gap-1">
          {/* Bar */}
          <div
            className={cn(skeletonBase, 'w-full')}
            style={{ height: `${height}%` }}
          />
          {/* Small line indicator */}
          <div className={cn(skeletonBase, 'h-1 w-full')} />
        </div>
      ))}
    </div>
  );
}

function GaugeChartSkeleton({ skeletonBase }: { skeletonBase: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8">
      {/* Simulated gauge (semi-circle) */}
      <div
        className={cn(skeletonBase, 'rounded-t-full')}
        style={{ width: '180px', height: '90px' }}
      />
      {/* Center value */}
      <div className={cn(skeletonBase, 'h-8 w-20')} />
    </div>
  );
}

function TimelineChartSkeleton({ skeletonBase }: { skeletonBase: string }) {
  return (
    <div className="absolute inset-0 flex items-center p-6">
      {/* Horizontal timeline */}
      <div className="flex w-full items-center justify-between">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className={cn(skeletonBase, 'h-12 w-12 rounded-full')} />
            <div className={cn(skeletonBase, 'h-3 w-16')} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ==================== Exports ====================

export default ChartSkeleton;
