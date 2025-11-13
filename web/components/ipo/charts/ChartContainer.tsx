'use client';

import { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { BarChart3, AlertTriangle } from 'lucide-react';

/**
 * Props for ChartContainer component
 */
export interface ChartContainerProps {
  /** Chart title */
  title?: string;
  /** Chart description/subtitle */
  description?: string;
  /** Chart content */
  children?: ReactNode;
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: Error | string | null;
  /** Empty state (no data) */
  isEmpty?: boolean;
  /** Custom empty message */
  emptyMessage?: string;
  /** Custom error message */
  errorMessage?: string;
  /** Height of the container (CSS value, default: 'auto') */
  height?: string | number;
  /** Custom class name for the card */
  className?: string;
  /** Show card wrapper (default: true) */
  showCard?: boolean;
  /** Card padding (default: true) */
  showPadding?: boolean;
  /** Header actions (buttons, links, etc.) */
  headerActions?: ReactNode;
  /** Footer content */
  footer?: ReactNode;
  /** Retry function for error state */
  onRetry?: () => void;
}

/**
 * ChartContainer - Reusable wrapper for chart components
 *
 * Features:
 * - Loading skeleton states
 * - Error boundary and error display
 * - Empty state handling
 * - Responsive design
 * - Dark mode compatible
 * - Optional card wrapper
 * - Header and footer sections
 * - Retry functionality
 *
 * @example
 * ```tsx
 * <ChartContainer
 *   title="Revenue Trend"
 *   description="Last 3 financial years"
 *   isLoading={isLoading}
 *   isEmpty={data.length === 0}
 *   emptyMessage="No financial data available"
 * >
 *   <LineChartBase data={data} {...chartConfig} />
 * </ChartContainer>
 * ```
 */
export function ChartContainer({
  title,
  description,
  children,
  isLoading = false,
  error = null,
  isEmpty = false,
  emptyMessage = 'No data available',
  errorMessage,
  height = 'auto',
  className,
  showCard = true,
  showPadding = true,
  headerActions,
  footer,
  onRetry,
}: ChartContainerProps) {
  // Loading skeleton
  if (isLoading) {
    return (
      <Card className={className}>
        {(title || description) && (
          <CardHeader>
            {title && <Skeleton className="h-6 w-48" />}
            {description && <Skeleton className="h-4 w-64 mt-2" />}
          </CardHeader>
        )}
        <CardContent className={showPadding ? undefined : 'p-0'}>
          <div style={{ height: typeof height === 'number' ? `${height}px` : height }}>
            <Skeleton className="h-full w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    const displayErrorMessage =
      errorMessage || (typeof error === 'string' ? error : error.message);

    const ErrorContent = (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <AlertTriangle className="h-12 w-12 text-yellow-500 mb-4" />
        <h3 className="text-lg font-semibold mb-2">Unable to load chart</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-md">
          {displayErrorMessage}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        )}
      </div>
    );

    if (!showCard) {
      return <div className={className}>{ErrorContent}</div>;
    }

    return (
      <Card className={className}>
        {(title || description) && (
          <CardHeader>
            {title && <CardTitle>{title}</CardTitle>}
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
        )}
        <CardContent className={showPadding ? undefined : 'p-0'}>
          {ErrorContent}
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (isEmpty) {
    const EmptyContent = (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No data available</h3>
        <p className="text-sm text-muted-foreground max-w-md">{emptyMessage}</p>
      </div>
    );

    if (!showCard) {
      return <div className={className}>{EmptyContent}</div>;
    }

    return (
      <Card className={className}>
        {(title || description) && (
          <CardHeader>
            {title && <CardTitle>{title}</CardTitle>}
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
        )}
        <CardContent className={showPadding ? undefined : 'p-0'}>
          {EmptyContent}
        </CardContent>
      </Card>
    );
  }

  // Success state with content
  const Content = (
    <div
      className="w-full"
      style={{
        height: typeof height === 'number' ? `${height}px` : height,
        minHeight: height === 'auto' ? '200px' : undefined,
      }}
    >
      {children}
    </div>
  );

  if (!showCard) {
    return <div className={className}>{Content}</div>;
  }

  return (
    <Card className={className}>
      {(title || description || headerActions) && (
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              {title && <CardTitle>{title}</CardTitle>}
              {description && <CardDescription>{description}</CardDescription>}
            </div>
            {headerActions && <div className="ml-4">{headerActions}</div>}
          </div>
        </CardHeader>
      )}
      <CardContent className={cn(showPadding ? undefined : 'p-0')}>
        {Content}
      </CardContent>
      {footer && (
        <div className="border-t px-6 py-4">
          {footer}
        </div>
      )}
    </Card>
  );
}

/**
 * ChartSkeleton - Standalone skeleton for charts
 *
 * Use when you need a skeleton without the ChartContainer wrapper.
 *
 * @example
 * ```tsx
 * {isLoading ? <ChartSkeleton /> : <Chart data={data} />}
 * ```
 */
export function ChartSkeleton({
  height = 300,
  showTitle = true,
  className,
}: {
  height?: number | string;
  showTitle?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      {showTitle && <Skeleton className="h-6 w-48 mb-4" />}
      <Skeleton
        className="w-full"
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      />
    </div>
  );
}

/**
 * ChartEmptyState - Standalone empty state for charts
 *
 * Use when you need an empty state without the ChartContainer wrapper.
 *
 * @example
 * ```tsx
 * {data.length === 0 ? (
 *   <ChartEmptyState message="No subscription data yet" />
 * ) : (
 *   <Chart data={data} />
 * )}
 * ```
 */
export function ChartEmptyState({
  message = 'No data available',
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center p-8 text-center', className)}>
      <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
      <p className="text-sm text-muted-foreground max-w-md">{message}</p>
    </div>
  );
}

/**
 * ChartErrorState - Standalone error state for charts
 *
 * Use when you need an error state without the ChartContainer wrapper.
 *
 * @example
 * ```tsx
 * {error ? (
 *   <ChartErrorState error={error} onRetry={refetch} />
 * ) : (
 *   <Chart data={data} />
 * )}
 * ```
 */
export function ChartErrorState({
  error,
  onRetry,
  className,
}: {
  error: Error | string;
  onRetry?: () => void;
  className?: string;
}) {
  const errorMessage = typeof error === 'string' ? error : error.message;

  return (
    <div className={cn('flex flex-col items-center justify-center p-8 text-center', className)}>
      <AlertTriangle className="h-12 w-12 text-yellow-500 mb-4" />
      <h3 className="text-lg font-semibold mb-2">Unable to load chart</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">{errorMessage}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
