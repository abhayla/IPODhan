'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Info } from 'lucide-react';

interface CategoryTooltipProps {
  category: string;
  description: string;
  children?: React.ReactNode;
}

/**
 * CategoryTooltip Component
 *
 * Displays an information tooltip for subscription categories.
 * Story 5.6: Enhanced Subscription Breakdown - AC 6
 */
export function CategoryTooltip({
  category,
  description,
  children,
}: CategoryTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {children || (
            <button
              type="button"
              className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
              aria-label={`Information about ${category}`}
            >
              <Info className="h-4 w-4" />
            </button>
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-sm">
            <span className="font-semibold">{category}:</span> {description}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
