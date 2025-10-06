import { IPOCardSkeleton } from '@/components/ipo/IPOCardSkeleton';

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header skeleton */}
      <div className="mb-8 space-y-4">
        <div className="h-10 w-64 bg-gray-200 rounded animate-pulse" />
        <div className="h-6 w-96 bg-gray-200 rounded animate-pulse" />
      </div>

      {/* Grid of loading skeletons */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <IPOCardSkeleton key={i} />
        ))}
      </div>

      {/* Pagination skeleton */}
      <div className="mt-8 flex justify-center">
        <div className="h-10 w-64 bg-gray-200 rounded animate-pulse" />
      </div>
    </div>
  );
}
