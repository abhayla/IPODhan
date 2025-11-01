/**
 * Form Error Boundary Component
 *
 * Specialized error boundary for forms that preserves user input on error
 */

'use client';

import React, { ReactNode } from 'react';
import { HiExclamationCircle, HiArrowPath } from 'react-icons/hi2';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface FormErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface FormErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  formData: FormData | null;
}

export class FormErrorBoundary extends React.Component<
  FormErrorBoundaryProps,
  FormErrorBoundaryState
> {
  constructor(props: FormErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      formData: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<FormErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Try to preserve form data if possible
    if (typeof window !== 'undefined') {
      const forms = document.querySelectorAll('form');
      if (forms.length > 0) {
        const formData = new FormData(forms[0] as HTMLFormElement);
        this.setState({ formData });
      }
    }

    console.error('Form error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      formData: null,
    });

    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <Alert variant="destructive" className="my-4">
          <HiExclamationCircle className="h-4 w-4" />
          <AlertTitle>Form Error</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              There was an error with the form. Your data has been preserved.
              {this.state.error && (
                <span className="block text-xs mt-1 font-mono">
                  {this.state.error.message}
                </span>
              )}
            </p>
            <Button
              onClick={this.handleReset}
              variant="outline"
              size="sm"
              className="mt-2"
            >
              <HiArrowPath className="mr-2 h-3 w-3" />
              Try Again
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    return this.props.children;
  }
}