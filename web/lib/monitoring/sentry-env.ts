/**
 * Sentry environment resolution — single source of truth.
 *
 * The DSN lookup order and the trace sample rate are read by four callers
 * (server config, edge config, client config, and isSentryInitialized). Keeping
 * them here stops the runtimes from silently diverging when one is changed.
 */

/**
 * Server/edge DSN. Prefers the non-public variable: NEXT_PUBLIC_* is inlined
 * into the client bundle, and only the browser genuinely needs that prefix.
 * Falls back to the public one so a single-variable setup still works.
 */
export function resolveServerDsn(): string | undefined {
  return process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
}

/**
 * Browser DSN. Must be NEXT_PUBLIC_-prefixed — a bare SENTRY_DSN is not
 * inlined into the client bundle and would read as undefined there.
 */
export function resolveClientDsn(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_DSN;
}

/**
 * 100% traces in development for debuggability; 10% in production to bound cost.
 */
export function resolveTracesSampleRate(): number {
  return process.env.NODE_ENV === 'development' ? 1.0 : 0.1;
}
