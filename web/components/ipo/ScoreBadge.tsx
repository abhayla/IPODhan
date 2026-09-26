/**
 * ScoreBadge Component (Story 4.7)
 * Displays IPO total score with color-coded badge
 */

'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  getScoreBgClass,
  getScoreTextClass,
  getScoreBorderClass,
  formatScore,
  getScoreCategory,
} from '@/lib/utils/score-utils';

interface ScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
  className?: string;
}

/**
 * ScoreBadge component displays IPO total score on the 0-10 scale
 * `/api/ipos/[slug]/score` and IPOScoreSection use (OD-125, #167) — a stored
 * `ipo_scores` row (0-100 raw) is converted via `adaptStoredScore(...)`
 * before it reaches this component; callers never pass the raw column.
 * Color scheme: 0-2.5=red, 2.6-5=orange, 5.1-7.5=yellow, 7.6-10=green
 */
export function ScoreBadge({
  score,
  size = 'md',
  showTooltip = true,
  className = '',
}: ScoreBadgeProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5',
  };

  const badge = (
    <div
      className={`
        inline-flex items-center gap-1 font-semibold rounded-full border
        ${getScoreBgClass(score)}
        ${getScoreTextClass(score)}
        ${getScoreBorderClass(score)}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      <span>{formatScore(score)}</span>
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
            IPODhan Score: {getScoreCategory(score)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Based on fundamentals, sentiment, subscription, and sector analysis
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
