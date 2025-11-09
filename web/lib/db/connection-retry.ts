/**
 * Database Connection Retry Utility
 *
 * Handles transient database connection failures with exponential backoff.
 * Provides resilience against temporary issues like:
 * - Connection pool exhaustion
 * - Network timeouts
 * - Database restarts
 * - Lock wait timeouts
 *
 * Usage:
 * ```typescript
 * import { withRetry, RetryableError } from '@/lib/db/connection-retry';
 *
 * const result = await withRetry(
 *   async () => await db.select().from(ipos),
 *   { maxRetries: 3, context: 'fetching IPOs' }
 * );
 * ```
 *
 * @module lib/db/connection-retry
 */

/**
 * Error codes that indicate a retryable database error
 */
const RETRYABLE_ERROR_CODES = [
  '53300', // too_many_connections - pool exhausted
  '53400', // configuration_limit_exceeded - resource limit
  '08000', // connection_exception - network issue
  '08003', // connection_does_not_exist - connection lost
  '08006', // connection_failure - network failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08007', // transaction_resolution_unknown
  '40001', // serialization_failure - transaction conflict
  '40P01', // deadlock_detected - deadlock
  '55P03', // lock_not_available - lock timeout
  '57014', // query_canceled - query timeout
  'ECONNRESET', // Node.js connection reset
  'ETIMEDOUT', // Node.js connection timeout
  'ENOTFOUND', // Node.js DNS lookup failed
  'ECONNREFUSED', // Node.js connection refused
];

/**
 * Error messages that indicate a retryable error
 */
const RETRYABLE_ERROR_MESSAGES = [
  'too many clients already',
  'connection terminated',
  'connection timeout',
  'pool exhausted',
  'lock timeout',
  'deadlock detected',
  'serialization failure',
  'could not serialize access',
  'canceling statement due to lock timeout',
  'canceling statement due to statement timeout',
  'server closed the connection',
  'Connection terminated unexpectedly',
];

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;

  /** Initial delay in milliseconds (default: 100ms) */
  initialDelay?: number;

  /** Maximum delay in milliseconds (default: 5000ms) */
  maxDelay?: number;

  /** Exponential backoff multiplier (default: 2) */
  backoffMultiplier?: number;

  /** Add jitter to prevent thundering herd (default: true) */
  useJitter?: boolean;

  /** Context for logging (e.g., 'fetching IPOs', 'updating subscription') */
  context?: string;

  /** Custom function to determine if error is retryable */
  isRetryable?: (error: any) => boolean;

  /** Callback before each retry (for logging/monitoring) */
  onRetry?: (attempt: number, error: any, delay: number) => void;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: Required<Omit<RetryConfig, 'context' | 'onRetry'>> = {
  maxRetries: 3,
  initialDelay: 100, // 100ms
  maxDelay: 5000, // 5s
  backoffMultiplier: 2,
  useJitter: true,
  isRetryable: isRetryableError,
};

/**
 * Custom error class for retryable errors
 */
export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly originalError: any,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

/**
 * Custom error class for non-retryable errors
 */
