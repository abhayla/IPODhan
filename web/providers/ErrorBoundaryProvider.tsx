/**
 * Error Boundary Provider
 *
 * Global error boundary wrapper for the entire application
 */

'use client';

import { ReactNode } from 'react';
import { ErrorBoundary } from '@/components/error/ErrorBoundary';
// TEMPORARILY DISABLED: Sentry causing module loading errors
// import * as Sentry from '@sentry/nextjs';

interface ErrorBoundaryProviderProps {
  children: ReactNode;
}

export function ErrorBoundaryProvider({ children }: ErrorBoundaryProviderProps) {
  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Application Error:', {
        error,
        errorInfo,
        timestamp: new Date().toISOString(),
      });
    }

    // TEMPORARILY DISABLED: Sentry reporting
    // Report to Sentry in production
    // if (process.env.NODE_ENV === 'production') {
    //   Sentry.withScope((scope) => {
    //     scope.setContext('errorBoundary', {
    //       componentStack: errorInfo.componentStack,
    //     });
    //     Sentry.captureException(error);
    //   });
    // }
  };

  return (
    <ErrorBoundary onError={handleError}>
      {children}
    </ErrorBoundary>
  );
}