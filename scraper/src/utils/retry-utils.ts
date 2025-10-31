/**
 * Retry Utility
 *
 * Provides exponential backoff retry logic for failed operations
 */

import { logger } from './logger.js';

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  exponentialBackoff?: boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  delayMs: 1000,
  exponentialBackoff: true,
  onRetry: () => {},
};

/**
 * Execute a function with retry logic
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Result of the function execution
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === opts.maxAttempts) {
        logger.error(
          {
            attempts: attempt,
            error: lastError.message,
          },
          'All retry attempts failed'
        );
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = opts.exponentialBackoff
        ? opts.delayMs * Math.pow(2, attempt - 1)
        : opts.delayMs;

      logger.warn(
        {
          attempt,
          maxAttempts: opts.maxAttempts,
          delay,
          error: lastError.message,
        },
        'Retrying after failure'
      );

      opts.onRetry(attempt, lastError);

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here
  throw lastError || new Error('Retry failed with unknown error');
}
