'use client';

import React, { useState, useRef } from 'react';
import { usePullToRefresh } from '@/hooks/use-gestures';
import { RefreshCw } from 'lucide-react';

/**
 * PullToRefresh Component - Pull-to-refresh gesture wrapper
 *
 * Phase 4: Mobile Excellence
 *
 * Features:
 * - Pull down to refresh content
 * - Visual feedback during pull
 * - Loading spinner during refresh
 * - Customizable threshold (default: 80px)
 * - Spring animation
 * - Haptic feedback (if supported)
 * - Accessibility announcements
 *
 * Integration:
 * - Phase 1: Uses IPODhan colors and animations
 * - Phase 3: Triggers live data refresh
 *
 * @example
 * <PullToRefresh onRefresh={async () => await fetchLatestIPOs()}>
 *   <IPOList />
 * </PullToRefresh>
 */

export interface PullToRefreshProps {
  children: React.ReactNode;
  onRefresh: () => void | Promise<void>;
  threshold?: number; // Pull distance threshold (default: 80px)
  disabled?: boolean;
  className?: string;
}

export function PullToRefresh({
  children,
  onRefresh,
  threshold = 80,
  disabled = false,
  className = '',
}: PullToRefreshProps) {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle refresh action
  const handleRefresh = async () => {
    if (isRefreshing || disabled) return;

    setIsRefreshing(true);

    // Haptic feedback (if supported)
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }

    try {
      await onRefresh();
    } finally {
      // Keep spinner visible for at least 500ms for better UX
      setTimeout(() => {
        setIsRefreshing(false);
        setPullDistance(0);
        setIsPulling(false);
      }, 500);
    }
  };

  // Custom pull-to-refresh implementation using touch events
  // (More control than usePullToRefresh for visual feedback)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (disabled || isRefreshing) return;

    const scrollTop = containerRef.current?.scrollTop || 0;
    if (scrollTop === 0) {
      setIsPulling(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isPulling || disabled || isRefreshing) return;

    const touch = e.touches[0];
    const startY = containerRef.current?.getBoundingClientRect().top || 0;
    const currentY = touch.clientY;
    const distance = Math.max(0, currentY - startY);

    // Apply resistance (rubber band effect)
    const resistance = 0.5;
    const adjustedDistance = Math.min(distance * resistance, threshold * 1.5);

    setPullDistance(adjustedDistance);
  };

  const handleTouchEnd = () => {
    if (!isPulling || disabled || isRefreshing) return;

    if (pullDistance >= threshold) {
      handleRefresh();
    } else {
      setPullDistance(0);
      setIsPulling(false);
    }
  };

  // Calculate progress (0-1)
  const progress = Math.min(pullDistance / threshold, 1);

  // Calculate icon rotation (0-360deg)
  const iconRotation = progress * 360;

  // Calculate icon scale (0.8-1.2)
  const iconScale = 0.8 + progress * 0.4;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-y-auto ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-center
          transition-all duration-200 ease-out"
        style={{
          height: `${pullDistance}px`,
          opacity: isPulling || isRefreshing ? 1 : 0,
        }}
        aria-live="polite"
        aria-busy={isRefreshing}
      >
        <div
          className={`
            flex items-center justify-center
            w-12 h-12 rounded-full
            bg-primary-500 text-white shadow-lg
            transition-all duration-200
            ${isRefreshing ? 'animate-spin' : ''}
          `}
          style={{
            transform: `scale(${iconScale}) rotate(${iconRotation}deg)`,
          }}
        >
          <RefreshCw className="w-6 h-6" />
        </div>

        {/* Accessibility announcement */}
        <span className="sr-only">
          {isRefreshing ? 'Refreshing content...' : 'Pull down to refresh'}
        </span>
      </div>

      {/* Content */}
      <div
        className="transition-transform duration-200 ease-out"
        style={{
          transform: `translateY(${pullDistance}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * SimplePullToRefresh Component - Minimal pull-to-refresh (no visual feedback)
 *
 * Uses the usePullToRefresh hook directly for simpler implementation.
 *
 * @example
 * <SimplePullToRefresh onRefresh={fetchData}>
 *   <IPOList />
 * </SimplePullToRefresh>
 */
export interface SimplePullToRefreshProps {
  children: React.ReactNode;
  onRefresh: () => void | Promise<void>;
  threshold?: number;
  className?: string;
}

export function SimplePullToRefresh({
  children,
  onRefresh,
  threshold = 80,
  className = '',
}: SimplePullToRefreshProps) {
  const bind = usePullToRefresh({
    onRefresh,
    threshold,
  });

  return (
    <div {...bind()} className={`overflow-y-auto ${className}`}>
      {children}
    </div>
  );
}

/**
 * RefreshButton Component - Manual refresh button (for desktop or accessibility)
 *
 * @example
 * <RefreshButton onRefresh={fetchData} />
 */
export interface RefreshButtonProps {
  onRefresh: () => void | Promise<void>;
  label?: string;
  className?: string;
}

export function RefreshButton({
  onRefresh,
  label = 'Refresh',
  className = '',
}: RefreshButtonProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleClick = async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isRefreshing}
      className={`
        flex items-center gap-2 px-4 py-2
        bg-primary-500 hover:bg-primary-600 text-white
        rounded-lg transition-all duration-200
        hover:scale-105 active:scale-95
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className}
      `}
      aria-label={label}
    >
      <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
      <span className="font-medium">{label}</span>
    </button>
  );
}
