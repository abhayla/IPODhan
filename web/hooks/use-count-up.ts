'use client';

import { useEffect, useState, useRef } from 'react';

interface UseCountUpOptions {
  /**
   * Target value to count up to
   */
  end: number;
  /**
   * Starting value (default: 0)
   */
  start?: number;
  /**
   * Duration in milliseconds (default: 800ms)
   */
  duration?: number;
  /**
   * Number of decimal places (default: 1)
   */
  decimals?: number;
  /**
   * Easing function (default: easeOutQuad)
   */
  easing?: (t: number) => number;
  /**
   * Delay before animation starts (default: 0)
   */
  delay?: number;
  /**
   * Whether to start animation immediately (default: true)
   */
  autoStart?: boolean;
}

/**
 * Custom hook for count-up animation
 * Phase 1: Visual Identity Revolution - Micro-interactions
 *
 * Creates smooth number animations with easing
 * Perfect for score displays, metrics, and counters
 *
 * @example
 * const score = useCountUp({ end: 8.5, duration: 800, decimals: 1 });
 * return <div className="text-3xl">{score}</div>;
 */
export function useCountUp({
  end,
  start = 0,
  duration = 800,
  decimals = 1,
  easing = easeOutQuad,
  delay = 0,
  autoStart = true,
}: UseCountUpOptions): number {
  const [count, setCount] = useState(start);
  const frameRef = useRef<number | undefined>(undefined);
  const startTimeRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!autoStart) return;

    const startAnimation = () => {
      startTimeRef.current = performance.now();

      const animate = (currentTime: number) => {
        if (!startTimeRef.current) return;

        const elapsed = currentTime - startTimeRef.current;
        const progress = Math.min(elapsed / duration, 1);

        // Apply easing function
        const easedProgress = easing(progress);

        // Calculate current value
        const currentValue = start + (end - start) * easedProgress;
        setCount(currentValue);

        // Continue animation if not complete
        if (progress < 1) {
          frameRef.current = requestAnimationFrame(animate);
        } else {
          setCount(end); // Ensure we end exactly on target
        }
      };

      // Start animation after delay
      const timeoutId = setTimeout(() => {
        frameRef.current = requestAnimationFrame(animate);
      }, delay);

      return () => {
        clearTimeout(timeoutId);
        if (frameRef.current) {
          cancelAnimationFrame(frameRef.current);
        }
      };
    };

    return startAnimation();
  }, [end, start, duration, easing, delay, autoStart]);

  // Format with specified decimals
  return Number(count.toFixed(decimals));
}

/**
 * Easing Functions
 */

// Quadratic ease-out: decelerating to zero velocity
export function easeOutQuad(t: number): number {
  return t * (2 - t);
}

// Cubic ease-out: more pronounced deceleration
export function easeOutCubic(t: number): number {
  return --t * t * t + 1;
}

// Exponential ease-out: very sharp deceleration
export function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// Elastic ease-out: bouncy effect at the end
export function easeOutElastic(t: number): number {
  const c4 = (2 * Math.PI) / 3;
  return t === 0
    ? 0
    : t === 1
    ? 1
    : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

// Linear: no easing
export function linear(t: number): number {
  return t;
}
