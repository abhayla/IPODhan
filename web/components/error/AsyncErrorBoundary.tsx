/**
 * Async Error Boundary Component
 *
 * Specialized error boundary for handling async errors and data fetching failures
 */

'use client';

import React, { ReactNode, Suspense } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { RotateCw } from 'lucide-react';

interface AsyncErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

/**
 * Default loading component
 */
const DefaultLoadingFallback = () => (
  <div className="flex items-center justify-center p-8">
    <RotateCw className="h-8 w-8 animate-spin text-primary" />
  </div>
);

/**
 * Async Error Boundary wraps components with both Suspense and ErrorBoundary
 * to handle both loading states and errors gracefully
 */
export function AsyncErrorBoundary({
  children,
  fallback,
  loadingFallback = <DefaultLoadingFallback />,
  onError,
}: AsyncErrorBoundaryProps) {
  return (
    <ErrorBoundary fallback={fallback} onError={onError}>
      <Suspense fallback={loadingFallback}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}