/**
 * Sentry — Edge runtime initialization (middleware, edge routes).
 *
 * Loaded from `instrumentation.ts` `register()` when NEXT_RUNTIME === 'edge'.
 * DSN-gated exactly like the server config — see sentry.server.config.ts.
 */
import * as Sentry from '@sentry/nextjs';

import { resolveServerDsn, resolveTracesSampleRate } from './lib/monitoring/sentry-env';

const dsn = resolveServerDsn();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: resolveTracesSampleRate(),
    debug: false,
  });
}
