'use client';

import React, { useState } from 'react';
import { useGestures } from '@/hooks/use-gestures';
import { Bookmark, Share2, TrendingUp, X } from 'lucide-react';

/**
 * SwipeableIPOCard Component - Swipeable IPO Card with Quick Actions
 *
 * Phase 4: Mobile Excellence
 *
 * Features:
 * - Swipe left to reveal quick actions (save, share, compare)
 * - Swipe right to dismiss
 * - Smooth spring animations
 * - Long press for additional options
 * - Visual feedback
 * - Accessibility support
 *
 * Integration:
 * - Phase 1: Uses IPOCardEnhanced as base
 * - Phase 3: Can trigger live updates
 *
 * @example
 * <SwipeableIPOCard
 *   ipoId="xyz-123"
 *   onSave={(id) => console.log('Save', id)}
 *   onShare={(id) => console.log('Share', id)}
 *   onCompare={(id) => console.log('Compare', id)}
 *   onDismiss={(id) => console.log('Dismiss', id)}
 * >
 *   <IPOCardEnhanced {...ipoData} />
 * </SwipeableIPOCard>
 */

export interface SwipeableIPOCardProps {
  children: React.ReactNode;
  ipoId: string;
  onSave?: (ipoId: string) => void;
  onShare?: (ipoId: string) => void;
  onCompare?: (ipoId: string) => void;
  onDismiss?: (ipoId: string) => void;
  onLongPress?: (ipoId: string) => void;
  disabled?: boolean;
}

export function SwipeableIPOCard({
  children,
  ipoId,
  onSave,
  onShare,
  onCompare,
  onDismiss,
  onLongPress,
  disabled = false,
}: SwipeableIPOCardProps) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const SWIPE_THRESHOLD = 80;
  const ACTION_REVEAL_THRESHOLD = 60;

  // Handle swipe gestures
  const bind = useGestures({
    onSwipeLeft: ({ distance }) => {
      if (disabled) return;

      if (distance > SWIPE_THRESHOLD) {
        setShowActions(true);
        setSwipeOffset(-ACTION_REVEAL_THRESHOLD);
      }
    },
    onSwipeRight: ({ distance }) => {
      if (disabled) return;

      if (distance > SWIPE_THRESHOLD && showActions) {
        // Close actions
        setShowActions(false);
        setSwipeOffset(0);
      } else if (distance > SWIPE_THRESHOLD && !showActions) {
        // Dismiss card
        onDismiss?.(ipoId);
      }
    },
    onLongPress: () => {
      if (disabled) return;
      onLongPress?.(ipoId);
    },
    enabled: !disabled,
  });

  // Quick action buttons
  const actions = [
    {
      icon: <Bookmark className="w-5 h-5" />,
      label: 'Save',
      onClick: () => {
        onSave?.(ipoId);
        setShowActions(false);
        setSwipeOffset(0);
      },
      color: 'bg-primary-500 hover:bg-primary-600',
    },
    {
      icon: <Share2 className="w-5 h-5" />,
      label: 'Share',
      onClick: () => {
        onShare?.(ipoId);
        setShowActions(false);
        setSwipeOffset(0);
      },
      color: 'bg-accent-500 hover:bg-accent-600',
    },
    {
      icon: <TrendingUp className="w-5 h-5" />,
      label: 'Compare',
      onClick: () => {
        onCompare?.(ipoId);
        setShowActions(false);
        setSwipeOffset(0);
      },
      color: 'bg-secondary-500 hover:bg-secondary-600',
    },
  ];

  return (
    <div className="relative overflow-hidden" data-testid="swipeable-card" data-swipeable="true">
      {/* Quick Actions (Hidden by default) */}
      <div
        className={`
          absolute inset-y-0 right-0 flex items-center gap-2 px-4
          transition-opacity duration-200
          ${showActions ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
        data-testid="quick-actions"
      >
        {actions.map((action, index) => (
          <button
            key={action.label}
            onClick={action.onClick}
            className={`
              flex items-center justify-center
              w-12 h-12 rounded-full
              text-white shadow-lg
              transition-all duration-200
              hover:scale-110 active:scale-95
              ${action.color}
            `}
            style={{
              transitionDelay: showActions ? `${index * 50}ms` : '0ms',
            }}
            aria-label={action.label}
          >
            {action.icon}
          </button>
        ))}
      </div>

      {/* Card Content (Swipeable) */}
      <div
        {...bind()}
        className={`
          relative touch-pan-y
          transition-transform duration-200 ease-out
          ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}
        `}
        style={{
          transform: `translateX(${swipeOffset}px)`,
        }}
      >
        {children}
      </div>

      {/* Swipe Hint (First time only - could use localStorage to track) */}
      {!showActions && (
        <div
          className="absolute top-1/2 right-4 -translate-y-1/2
            opacity-20 pointer-events-none
            md:hidden"
          aria-hidden="true"
        >
          <div className="flex gap-1">
            <ChevronLeft className="w-4 h-4 text-gray-400 animate-pulse" />
            <ChevronLeft
              className="w-4 h-4 text-gray-400 animate-pulse"
              style={{ animationDelay: '0.1s' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Import ChevronLeft for swipe hint
import { ChevronLeft } from 'lucide-react';

/**
 * DismissibleIPOCard Component - Simplified swipeable card (swipe right to dismiss only)
 *
 * @example
 * <DismissibleIPOCard onDismiss={(id) => removeFromList(id)}>
 *   <IPOCardEnhanced {...ipoData} />
 * </DismissibleIPOCard>
 */
export interface DismissibleIPOCardProps {
  children: React.ReactNode;
  ipoId: string;
  onDismiss: (ipoId: string) => void;
}

export function DismissibleIPOCard({ children, ipoId, onDismiss }: DismissibleIPOCardProps) {
  const [isExiting, setIsExiting] = useState(false);

  const bind = useGestures({
    onSwipeRight: ({ distance }) => {
      if (distance > 100) {
        setIsExiting(true);
        setTimeout(() => {
          onDismiss(ipoId);
        }, 300);
      }
    },
  });

  return (
    <div
      {...bind()}
      className={`
        touch-pan-y transition-all duration-300
        ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
      `}
    >
      {children}
    </div>
  );
}
