/**
 * Mainboard IPOs Landing Page Loading Skeleton
 *
 * Displays loading skeletons during data fetch
 * AC#21: Loading skeletons display during data fetch
 */

import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header Skeleton */}
      <div className="mb-8">
        <Skeleton className="h-10 w-3/4 mb-3" />
        <Skeleton className="h-5 w-full mb-2" />
        <Skeleton className="h-5 w-5/6" />
      </div>

      {/* Summary Metrics Skeleton */}
      <section className="mb-12">
        <Skeleton className="h-8 w-64 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-10 w-10 rounded-full" />
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Content Sections Skeleton */}
      <section className="mb-12 space-y-12">
        {[1, 2, 3, 4, 5, 6].map((section) => (
          <div key={section}>
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-6 w-24" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((card) => (
                <Card key={card}>
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/6" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Navigation Cards Skeleton */}
      <section className="mb-12">
        <Skeleton className="h-8 w-64 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="h-full">
              <CardHeader>
                <div className="flex items-center justify-center mb-3">
                  <Skeleton className="h-16 w-16 rounded-full" />
                </div>
                <Skeleton className="h-6 w-32 mx-auto" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full mx-auto" />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Detailed Table Skeleton */}
      <section className="mb-12">
        <Skeleton className="h-8 w-64 mb-4" />
        <div className="border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-10 w-32" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
