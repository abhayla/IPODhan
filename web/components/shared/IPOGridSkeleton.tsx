import { IPOCardSkeleton } from '@/components/ipo/IPOCardSkeleton';

interface IPOGridSkeletonProps {
  count?: number;
}

export function IPOGridSkeleton({ count = 12 }: IPOGridSkeletonProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="ipo-grid-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <IPOCardSkeleton key={i} />
      ))}
    </div>
  );
}
