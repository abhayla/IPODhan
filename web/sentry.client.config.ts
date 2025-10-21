import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment
  environment: process.env.NODE_ENV || 'development',

  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.3 : 1.0,

  // Session Replay
  replaysSessionSampleRate: 0.1, // 10% of sessions
  replaysOnErrorSampleRate: 1.0, // 100% of errors

  // Integrations
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
    Sentry.browserTracingIntegration({
      tracePropagationTargets: [
        'localhost',
        /^https:\/\/ipodhan\.com/,
        /^https:\/\/.*\.ipodhan\.com/,
      ],
    }),
  ],

  // Error filtering
  beforeSend(event, hint) {
    // Filter out known non-critical errors
    if (event.exception) {
      const error = hint.originalException as Error;

      // Ignore network errors from ad blockers
      if (error?.message?.includes('adsbygoogle') ||
          error?.message?.includes('blocked by ad blocker')) {
        return null;
      }

      // Ignore Next.js hydration warnings in dev
      if (process.env.NODE_ENV === 'development' &&
          error?.message?.includes('Hydration')) {
        return null;
      }

      // Ignore ResizeObserver errors (common browser quirk)
      if (error?.message?.includes('ResizeObserver')) {
        return null;
      }

      // Ignore chart rendering errors (recharts non-critical)
      if (error?.message?.includes('recharts') &&
          error?.message?.includes('null')) {
        return null;
      }
    }

    return event;
  },

  // Performance event filtering
  beforeSendTransaction(event) {
    // Don't send transactions for health checks
    if (event.transaction?.includes('/api/health')) {
      return null;
    }

    // Don't send transactions for static assets
    if (event.transaction?.includes('/_next/static/')) {
      return null;
    }

    return event;
  },

  // Enable debug mode in development
  debug: process.env.NODE_ENV === 'development',

  // Release tracking
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'development',
});
