/**
 * IPOViewTracker - Phase 5: Personalization Engine
 *
 * Tracks when users view IPO detail pages for personalization.
 * Automatically updates user profile in localStorage.
 */

'use client';

import { useEffect } from 'react';
import { BehaviorTracker } from '@/lib/personalization/behavior-tracker';

interface IPOViewTrackerProps {
  ipoId: string;
  slug: string;
  companyName: string;
}

export function IPOViewTracker({
  ipoId,
  slug,
  companyName,
}: IPOViewTrackerProps) {
  useEffect(() => {
    // Track IPO view on mount
    const tracker = new BehaviorTracker();
    tracker.trackIPOView(ipoId, slug, companyName);
  }, [ipoId, slug, companyName]);

  // This component doesn't render anything
  return null;
}
