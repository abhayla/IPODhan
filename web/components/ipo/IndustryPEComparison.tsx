/**
 * Industry P/E Comparison Component (Story 4.10)
 *
 * Displays company P/E ratio compared to industry average with visual indicators.
 */

import { ArrowDown, ArrowUp, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface IndustryPEComparisonProps {
  companyPE: number | string | null;
  industryPE: number | string | null;
  className?: string;
}

export function IndustryPEComparison({
  companyPE,
  industryPE,
  className = '',
}: IndustryPEComparisonProps) {
  // Handle missing data
  if (!companyPE || !industryPE) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div>
          <span className="text-sm font-medium text-muted-foreground">Company P/E:</span>
          <span className="ml-2 text-sm">{companyPE ? Number(companyPE).toFixed(2) : 'N/A'}</span>
        </div>
        <div className="text-muted-foreground">|</div>
        <div>
          <span className="text-sm font-medium text-muted-foreground">Industry Avg:</span>
          <span className="ml-2 text-sm text-muted-foreground">N/A</span>
        </div>
      </div>
    );
  }

  const companyValue = typeof companyPE === 'string' ? parseFloat(companyPE) : companyPE;
  const industryValue = typeof industryPE === 'string' ? parseFloat(industryPE) : industryPE;

  // Calculate difference percentage
  const difference = ((companyValue - industryValue) / industryValue) * 100;
  const isOvervalued = companyValue > industryValue;

  // Determine indicator color
  const indicatorColor = isOvervalued
    ? 'text-red-600 dark:text-red-400'
    : 'text-green-600 dark:text-green-400';

  const Arrow = isOvervalued ? ArrowUp : ArrowDown;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div>
        <span className="text-sm font-medium text-muted-foreground">Company P/E:</span>
        <span className="ml-2 text-sm font-semibold">{companyValue.toFixed(2)}</span>
      </div>

      <div className="text-muted-foreground">vs</div>

      <div>
        <span className="text-sm font-medium text-muted-foreground">Industry Avg:</span>
        <span className="ml-2 text-sm font-semibold">{industryValue.toFixed(2)}</span>
      </div>

      <div className={`flex items-center gap-1 ${indicatorColor}`}>
        <Arrow className="h-4 w-4" />
        <span className="text-xs font-medium">{Math.abs(difference).toFixed(1)}%</span>
      </div>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-sm">
              <strong>P/E Ratio Comparison</strong>
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              <li className="text-green-600">
                • ↓ Below industry: Potentially undervalued
              </li>
              <li className="text-red-600">
                • ↑ Above industry: Potentially overvalued or high growth expectations
              </li>
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {isOvervalued
                ? `This IPO's P/E is ${Math.abs(difference).toFixed(1)}% higher than the industry average.`
                : `This IPO's P/E is ${Math.abs(difference).toFixed(1)}% lower than the industry average.`}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
