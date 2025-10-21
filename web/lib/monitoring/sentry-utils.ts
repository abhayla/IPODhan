/**
 * Sentry Utility Functions
 *
 * Custom instrumentation helpers for error tracking and performance monitoring
 */

import * as Sentry from '@sentry/nextjs';

/**
 * API Error Context
 */
export interface APIErrorContext {
  endpoint: string;
  method: string;
  statusCode?: number;
  userId?: string;
  requestId?: string;
  queryParams?: Record<string, any>;
  body?: Record<string, any>;
}

/**
 * Capture API errors with context
 *
 * Usage:
 * ```typescript
 * try {
 *   // API logic
 * } catch (error) {
 *   captureAPIError(error as Error, {
 *     endpoint: '/api/ipos',
 *     method: 'GET',
 *     statusCode: 500
 *   });
 * }
 * ```
 */
export function captureAPIError(
  error: Error,
  context: APIErrorContext
): string {
  const eventId = Sentry.captureException(error, {
    tags: {
      api_endpoint: context.endpoint,
      http_method: context.method,
      status_code: context.statusCode?.toString(),
      user_id: context.userId,
    },
    extra: {
      requestId: context.requestId,
      queryParams: context.queryParams,
      body: context.body,
      timestamp: new Date().toISOString(),
    },
    level: context.statusCode && context.statusCode >= 500 ? 'error' : 'warning',
  });

  return eventId;
}

/**
 * Track performance for critical operations
 *
 * Usage:
 * ```typescript
 * const result = await trackPerformance(
 *   'fetch-ipo-data',
 *   async () => {
 *     return await ipoRepository.findBySlug(slug);
 *   },
 *   { category: 'database', operation: 'query' }
 * );
 * ```
 */
export async function trackPerformance<T>(
  operation: string,
  fn: () => Promise<T>,
  tags?: Record<string, string>
): Promise<T> {
  const span = Sentry.startInactiveSpan({
    op: 'function',
    name: operation,
    attributes: tags,
  });

  try {
    const result = await fn();
    span?.end();
    return result;
  } catch (error) {
    span?.setStatus({ code: 2, message: 'internal_error' });
    span?.end();
    throw error;
  }
}

/**
 * Track synchronous performance
 */
export function trackSyncPerformance<T>(
  operation: string,
  fn: () => T,
  tags?: Record<string, string>
): T {
  const span = Sentry.startInactiveSpan({
    op: 'function',
    name: operation,
    attributes: tags,
  });

  try {
    const result = fn();
    span?.end();
    return result;
  } catch (error) {
    span?.setStatus({ code: 2, message: 'internal_error' });
    span?.end();
    throw error;
  }
}

/**
 * Set user context for error tracking
 *
 * Usage:
 * ```typescript
 * // In middleware or API route
 * setUserContext('user-123', 'user@example.com', { plan: 'premium' });
 * ```
 */
export function setUserContext(
  userId: string,
  email?: string,
  additionalData?: Record<string, any>
) {
  Sentry.setUser({
    id: userId,
    email,
    ...additionalData,
  });
}

/**
 * Clear user context (e.g., on logout)
 */
export function clearUserContext() {
  Sentry.setUser(null);
}

/**
 * Add breadcrumb for debugging
 *
 * Usage:
 * ```typescript
 * addBreadcrumb('User searched for IPO', {
 *   query: 'TCS',
 *   resultsCount: 5
 * });
 * ```
 */
