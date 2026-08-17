/**
 * Next.js 15 Instrumentation Hook
 *
 * This file is automatically loaded by Next.js before the application starts.
 * Used to initialize OpenTelemetry APM instrumentation.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import * as Sentry from '@sentry/nextjs';
import type { Instrumentation } from 'next';

export async function register() {
  // Only run in Node.js runtime (not Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // TEMPORARILY DISABLED: OpenTelemetry instrumentation causing build issues
    // const { startInstrumentation } = await import('./lib/monitoring/instrumentation');
    // startInstrumentation();
    console.log('[Instrumentation] OpenTelemetry disabled for load testing');

    // Non-fatal: a throwing instrumentation hook is a Next.js startup failure,
    // and PM2's autorestart would turn that into a restart loop. A malformed
    // DSN must degrade to "no monitoring", never take down the app it monitors.
    try {
      await import('./sentry.server.config');
    } catch (error) {
      console.error('[Instrumentation] Sentry server init failed (non-fatal):', error);
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    try {
      await import('./sentry.edge.config');
    } catch (error) {
      console.error('[Instrumentation] Sentry edge init failed (non-fatal):', error);
    }
  }
}

/**
 * Called by Next.js for errors thrown in Server Components, Route Handlers,
 * middleware, and other server-side code.
 *
 * Two sinks, deliberately: the project's structured logger (always) and Sentry
 * (a no-op unless a DSN is configured — see sentry.server.config.ts). Sentry is
 * forwarded first and guarded, so a monitoring failure can never swallow the
 * log line that operators actually rely on.
 *
 * The full (error, request, context) signature is required — Sentry's
 * captureRequestError needs the request/context to attribute the event to a
 * route and runtime.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  try {
    Sentry.captureRequestError(error, request, context);
  } catch (sentryError) {
    console.error('[Instrumentation] Sentry capture failed (non-fatal):', sentryError);
  }

  // Next.js types this as `unknown` and means it — a handler may throw a string,
  // null, or any non-Error value. Destructuring such a value would throw inside
  // the error handler itself and lose the log line entirely.
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logger } = await import('./lib/logging/logger');
    logger.error('Unhandled request error', { message, stack });
  } else {
    // Fallback for Edge runtime
    console.error('Unhandled request error:', message);
  }
};
