/**
 * Sentry — browser/client initialization.
 *
 * Next.js 15 + Sentry SDK v10 load this file automatically on the client; it
 * replaces the legacy `sentry.client.config.ts` (which the stale
 * scripts/validate-sentry-setup.ts still looks for — see
 * docs/monitoring/webpack-session5-root-cause.md).
 *
 * DSN-gated: unset NEXT_PUBLIC_SENTRY_DSN means no init and no network calls.
 */
import * as Sentry from '@sentry/nextjs';

import { resolveClientDsn, resolveTracesSampleRate } from './lib/monitoring/sentry-env';

// The browser needs the NEXT_PUBLIC_-prefixed variable specifically — a bare
// SENTRY_DSN is not inlined into the client bundle.
const dsn = resolveClientDsn();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: resolveTracesSampleRate(),
    debug: false,
  });
}

// Instruments App Router client-side navigations for tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
