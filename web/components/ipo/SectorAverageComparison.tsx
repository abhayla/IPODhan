'use client';

import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SectorAverageComparisonProps {
  listingGainPercent: number;
  sectorAverage: number | null;
  sector: string;
  className?: string;
}

/**
 * SectorAverageComparison Component
 *
 * Displays comparison of IPO listing performance against sector average.
 * Shows "Above Average" or "Below Average" badge with sector context.
 *
 * @param listingGainPercent - IPO's listing day gain percentage
 * @param sectorAverage - Sector average listing gain percentage
 * @param sector - IPO sector name
 * @param className - Additional CSS classes
 */
export function SectorAverageComparison({
  listingGainPercent,
  sectorAverage,
  sector,
  className,
}: SectorAverageComparisonProps) {
  // Don't render if sector average is not available
  if (sectorAverage === null) {
    return null;
  }

  const isAboveAverage = listingGainPercent >= sectorAverage;
  const difference = Math.abs(listingGainPercent - sectorAverage);

  const badgeStyles = isAboveAverage
    ? 'bg-green-100 text-green-700 border-green-500'
    : 'bg-red-100 text-red-700 border-red-500';

  const TrendIcon = isAboveAverage ? TrendingUp : TrendingDown;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className={cn(badgeStyles, 'font-semibold border')}>
          <TrendIcon className="mr-1 h-3 w-3" aria-hidden="true" />
          {isAboveAverage ? 'Above Average' : 'Below Average'}
        </Badge>
      </div>

      <div className="text-sm text-muted-foreground">
        <p>
          <span className="font-medium">{sector}</span> sector average:{' '}
          <span className="font-semibold">
            {sectorAverage >= 0 ? '+' : ''}
            {sectorAverage.toFixed(1)}%
          </span>
        </p>
        <p className="mt-1">
          This IPO performed{' '}
          <span className={cn('font-semibold', isAboveAverage ? 'text-green-700' : 'text-red-700')}>
            {difference.toFixed(1)}%
          </span>{' '}
          {isAboveAverage ? 'better' : 'worse'} than sector average
        </p>
      </div>
    </div>
  );
}
