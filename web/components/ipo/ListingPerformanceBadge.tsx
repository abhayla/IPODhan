'use client';

import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ListingPerformanceBadgeProps {
  listingGainPercent: number;
  size?: 'small' | 'medium' | 'large';
  showIcon?: boolean;
}

/**
 * ListingPerformanceBadge Component
 *
 * Displays listing day performance with color-coded gains/losses
 * - Green for positive gains (+X.X%)
 * - Red for negative losses (-X.X%)
 * - Icons: TrendingUp for gains, TrendingDown for losses
 *
 * @param listingGainPercent - Percentage gain/loss from issue price to listing close
 * @param size - Badge size variant (small: 14px, medium: 18px, large: 24px)
 * @param showIcon - Whether to display trending icon (default: true)
 */
export function ListingPerformanceBadge({
  listingGainPercent,
  size = 'medium',
  showIcon = true,
}: ListingPerformanceBadgeProps) {
  // Don't render if listingGainPercent is null or undefined
  if (listingGainPercent === null || listingGainPercent === undefined) {
    return null;
  }

  const isPositive = listingGainPercent > 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;

  // Size-specific styles
  const sizeClasses = {
    small: 'text-sm px-2 py-0.5',
    medium: 'text-base px-3 py-1',
    large: 'text-2xl px-4 py-2',
  };

  const iconSizeClasses = {
    small: 'h-3 w-3',
    medium: 'h-4 w-4',
    large: 'h-6 w-6',
  };

  // Color classes based on positive/negative gain
  const colorClasses = isPositive
    ? 'bg-green-100 text-green-700 border-green-500'
    : 'bg-red-100 text-red-700 border-red-500';

  return (
    <Badge
      className={cn(
        'inline-flex items-center gap-1 font-semibold border-2',
        sizeClasses[size],
        colorClasses
      )}
    >
      {showIcon && <Icon className={iconSizeClasses[size]} aria-hidden="true" />}
      <span>
        {isPositive ? '+' : ''}
        {listingGainPercent.toFixed(2)}%
      </span>
    </Badge>
  );
}
