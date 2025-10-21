import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV || 'development',

  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.3 : 1.0,

  // Database query tracking
  integrations: [
    Sentry.postgresIntegration({
      // Track database queries
    }),
  ],

  // Error filtering for server
  beforeSend(event, hint) {
    // Filter out known non-critical errors
    const error = hint.originalException as Error;

    // Ignore Redis connection warnings (we have graceful fallback)
    if (error?.message?.includes('Redis') &&
        (error?.message?.includes('Connection') ||
         error?.message?.includes('ECONNREFUSED'))) {
      console.warn('[Sentry] Filtered Redis connection warning');
      return null;
    }

    // Ignore database connection pool warnings (expected under load)
    if (error?.message?.includes('remaining connection slots are reserved') ||
        error?.message?.includes('too many clients')) {
      console.warn('[Sentry] Filtered database connection pool warning');
      return null;
    }

    // Ignore scraper timeout errors (handled by retry logic)
    if (error?.message?.includes('scraper') &&
        error?.message?.includes('timeout')) {
      return null;
    }

    return event;
  },

  // Performance event filtering
  beforeSendTransaction(event) {
    // Don't send transactions for health checks
    if (event.transaction?.includes('/api/health') ||
        event.transaction?.includes('/api/metrics') ||
        event.transaction?.includes('/monitoring')) {
      return null;
    }

    return event;
  },

  // Enable debug mode in development
  debug: process.env.NODE_ENV === 'development',

  // Release tracking
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'development',

  // Server-specific options
  tracesSampler(samplingContext) {
    // Sample 100% of errors
    if (samplingContext.transactionContext.name?.includes('error')) {
      return 1.0;
    }

    // Sample 100% of slow transactions (>1s)
    if (samplingContext.parentSampled !== undefined) {
      return samplingContext.parentSampled ? 1.0 : 0;
    }

    // Default sample rate
    return process.env.NODE_ENV === 'production' ? 0.3 : 1.0;
  },
});
