import pino from 'pino';

/**
 * Pino Logger Configuration
 *
 * Provides structured logging throughout the application.
 * In development: Direct console output (no worker threads, no streams)
 * In production: Outputs JSON for log aggregation
 *
 * CRITICAL: Does NOT use pino-pretty, custom streams, or any worker threads
 * to maintain compatibility with Next.js Turbopack in development mode
 */

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    browser: {
      asObject: true,
    },
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  }
);

/**
 * Create a child logger with context
 *
 * @param context - Additional context to include in all log messages
 * @returns Child logger instance
 *
 * @example
 * const requestLogger = createLogger({ requestId: '123', userId: 'abc' });
 * requestLogger.info('Processing request');
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

export default logger;
