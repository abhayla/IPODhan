import { IPOGridSkeleton } from '@/components/shared/IPOGridSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8" aria-busy="true" aria-live="polite">
      <div className="sr-only">Loading IPO dashboard...</div>

      {/* Header skeleton */}
      <div className="mb-8 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-96" />
      </div>

      {/* Filter bar skeleton */}
      <div className="mb-6 flex flex-wrap gap-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-48" />
      </div>

      {/* Grid of loading skeletons */}
      <IPOGridSkeleton count={12} />

      {/* Pagination skeleton */}
      <div className="mt-8 flex justify-center">
        <Skeleton className="h-10 w-64" />
      </div>
    </div>
  );
}
