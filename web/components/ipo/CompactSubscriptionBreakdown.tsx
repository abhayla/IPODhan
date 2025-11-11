'use client';

import { Subscription } from '@/lib/db/types';
import { cn } from '@/lib/utils';

interface CompactSubscriptionBreakdownProps {
  subscription: Subscription | null;
  className?: string;
}

/**
 * Compact Subscription Breakdown
 * Phase 1: Visual Identity Revolution - Layer 2 (Hover State)
 *
 * Features:
 * - Mini version for card hover state
 * - Shows QIB, NII, Retail with color-coded bars
 * - Compact layout (single line per category)
 */
export function CompactSubscriptionBreakdown({
  subscription,
  className,
}: CompactSubscriptionBreakdownProps) {
  if (!subscription) {
    return (
      <div className={cn('text-xs text-muted-foreground', className)}>
        No subscription data
      </div>
    );
  }

  const categories = [
    {
      label: 'QIB',
      value: subscription.qibSubscription,
      fullLabel: 'Qualified Institutional Buyers',
    },
    {
      label: 'NII',
      value: subscription.niiSubscription,
      fullLabel: 'Non-Institutional Investors',
    },
    {
      label: 'Retail',
      value: subscription.retailSubscription,
      fullLabel: 'Retail Individual Investors',
    },
  ];

  const getBarColor = (value: number | string | null) => {
    if (value === null) return 'bg-muted-foreground/20';
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (numValue >= 2) return 'bg-success'; // Strong demand
    if (numValue >= 1) return 'bg-accent'; // Good demand
    if (numValue >= 0.5) return 'bg-secondary'; // Moderate
    return 'bg-danger/70'; // Weak
  };

  const getBarWidth = (value: number | string | null) => {
    if (value === null) return '0%';
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    // Scale: 0-5x maps to 0-100%
    const percentage = Math.min((numValue / 5) * 100, 100);
    return `${percentage}%`;
  };

  const formatValue = (value: number | string | null) => {
    if (value === null) return '0.00';
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return numValue.toFixed(2);
  };

  return (
    <div className={cn('space-y-2', className)}>
      {categories.map((category) => (
        <div key={category.label} className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground/90" title={category.fullLabel}>
              {category.label}
            </span>
            <span className="text-xs font-bold tabular-nums">
              {formatValue(category.value)}x
            </span>
          </div>
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted/30">
            <div
              className={cn('h-full transition-all duration-300', getBarColor(category.value))}
              style={{ width: getBarWidth(category.value) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
