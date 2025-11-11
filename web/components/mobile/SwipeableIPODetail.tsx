'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSwipeNavigation } from '@/hooks/use-gestures';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * SwipeableIPODetail Component - Swipeable IPO Detail Container
 *
 * Phase 4: Mobile Excellence
 *
 * Features:
 * - Swipe left/right to navigate between IPOs
 * - Visual feedback during swipe
 * - Navigation hints (arrows)
 * - Smooth transitions
 * - Keyboard navigation support (arrow keys)
 * - Accessibility: ARIA labels
 *
 * Integration:
 * - Phase 1: Uses smooth 60fps animations
 * - Phase 3: Can fetch next/previous IPO data
 *
 * @example
 * <SwipeableIPODetail
 *   currentSlug="xyz-ipo"
 *   previousSlug="abc-ipo"
 *   nextSlug="def-ipo"
 * >
 *   <IPODetailContent />
 * </SwipeableIPODetail>
 */

export interface SwipeableIPODetailProps {
  children: React.ReactNode;
  currentSlug: string;
  previousSlug?: string | null;
  nextSlug?: string | null;
  onNavigate?: (slug: string, direction: 'previous' | 'next') => void;
}

export function SwipeableIPODetail({
  children,
  currentSlug,
  previousSlug,
  nextSlug,
  onNavigate,
}: SwipeableIPODetailProps) {
  const router = useRouter();
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Navigate to previous IPO
  const handlePrevious = () => {
    if (previousSlug && !isTransitioning) {
      setIsTransitioning(true);
      onNavigate?.(previousSlug, 'previous');
      router.push(`/ipos/${previousSlug}`);
    }
  };

  // Navigate to next IPO
  const handleNext = () => {
    if (nextSlug && !isTransitioning) {
      setIsTransitioning(true);
      onNavigate?.(nextSlug, 'next');
      router.push(`/ipos/${nextSlug}`);
    }
  };

  // Bind swipe gestures
  const bind = useSwipeNavigation({
    onPrevious: handlePrevious,
    onNext: handleNext,
    threshold: 80, // 80px swipe to navigate
  });

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && previousSlug) {
        handlePrevious();
      } else if (e.key === 'ArrowRight' && nextSlug) {
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previousSlug, nextSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      {...bind()}
      className="relative min-h-screen touch-pan-y"
      style={{
        transform: `translateX(${swipeOffset}px)`,
        transition: isTransitioning ? 'transform 0.3s ease-out' : 'none',
      }}
    >
      {/* Content */}
      {children}

      {/* Navigation Hints (Mobile Only) */}
      <div className="fixed inset-y-0 left-0 right-0 pointer-events-none z-40 md:hidden">
        {/* Previous hint */}
        {previousSlug && (
          <div
            className="absolute left-4 top-1/2 -translate-y-1/2
              w-12 h-12 flex items-center justify-center
              bg-white/90 dark:bg-gray-800/90 rounded-full shadow-lg
              opacity-0 hover:opacity-100 transition-opacity duration-200"
            aria-label="Swipe right to view previous IPO"
          >
            <ChevronLeft className="w-6 h-6 text-gray-700 dark:text-gray-300" />
          </div>
        )}

        {/* Next hint */}
        {nextSlug && (
          <div
            className="absolute right-4 top-1/2 -translate-y-1/2
              w-12 h-12 flex items-center justify-center
              bg-white/90 dark:bg-gray-800/90 rounded-full shadow-lg
              opacity-0 hover:opacity-100 transition-opacity duration-200"
            aria-label="Swipe left to view next IPO"
          >
            <ChevronRight className="w-6 h-6 text-gray-700 dark:text-gray-300" />
          </div>
        )}
      </div>

      {/* Desktop Navigation Buttons */}
      <div className="hidden md:flex fixed bottom-8 left-1/2 -translate-x-1/2 gap-4 z-40">
        {previousSlug && (
          <button
            onClick={handlePrevious}
            disabled={isTransitioning}
            className="flex items-center gap-2 px-4 py-2
              bg-white dark:bg-gray-800 rounded-full shadow-lg
              hover:bg-gray-50 dark:hover:bg-gray-700
              transition-all duration-200 hover:scale-105
              disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Previous IPO"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="text-sm font-medium">Previous</span>
          </button>
        )}

        {nextSlug && (
          <button
            onClick={handleNext}
            disabled={isTransitioning}
            className="flex items-center gap-2 px-4 py-2
              bg-white dark:bg-gray-800 rounded-full shadow-lg
              hover:bg-gray-50 dark:hover:bg-gray-700
              transition-all duration-200 hover:scale-105
              disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Next IPO"
          >
            <span className="text-sm font-medium">Next</span>
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * useIPONavigation Hook - Helper for getting previous/next IPO slugs
 *
 * This hook would typically fetch the adjacent IPOs based on current filters/sort.
 * Placeholder implementation below.
 *
 * @example
 * const { previousSlug, nextSlug } = useIPONavigation(currentSlug);
 */
export function useIPONavigation(currentSlug: string): {
  previousSlug: string | null;
  nextSlug: string | null;
  isLoading: boolean;
} {
  // TODO: Implement actual logic to fetch adjacent IPO slugs
  // This would typically:
  // 1. Get current filter/sort settings from localStorage or context
  // 2. Fetch list of IPO slugs matching those filters
  // 3. Find current slug in list
  // 4. Return previous and next slugs

  // Placeholder implementation
  return {
    previousSlug: null,
    nextSlug: null,
    isLoading: false,
  };
}
