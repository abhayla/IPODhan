'use client';

/**
 * Global error boundary — the last line of defence for React rendering errors
 * in the App Router, including errors thrown in the root layout.
 *
 * Without this file, React render errors never reach Sentry; the build emits
 * an explicit "you don't have a global error handler set up" warning. Added as
 * part of T-178 (re-enabling Sentry).
 *
 * Must be a Client Component and must render its own <html>/<body>, because it
 * replaces the root layout when it fires.
 */
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Always log locally: captureException is a silent no-op when no DSN is
    // configured, which would otherwise leave a page-destroying render error
    // with no trace anywhere at all.
    console.error('[GlobalError] Unhandled render error:', error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ padding: '4rem 1.5rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>Something went wrong</h1>
          <p style={{ marginBottom: '1.5rem', color: '#555' }}>
            An unexpected error occurred. Our team has been notified.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '0.375rem',
              border: '1px solid #ccc',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
