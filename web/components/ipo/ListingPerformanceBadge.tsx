'use client';

import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ListingPerformanceBadgeProps {
  listingGainPercent: number;
  variant?: 'default' | 'compact';
  className?: string;
}

/**
 * ListingPerformanceBadge Component
 *
 * Displays listing day performance gain/loss with color coding and trend icons.
 * Used on historical IPO cards and listing performance sections.
 *
 * @param listingGainPercent - Percentage gain/loss on listing day
 * @param variant - Display variant: 'default' (with icon) or 'compact' (text only)
 * @param className - Additional CSS classes
 */
export function ListingPerformanceBadge({
  listingGainPercent,
  variant = 'default',
  className,
}: ListingPerformanceBadgeProps) {
  const isPositive = listingGainPercent >= 0;
  const formattedPercent = `${isPositive ? '+' : ''}${listingGainPercent.toFixed(1)}%`;

  const badgeStyles = isPositive
    ? 'bg-green-100 text-green-700 border-green-500'
    : 'bg-red-100 text-red-700 border-red-500';

  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

  return (
    <Badge
      variant="outline"
      data-testid="listing-performance-badge"
      className={cn(
        badgeStyles,
        'font-semibold border',
        variant === 'compact' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1',
        className
      )}
    >
      {variant === 'default' && (
        <TrendIcon className="mr-1 h-3 w-3" aria-hidden="true" />
      )}
      <span>{formattedPercent}</span>
      <span className="sr-only">
        Listing day {isPositive ? 'gain' : 'loss'} of {Math.abs(listingGainPercent).toFixed(1)} percent
      </span>
    </Badge>
  );
}
