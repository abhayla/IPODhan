/**
 * CollapsibleSection Component
 *
 * Reusable collapsible section with smooth animations and keyboard accessibility.
 * Used for progressive disclosure in IPO detail page.
 *
 * Features:
 * - Smooth expand/collapse animation (300ms)
 * - Keyboard accessible (Enter/Space to toggle)
 * - Icon indicator (chevron rotation)
 * - Optional default expanded state
 * - ARIA compliant for screen readers
 *
 * @example
 * ```tsx
 * <CollapsibleSection
 *   title="Financial Performance"
 *   defaultExpanded={true}
 *   id="financial-section"
 * >
 *   <FinancialPerformanceCharts />
 * </CollapsibleSection>
 * ```
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';

// ==================== TYPES ====================

export interface CollapsibleSectionProps {
  /**
   * Section title displayed in header
   */
  title: string;

  /**
   * Optional subtitle or description
   */
  subtitle?: string;

  /**
   * Content to show when expanded
   */
  children: React.ReactNode;

  /**
   * Whether section is expanded by default (uncontrolled mode)
   * @default false
   */
  defaultExpanded?: boolean;

  /**
   * Whether section is expanded (controlled mode)
   * If provided, component will be controlled and defaultExpanded is ignored
   */
  expanded?: boolean;

  /**
   * Unique ID for section (used for ARIA and accessibility)
   */
  id: string;

  /**
   * Optional CSS class for custom styling
   */
  className?: string;

  /**
   * Optional badge or count to display in header
   */
  badge?: string | number;

  /**
   * Optional icon component to display before title
   */
  icon?: React.ReactNode;

  /**
   * Callback when expanded state changes
   */
  onExpandedChange?: (expanded: boolean) => void;

  /**
   * Whether to animate the height transition
   * @default true
   */
  animated?: boolean;

  /**
   * Animation duration in milliseconds
   * @default 300
   */
  animationDuration?: number;
}

// ==================== COMPONENT ====================

export function CollapsibleSection({
  title,
  subtitle,
  children,
  defaultExpanded = false,
  expanded: controlledExpanded,
  id,
  className = '',
  badge,
  icon,
  onExpandedChange,
  animated = true,
  animationDuration = 300,
}: CollapsibleSectionProps) {
  // Determine if component is controlled
  const isControlled = controlledExpanded !== undefined;

  // Check user's motion preference (accessibility)
  const prefersReducedMotion = useReducedMotion();

  // Internal state for uncontrolled mode
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(defaultExpanded);

  // Use controlled or uncontrolled value
  const isExpanded = isControlled ? controlledExpanded : uncontrolledExpanded;

  const [height, setHeight] = useState<number | 'auto'>(defaultExpanded ? 'auto' : 0);
  const contentRef = useRef<HTMLDivElement>(null);

  // Disable animations if user prefers reduced motion (accessibility)
  const shouldAnimate = animated && !prefersReducedMotion;

  // Update height when expanded state changes
  useEffect(() => {
    if (!shouldAnimate) {
      setHeight(isExpanded ? 'auto' : 0);
      return;
    }

    if (isExpanded) {
      // Get scroll height and set it for animation
      const scrollHeight = contentRef.current?.scrollHeight || 0;
      setHeight(scrollHeight);

      // After animation, set to 'auto' to allow dynamic content
      const timer = setTimeout(() => {
        setHeight('auto');
      }, animationDuration);

      return () => clearTimeout(timer);
    } else {
      // First set to actual height for animation start
      const scrollHeight = contentRef.current?.scrollHeight || 0;
      setHeight(scrollHeight);

      // Then animate to 0
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setHeight(0);
        });
      });
    }
  }, [isExpanded, shouldAnimate, animationDuration]);

  // Toggle expanded state
  const toggleExpanded = () => {
    const newExpanded = !isExpanded;

    // Update internal state if uncontrolled
    if (!isControlled) {
      setUncontrolledExpanded(newExpanded);
    }

    // Always call callback (allows controlled mode to update parent state)
    onExpandedChange?.(newExpanded);
  };

  // Handle keyboard events (Enter and Space)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleExpanded();
    }
  };

  return (
    <div className={`border border-gray-200 rounded-lg overflow-hidden ${className}`}>
      {/* Header - Clickable toggle */}
      <button
        type="button"
        onClick={toggleExpanded}
        onKeyDown={handleKeyDown}
        aria-expanded={isExpanded}
        aria-controls={`${id}-content`}
        className="w-full flex items-center justify-between p-4 bg-white hover:bg-gray-50 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-inset"
      >
        <div className="flex items-center gap-3 flex-1">
          {/* Optional icon */}
          {icon && <div className="text-gray-500">{icon}</div>}

          {/* Title and subtitle */}
          <div className="flex flex-col items-start text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
              {badge && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                  {badge}
                </span>
              )}
            </div>
            {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
          </div>
        </div>

        {/* Chevron indicator */}
        <div
          className={shouldAnimate ? "ml-4 transition-transform duration-300 ease-in-out" : "ml-4"}
          style={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <ChevronDownIcon className="h-5 w-5 text-gray-500" aria-hidden="true" />
        </div>
      </button>

      {/* Content - Collapsible */}
      <div
        ref={contentRef}
        id={`${id}-content`}
        role="region"
        aria-labelledby={`${id}-header`}
        style={{
          height: height,
          overflow: isExpanded && height === 'auto' ? 'visible' : 'hidden',
          transition: shouldAnimate ? `height ${animationDuration}ms ease-in-out` : 'none',
        }}
      >
        <div className="p-4 pt-0 bg-white">{children}</div>
      </div>
    </div>
  );
}

// ==================== COMPOUND COMPONENT: CollapsibleSection.Header ====================

/**
 * Custom header for CollapsibleSection
 * Allows more control over header content
 */
CollapsibleSection.Header = function CollapsibleSectionHeader({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex-1">{children}</div>;
};

// ==================== COMPOUND COMPONENT: CollapsibleSection.Content ====================

/**
 * Custom content wrapper for CollapsibleSection
 * Provides consistent padding and styling
 */
CollapsibleSection.Content = function CollapsibleSectionContent({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`space-y-4 ${className}`}>{children}</div>;
};
