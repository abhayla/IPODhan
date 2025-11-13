/**
 * PeerComparisonEmptyState Component
 *
 * Empty state shown when no peer comparison data is available.
 *
 * Story 4.8: Peer Comparison Tab
 */

'use client';

import { TrendingUp } from 'lucide-react';

/**
 * PeerComparisonEmptyState component
 * Displays when no peer data exists
 */
export function PeerComparisonEmptyState() {
  return (
    <div className="rounded-lg border bg-card p-12 text-center">
      <div className="flex justify-center mb-4">
        <div className="rounded-full bg-muted p-4">
          <TrendingUp className="h-8 w-8 text-muted-foreground" />
        </div>
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        Peer Comparison Data Not Available
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">
        Peer comparison data for this IPO is not yet available.
        Check back later as we continue to update our database with peer company information.
      </p>
    </div>
  );
}
