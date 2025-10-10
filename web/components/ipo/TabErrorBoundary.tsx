/**
 * TabErrorBoundary Component
 *
 * Error boundary for IPO detail tabs to catch and handle errors gracefully
 * without crashing the entire page.
 *
 * Features:
 * - Catches errors during rendering, in lifecycle methods, and in constructors
 * - Displays user-friendly error message
 * - Provides retry functionality
 * - Logs errors for debugging
 */

'use client';

import React, { Component, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TabErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  tabName?: string;
}

interface TabErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class TabErrorBoundary extends Component<
  TabErrorBoundaryProps,
  TabErrorBoundaryState
> {
  constructor(props: TabErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): TabErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error details for debugging
    console.error('Tab Error Boundary caught an error:', error);
    console.error('Error Info:', errorInfo);

    // Update state with error info
    this.setState({
      errorInfo,
    });

    // TODO: Send error to error tracking service (e.g., Sentry)
    // Example: Sentry.captureException(error, { extra: errorInfo });
  }

  handleRetry = () => {
    // Reset error state to retry rendering
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    const { hasError, error } = this.state;
    const { children, fallback, tabName } = this.props;

    if (hasError) {
      // Custom fallback UI provided
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <div className="rounded-lg border-2 border-destructive/50 bg-card p-8 text-center space-y-4">
          <div className="flex justify-center">
            <div className="rounded-full bg-destructive/10 p-3">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-destructive">
              Failed to Load {tabName ? `${tabName} Tab` : 'Content'}
            </h3>
            <p className="text-sm text-muted-foreground">
              An error occurred while loading this tab. This could be due to a network issue or a temporary problem.
            </p>
            {error && process.env.NODE_ENV === 'development' && (
              <details className="mt-4 text-left">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                  Error Details (Development Only)
                </summary>
                <pre className="mt-2 rounded-md bg-muted p-4 text-xs text-destructive overflow-auto max-h-40">
                  {error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Button
              onClick={this.handleRetry}
              variant="default"
              size="default"
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Retry Loading
            </Button>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              size="default"
            >
              Reload Page
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mt-4">
            If the problem persists, please try again later or contact support.
          </p>
        </div>
      );
    }

    return children;
  }
}
