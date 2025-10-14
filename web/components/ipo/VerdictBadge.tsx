/**
 * VerdictBadge Component (Story 4.7)
 * Displays IPO verdict with color-coded badge
 */

'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { IPOVerdict } from '@/lib/db/types';
import {
  getVerdictBgClass,
  getVerdictTextClass,
  getVerdictBorderClass,
} from '@/lib/utils/score-utils';

interface VerdictBadgeProps {
  verdict: IPOVerdict;
  size?: 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
  className?: string;
}

/**
 * VerdictBadge component displays IPO verdict recommendation
 * Color scheme: APPLY=green, CONSIDER=yellow, SKIP=red
 */
export function VerdictBadge({
  verdict,
  size = 'md',
  showTooltip = true,
  className = '',
}: VerdictBadgeProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5',
  };

  const verdictText = {
    APPLY: 'Apply',
    CONSIDER: 'Consider',
    SKIP: 'Skip',
  };

  const verdictDescriptions = {
    APPLY: 'Strong fundamentals and good subscription potential. Recommended for application.',
    CONSIDER: 'Mixed signals. Review details carefully before deciding.',
    SKIP: 'Weak fundamentals or poor valuation. Not recommended.',
  };

  const badge = (
    <div
      className={`
        inline-flex items-center gap-1 font-semibold rounded-full border
        ${getVerdictBgClass(verdict)}
        ${getVerdictTextClass(verdict)}
        ${getVerdictBorderClass(verdict)}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      <span>{verdictText[verdict]}</span>
    </div>
  );

  if (!showTooltip) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help">{badge}</div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs shadow-lg">
          <p className="text-sm font-medium">
            Verdict: {verdictText[verdict]}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {verdictDescriptions[verdict]}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
