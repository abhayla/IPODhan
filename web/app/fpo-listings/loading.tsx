import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading skeleton for FPO Listings page
 */
export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8">
      {/* Page Header Skeleton */}
      <div className="mb-6">
        <Skeleton className="h-10 w-80 mb-2" />
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-4 w-full max-w-xl mt-1" />
      </div>

      {/* Tabs Skeleton */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex space-x-8">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>

      {/* Filters Skeleton */}
      <div className="flex justify-between items-center mb-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-6 w-64" />
      </div>

      {/* Table Skeleton */}
      <div className="border rounded-lg overflow-hidden">
        <Skeleton className="h-96 w-full" />
      </div>

      {/* Pagination Skeleton */}
      <div className="mt-6">
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
