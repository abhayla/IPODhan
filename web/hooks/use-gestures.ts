'use client';

import { useGesture } from '@use-gesture/react';
import { useCallback, useRef } from 'react';

/**
 * useGestures Hook - Unified gesture handling
 *
 * Phase 4: Mobile Excellence
 *
 * Provides a unified interface for handling common touch gestures:
 * - Swipe (left, right, up, down)
 * - Pinch (zoom in, zoom out)
 * - Long press
 * - Pull to refresh
 *
 * Features:
 * - Gesture disambiguation (prevents conflicts)
 * - Threshold-based gesture recognition
 * - Velocity tracking
 * - Multi-touch support
 * - TypeScript strict typing
 *
 * Integration:
 * - Phase 1: Uses 60fps animations for smooth gesture feedback
 * - Phase 3: Can trigger live data refreshes on pull-to-refresh
 *
 * @example
 * const bind = useGestures({
 *   onSwipeLeft: () => console.log('Swiped left'),
 *   onSwipeRight: () => console.log('Swiped right'),
 *   onPinch: ({ offset: [scale] }) => console.log('Pinch scale:', scale),
 *   onLongPress: () => console.log('Long pressed'),
 * });
 *
 * return <div {...bind()}>Swipeable content</div>;
 */

export interface SwipeEvent {
  direction: 'left' | 'right' | 'up' | 'down';
  velocity: number;
  distance: number;
}

export interface PinchEvent {
  scale: number;
  delta: number;
  velocity: number;
}

export interface PullToRefreshEvent {
  distance: number;
  threshold: number;
  isRefreshing: boolean;
}

export interface UseGesturesOptions {
  // Swipe gestures
  onSwipeLeft?: (event: SwipeEvent) => void;
  onSwipeRight?: (event: SwipeEvent) => void;
  onSwipeUp?: (event: SwipeEvent) => void;
  onSwipeDown?: (event: SwipeEvent) => void;
  swipeThreshold?: number; // Minimum distance in px (default: 50)
  swipeVelocity?: number; // Minimum velocity (default: 0.3)

  // Pinch gestures
  onPinch?: (event: PinchEvent) => void;
  onPinchStart?: () => void;
  onPinchEnd?: (event: PinchEvent) => void;
  pinchThreshold?: number; // Minimum scale change (default: 0.1)

  // Long press
  onLongPress?: () => void;
  longPressDelay?: number; // Delay in ms (default: 500)

  // Pull to refresh
  onPullToRefresh?: (event: PullToRefreshEvent) => void;
  pullToRefreshThreshold?: number; // Pull distance threshold (default: 80)
  enablePullToRefresh?: boolean; // Enable pull-to-refresh (default: false)

  // General options
  enabled?: boolean; // Enable/disable all gestures (default: true)
  preventDefault?: boolean; // Prevent default browser behavior (default: true)
}

