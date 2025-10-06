import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function IPOCardSkeleton() {
  return (
    <Card className="overflow-hidden" data-testid="ipo-card-skeleton">
      <CardContent className="p-6 space-y-4">
        {/* Company name */}
        <Skeleton className="h-6 w-3/4" />

        {/* Status badge */}
        <Skeleton className="h-5 w-20" />

        {/* Category and sector */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>

        {/* Price range */}
        <Skeleton className="h-5 w-full" />

        {/* Dates */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>

        {/* Rating */}
        <Skeleton className="h-4 w-24" />
      </CardContent>
    </Card>
  );
}
