/**
 * Next.js 15 Instrumentation Hook
 *
 * This file is automatically loaded by Next.js before the application starts.
 * Used to initialize OpenTelemetry APM instrumentation.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run in Node.js runtime (not Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Import and start OpenTelemetry instrumentation
    const { startInstrumentation } = await import('./lib/monitoring/instrumentation');
    startInstrumentation();
  }
}

/**
 * Optional: Called when the instrumentation is torn down
 */
export async function onRequestError(error: Error) {
  // Log unhandled errors
  const { logger } = await import('./lib/logging/logger');
  logger.error('Unhandled request error', {
    message: error.message,
    stack: error.stack,
  });
}
