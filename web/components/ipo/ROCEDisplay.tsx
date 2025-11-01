/**
 * ROCE Display Component (Story 4.10)
 *
 * Displays Return on Capital Employed percentage with color coding based on value.
 */

import { HiInformationCircle } from 'react-icons/hi2';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ROCEDisplayProps {
  roce: number | string | null;
  className?: string;
}

export function ROCEDisplay({ roce, className = '' }: ROCEDisplayProps) {
  // Handle null/undefined
  if (roce === null || roce === undefined) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="text-sm font-medium text-muted-foreground">ROCE:</span>
        <span className="text-sm text-muted-foreground">N/A</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <HiInformationCircle className="h-4 w-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-sm">
                <strong>Return on Capital Employed (ROCE)</strong> measures profitability and efficiency of capital usage.
                Higher percentages indicate better performance. Data not yet available for this IPO.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  // Convert to number and format with 2 decimals
  const roceValue = typeof roce === 'string' ? parseFloat(roce) : roce;
  const formattedRoce = roceValue.toFixed(2);

  // Color coding: Green (>15%), Yellow (10-15%), Red (<10%)
  let colorClass = 'text-foreground';
  let bgClass = '';
  if (roceValue > 15) {
    colorClass = 'text-green-700 dark:text-green-400';
    bgClass = 'bg-green-50 dark:bg-green-950/30';
  } else if (roceValue >= 10 && roceValue <= 15) {
    colorClass = 'text-yellow-700 dark:text-yellow-400';
    bgClass = 'bg-yellow-50 dark:bg-yellow-950/30';
  } else {
    colorClass = 'text-red-700 dark:text-red-400';
    bgClass = 'bg-red-50 dark:bg-red-950/30';
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-sm font-medium text-muted-foreground">ROCE:</span>
      <span
        className={`text-sm font-semibold px-2 py-0.5 rounded ${colorClass} ${bgClass}`}
      >
        {formattedRoce}%
      </span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <HiInformationCircle className="h-4 w-4 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-sm">
              <strong>Return on Capital Employed (ROCE)</strong> measures how efficiently a company uses its capital.
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              <li className="text-green-600">• &gt; 15%: Excellent capital efficiency</li>
              <li className="text-yellow-600">• 10-15%: Good performance</li>
              <li className="text-red-600">• &lt; 10%: Poor capital usage</li>
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Formula: EBIT / Capital Employed × 100
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
