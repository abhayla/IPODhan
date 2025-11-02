'use client';

import { format } from 'date-fns';
import { cn } from '@/lib/utils';

/**
 * Timeline milestone data structure
 */
export interface TimelineMilestone {
  /** Unique identifier for the milestone */
  id: string;
  /** Display label for the milestone */
  label: string;
  /** Date of the milestone */
  date?: Date | string | null;
  /** Status of the milestone ('completed' | 'current' | 'upcoming') */
  status: 'completed' | 'current' | 'upcoming';
  /** Optional description/details */
  description?: string;
  /** Optional icon component */
  icon?: React.ReactNode;
  /** Custom color for this milestone (overrides default status colors) */
  color?: string;
}

/**
 * Props for TimelineBase component
 */
export interface TimelineBaseProps {
  /** Array of timeline milestones */
  milestones: TimelineMilestone[];
  /** Orientation of the timeline (default: 'horizontal') */
  orientation?: 'horizontal' | 'vertical';
  /** Show connecting lines between milestones (default: true) */
  showConnectors?: boolean;
  /** Date format string for displaying dates (default: 'dd MMM yyyy') */
  dateFormat?: string;
  /** Show milestone descriptions (default: false) */
  showDescriptions?: boolean;
  /** Custom class name for the container */
  className?: string;
  /** Spacing between milestones (CSS value, default: '2rem' for horizontal, '3rem' for vertical) */
  spacing?: string;
  /** Size of milestone dots (default: 'medium') */
  dotSize?: 'small' | 'medium' | 'large';
}

/**
 * TimelineBase - Custom timeline component for displaying IPO lifecycle stages
 *
 * Features:
 * - Horizontal or vertical orientation
 * - Three status states (completed, current, upcoming)
 * - Optional dates and descriptions
 * - Custom icons and colors
 * - Responsive design
 * - Dark mode compatible
 * - Connector lines between milestones
 *
 * @example
 * ```tsx
 * // IPO lifecycle timeline
 * <TimelineBase
 *   milestones={[
 *     {
 *       id: 'announced',
 *       label: 'Announced',
 *       date: new Date('2024-01-01'),
 *       status: 'completed',
 *     },
 *     {
 *       id: 'open',
 *       label: 'Bidding Open',
 *       date: new Date('2024-01-15'),
 *       status: 'current',
 *       description: 'Subscription ongoing',
 *     },
 *     {
 *       id: 'close',
 *       label: 'Bidding Close',
 *       date: new Date('2024-01-17'),
 *       status: 'upcoming',
 *     },
 *     {
 *       id: 'allotment',
 *       label: 'Allotment',
 *       date: new Date('2024-01-20'),
 *       status: 'upcoming',
 *     },
 *     {
 *       id: 'listing',
 *       label: 'Listing',
 *       date: new Date('2024-01-22'),
 *       status: 'upcoming',
 *     },
 *   ]}
 *   orientation="horizontal"
 *   showDescriptions
 * />
 * ```
 */
