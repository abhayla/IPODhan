import pino from 'pino';

/**
 * Pino Logger Configuration
 *
 * Provides structured logging throughout the application.
 * In development: Uses simple JSON output (no worker threads)
 * In production: Outputs JSON for log aggregation
 *
 * Note: pino-pretty transport is NOT used as it relies on worker threads
 * which are incompatible with Next.js Turbopack in development mode
 */

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Custom stream for pretty console output in development
 * This avoids worker threads while providing readable logs
 */
const prettyStream = isDevelopment
  ? {
      write: (msg: string) => {
        try {
          const log = JSON.parse(msg);
          const { time, level, msg: message, ...rest } = log;

          // Map log level number to string
          const levelStr =
            typeof level === 'number'
              ? ['trace', 'debug', 'info', 'warn', 'error', 'fatal'][
                  Math.floor(level / 10) - 1
                ] || 'info'
              : String(level);

          // Color codes for terminal output
          const colors: Record<string, string> = {
            trace: '\x1b[90m', // gray
            debug: '\x1b[36m', // cyan
            info: '\x1b[32m', // green
            warn: '\x1b[33m', // yellow
            error: '\x1b[31m', // red
            fatal: '\x1b[35m', // magenta
          };
          const reset = '\x1b[0m';
          const color = colors[levelStr] || '';

          // Format timestamp
          let timestamp = '';
          if (typeof time === 'string') {
            timestamp = time.replace('T', ' ').slice(0, -5);
          } else if (typeof time === 'number') {
            timestamp = new Date(time).toISOString().replace('T', ' ').slice(0, -5);
          } else {
            timestamp = new Date().toISOString().replace('T', ' ').slice(0, -5);
          }

          // Build readable log message
          const contextKeys = Object.keys(rest).filter(
            (k) => !['pid', 'hostname'].includes(k)
          );
          const context =
            contextKeys.length > 0
              ? ` ${JSON.stringify(
                  contextKeys.reduce((acc, k) => ({ ...acc, [k]: rest[k] }), {})
                )}`
              : '';

          console.log(
            `${color}[${timestamp}] ${levelStr.toUpperCase()}${reset}: ${message}${context}`
          );
        } catch {
          // Fallback to original message if parsing fails
          console.log(msg);
        }
      },
    }
  : undefined;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  prettyStream
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