export function useGestures(options: UseGesturesOptions = {}) {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    swipeThreshold = 50,
    swipeVelocity = 0.3,
    onPinch,
    onPinchStart,
    onPinchEnd,
    pinchThreshold = 0.1,
    onLongPress,
    longPressDelay = 500,
    onPullToRefresh,
    pullToRefreshThreshold = 80,
    enablePullToRefresh = false,
    enabled = true,
    preventDefault = true,
  } = options;

  const longPressTimeout = useRef<NodeJS.Timeout | null>(null);
  const isPulling = useRef(false);
  const pullDistance = useRef(0);

  // Clear long press timeout
  const clearLongPressTimeout = useCallback(() => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current);
      longPressTimeout.current = null;
    }
  }, []);

  // Handle swipe gestures
  const handleSwipe = useCallback(
    (direction: [number, number], velocity: [number, number]) => {
      const [vx, vy] = velocity;
      const [dx, dy] = direction;

      // Determine swipe direction based on dominant axis
      const horizontal = Math.abs(dx) > Math.abs(dy);

      if (horizontal) {
        if (dx > swipeThreshold && Math.abs(vx) > swipeVelocity) {
          // Swipe right
          onSwipeRight?.({
            direction: 'right',
            velocity: Math.abs(vx),
            distance: Math.abs(dx),
          });
        } else if (dx < -swipeThreshold && Math.abs(vx) > swipeVelocity) {
          // Swipe left
          onSwipeLeft?.({
            direction: 'left',
            velocity: Math.abs(vx),
            distance: Math.abs(dx),
          });
        }
      } else {
        if (dy > swipeThreshold && Math.abs(vy) > swipeVelocity) {
          // Swipe down
          if (enablePullToRefresh && dy > pullToRefreshThreshold) {
            // Pull to refresh
            isPulling.current = true;
            onPullToRefresh?.({
              distance: dy,
              threshold: pullToRefreshThreshold,
              isRefreshing: true,
            });
          } else {
            onSwipeDown?.({
              direction: 'down',
              velocity: Math.abs(vy),
              distance: Math.abs(dy),
            });
          }
        } else if (dy < -swipeThreshold && Math.abs(vy) > swipeVelocity) {
          // Swipe up
          onSwipeUp?.({
            direction: 'up',
            velocity: Math.abs(vy),
            distance: Math.abs(dy),
          });
        }
      }
    },
    [
      swipeThreshold,
      swipeVelocity,
      onSwipeLeft,
      onSwipeRight,
      onSwipeUp,
      onSwipeDown,
      enablePullToRefresh,
      pullToRefreshThreshold,
      onPullToRefresh,
    ]
  );

  // Unified gesture handler using @use-gesture/react
  const bind = useGesture(
    {
      // Drag gesture (for swipes)
      onDrag: ({ movement, velocity, last }) => {
        if (!enabled) return;

        // Update pull distance for pull-to-refresh
        if (enablePullToRefresh) {
          pullDistance.current = movement[1];
        }

        // On drag end, check for swipe
        if (last) {
          handleSwipe(movement, velocity);

          // Reset pull-to-refresh state
          if (isPulling.current) {
            isPulling.current = false;
            onPullToRefresh?.({
              distance: 0,
              threshold: pullToRefreshThreshold,
              isRefreshing: false,
            });
          }
        }
      },

      // Pinch gesture (for zoom)
      onPinch: ({ offset: [scale], delta: [deltaScale], velocity, first, last }) => {
        if (!enabled || !onPinch) return;

        if (first) {
          onPinchStart?.();
        }

        // Only trigger if scale change exceeds threshold
        if (Math.abs(scale - 1) > pinchThreshold) {
          onPinch({
            scale,
            delta: deltaScale,
            velocity: velocity[0],
          });
        }

        if (last) {
          onPinchEnd?.({
            scale,
            delta: deltaScale,
            velocity: velocity[0],
          });
        }
      },

      // Touch start (for long press detection)
      onTouchStart: () => {
        if (!enabled || !onLongPress) return;

        clearLongPressTimeout();
        longPressTimeout.current = setTimeout(() => {
          onLongPress();
        }, longPressDelay);
      },

      // Touch end/move (cancel long press)
      onTouchEnd: () => {
        clearLongPressTimeout();
      },

      onTouchMove: () => {
        clearLongPressTimeout();
      },
    },
    {
      // Configuration
      drag: {
        threshold: 10, // Minimum movement before drag is detected
        filterTaps: true, // Filter out taps
      },
      pinch: {
        scaleBounds: { min: 0.5, max: 3 }, // Prevent extreme zoom levels
        rubberband: true, // Smooth bouncing at limits
      },
      eventOptions: {
        passive: !preventDefault, // Use passive events for performance
      },
    }
  );

  return bind;
}

/**
 * useSwipeNavigation Hook - Simplified swipe navigation
 *
 * Convenience hook for swipe-based navigation (e.g., between IPO details)
 *
 * @example
 * const bind = useSwipeNavigation({
 *   onNext: () => router.push('/next-ipo'),
 *   onPrevious: () => router.push('/previous-ipo'),
 * });
 */
export function useSwipeNavigation(options: {
  onNext?: () => void;
  onPrevious?: () => void;
  threshold?: number;
}) {
  const { onNext, onPrevious, threshold = 50 } = options;

  return useGestures({
    onSwipeLeft: onNext,
    onSwipeRight: onPrevious,
    swipeThreshold: threshold,
  });
}

/**
 * usePullToRefresh Hook - Simplified pull-to-refresh
 *
 * Convenience hook for pull-to-refresh functionality
 *
 * @example
 * const bind = usePullToRefresh({
 *   onRefresh: async () => {
 *     await fetchLatestData();
 *   },
 * });
 */
export function usePullToRefresh(options: {
  onRefresh: () => void | Promise<void>;
  threshold?: number;
}) {
  const { onRefresh, threshold = 80 } = options;

  return useGestures({
    enablePullToRefresh: true,
    pullToRefreshThreshold: threshold,
    onPullToRefresh: async (event) => {
      if (event.isRefreshing) {
        await onRefresh();
      }
    },
  });
}
