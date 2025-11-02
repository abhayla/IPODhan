/**
 * ChartErrorBoundary Component
 *
 * React Error Boundary specifically designed for chart components.
 * Provides graceful degradation when charts fail to render.
 *
 * Industry standard: Error boundaries prevent entire page crashes from
 * single component failures, improving overall application resilience.
 *
 * @example
 * ```tsx
 * <ChartErrorBoundary chartName="Revenue Trend">
 *   <LineChart data={data} />
 * </ChartErrorBoundary>
 * ```
 */

'use client';

import React, { Component, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

// ==================== TYPES ====================

interface ChartErrorBoundaryProps {
  /** Child components to wrap */
  children: ReactNode;
  /** Name of the chart for error messages */
  chartName?: string;
  /** Fallback component to render on error */
  fallback?: ReactNode;
  /** Custom error handler */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** Custom className */
  className?: string;
  /** Minimum height for error display (default: 300) */
  minHeight?: number;
}

interface ChartErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

// ==================== COMPONENT ====================

/**
 * ChartErrorBoundary
 *
 * Error boundary component for graceful chart failure handling.
 * Displays user-friendly error message with retry option.
 */
export class ChartErrorBoundary extends Component<
  ChartErrorBoundaryProps,
  ChartErrorBoundaryState
> {
  constructor(props: ChartErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  /**
   * Update state when error is caught
   */
  static getDerivedStateFromError(error: Error): Partial<ChartErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * Log error details and call custom error handler
   */
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Update state with error info
    this.setState({
      errorInfo,
    });

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ChartErrorBoundary caught an error:', error);
      console.error('Error Info:', errorInfo);
    }

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // TODO: Send to error tracking service (Sentry) in production
    // if (process.env.NODE_ENV === 'production') {
    //   captureException(error, { extra: errorInfo });
    // }
  }

  /**
   * Reset error state (for retry functionality)
   */
  resetErrorBoundary = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    const { hasError, error } = this.state;
    const { children, chartName, fallback, className, minHeight = 300 } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <ChartErrorFallback
          chartName={chartName}
          error={error}
          onReset={this.resetErrorBoundary}
          className={className}
          minHeight={minHeight}
        />
      );
    }

    return children;
  }
}

// ==================== ERROR FALLBACK UI ====================

interface ChartErrorFallbackProps {
  chartName?: string;
  error: Error | null;
  onReset: () => void;
  className?: string;
  minHeight: number;
}

/**
 * ChartErrorFallback
 *
 * User-friendly error display with retry option.
 */
function ChartErrorFallback({
  chartName = 'Chart',
  error,
  onReset,
  className,
  minHeight,
}: ChartErrorFallbackProps) {
  const isDevelopment = process.env.NODE_ENV === 'development';

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center',
        'rounded-lg border border-destructive/20 bg-destructive/5 p-8',
        'text-center',
        className
      )}
      style={{ minHeight: `${minHeight}px` }}
      role="alert"
      aria-live="assertive"
    >
      {/* Error Icon */}
      <div className="mb-4 rounded-full bg-destructive/10 p-3">
        <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
      </div>

      {/* Error Message */}
      <h3 className="mb-2 text-lg font-semibold text-destructive">
        {chartName} Failed to Load
      </h3>
      <p className="mb-4 max-w-md text-sm text-muted-foreground">
        We encountered an issue while rendering this chart. This could be due to invalid data or a
        temporary problem.
      </p>

      {/* Retry Button */}
      <button
        onClick={onReset}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-4 py-2',
          'bg-primary text-primary-foreground',
          'hover:bg-primary/90',
          'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
          'transition-colors duration-200'
        )}
        aria-label={`Retry loading ${chartName}`}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Retry
      </button>

      {/* Developer Error Details (Development Only) */}
      {isDevelopment && error && (
        <details className="mt-6 w-full max-w-2xl text-left">
          <summary className="cursor-pointer text-sm font-medium text-destructive hover:underline">
            Developer Details
          </summary>
          <div className="mt-2 rounded-md bg-muted p-4">
            <p className="text-xs font-mono text-foreground">
              <strong>Error:</strong> {error.message}
            </p>
            {error.stack && (
              <pre className="mt-2 overflow-auto text-xs text-muted-foreground">
                {error.stack}
              </pre>
            )}
          </div>
        </details>
      )}

      {/* Screen Reader Message */}
      <span className="sr-only">
        Error loading {chartName}. Click the retry button to try again.
      </span>
    </div>
  );
}

// ==================== EXPORTS ====================

export default ChartErrorBoundary;
