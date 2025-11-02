/**
 * SectionControlBar Component
 *
 * Global control bar for managing collapsible sections on IPO detail page.
 * Provides "Expand All" / "Collapse All" functionality.
 *
 * Features:
 * - Toggle all sections at once
 * - Section count display
 * - Keyboard accessible
 * - Responsive design (sticky on desktop, inline on mobile)
 * - ARIA compliant
 *
 * @example
 * ```tsx
 * <SectionControlBar
 *   sectionCount={9}
 *   allExpanded={allExpanded}
 *   onToggleAll={(shouldExpand) => setAllExpanded(shouldExpand)}
 * />
 * ```
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import {
  ChevronDoubleDownIcon,
  ChevronDoubleUpIcon,
  AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/outline';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';

// ==================== TYPES ====================

export interface SectionControlBarProps {
  /**
   * Total number of collapsible sections
   */
  sectionCount: number;

  /**
   * Whether all sections are currently expanded
   */
  allExpanded: boolean;

  /**
   * Callback when toggle all button is clicked
   * @param shouldExpand - true to expand all, false to collapse all
   */
  onToggleAll: (shouldExpand: boolean) => void;

  /**
   * Optional CSS class for custom styling
   */
  className?: string;

  /**
   * Whether to make the bar sticky (desktop only)
   * @default true
   */
  sticky?: boolean;

  /**
   * Z-index for sticky positioning
   * @default 30
   */
  zIndex?: number;
}

// ==================== COMPONENT ====================

export function SectionControlBar({
  sectionCount,
  allExpanded,
  onToggleAll,
  className = '',
  sticky = true,
  zIndex = 30,
}: SectionControlBarProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleToggle = () => {
    onToggleAll(!allExpanded);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle();
    }
  };

  return (
    <div
      className={`
        ${sticky ? 'sticky top-0 lg:top-16' : ''}
        ${className}
      `}
      style={{
        zIndex: sticky ? zIndex : undefined,
      }}
    >
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 border-y border-gray-200 shadow-sm">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Section count info */}
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <AdjustmentsHorizontalIcon className="h-4 w-4" aria-hidden="true" />
              <span className="font-medium">
                {sectionCount} {sectionCount === 1 ? 'section' : 'sections'}
              </span>
            </div>

            {/* Toggle all button */}
            <button
              type="button"
              onClick={handleToggle}
              onKeyDown={handleKeyDown}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              aria-label={allExpanded ? 'Collapse all sections' : 'Expand all sections'}
              aria-pressed={allExpanded}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg
                font-medium text-sm
                transition-all duration-200
                focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
                ${
                  allExpanded
                    ? 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                    : 'bg-primary-600 text-white hover:bg-primary-700 border border-primary-600'
                }
              `}
            >
              {allExpanded ? (
                <>
                  <ChevronDoubleUpIcon
                    className={`h-4 w-4 transition-transform duration-200 ${
                      isHovered ? '-translate-y-0.5' : ''
                    }`}
                    aria-hidden="true"
                  />
                  <span>Collapse All</span>
                </>
              ) : (
                <>
                  <ChevronDoubleDownIcon
                    className={`h-4 w-4 transition-transform duration-200 ${
                      isHovered ? 'translate-y-0.5' : ''
                    }`}
                    aria-hidden="true"
                  />
                  <span>Expand All</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== HELPER HOOK ====================

/**
 * Custom hook to manage section expanded states with staggered animations
 * and localStorage persistence
 * @param sectionIds - Array of section IDs
 * @param defaultExpanded - Whether sections are expanded by default
 * @returns Object with expanded states and control functions
 */
export function useSectionControl(sectionIds: string[], defaultExpanded: boolean = false) {
  const STORAGE_KEY = 'ipo-detail-sections-state';

  // Initialize state with localStorage or defaults
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    // Try to load from localStorage
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Record<string, boolean>;

          // Validate that saved state contains all current section IDs
          const hasAllSections = sectionIds.every((id) => id in parsed);
          if (hasAllSections) {
            return parsed;
          }
        }
      } catch (error) {
        // Invalid JSON or localStorage error - fall through to defaults
        console.warn('Failed to load section state from localStorage:', error);
      }
    }

    // Fallback to default state
    const initial: Record<string, boolean> = {};
    sectionIds.forEach((id) => {
      initial[id] = defaultExpanded;
    });
    return initial;
  });

  // Ref to store timeout IDs for cleanup
  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);

  // Detect reduced motion preference
  const prefersReducedMotion = useReducedMotion();

  // Save to localStorage whenever state changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(expandedSections));
      } catch (error) {
        // localStorage might be full or disabled - ignore silently
        console.warn('Failed to save section state to localStorage:', error);
      }
    }
  }, [expandedSections]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      timeoutsRef.current = [];
    };
  }, []);

  const allExpanded = sectionIds.every((id) => expandedSections[id]);
  const allCollapsed = sectionIds.every((id) => !expandedSections[id]);

  /**
   * Toggle all sections with optional staggered animation
   * - If user prefers reduced motion: instant (no stagger)
   * - Otherwise: 50ms stagger delay between sections for smooth visual effect
   */
  const toggleAll = (shouldExpand: boolean) => {
    // Clear any existing timeouts
    timeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    timeoutsRef.current = [];

    if (prefersReducedMotion) {
      // Instant toggle for users who prefer reduced motion
      const updated: Record<string, boolean> = {};
      sectionIds.forEach((id) => {
        updated[id] = shouldExpand;
      });
      setExpandedSections(updated);
    } else {
      // Staggered animation for smooth visual effect
      sectionIds.forEach((id, index) => {
        const timeout = setTimeout(() => {
          setExpandedSections((prev) => ({
            ...prev,
            [id]: shouldExpand,
          }));
        }, index * 50); // 50ms stagger delay

        timeoutsRef.current.push(timeout);
      });
    }
  };

  const toggleSection = (id: string, isExpanded: boolean) => {
    setExpandedSections((prev) => ({
      ...prev,
      [id]: isExpanded,
    }));
  };

  const expandSection = (id: string) => toggleSection(id, true);
  const collapseSection = (id: string) => toggleSection(id, false);

  /**
   * Reset all sections to default state and clear localStorage
   */
  const resetToDefaults = () => {
    const defaults: Record<string, boolean> = {};
    sectionIds.forEach((id) => {
      defaults[id] = defaultExpanded;
    });
    setExpandedSections(defaults);

    // Clear localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        console.warn('Failed to clear section state from localStorage:', error);
      }
    }
  };

  return {
    expandedSections,
    allExpanded,
    allCollapsed,
    toggleAll,
    toggleSection,
    expandSection,
    collapseSection,
    resetToDefaults,
  };
}
