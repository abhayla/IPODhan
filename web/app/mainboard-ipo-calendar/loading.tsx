/**
 * Loading State for Mainboard IPO Calendar Page
 *
 * Displays skeleton UI while calendar data is being fetched.
 */

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header Skeleton */}
      <div className="space-y-2 mb-6">
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </div>

      {/* Event Legend Skeleton */}
      <Skeleton className="h-20 w-full mb-6" />

      {/* Search Skeleton */}
      <Skeleton className="h-10 w-full mb-6" />

      {/* Month Navigation Skeleton */}
      <div className="flex items-center justify-between gap-4 py-4 mb-6">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-9 w-24" />
      </div>

      {/* Calendar Grid Skeleton (Desktop) */}
      <div className="hidden md:block space-y-2">
        {/* Week headers */}
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>

        {/* Calendar grid */}
        {Array.from({ length: 5 }).map((_, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, dayIndex) => (
              <Skeleton key={dayIndex} className="h-24" />
            ))}
          </div>
        ))}
      </div>

      {/* List View Skeleton (Mobile) */}
      <div className="md:hidden space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}
