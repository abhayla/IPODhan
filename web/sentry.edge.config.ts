import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV || 'development',

  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.3 : 1.0,

  // Error filtering
  beforeSend(event, hint) {
    // Filter out middleware errors for static assets
    if (event.request?.url?.includes('/_next/static/')) {
      return null;
    }

    return event;
  },

  // Enable debug mode in development
  debug: process.env.NODE_ENV === 'development',

  // Release tracking
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'development',
});
