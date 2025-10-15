'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { SubscriptionViewMode } from '@/lib/utils/subscription-utils';

interface SubscriptionViewToggleProps {
  currentView: SubscriptionViewMode;
  onViewChange: (view: SubscriptionViewMode) => void;
}

/**
 * SubscriptionViewToggle Component
 *
 * Toggle between simple (3 categories) and detailed (7 categories) subscription views.
 * Story 5.6: Enhanced Subscription Breakdown - AC 3
 */
export function SubscriptionViewToggle({
  currentView,
  onViewChange,
}: SubscriptionViewToggleProps) {
  return (
    <Tabs
      value={currentView}
      onValueChange={(value) => onViewChange(value as SubscriptionViewMode)}
      className="w-full sm:w-auto"
    >
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="simple" className="text-sm">
          Simple View
        </TabsTrigger>
        <TabsTrigger value="detailed" className="text-sm">
          Detailed View
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
