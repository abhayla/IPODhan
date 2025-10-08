'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

export function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Search bar skeleton */}
      <Skeleton className="h-10 w-full max-w-md" />

      {/* Desktop table skeleton */}
      <div className="hidden md:block space-y-3">
        <Skeleton className="h-12 w-full" />
        {[...Array(10)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>

      {/* Mobile card skeleton */}
      <div className="md:hidden space-y-4">
        {[...Array(5)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6 space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-20" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pagination skeleton */}
      <div className="flex justify-center">
        <Skeleton className="h-10 w-64" />
      </div>
    </div>
  );
}
