'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Sparkles, X, RotateCcw } from 'lucide-react';
import { getBehaviorTracker } from '@/lib/personalization/behavior-tracker';
import type { UserPreferences } from '@/lib/personalization/user-profile';

/**
 * SmartDefaultFilters Component - Phase 5: Personalization Engine
 *
 * Automatically pre-fills filter controls based on user preferences
 * learned from browsing behavior.
 *
 * Features:
 * - Auto-applies learned preferences on mount (opt-in)
 * - Shows indicator when personalized filters are active
 * - Allows users to clear personalized defaults
 * - Respects user's manual filter changes
 * - Non-intrusive: only applies when no filters are set
 *
 * Integration:
 * - Uses behavior tracker to get user preferences
 * - Updates URL search params (same as FilterBar)
 * - Works alongside existing filter components
 *
 * @example
 * <SmartDefaultFilters />
 */

export interface SmartDefaultFiltersProps {
  /**
   * Whether to automatically apply personalized filters on mount
   * Default: true (but only if no filters are currently set)
   */
  autoApply?: boolean;

  /**
   * Minimum profile strength (0-100) required to apply smart defaults
   * Default: 30 (same threshold as recommendation engine)
   */
  minProfileStrength?: number;

  className?: string;
}

export function SmartDefaultFilters({
  autoApply = true,
  minProfileStrength = 30,
  className = '',
}: SmartDefaultFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [profileStrength, setProfileStrength] = useState(0);
  const [isSmartFiltersActive, setIsSmartFiltersActive] = useState(false);
  const [hasUserFilters, setHasUserFilters] = useState(false);

  // Load user preferences on mount
  useEffect(() => {
    try {
      const tracker = getBehaviorTracker();
      const profile = tracker.getProfile();
      const prefs = profile.preferences;

      // Calculate profile strength (simplified from recommendation engine)
      const strength = Math.min(
        100,
        profile.history.viewedIPOs.length * 2 +
          profile.history.savedIPOs.length * 4 +
          profile.history.searchHistory.length
      );

      setPreferences(prefs);
      setProfileStrength(strength);
    } catch (error) {
      console.error('[SmartDefaultFilters] Failed to load preferences:', error);
    }
  }, []);

  // Check if user has manually set any filters
  useEffect(() => {
    const hasFilters =
      searchParams.get('segment') !== null ||
      searchParams.get('sector') !== null ||
      searchParams.get('scoreRange') !== null ||
      (searchParams.get('status') !== null && searchParams.get('status') !== 'OPEN');

    setHasUserFilters(hasFilters);
  }, [searchParams]);

  // Apply smart defaults when ready
  useEffect(() => {
    if (!autoApply || !preferences || profileStrength < minProfileStrength) {
      return;
    }

    // Don't override user's manual filters
    if (hasUserFilters) {
      return;
    }

    // Check if smart filters were already applied this session
    const appliedThisSession = sessionStorage.getItem('smart-filters-applied');
    if (appliedThisSession === 'true') {
      return;
    }

    applySmartDefaults();
    sessionStorage.setItem('smart-filters-applied', 'true');
  }, [preferences, profileStrength, hasUserFilters, autoApply, minProfileStrength]);

  /**
   * Apply personalized filter defaults based on learned preferences
   */
  const applySmartDefaults = useCallback(() => {
    if (!preferences) return;

    const params = new URLSearchParams(searchParams);
    let filtersApplied = false;

    // Apply favorite sectors (use first favorite)
    if (preferences.favoriteSectors.length > 0) {
      const topSector = preferences.favoriteSectors[0];
      params.set('sector', topSector);
      filtersApplied = true;
    }

    // Apply preferred segments
    if (preferences.preferredSegments.length > 0) {
      const segment = preferences.preferredSegments[0];
      params.set('segment', segment);
      filtersApplied = true;
    }

    // Apply min score threshold
    if (preferences.minScoreThreshold > 6) {
      const scoreRange = `${preferences.minScoreThreshold}-10`;
      params.set('scoreRange', scoreRange);
      filtersApplied = true;
    }

    // Apply default sort
    if (preferences.defaultSort !== 'score') {
      params.set('sort', preferences.defaultSort);
      filtersApplied = true;
    }

    if (filtersApplied) {
      params.set('page', '1');
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
      setIsSmartFiltersActive(true);
    }
  }, [preferences, searchParams, pathname, router]);

  /**
   * Clear personalized filters and reset to defaults
   */
  const clearSmartDefaults = useCallback(() => {
    const params = new URLSearchParams(searchParams);

    // Remove personalized filters
    params.delete('sector');
    params.delete('segment');
    params.delete('scoreRange');
    params.delete('sort');

    // Reset to default status
    params.set('status', 'OPEN');
    params.set('offeringType', 'IPO,FPO');
    params.set('page', '1');

    router.push(`${pathname}?${params.toString()}`, { scroll: false });
    setIsSmartFiltersActive(false);
    sessionStorage.removeItem('smart-filters-applied');
  }, [searchParams, pathname, router]);

  /**
   * Manually trigger smart defaults
   */
  const triggerSmartDefaults = useCallback(() => {
    applySmartDefaults();
    sessionStorage.setItem('smart-filters-applied', 'true');
  }, [applySmartDefaults]);

  // Don't show anything if profile is too weak
  if (profileStrength < minProfileStrength) {
    return null;
  }

  // Show different UI based on whether smart filters are active
  if (isSmartFiltersActive || hasUserFilters) {
    return (
      <div className={`smart-defaults-active ${className}`}>
        {/* Indicator that smart filters are active */}
        <div className="flex items-center justify-between p-3 mb-4 rounded-lg bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary animate-pulse" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                Personalized filters active
              </span>
              <span className="text-xs text-muted-foreground">
                Based on your browsing preferences
              </span>
            </div>
          </div>

          {/* Clear button */}
          <button
            onClick={clearSmartDefaults}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-background hover:bg-muted border border-border text-foreground text-xs font-medium transition-colors"
            title="Clear personalized filters"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>
      </div>
    );
  }

  // Show suggestion to apply smart defaults
  return (
    <div className={`smart-defaults-suggestion ${className}`}>
      <div className="flex items-center justify-between p-3 mb-4 rounded-lg bg-muted/50 border border-border/50">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">
              Apply personalized filters?
            </span>
            <span className="text-xs text-muted-foreground">
              We've learned your preferences ({profileStrength}% profile strength)
            </span>
          </div>
        </div>

        {/* Apply button */}
        <div className="flex items-center gap-2">
          <button
            onClick={triggerSmartDefaults}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Apply
          </button>

          <button
            onClick={() => {
              sessionStorage.setItem('smart-filters-applied', 'true');
              setIsSmartFiltersActive(false);
            }}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to get current smart filter status
 */
export function useSmartFilterStatus() {
  const searchParams = useSearchParams();
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);

  useEffect(() => {
    try {
      const tracker = getBehaviorTracker();
      setPreferences(tracker.getPreferences());
    } catch (error) {
      console.error('[useSmartFilterStatus] Failed to load preferences:', error);
    }
  }, []);

  const isSmartFiltersActive = React.useMemo(() => {
    if (!preferences) return false;

    const sector = searchParams.get('sector');
    const segment = searchParams.get('segment');
    const scoreRange = searchParams.get('scoreRange');

    // Check if current filters match learned preferences
    const sectorMatches = preferences.favoriteSectors.includes(sector || '');
    const segmentMatches = preferences.preferredSegments.includes(segment as any);
    const scoreMatches = scoreRange?.startsWith(String(preferences.minScoreThreshold));

    return sectorMatches || segmentMatches || scoreMatches;
  }, [preferences, searchParams]);

  return {
    isSmartFiltersActive,
    preferences,
  };
}

export default SmartDefaultFilters;
