/**
 * Loading Skeleton for Mainboard IPO Reviews Page
 *
 * Displays animated loading placeholders while data is being fetched
 */

export default function Loading() {
  return (
    <div className="container mx-auto py-8 px-4">
      {/* Page Title Skeleton */}
      <div className="h-8 bg-gray-200 rounded w-1/3 mb-6 animate-pulse" />

      {/* Educational Header Skeleton */}
      <div className="bg-gray-100 border border-gray-200 rounded-lg p-6 mb-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/4 mb-3" />
        <div className="h-4 bg-gray-200 rounded w-full mb-2" />
        <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-5/6 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
      </div>

      {/* Total Records Skeleton */}
      <div className="h-5 bg-gray-200 rounded w-32 mb-4 animate-pulse" />

      {/* Table Skeleton */}
      <div className="border rounded-lg overflow-hidden">
        {/* Table Header Skeleton */}
        <div className="bg-gray-50 border-b p-4 animate-pulse">
          <div className="grid grid-cols-5 gap-4">
            <div className="h-4 bg-gray-300 rounded" />
            <div className="h-4 bg-gray-300 rounded" />
            <div className="h-4 bg-gray-300 rounded" />
            <div className="h-4 bg-gray-300 rounded" />
            <div className="h-4 bg-gray-300 rounded" />
          </div>
        </div>

        {/* Table Row Skeletons */}
        <div className="space-y-0 divide-y">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="p-4 animate-pulse">
              <div className="grid grid-cols-5 gap-4">
                <div className="h-4 bg-gray-200 rounded" />
                <div className="h-4 bg-gray-200 rounded" />
                <div className="h-4 bg-gray-200 rounded" />
                <div className="h-4 bg-gray-200 rounded" />
                <div className="h-4 bg-gray-200 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pagination Skeleton */}
      <div className="flex items-center justify-between mt-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-24" />
        <div className="flex items-center gap-2">
          <div className="h-9 w-20 bg-gray-200 rounded" />
          <div className="h-9 w-9 bg-gray-200 rounded" />
          <div className="h-9 w-9 bg-gray-200 rounded" />
          <div className="h-9 w-9 bg-gray-200 rounded" />
          <div className="h-9 w-20 bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  );
}