export function addBreadcrumb(
  message: string,
  data?: Record<string, any>,
  level?: 'debug' | 'info' | 'warning' | 'error'
) {
  Sentry.addBreadcrumb({
    message,
    level: level || 'info',
    data,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Capture database query errors
 */
export function captureDatabaseError(
  error: Error,
  context: {
    query: string;
    table: string;
    operation: 'select' | 'insert' | 'update' | 'delete';
    duration?: number;
  }
): string {
  return Sentry.captureException(error, {
    tags: {
      error_type: 'database',
      table: context.table,
      operation: context.operation,
    },
    extra: {
      query: context.query,
      duration: context.duration,
      timestamp: new Date().toISOString(),
    },
    level: 'error',
  });
}

/**
 * Capture cache errors (Redis)
 */
export function captureCacheError(
  error: Error,
  context: {
    operation: 'get' | 'set' | 'delete' | 'connection';
    key?: string;
    ttl?: number;
  }
): string {
  // Only capture if not a connection error (we have graceful fallback)
  if (context.operation === 'connection') {
    // Log but don't send to Sentry (too noisy)
    console.warn('[Redis] Connection error:', error.message);
    return '';
  }

  return Sentry.captureException(error, {
    tags: {
      error_type: 'cache',
      cache_operation: context.operation,
    },
    extra: {
      key: context.key,
      ttl: context.ttl,
      timestamp: new Date().toISOString(),
    },
    level: 'warning',
  });
}

/**
 * Capture scraper errors
 */
export function captureScraperError(
  error: Error,
  context: {
    scraper: 'nse' | 'bse' | 'moneycontrol' | 'chittorgarh';
    url?: string;
    retryCount?: number;
    statusCode?: number;
  }
): string {
  return Sentry.captureException(error, {
    tags: {
      error_type: 'scraper',
      scraper: context.scraper,
      retry_count: context.retryCount?.toString(),
      status_code: context.statusCode?.toString(),
    },
    extra: {
      url: context.url,
      timestamp: new Date().toISOString(),
    },
    level: context.retryCount && context.retryCount > 2 ? 'error' : 'warning',
  });
}

/**
 * Measure and report custom metrics
 * NOTE: Temporarily disabled - Sentry.metrics not available in current version
 */
export function reportMetric(
  name: string,
  value: number,
  unit: 'millisecond' | 'byte' | 'none' = 'none',
  tags?: Record<string, string>
) {
  // Sentry.metrics.gauge(name, value, {
  //   unit,
  //   tags,
  // });
  console.log(`[Metric] ${name}: ${value}${unit !== 'none' ? unit : ''}`, tags);
}

/**
 * Track business metrics
 */
export function trackBusinessMetric(
  metric: 'ipo_view' | 'comparison_used' | 'calculator_used' | 'broker_click',
  data?: Record<string, any>
) {
  addBreadcrumb(`Business metric: ${metric}`, data, 'info');

  // Also send as custom metric
  // NOTE: Temporarily disabled - Sentry.metrics not available in current version
  // Sentry.metrics.increment(metric, 1, {
  //   tags: data,
  // });
  console.log(`[Business Metric] ${metric}`, data);
}

/**
 * Create error boundary for React components
 */
export function createErrorBoundary(componentName: string) {
  return (error: Error, errorInfo: { componentStack: string }) => {
    Sentry.captureException(error, {
      tags: {
        error_type: 'react_error_boundary',
        component: componentName,
      },
      extra: {
        componentStack: errorInfo.componentStack,
      },
      level: 'error',
    });
  };
}

/**
 * Wrap async handler with automatic error capture
 *
 * Usage:
 * ```typescript
 * export const GET = withSentryErrorHandler(
 *   async (request: NextRequest) => {
 *     // API logic
 *   },
 *   { endpoint: '/api/ipos', method: 'GET' }
 * );
 * ```
 */
export function withSentryErrorHandler<T extends (...args: any[]) => Promise<any>>(
  handler: T,
  context: Omit<APIErrorContext, 'statusCode'>
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (error) {
      captureAPIError(error as Error, {
        ...context,
        statusCode: 500,
      });
      throw error;
    }
  }) as T;
}

/**
 * Check if Sentry is properly initialized
 */
export function isSentryInitialized(): boolean {
  return !!process.env.NEXT_PUBLIC_SENTRY_DSN;
}

/**
 * Get Sentry hub for advanced usage
 */
export function getSentryHub() {
  // NOTE: getCurrentHub() deprecated in newer Sentry versions
  // Return a mock hub for compatibility
  return null;
}
