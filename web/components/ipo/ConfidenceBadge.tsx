/**
 * ConfidenceBadge Component (Story 4.7)
 * Displays confidence level indicator with icon
 */

'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ConfidenceLevel } from '@/lib/db/types';
import {
  getConfidenceClass,
  getConfidenceIcon,
  getConfidenceText,
} from '@/lib/utils/score-utils';

interface ConfidenceBadgeProps {
  confidence: ConfidenceLevel;
  size?: 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
  className?: string;
}

/**
 * ConfidenceBadge component displays confidence level (HIGH/MEDIUM/LOW)
 * with visual icon indicator
 */
export function ConfidenceBadge({
  confidence,
  size = 'md',
  showTooltip = true,
  className = '',
}: ConfidenceBadgeProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  const confidenceDescriptions: Record<ConfidenceLevel, string> = {
    HIGH: 'High data availability and quality. Score is highly reliable.',
    MEDIUM: 'Moderate data availability. Score is reasonably reliable.',
    LOW: 'Limited data available. Score should be used as indicative only.',
  };

  const confidenceDescription: string = confidenceDescriptions[confidence];

  const badge = (
    <div
      className={`
        inline-flex items-center gap-1.5 font-medium rounded-md
        bg-muted/50 border border-muted-foreground/20
        ${getConfidenceClass(confidence)}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      <span>{getConfidenceIcon(confidence)}</span>
      <span>{getConfidenceText(confidence)}</span>
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
            Confidence: {getConfidenceText(confidence)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {confidenceDescription}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
