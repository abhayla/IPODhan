/**
 * Winston Structured Logging Configuration
 *
 * Provides structured logging with daily rotation, JSON formatting,
 * and separate error logs for production monitoring.
 *
 * NOTE: This module is Node.js-only and should not be imported in Edge Runtime.
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

// Ensure we're in Node.js runtime
if (typeof process === 'undefined' || !process.cwd) {
  throw new Error('Logger requires Node.js runtime');
}

// Log format with timestamp and JSON structure
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Console format for development (human-readable)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}] ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create logger instance
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'ipodhan-web' },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: consoleFormat,
      silent: process.env.NODE_ENV === 'test', // Silence in tests
    }),

    // Daily rotate file for all logs
    new DailyRotateFile({
      filename: path.join(process.cwd(), 'logs', 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      level: 'info',
      format: logFormat,
    }),

    // Daily rotate file for error logs
    new DailyRotateFile({
      filename: path.join(process.cwd(), 'logs', 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      level: 'error',
      format: logFormat,
    }),

    // Performance logs (separate file)
    new DailyRotateFile({
      filename: path.join(process.cwd(), 'logs', 'performance-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '7d',
      level: 'debug',
      format: logFormat,
    }),
  ],
});

/**
 * Log performance metrics
 */
export function logPerformance(
  operation: string,
  duration: number,
  metadata?: Record<string, unknown>
) {
  logger.debug('Performance metric', {
    operation,
    duration,
    unit: 'ms',
    ...metadata,
  });
}

/**
 * Log error with context
 */
export function logError(error: Error, context?: Record<string, unknown>) {
  logger.error('Application error', {
    message: error.message,
    stack: error.stack,
    name: error.name,
    ...context,
  });
}

/**
 * Log database query
 */
export function logQuery(
  queryName: string,
  duration: number,
  success: boolean,
  metadata?: Record<string, unknown>
) {
  const level = success ? 'info' : 'error';
  logger.log(level, 'Database query', {
    query: queryName,
    duration,
    success,
    ...metadata,
  });
}

/**
 * Log cache operation
 */
export function logCache(
  operation: 'HIT' | 'MISS' | 'SET' | 'DEL' | 'ERROR',
  key: string,
  metadata?: Record<string, unknown>
) {
  logger.debug('Cache operation', {
    operation,
    key,
    ...metadata,
  });
}

/**
 * Log API request
 */
export function logRequest(
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  metadata?: Record<string, unknown>
) {
  logger.info('API request', {
    method,
    path,
    statusCode,
    duration,
    ...metadata,
  });
}

/**
 * Log business metric
 */
export function logBusinessMetric(
  metric: string,
  value: number | string,
  metadata?: Record<string, unknown>
) {
  logger.info('Business metric', {
    metric,
    value,
    ...metadata,
  });
}

/**
 * Log scraper activity
 */
export function logScraper(
  scraper: string,
  status: 'START' | 'SUCCESS' | 'FAILED',
  metadata?: Record<string, unknown>
) {
  const level = status === 'FAILED' ? 'error' : 'info';
  logger.log(level, 'Scraper activity', {
    scraper,
    status,
    ...metadata,
  });
}

/**
 * Create child logger with additional context
 */
export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

export default logger;
