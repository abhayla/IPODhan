'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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
  }, [error]);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <Alert variant="destructive" className="max-w-2xl">
          <AlertTriangle className="h-5 w-5" />
          <AlertTitle className="text-xl font-bold">Something went wrong!</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="mb-4">
              {error.message || 'Failed to load IPO dashboard. Please try again.'}
            </p>
            {error.digest && (
              <p className="text-sm text-muted-foreground mb-4">
                Error ID: {error.digest}
              </p>
            )}
            <Button onClick={reset} variant="outline">
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
