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
    // Every logged Error loses its cause without this (signal-ownership R6:
    // "failures carry their cause"). Plain JSON.stringify(err) on a native
    // Error/TypeError returns `{}` — `message` and `stack` are non-enumerable
    // per spec, so only plain-assigned fields (e.g. `name`) survive. Repo code
    // logs errors under both `error` and `err` keys (`logger.error({ error }, ...)`
    // is the dominant call shape here); pino's own `err` serializer only binds to
    // the literal `err` key by default, so `error`-keyed calls got zero
    // protection. pino.stdSerializers.err walks message/stack/name AND any
    // wrapped `.cause`/other own-enumerable fields (e.g. NonRetryableError's
    // `originalError`), so a wrapped DatabaseError -> TypeError chain now reads
    // as real text instead of `{}` (#954).
    serializers: {
      error: pino.stdSerializers.err,
      err: pino.stdSerializers.err,
    },
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
