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
    // TEMPORARILY DISABLED: OpenTelemetry instrumentation causing build issues
    // const { startInstrumentation } = await import('./lib/monitoring/instrumentation');
    // startInstrumentation();
    console.log('[Instrumentation] OpenTelemetry disabled for load testing');
  }
}

/**
 * Optional: Called when the instrumentation is torn down
 */
export async function onRequestError(error: Error) {
  // Only run in Node.js runtime (not Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Log unhandled errors
    const { logger } = await import('./lib/logging/logger');
    logger.error('Unhandled request error', {
      message: error.message,
      stack: error.stack,
    });
  } else {
    // Fallback for Edge runtime
    console.error('Unhandled request error:', error.message);
  }
}
