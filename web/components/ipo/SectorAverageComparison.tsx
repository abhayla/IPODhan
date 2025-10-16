'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface SectorAverageComparisonProps {
  listingGainPercent: number;
  sectorAverageGain: number;
  sector: string;
}

/**
 * Format percentage with + or - sign
 */
const formatPercentage = (percent: number): string => {
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
};

/**
 * SectorAverageComparison Component
 *
 * Displays comparison of IPO's listing gain against sector average
 * - Shows sector average listing gain percentage
 * - Badge: "Above average" (green) or "Below average" (red)
 * - Helps investors understand relative performance
 *
 * @param listingGainPercent - IPO's listing gain percentage
 * @param sectorAverageGain - Sector's average listing gain percentage
 * @param sector - Sector name (e.g., "Technology", "Healthcare")
 */
export function SectorAverageComparison({
  listingGainPercent,
  sectorAverageGain,
  sector,
}: SectorAverageComparisonProps) {
  // Determine if IPO performed above or below sector average
  const isAboveAverage = listingGainPercent > sectorAverageGain;

  return (
    <div className="mt-6 p-4 rounded-lg bg-muted/30 border">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground mb-1">Historical Context</p>
          <p className="text-base font-medium">
            {sector} sector average listing gain:{' '}
            <span className="font-semibold">{formatPercentage(sectorAverageGain)}</span>
          </p>
        </div>
        <Badge
          className={cn(
            'inline-flex items-center gap-1 font-semibold border-2 px-3 py-1 text-sm',
            isAboveAverage
              ? 'bg-green-100 text-green-700 border-green-500'
              : 'bg-red-100 text-red-700 border-red-500'
          )}
        >
          {isAboveAverage ? 'Above average' : 'Below average'}
        </Badge>
      </div>
    </div>
  );
}
