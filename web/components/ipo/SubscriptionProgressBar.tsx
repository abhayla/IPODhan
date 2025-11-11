'use client';

import { cn } from '@/lib/utils';

interface SubscriptionProgressBarProps {
  /**
   * Total subscription multiplier (e.g., 2.5 for 2.5x subscribed)
   */
  subscriptionMultiplier: number | null;
  /**
   * Size variant
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Show label
   */
  showLabel?: boolean;
  /**
   * Custom class name
   */
  className?: string;
}

/**
 * Mini Progress Bar for Subscription Tracking
 * Phase 1: Visual Identity Revolution
 *
 * Features:
 * - Visual representation of subscription status (▓▓▓▓░░░░)
 * - Color-coded based on subscription level
 * - Animated fill with smooth transitions
 * - Responsive to different sizes
 */
export function SubscriptionProgressBar({
  subscriptionMultiplier,
  size = 'sm',
  showLabel = true,
  className,
}: SubscriptionProgressBarProps) {
  // Calculate percentage (cap at 100% for visual display)
  const percentage = subscriptionMultiplier
    ? Math.min((subscriptionMultiplier / 10) * 100, 100) // Scale: 10x = 100%
    : 0;

  // Determine color based on subscription level
  const getProgressColor = () => {
    if (!subscriptionMultiplier) return 'bg-muted-foreground/20';

    if (subscriptionMultiplier >= 5) {
      return 'bg-gradient-success'; // Heavily oversubscribed
    } else if (subscriptionMultiplier >= 2) {
      return 'bg-success'; // Well subscribed
    } else if (subscriptionMultiplier >= 1) {
      return 'bg-secondary'; // Fully subscribed
    } else if (subscriptionMultiplier >= 0.5) {
      return 'bg-accent'; // Moderately subscribed
    } else {
      return 'bg-danger/40'; // Under subscribed
    }
  };

  // Size configurations
  const sizeConfig = {
    sm: {
      height: 'h-2',
      text: 'text-xs',
    },
    md: {
      height: 'h-3',
      text: 'text-sm',
    },
    lg: {
      height: 'h-4',
      text: 'text-base',
    },
  };

  const config = sizeConfig[size];

  // Format subscription text
  const formatSubscription = (multiplier: number | null) => {
    if (multiplier === null || multiplier === 0) return '--';
    if (multiplier < 0.01) return '<0.01x';
    return `${multiplier.toFixed(2)}x`;
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      {showLabel && (
        <div className={cn('flex justify-between', config.text, 'text-muted-foreground')}>
          <span>Subscription</span>
          <span className="font-mono font-semibold">
            {formatSubscription(subscriptionMultiplier)}
          </span>
        </div>
      )}

      <div className={cn('relative rounded-full overflow-hidden bg-muted', config.height)}>
        {/* Animated progress fill */}
        <div
          className={cn(
            'h-full transition-all duration-700 ease-out',
            getProgressColor(),
            'relative'
          )}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Subscribed ${formatSubscription(subscriptionMultiplier)}`}
        >
          {/* Shimmer effect for active subscriptions */}
          {subscriptionMultiplier && subscriptionMultiplier > 0 && (
            <div className="absolute inset-0 animate-shimmer bg-gradient-shimmer" />
          )}
        </div>

        {/* Milestone markers (subtle) */}
        <div className="absolute inset-0 flex justify-between px-0.5">
          {[1, 2, 3, 5, 10].map((milestone) => {
            const milestonePercent = (milestone / 10) * 100;
            return (
              <div
                key={milestone}
                className="w-px bg-background/30"
                style={{ marginLeft: `${milestonePercent}%` }}
              />
            );
          })}
        </div>
      </div>

      {/* Subscription level indicator */}
      {subscriptionMultiplier !== null && subscriptionMultiplier > 0 && (
        <p className="text-xs text-muted-foreground">
          {subscriptionMultiplier >= 5 && '🔥 Heavily Oversubscribed'}
          {subscriptionMultiplier >= 2 && subscriptionMultiplier < 5 && '✨ Well Subscribed'}
          {subscriptionMultiplier >= 1 && subscriptionMultiplier < 2 && '✓ Fully Subscribed'}
          {subscriptionMultiplier >= 0.5 && subscriptionMultiplier < 1 && '⏳ Moderate Interest'}
          {subscriptionMultiplier < 0.5 && '⚠️ Low Subscription'}
        </p>
      )}
    </div>
  );
}
