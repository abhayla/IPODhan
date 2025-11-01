/**
 * KPIComparisonCard Component (Story 11.11)
 * Displays pre vs post IPO comparison metrics (EPS, P/E)
 * with change percentage and color-coded arrows
 */

'use client';

import { IconType } from 'react-icons';
import { HiArrowTrendingUp, HiArrowTrendingDown, HiArrowRight, HiInformationCircle } from 'react-icons/hi2';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getChangeColorClass, getChangeTrend } from '@/lib/utils/kpi-calculations';
import { formatChange } from '@/lib/utils/kpi-formatters';

export interface KPIComparisonCardProps {
  /**
   * Icon component from react-icons
   */
  icon: IconType;

  /**
   * Title of the comparison (e.g., "EPS Comparison", "P/E Ratio Comparison")
   */
  title: string;

  /**
   * Label for pre-IPO value (e.g., "Pre-IPO EPS")
   */
  preLabel: string;

  /**
   * Pre-IPO value formatted (e.g., "₹45.20")
   */
  preValue: string;

  /**
   * Label for post-IPO value (e.g., "Post-IPO EPS")
   */
  postLabel: string;

  /**
   * Post-IPO value formatted (e.g., "₹52.30")
   */
  postValue: string;

  /**
   * Change percentage (numeric, can be positive or negative)
   */
  changePercent: number | null;

  /**
   * Explanatory tooltip text
   */
  tooltip: string;

  /**
   * Optional custom color for the icon (defaults to primary)
   */
  iconColor?: string;

  /**
   * Whether to invert color logic (for P/E, lower is better)
   */
  invertColors?: boolean;
}

/**
 * Get arrow icon based on trend
 */
function getTrendIcon(trend: 'up' | 'down' | 'neutral') {
  if (trend === 'up') return HiArrowTrendingUp;
  if (trend === 'down') return HiArrowTrendingDown;
  return HiArrowRight;
}

/**
 * KPI Comparison Card Component
 * Shows Pre vs Post IPO metrics with change percentage
 */
export function KPIComparisonCard({
  icon: Icon,
  title,
  preLabel,
  preValue,
  postLabel,
  postValue,
  changePercent,
  tooltip,
  iconColor = 'text-primary',
  invertColors = false,
}: KPIComparisonCardProps) {
  // Get trend and color based on change percentage
  const trend = getChangeTrend(changePercent);
  let colorClass = getChangeColorClass(changePercent);

  // Invert colors for P/E (lower is better after IPO due to dilution)
  if (invertColors && changePercent !== null) {
    if (changePercent > 0) {
      colorClass = 'text-red-600'; // Increase in P/E is bad
    } else if (changePercent < 0) {
      colorClass = 'text-green-600'; // Decrease in P/E is good
    }
  }

  const TrendIcon = getTrendIcon(trend);

  return (
    <div className="space-y-3 p-4 rounded-lg bg-muted/50 border border-border hover:border-primary/50 transition-colors">
      {/* Header */}
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
                <HiInformationCircle className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-sm">{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Pre vs Post Values */}
      <div className="flex items-center justify-between gap-4">
        {/* Pre-IPO */}
        <div className="flex-1">
          <p className="text-xs text-muted-foreground mb-1">{preLabel}</p>
          <p className="text-lg font-bold text-foreground">
            {preValue === 'N/A' ? (
              <span className="text-muted-foreground italic text-sm">N/A</span>
            ) : (
              preValue
            )}
          </p>
        </div>

        {/* Arrow and Change */}
        {changePercent !== null && preValue !== 'N/A' && postValue !== 'N/A' ? (
          <div className="flex flex-col items-center gap-1">
            <TrendIcon className={`h-5 w-5 ${colorClass}`} />
            <span className={`text-xs font-semibold ${colorClass}`}>
              {formatChange(changePercent)}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <HiArrowRight className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">-</span>
          </div>
        )}

        {/* Post-IPO */}
        <div className="flex-1 text-right">
          <p className="text-xs text-muted-foreground mb-1">{postLabel}</p>
          <p className="text-lg font-bold text-foreground">
            {postValue === 'N/A' ? (
              <span className="text-muted-foreground italic text-sm">N/A</span>
            ) : (
              postValue
            )}
          </p>
        </div>
      </div>

      {/* Change Explanation (optional) */}
      {changePercent !== null && preValue !== 'N/A' && postValue !== 'N/A' && (
        <div className={`text-xs px-2 py-1 rounded ${colorClass.replace('text-', 'bg-').replace('600', '50')} border ${colorClass.replace('text-', 'border-').replace('600', '200')}`}>
          <p className={`${colorClass} font-medium`}>
            {invertColors ? (
              <>
                {changePercent < 0 && 'Positive: P/E decreased due to dilution'}
                {changePercent > 0 && 'Note: P/E increased, indicating higher valuation'}
                {changePercent === 0 && 'No change in P/E ratio'}
              </>
            ) : (
              <>
                {changePercent > 0 && 'EPS increased after IPO'}
                {changePercent < 0 && 'EPS decreased after IPO'}
                {changePercent === 0 && 'No change in EPS'}
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
