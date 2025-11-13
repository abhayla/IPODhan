/**
 * KPICard Component (Story 11.11)
 * Displays a single KPI metric with icon, title, value, and tooltip
 */

'use client';

import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Info } from 'lucide-react';

export interface KPICardProps {
  /**
   * Icon component from react-icons
   */
  icon: LucideIcon;

  /**
   * Title of the KPI metric
   */
  title: string;

  /**
   * Formatted value to display (e.g., "₹5,000 Cr" or "18.5%")
   */
  value: string | ReactNode;

  /**
   * Explanatory tooltip text
   */
  tooltip: string;

  /**
   * Optional custom color for the icon (defaults to primary)
   */
  iconColor?: string;
}

/**
 * KPI Card Component
 * Displays a single financial KPI with icon, title, value, and tooltip
 */
export function KPICard({
  icon: Icon,
  title,
  value,
  tooltip,
  iconColor = 'text-primary',
}: KPICardProps) {
  return (
    <div className="space-y-2 p-4 rounded-lg bg-muted/50 border border-border hover:border-primary/50 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${iconColor}`} />
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label={`Info about ${title}`}
              >
                <Info className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-sm">{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="text-2xl font-bold text-foreground">
        {value === 'N/A' ? (
          <span className="text-muted-foreground italic text-lg">N/A</span>
        ) : (
          value
        )}
      </div>
    </div>
  );
}
