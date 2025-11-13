/**
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree
 * and displays a fallback UI instead of crashing the whole app
 */

'use client';

import React, { ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCw, Home, Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Update state with error info
    this.setState({
      error,
      errorInfo,
    });

    // Report to error tracking service (e.g., Sentry) in production
    if (process.env.NODE_ENV === 'production' && typeof window !== 'undefined') {
      // @ts-ignore - Sentry may be available globally
      if (window.Sentry) {
        // @ts-ignore
        window.Sentry.captureException(error, {
          contexts: {
            react: {
              componentStack: errorInfo.componentStack,
            },
          },
        });
      }
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI provided
      if (this.props.fallback) {
        return <>{this.props.fallback}</>;
      }

      // Default error UI
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background to-muted/20">
          <Card className="w-full max-w-lg shadow-xl border-destructive/20">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-3 bg-destructive/10 rounded-full w-fit">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <CardTitle className="text-2xl">Oops! Something went wrong</CardTitle>
              <CardDescription>
                We encountered an unexpected error. Don't worry, our team has been notified.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Bug className="h-4 w-4" />
                    <span>Error Details (Development Only)</span>
                  </div>
                  <pre className="text-xs overflow-auto p-2 bg-background rounded">
                    {this.state.error.toString()}
                  </pre>
                  {this.state.errorInfo && (
                    <details className="text-xs">
                      <summary className="cursor-pointer hover:text-primary">
                        Component Stack
                      </summary>
                      <pre className="mt-2 overflow-auto p-2 bg-background rounded">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <Button
                  onClick={this.handleReset}
                  variant="default"
                  className="w-full"
                >
                  <RotateCw className="mr-2 h-4 w-4" />
                  Try Again
                </Button>

                <Button
                  onClick={this.handleReload}
                  variant="outline"
                  className="w-full"
                >
                  Reload Page
                </Button>

                <Link href="/" className="w-full">
                  <Button variant="ghost" className="w-full">
                    <Home className="mr-2 h-4 w-4" />
                    Go to Homepage
                  </Button>
                </Link>
              </div>
            </CardContent>

            <CardFooter className="text-center text-sm text-muted-foreground">
              If this problem persists, please contact our support team
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook to use error boundary in functional components
 */
export function useErrorHandler() {
  return (error: Error) => {
    throw error; // This will be caught by the nearest error boundary
  };
}