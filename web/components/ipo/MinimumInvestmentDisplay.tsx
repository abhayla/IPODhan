/**
 * MinimumInvestmentDisplay Component (Story 4.11)
 *
 * Displays the minimum investment amount with a large, bold display.
 * Shows a warning badge if investment is >₹50,000.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface MinimumInvestmentDisplayProps {
  minInvestment: string | number | null | undefined;
  className?: string;
}

export function MinimumInvestmentDisplay({
  minInvestment,
  className = '',
}: MinimumInvestmentDisplayProps) {
  if (!minInvestment) {
    return (
      <div className={`text-center ${className}`}>
        <p className="text-sm text-gray-500">Not Available</p>
      </div>
    );
  }

  const investmentAmount = parseFloat(minInvestment.toString());
  const isHighInvestment = investmentAmount > 50000;

  return (
    <div className={`text-center ${className}`}>
      <div className="mb-2">
        <p className="text-sm text-gray-600 mb-1">Minimum Investment</p>
        <p className="text-3xl font-bold text-gray-900">
          ₹{investmentAmount.toLocaleString('en-IN')}
        </p>
      </div>

      {isHighInvestment && (
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span className="text-xs font-medium text-amber-800">
            High Investment
          </span>
        </div>
      )}

      {!isHighInvestment && (
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 rounded-full">
          <svg
            className="w-4 h-4 text-green-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          <span className="text-xs font-medium text-green-800">
            Accessible
          </span>
        </div>
      )}
    </div>
  );
}