export function TimelineBase({
  milestones,
  orientation = 'horizontal',
  showConnectors = true,
  dateFormat = 'dd MMM yyyy',
  showDescriptions = false,
  className,
  spacing,
  dotSize = 'medium',
}: TimelineBaseProps) {
  // Determine default spacing based on orientation
  const defaultSpacing = orientation === 'horizontal' ? '2rem' : '3rem';
  const gapSize = spacing || defaultSpacing;

  // Dot size mapping
  const dotSizeClasses = {
    small: 'w-3 h-3',
    medium: 'w-4 h-4',
    large: 'w-6 h-6',
  };

  // Status color mapping
  const statusColors = {
    completed: 'bg-green-500',
    current: 'bg-blue-500',
    upcoming: 'bg-gray-300 dark:bg-gray-600',
  };

  // Status border colors for current milestone
  const statusBorderColors = {
    completed: 'border-green-500',
    current: 'border-blue-500',
    upcoming: 'border-gray-300 dark:border-gray-600',
  };

  // Connector color based on milestone status
  const getConnectorColor = (index: number) => {
    if (index >= milestones.length - 1) return '';
    const currentStatus = milestones[index].status;
    return currentStatus === 'completed' ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600';
  };

  // Format date helper
  const formatDate = (date?: Date | string | null) => {
    if (!date) return null;
    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      return format(dateObj, dateFormat);
    } catch {
      return null;
    }
  };

  if (orientation === 'horizontal') {
    return (
      <div className={cn('w-full overflow-x-auto', className)}>
        <div
          className="flex items-start justify-between min-w-max px-4"
          style={{ gap: gapSize }}
        >
          {milestones.map((milestone, index) => {
            const isLast = index === milestones.length - 1;
            const formattedDate = formatDate(milestone.date);

            return (
              <div key={milestone.id} className="flex items-start flex-1">
                {/* Milestone */}
                <div className="flex flex-col items-center text-center flex-shrink-0">
                  {/* Dot */}
                  <div className="relative mb-2">
                    <div
                      className={cn(
                        'rounded-full border-2',
                        dotSizeClasses[dotSize],
                        milestone.color || statusColors[milestone.status],
                        milestone.status === 'current' && 'ring-4 ring-blue-100 dark:ring-blue-900',
                        milestone.color ? `border-${milestone.color}` : statusBorderColors[milestone.status]
                      )}
                    >
                      {milestone.icon && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          {milestone.icon}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Label */}
                  <div
                    className={cn(
                      'text-sm font-semibold mb-1',
                      milestone.status === 'current' && 'text-blue-600 dark:text-blue-400',
                      milestone.status === 'completed' && 'text-green-600 dark:text-green-400',
                      milestone.status === 'upcoming' && 'text-gray-500 dark:text-gray-400'
                    )}
                  >
                    {milestone.label}
                  </div>

                  {/* Date */}
                  {formattedDate && (
                    <div className="text-xs text-muted-foreground mb-1">{formattedDate}</div>
                  )}

                  {/* Description */}
                  {showDescriptions && milestone.description && (
                    <div className="text-xs text-muted-foreground max-w-[120px]">
                      {milestone.description}
                    </div>
                  )}
                </div>

                {/* Connector Line */}
                {!isLast && showConnectors && (
                  <div
                    className={cn(
                      'flex-1 h-0.5 mt-4',
                      getConnectorColor(index)
                    )}
                    style={{ minWidth: gapSize }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Vertical timeline
  return (
    <div className={cn('w-full', className)}>
      <div className="relative pl-8">
        {/* Vertical line */}
        {showConnectors && (
          <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-300 dark:bg-gray-600" />
        )}

        <div className="space-y-8" style={{ gap: gapSize }}>
          {milestones.map((milestone, index) => {
            const formattedDate = formatDate(milestone.date);

            return (
              <div key={milestone.id} className="relative flex items-start gap-4">
                {/* Dot */}
                <div
                  className={cn(
                    'absolute -left-8 rounded-full border-2 flex-shrink-0',
                    dotSizeClasses[dotSize],
                    milestone.color || statusColors[milestone.status],
                    milestone.status === 'current' && 'ring-4 ring-blue-100 dark:ring-blue-900',
                    milestone.color ? `border-${milestone.color}` : statusBorderColors[milestone.status]
                  )}
                >
                  {milestone.icon && (
                    <div className="flex items-center justify-center w-full h-full">
                      {milestone.icon}
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pb-8">
                  {/* Label */}
                  <div
                    className={cn(
                      'text-base font-semibold mb-1',
                      milestone.status === 'current' && 'text-blue-600 dark:text-blue-400',
                      milestone.status === 'completed' && 'text-green-600 dark:text-green-400',
                      milestone.status === 'upcoming' && 'text-gray-500 dark:text-gray-400'
                    )}
                  >
                    {milestone.label}
                  </div>

                  {/* Date */}
                  {formattedDate && (
                    <div className="text-sm text-muted-foreground mb-2">{formattedDate}</div>
                  )}

                  {/* Description */}
                  {showDescriptions && milestone.description && (
                    <div className="text-sm text-muted-foreground">{milestone.description}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
