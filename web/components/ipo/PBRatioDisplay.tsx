/**
 * P/B Ratio Display Component (Story 4.10)
 *
 * Displays Price-to-Book ratio with tooltip explaining the metric.
 */

import { InfoIcon } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface PBRatioDisplayProps {
  pbRatio: number | string | null;
  className?: string;
}

export function PBRatioDisplay({ pbRatio, className = '' }: PBRatioDisplayProps) {
  // Handle null/undefined
  if (pbRatio === null || pbRatio === undefined) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-sm font-medium text-muted-foreground">P/B Ratio:</span>
        <span className="text-sm text-muted-foreground">N/A</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <InfoIcon className="h-4 w-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-sm">
                <strong>Price-to-Book Ratio</strong> compares a company's stock price to its book value per share.
                Lower ratios may indicate undervaluation. Data not yet available for this IPO.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // Convert to number and format with 2 decimals
  const ratio = typeof pbRatio === 'string' ? parseFloat(pbRatio) : pbRatio;
  const formattedRatio = ratio.toFixed(2);

  // Color coding: Green (<2.0), Yellow (2.0-4.0), Red (>4.0)
  let colorClass = 'text-foreground';
  if (ratio < 2.0) {
    colorClass = 'text-green-600 dark:text-green-500';
  } else if (ratio >= 2.0 && ratio <= 4.0) {
    colorClass = 'text-yellow-600 dark:text-yellow-500';
  } else {
    colorClass = 'text-red-600 dark:text-red-500';
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-sm font-medium text-muted-foreground">P/B Ratio:</span>
      <span className={`text-sm font-semibold ${colorClass}`}>{formattedRatio}</span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <InfoIcon className="h-4 w-4 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-sm">
              <strong>Price-to-Book Ratio</strong> compares stock price to book value per share.
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              <li className="text-green-600">• &lt; 2.0: Potentially attractive valuation</li>
              <li className="text-yellow-600">• 2.0-4.0: Fair valuation</li>
              <li className="text-red-600">• &gt; 4.0: Premium valuation</li>
            </ul>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
