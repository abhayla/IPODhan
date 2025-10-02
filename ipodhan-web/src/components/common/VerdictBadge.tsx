import React from 'react';

export type Verdict = 'APPLY' | 'CONSIDER' | 'SKIP';

export interface VerdictBadgeProps {
  verdict: Verdict;
  score?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Get verdict display based on score or verdict value
 */
const getVerdictDisplay = (verdict: Verdict, score?: number) => {
  // If score provided, override verdict
  if (score !== undefined) {
    if (score >= 70) {
      return {
        label: 'Strong Buy',
        color: 'text-success-dark',
        bgColor: 'bg-success-light',
        borderColor: 'border-success',
      };
    } else if (score >= 50) {
      return {
        label: 'Consider',
        color: 'text-primary-700',
        bgColor: 'bg-primary-100',
        borderColor: 'border-primary-500',
      };
    } else if (score >= 30) {
      return {
        label: 'Risky',
        color: 'text-warning-dark',
        bgColor: 'bg-warning-light',
        borderColor: 'border-warning',
      };
    } else {
      return {
        label: 'Avoid',
        color: 'text-danger-dark',
        bgColor: 'bg-danger-light',
        borderColor: 'border-danger',
      };
    }
  }

  // Use verdict value
  switch (verdict) {
    case 'APPLY':
      return {
        label: 'Strong Buy',
        color: 'text-success-dark',
        bgColor: 'bg-success-light',
        borderColor: 'border-success',
      };
    case 'CONSIDER':
      return {
        label: 'Consider',
        color: 'text-primary-700',
        bgColor: 'bg-primary-100',
        borderColor: 'border-primary-500',
      };
    case 'SKIP':
      return {
        label: 'Avoid',
        color: 'text-danger-dark',
        bgColor: 'bg-danger-light',
        borderColor: 'border-danger',
      };
  }
};

/**
 * VerdictBadge Component
 * Displays recommendation verdict with color coding
 */
export const VerdictBadge: React.FC<VerdictBadgeProps> = ({
  verdict,
  score,
  size = 'md',
  className = '',
}) => {
  const display = getVerdictDisplay(verdict, score);

  const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-2',
  };

  return (
    <span
      className={`inline-flex items-center ${display.bgColor} ${display.color} ${display.borderColor} border rounded-full font-semibold ${sizeClasses[size]} ${className}`}
      role="status"
      aria-label={`Verdict: ${display.label}`}
    >
      {display.label}
    </span>
  );
};
