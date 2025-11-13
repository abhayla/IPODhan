'use client';

/**
 * SubscriptionHeatmap Component
 *
 * Visual heatmap showing subscription intensity day-by-day during bidding period
 * Color intensity represents subscription levels
 */

import { formatSubscription } from './utils';
import type { SubscriptionHeatmapProps } from './types';
import { cn } from '@/lib/utils';
import { Calendar } from 'lucide-react';

export function SubscriptionHeatmap({ data, className }: SubscriptionHeatmapProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/25 p-8 text-center">
        <Calendar className="mx-auto h-12 w-12 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">
          Heatmap data not available yet
        </p>
      </div>
    );
  }

  /**
   * Get color intensity based on subscription level
   * Returns Tailwind background color class
   */
  const getIntensityColor = (intensity: number, subscription: number): string => {
    // Special handling for zero or very low subscription
    if (subscription === 0) {
      return 'bg-muted';
    }

    if (subscription < 0.1) {
      return 'bg-orange-100 dark:bg-orange-950';
    }

    // Color scale based on intensity (0-100)
    if (intensity >= 80) {
      return 'bg-green-600 dark:bg-green-700';
    }
    if (intensity >= 60) {
      return 'bg-green-500 dark:bg-green-600';
    }
    if (intensity >= 40) {
      return 'bg-green-400 dark:bg-green-500';
    }
    if (intensity >= 20) {
      return 'bg-green-300 dark:bg-green-600/70';
    }
    return 'bg-green-200 dark:bg-green-700/50';
  };

  /**
   * Get text color for contrast
   */
  const getTextColor = (intensity: number): string => {
    if (intensity >= 40) {
      return 'text-white dark:text-white';
    }
    return 'text-foreground';
  };

  return (
    <div className={className}>
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-medium">Bidding Activity Heatmap</h4>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Low</span>
            <div className="flex gap-0.5">
              <div className="w-4 h-4 rounded bg-green-200 dark:bg-green-700/50" />
              <div className="w-4 h-4 rounded bg-green-300 dark:bg-green-600/70" />
              <div className="w-4 h-4 rounded bg-green-400 dark:bg-green-500" />
              <div className="w-4 h-4 rounded bg-green-500 dark:bg-green-600" />
              <div className="w-4 h-4 rounded bg-green-600 dark:bg-green-700" />
            </div>
            <span>High</span>
          </div>
        </div>

        {/* Heatmap Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {data.map((point, index) => {
            const colorClass = getIntensityColor(point.intensity, point.subscription);
            const textColorClass = getTextColor(point.intensity);

            return (
              <div
                key={index}
                className={cn(
                  'group relative rounded-lg p-4 transition-all duration-200 hover:scale-105 hover:shadow-lg cursor-pointer',
                  colorClass
                )}
              >
                {/* Day Label */}
                <div className="flex flex-col items-center justify-center space-y-1">
                  <span className={cn('text-xs font-medium', textColorClass)}>
                    Day {point.dayOfBidding}
                  </span>
                  <span className={cn('text-lg font-bold', textColorClass)}>
                    {formatSubscription(point.subscription)}
                  </span>
                  <span className={cn('text-xs', textColorClass)}>
                    {point.dateLabel}
                  </span>
                </div>

                {/* Hover Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                  <div className="rounded-lg border bg-background/95 backdrop-blur-sm p-2 shadow-lg text-xs whitespace-nowrap">
                    <p className="font-medium mb-1">Day {point.dayOfBidding}</p>
                    <p className="text-muted-foreground">{point.dateLabel}</p>
                    <p className="font-bold mt-1">
                      {formatSubscription(point.subscription)}
                    </p>
                    <p className="text-muted-foreground">
                      {point.intensity.toFixed(0)}% intensity
                    </p>
                  </div>
                  {/* Arrow */}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                    <div className="border-4 border-transparent border-t-border" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground justify-center">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-muted" />
              <span>No Subscription</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-green-200 dark:bg-green-700/50" />
              <span>0-20%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-green-300 dark:bg-green-600/70" />
              <span>20-40%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-green-400 dark:bg-green-500" />
              <span>40-60%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-green-500 dark:bg-green-600" />
              <span>60-80%</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-green-600 dark:bg-green-700" />
              <span>80-100%</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-3 text-center">
          Intensity calculated relative to peak subscription day
        </p>
      </div>
    </div>
  );
}
