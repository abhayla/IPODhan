'use client';

import { useCountUp } from '@/hooks/use-count-up';
import { cn } from '@/lib/utils';

interface AnimatedScoreProps {
  /**
   * Score value (0-10 scale) - Legacy prop for IPO scores
   * Use 'value' for generic numbers
   */
  score?: number;
  /**
   * Generic number value (alternative to 'score')
   * For non-score numbers (GMP, subscription, etc.)
   */
  value?: number;
  /**
   * Number of decimal places to show
   */
  decimals?: number;
  /**
   * Prefix (e.g., "₹", "$")
   */
  prefix?: string;
  /**
   * Suffix (e.g., "x", "%")
   */
  suffix?: string;
  /**
   * Size variant
   */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Whether to show the gradient effect
   */
  gradient?: boolean;
  /**
   * Custom class name
   */
  className?: string;
  /**
   * Show "/10" suffix (for IPO scores only)
   */
  showSuffix?: boolean;
  /**
   * Animation delay in ms
   */
  delay?: number;
}

/**
 * Animated Score Display
 * Phase 1: Visual Identity Revolution - Micro-interactions
 *
 * Features:
 * - Smooth count-up animation (800ms)
 * - Gradient text effect
 * - Multiple size variants
 * - Score-based color coding
 */
export function AnimatedScore({
  score,
  value,
  decimals,
  prefix,
  suffix,
  size = 'lg',
  gradient = true,
  className,
  showSuffix = false,
  delay = 0,
}: AnimatedScoreProps) {
  // Determine which value to use (value takes precedence, fallback to score)
  const numberValue = value !== undefined ? value : (score ?? 0);
  const decimalPlaces = decimals !== undefined ? decimals : (score !== undefined ? 1 : 0);

  // Animate the value
  const animatedValue = useCountUp({
    end: numberValue,
    start: 0,
    duration: 800,
    decimals: decimalPlaces,
    delay,
  });

  // Size configurations
  const sizeConfig = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-3xl',
    xl: 'text-5xl',
  };

  // Get color based on score (if using score prop and not gradient)
  const getScoreColor = () => {
    if (score === undefined) return 'text-foreground'; // Not a score, use default
    if (score >= 9.0) return 'text-success'; // Exceptional
    if (score >= 7.5) return 'text-accent'; // Strong
    if (score >= 6.0) return 'text-secondary'; // Good
    if (score >= 4.5) return 'text-muted-foreground'; // Average
    return 'text-danger'; // Below average
  };

  return (
    <div className={cn('inline-flex items-baseline gap-0.5', className)}>
      {prefix && (
        <span className={cn('font-semibold tabular-nums', sizeConfig[size])}>
          {prefix}
        </span>
      )}
      <span
        className={cn(
          'font-bold font-heading tabular-nums',
          sizeConfig[size],
          gradient && score !== undefined ? 'gradient-text' : getScoreColor(),
          'transition-all duration-300'
        )}
      >
        {animatedValue.toFixed(decimalPlaces)}
      </span>
      {suffix && (
        <span className={cn('font-medium text-foreground', sizeConfig[size])}>
          {suffix}
        </span>
      )}
      {showSuffix && score !== undefined && (
        <span className="text-sm text-muted-foreground font-medium">/ 10</span>
      )}
    </div>
  );
}
