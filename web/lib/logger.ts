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

// #1073 (security-baseline.md): a single structured logger is the one
// redaction choke point — every field-name match below is stripped before
// emission, regardless of how deep it sits or which serializer put it
// there. #954 (PR #1069) made wrapped-error causes serialize via
// pino.stdSerializers.err, so enumerable fields on a driver error (which
// can legitimately carry a connectionString, a password, an Authorization
// header) now reach the log; this closes that gap rather than widening it
// further. fast-redact (pino's redact engine) wildcards one path segment
// at a time — `*` — so common nesting depths (a bare field, one level
// under an object, one level under err/error, and req.headers.*) are
// listed explicitly rather than relying on a single recursive pattern.
const REDACTED_FIELD_NAMES = ['password', 'secret', 'token', 'authorization', 'cookie', 'connectionString'];
const redactPaths = [
  ...REDACTED_FIELD_NAMES,
  ...REDACTED_FIELD_NAMES.map((f) => `*.${f}`),
  ...REDACTED_FIELD_NAMES.map((f) => `*.*.${f}`),
  ...REDACTED_FIELD_NAMES.map((f) => `err.${f}`),
  ...REDACTED_FIELD_NAMES.map((f) => `error.${f}`),
  'req.headers.authorization',
  'req.headers.cookie',
];

export const pinoOptions: pino.LoggerOptions = {
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
  redact: {
    paths: redactPaths,
    censor: '[Redacted]',
  },
};

export const logger = pino(pinoOptions);

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
