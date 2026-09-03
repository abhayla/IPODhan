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
  /** Shares per lot — used to derive the minimum when it is not stored. */
  lotSize?: number | null;
  /** Cap of the price band — used to derive the minimum when it is not stored. */
  priceRangeMax?: number | null;
  className?: string;
}

/**
 * W-85(a): `ipo_details.min_investment` is frequently empty even when the lot
 * size and the cap of the band are both known, which rendered "Not Available"
 * beside a fact ribbon that already showed the figure. Derive it (one lot at
 * the cap) rather than showing nothing; a stored value always wins.
 */
function resolveMinInvestment(
  stored: string | number | null | undefined,
  lotSize: number | null | undefined,
  priceRangeMax: number | null | undefined
): number | null {
  // Same truthiness gate the component always used, so a stored 0 / negative
  // keeps rendering exactly as before — only the empty case gains a fallback.
  if (stored) return parseFloat(stored.toString());

  const lots = typeof lotSize === 'number' ? lotSize : null;
  const cap = typeof priceRangeMax === 'number' ? priceRangeMax : null;
  if (lots === null || cap === null || lots <= 0 || cap <= 0) return null;

  const derived = lots * cap;
  return Number.isFinite(derived) ? derived : null;
}

export function MinimumInvestmentDisplay({
  minInvestment,
  lotSize = null,
  priceRangeMax = null,
  className = '',
}: MinimumInvestmentDisplayProps) {
  const investmentAmount = resolveMinInvestment(minInvestment, lotSize, priceRangeMax);

  if (investmentAmount === null) {
    return (
      <div className={`text-center ${className}`}>
        <p className="text-sm text-gray-500">Not Available</p>
      </div>
    );
  }

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
