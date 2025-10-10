import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function IPOCardSkeleton() {
  return (
    <Card className="overflow-hidden border-2 border-border animate-in fade-in duration-500" data-testid="ipo-card-skeleton">
      <CardContent className="p-6 space-y-4">
        {/* Company name */}
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-6 w-3/4 animate-in slide-in-from-left duration-300" />
          <Skeleton className="h-6 w-16 rounded-full animate-in slide-in-from-right duration-300" />
        </div>

        {/* Category and sector */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-20 rounded-full animate-in fade-in duration-500 delay-100" />
          <Skeleton className="h-4 w-24 animate-in fade-in duration-500 delay-150" />
        </div>

        {/* Price range */}
        <div className="space-y-2 p-3 rounded-lg bg-muted/30 animate-in fade-in duration-500 delay-200">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-full" />
        </div>

        {/* Lot size */}
        <div className="space-y-2 animate-in fade-in duration-500 delay-300">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-24" />
        </div>

        {/* Dates */}
        <div className="space-y-2 animate-in fade-in duration-500 delay-400">
          <Skeleton className="h-3 w-20" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>

        {/* Rating */}
        <div className="pt-2 border-t border-border/50 space-y-2 animate-in fade-in duration-500 delay-500">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-28" />
        </div>
      </CardContent>
    </Card>
  );
}
