/**
 * useReducedMotion Hook
 *
 * Detects user's motion preference using the prefers-reduced-motion media query.
 * Returns true if user prefers reduced motion (for accessibility).
 *
 * Industry standard: WCAG 2.1 Level AAA requires respecting user motion preferences.
 * Approximately 35% of users enable reduced motion for accessibility reasons.
 *
 * @example
 * ```tsx
 * const prefersReducedMotion = useReducedMotion();
 *
 * const animate = !prefersReducedMotion;
 * <motion.div animate={animate ? "visible" : false} />
 * ```
 */

'use client';

import { useState, useEffect } from 'react';

/**
 * useReducedMotion
 *
 * @returns true if user prefers reduced motion, false otherwise
 */
export function useReducedMotion(): boolean {
  // Default to false (enable animations) for SSR
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Check if window and matchMedia are available (client-side only)
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    // Create media query for prefers-reduced-motion
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Set initial value
    setPrefersReducedMotion(mediaQuery.matches);

    // Create event listener for changes
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    // Add event listener (modern browsers)
    mediaQuery.addEventListener('change', handleChange);

    // Cleanup
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  return prefersReducedMotion;
}

/**
 * useAnimationDuration
 *
 * Returns 0ms if user prefers reduced motion, otherwise returns the specified duration.
 * Useful for conditional animation durations.
 *
 * @param duration - Normal animation duration in milliseconds
 * @returns 0 if reduced motion preferred, otherwise the specified duration
 *
 * @example
 * ```tsx
 * const duration = useAnimationDuration(300); // Returns 0ms or 300ms
 * ```
 */
export function useAnimationDuration(duration: number): number {
  const prefersReducedMotion = useReducedMotion();
  return prefersReducedMotion ? 0 : duration;
}

export default useReducedMotion;