export class NonRetryableError extends Error {
  constructor(
    message: string,
    public readonly originalError: any
  ) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * Determine if an error is retryable
 */
export function isRetryableError(error: any): boolean {
  if (!error) return false;

  // Check error code (PostgreSQL error codes)
  const errorCode = error.code || error.errno || '';
  if (RETRYABLE_ERROR_CODES.includes(errorCode)) {
    return true;
  }

  // Check error message
  const errorMessage = error.message || error.toString() || '';
  if (RETRYABLE_ERROR_MESSAGES.some(msg =>
    errorMessage.toLowerCase().includes(msg.toLowerCase())
  )) {
    return true;
  }

  // Check for Drizzle-specific errors
  if (error.name === 'DrizzleQueryError' && error.cause) {
    return isRetryableError(error.cause);
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  config: Required<Omit<RetryConfig, 'context' | 'onRetry'>>
): number {
  // Exponential backoff: delay = initialDelay * (backoffMultiplier ^ attempt)
  let delay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt);

  // Cap at maxDelay
  delay = Math.min(delay, config.maxDelay);

  // Add jitter (randomize ±20%) to prevent thundering herd
  if (config.useJitter) {
    const jitter = delay * 0.2; // 20% jitter
    delay = delay + (Math.random() * jitter * 2 - jitter);
  }

  return Math.floor(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a database operation with automatic retry on transient failures
 *
 * @param operation - Async function to execute (database query/mutation)
 * @param config - Retry configuration
 * @returns Promise with operation result
 * @throws NonRetryableError if max retries exceeded or non-retryable error
 *
 * @example
 * ```typescript
 * const ipos = await withRetry(
 *   async () => await db.select().from(ipos).where(eq(ipos.status, 'OPEN')),
 *   { maxRetries: 3, context: 'fetching open IPOs' }
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: any;

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      // Execute the operation
      return await operation();
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      const isRetryable = finalConfig.isRetryable(error);

      // Log error (first attempt = attempt 0)
      const context = config.context ? `[${config.context}] ` : '';
      if (attempt === 0) {
        console.error(
          `${context}Database operation failed (attempt ${attempt + 1}/${finalConfig.maxRetries + 1}):`,
          error instanceof Error ? error.message : String(error)
        );
      }

      // If not retryable, throw immediately
      if (!isRetryable) {
        throw new NonRetryableError(
          `${context}Non-retryable database error: ${error instanceof Error ? error.message : String(error)}`,
          error
        );
      }

      // If max retries reached, throw
      if (attempt >= finalConfig.maxRetries) {
        throw new NonRetryableError(
          `${context}Max retries (${finalConfig.maxRetries}) exceeded. Last error: ${error instanceof Error ? error.message : String(error)}`,
          error
        );
      }

      // Calculate delay for next retry
      const delay = calculateDelay(attempt, finalConfig);

      // Call onRetry callback if provided
      if (config.onRetry) {
        config.onRetry(attempt + 1, error, delay);
      }

      // Log retry attempt
      console.warn(
        `${context}Retrying in ${delay}ms (attempt ${attempt + 2}/${finalConfig.maxRetries + 1})...`
      );

      // Wait before retrying
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw new NonRetryableError(
    `${config.context ? `[${config.context}] ` : ''}Operation failed after ${finalConfig.maxRetries} retries`,
    lastError
  );
}

/**
 * Wrap a repository method with retry logic
 * Use this for creating retry-enabled repository methods
 *
 * @example
 * ```typescript
 * class IPORepository {
 *   findById = withRetryMethod(
 *     async (id: string) => {
 *       return await this.db.select().from(ipos).where(eq(ipos.id, id));
 *     },
 *     { context: 'IPORepository.findById' }
 *   );
 * }
 * ```
 */
export function withRetryMethod<TArgs extends any[], TResult>(
  method: (...args: TArgs) => Promise<TResult>,
  config: RetryConfig = {}
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    return withRetry(() => method(...args), config);
  };
}

/**
 * Get retry statistics for monitoring
 * Call this periodically to monitor retry behavior
 */
export interface RetryStats {
  totalRetries: number;
  retryReasons: Record<string, number>;
  avgRetryDelay: number;
  maxRetryAttempts: number;
}

// Global stats tracking
let retryStats: RetryStats = {
  totalRetries: 0,
  retryReasons: {},
  avgRetryDelay: 0,
  maxRetryAttempts: 0,
};

/**
 * Track retry attempt (call from onRetry callback)
 */
export function trackRetry(attempt: number, error: any, delay: number): void {
  retryStats.totalRetries++;

  const reason = error.code || error.message?.substring(0, 50) || 'unknown';
  retryStats.retryReasons[reason] = (retryStats.retryReasons[reason] || 0) + 1;

  retryStats.avgRetryDelay =
    (retryStats.avgRetryDelay * (retryStats.totalRetries - 1) + delay) / retryStats.totalRetries;

  retryStats.maxRetryAttempts = Math.max(retryStats.maxRetryAttempts, attempt);
}

/**
 * Get current retry statistics
 */
export function getRetryStats(): RetryStats {
  return { ...retryStats };
}

/**
 * Reset retry statistics (for testing)
 */
export function resetRetryStats(): void {
  retryStats = {
    totalRetries: 0,
    retryReasons: {},
    avgRetryDelay: 0,
    maxRetryAttempts: 0,
  };
}

/**
 * Health check for database connectivity with retry
 * Use this for readiness/liveness probes
 */
export async function healthCheck(db: any): Promise<{
  healthy: boolean;
  latency?: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    await withRetry(
      async () => {
        // Simple query to test connectivity
        const result = await db.execute('SELECT 1 as health_check');
        if (!result) {
          throw new Error('Health check query returned no result');
        }
      },
      {
        maxRetries: 2,
        initialDelay: 50,
        context: 'database health check',
      }
    );

    const latency = Date.now() - startTime;
    return { healthy: true, latency };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
