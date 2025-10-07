'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import * as Sentry from '@sentry/nextjs';

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to console in development
    console.error('Dashboard error:', error);

    // Log to Sentry in production
    if (process.env.NODE_ENV === 'production') {
      Sentry.captureException(error, {
        tags: {
          errorDigest: error.digest,
          page: 'dashboard',
        },
      });
    }
  }, [error]);

  const getUserFriendlyMessage = () => {
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return 'Unable to connect to the server. Please check your internet connection.';
    }
    if (error.message.includes('timeout')) {
      return 'Request timed out. The server took too long to respond.';
    }
    return error.message || 'Failed to load IPO dashboard. Please try again.';
  };

  return (
    <div className="container mx-auto px-4 py-8" role="alert" aria-live="assertive">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle className="text-xl font-bold">Something went wrong!</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="mb-4">
              {getUserFriendlyMessage()}
            </p>
            {error.digest && (
              <p className="text-sm text-muted-foreground mb-4">
                Error ID: {error.digest}
              </p>
            )}
            {process.env.NODE_ENV === 'development' && (
              <details className="mb-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Technical details (development only)
                </summary>
                <pre className="mt-2 text-xs overflow-auto p-2 bg-black/10 rounded max-h-40">
                  {error.stack || error.message}
                </pre>
              </details>
            )}
            <div className="flex gap-2">
              <Button onClick={reset} variant="outline" className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Try Again
              </Button>
              <Button onClick={() => (window.location.href = '/')} variant="ghost" className="gap-2">
                <Home className="h-4 w-4" />
                Go Home
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
