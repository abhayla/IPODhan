import pino from 'pino';

/**
 * Pino Logger Configuration
 *
 * Provides structured logging throughout the application.
 * In development: Uses pino-pretty for human-readable output
 * In production: Outputs JSON for log aggregation
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

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
export function createLogger(context: Record<string, any>) {
  return logger.child(context);
}

export default logger;
