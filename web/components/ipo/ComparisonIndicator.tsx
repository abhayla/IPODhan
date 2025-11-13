/**
 * ComparisonIndicator Component
 *
 * Visual indicator showing how IPO metrics compare to industry average.
 * Features:
 * - Green for better than average
 * - Red for worse than average
 * - Neutral for within ±10% of average
 * - Up/down arrows
 * - Tooltip showing exact difference
 *
 * Story 4.8: Peer Comparison Tab
 */

'use client';

import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ==================== TYPES ====================

interface ComparisonIndicatorProps {
  value: number | null;
  average: number | null;
  higherIsBetter?: boolean; // Default true (for most metrics)
  className?: string;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate comparison result
 * @returns 'better' | 'worse' | 'neutral' | 'no-data'
 */
function getComparisonResult(
  value: number | null,
  average: number | null,
  higherIsBetter: boolean
): 'better' | 'worse' | 'neutral' | 'no-data' {
  if (value === null || average === null || average === 0) {
    return 'no-data';
  }

  const differencePercent = ((value - average) / Math.abs(average)) * 100;

  // Within ±10% is neutral
  if (Math.abs(differencePercent) <= 10) {
    return 'neutral';
  }

  // Higher value
  if (differencePercent > 0) {
    return higherIsBetter ? 'better' : 'worse';
  }

  // Lower value
  return higherIsBetter ? 'worse' : 'better';
}

/**
 * Calculate difference percentage
 */
function getDifferencePercent(
  value: number | null,
  average: number | null
): number | null {
  if (value === null || average === null || average === 0) {
    return null;
  }

  return ((value - average) / Math.abs(average)) * 100;
}

/**
 * Format difference for tooltip
 */
function formatDifference(
  value: number | null,
  average: number | null
): string {
  const diff = getDifferencePercent(value, average);
  if (diff === null) return 'N/A';

  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)}% vs average`;
}

// ==================== COMPONENT ====================

/**
 * ComparisonIndicator component
 * Shows colored indicator with arrow based on comparison to average
 */
export function ComparisonIndicator({
  value,
  average,
  higherIsBetter = true,
  className,
}: ComparisonIndicatorProps) {
  const result = getComparisonResult(value, average, higherIsBetter);
  const difference = formatDifference(value, average);

  // No data - show dash
  if (result === 'no-data') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-gray-600', className)}>
        <Minus className="h-3 w-3" />
      </span>
    );
  }

  // Determine color and icon
  let colorClass = 'text-gray-600';
  let Icon = Minus;

  if (result === 'better') {
    colorClass = 'text-green-600';
    Icon = ArrowUp;
  } else if (result === 'worse') {
    colorClass = 'text-red-600';
    Icon = ArrowDown;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex items-center gap-1', colorClass, className)}>
            <Icon className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">{difference}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
