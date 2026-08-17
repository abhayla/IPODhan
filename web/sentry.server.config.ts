/**
 * Sentry — Node.js server runtime initialization.
 *
 * Loaded from `instrumentation.ts` `register()` when NEXT_RUNTIME === 'nodejs',
 * per the Next.js 15 instrumentation-hook setup the disabled-Sentry TODO in
 * next.config.mjs asked for (T-178).
 *
 * DSN-gated: with neither SENTRY_DSN nor NEXT_PUBLIC_SENTRY_DSN set this is a
 * no-op, so local dev, CI, and any environment without a DSN behave exactly as
 * they did while Sentry was disabled. No secret is hardcoded — the DSN comes
 * from the environment only. Resolution order lives in lib/monitoring/sentry-env.
 */
import * as Sentry from '@sentry/nextjs';

import { resolveServerDsn, resolveTracesSampleRate } from './lib/monitoring/sentry-env';

const dsn = resolveServerDsn();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: resolveTracesSampleRate(),

    // Verbose SDK logging only when explicitly asked for.
    debug: false,
  });
}
