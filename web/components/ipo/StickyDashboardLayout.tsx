'use client';

import { useState, useEffect } from 'react';
import { IPOTimelineWidget } from './IPOTimelineWidget';
import { KeyMetricsCardsEnhanced } from './KeyMetricsCardsEnhanced';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { IPO } from '@/lib/db/types';
import type { SubscriptionDataRaw, GMPRecordRaw } from '@/components/ipo/charts';

interface StickyDashboardLayoutProps {
  /** IPO data for timeline */
  ipo: Pick<IPO, 'openDate' | 'closeDate' | 'allotmentDate' | 'listingDate' | 'status'>;
  /** Issue size for metrics */
  issueSize: number;
  /** Current subscription value */
  subscription: number | null;
  /** Subscription trend */
  subscriptionTrend?: 'up' | 'down' | 'neutral';
  /** Current GMP value */
  gmp: number | null;
  /** GMP percentage */
  gmpPercent: number | null;
  /** Historical subscription data */
  subscriptions?: SubscriptionDataRaw[];
  /** Historical GMP data */
  gmpRecords?: GMPRecordRaw[];
  /** Custom class name */
  className?: string;
  /** Enable sticky behavior (default: true) */
  enableSticky?: boolean;
  /** Collapse on mobile (default: true) */
  collapseOnMobile?: boolean;
}

/**
 * StickyDashboardLayout - Sticky header with timeline and key metrics
 *
 * Features:
 * - Sticky positioning on scroll
 * - Collapsible on mobile for better UX
 * - Auto-compact mode when sticky
 * - Smooth animations
 * - Responsive design
 *
 * @example
 * ```tsx
 * <StickyDashboardLayout
 *   ipo={ipoData}
 *   issueSize={500000000}
 *   subscription={2.5}
 *   gmp={50}
 *   gmpPercent={10}
 *   subscriptions={subscriptionData}
 *   gmpRecords={gmpData}
 * />
 * ```
 */
export function StickyDashboardLayout({
  ipo,
  issueSize,
  subscription,
  subscriptionTrend = 'neutral',
  gmp,
  gmpPercent,
  subscriptions = [],
  gmpRecords = [],
  className,
  enableSticky = true,
  collapseOnMobile = true,
}: StickyDashboardLayoutProps) {
  const [isSticky, setIsSticky] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Track scroll position to determine sticky state
  useEffect(() => {
    if (!enableSticky) return;

    const handleScroll = () => {
      const scrollPosition = window.scrollY;
      // Become sticky after scrolling past initial view (~400px)
      setIsSticky(scrollPosition > 400);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [enableSticky]);

  // Auto-collapse on mobile when sticky
  useEffect(() => {
    if (collapseOnMobile && isMobile && isSticky) {
      setIsCollapsed(true);
    }
  }, [isMobile, isSticky, collapseOnMobile]);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div
      className={cn(
        'transition-all duration-300 z-40',
        enableSticky && isSticky && 'sticky top-0 shadow-md',
        className
      )}
    >
      <div
        className={cn(
          'bg-background/95 backdrop-blur-sm border-b',
          isSticky && 'border-border'
        )}
      >
        <div className="container mx-auto px-4">
          {/* Collapse Toggle (mobile only, when sticky) */}
          {isMobile && isSticky && (
            <button
              onClick={toggleCollapse}
              className="w-full py-2 flex items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              aria-label={isCollapsed ? 'Expand dashboard' : 'Collapse dashboard'}
            >
              <span>{isCollapsed ? 'Show Dashboard' : 'Hide Dashboard'}</span>
              {isCollapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>
          )}

          {/* Dashboard Content */}
          <div
            className={cn(
              'transition-all duration-300 overflow-hidden',
              isCollapsed ? 'max-h-0 py-0' : 'max-h-[1000px] py-4'
            )}
          >
            <div className="space-y-4">
              {/* Timeline Widget */}
              <IPOTimelineWidget
                ipo={ipo}
                compact={isSticky}
              />

              {/* Key Metrics Cards */}
              <KeyMetricsCardsEnhanced
                issueSize={issueSize}
                subscription={subscription}
                subscriptionTrend={subscriptionTrend}
                gmp={gmp}
                gmpPercent={gmpPercent}
                subscriptions={subscriptions}
                gmpRecords={gmpRecords}
                showSparklines={!isSticky} // Hide sparklines when sticky for compactness
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
