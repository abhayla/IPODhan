'use client';

import { IPO } from '@/lib/api-client';
import { IPOCard } from '@/components/ipo/IPOCard';
import { Inbox } from 'lucide-react';

interface IPOGridProps {
  ipos: IPO[];
  view: 'grid' | 'list';
}

export function IPOGrid({ ipos, view }: IPOGridProps) {
  if (ipos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
        <Inbox className="h-16 w-16 text-muted-foreground mb-4" />
        <h3 className="text-xl font-semibold mb-2">No IPOs found</h3>
        <p className="text-muted-foreground">
          Try adjusting your filters or check back later for new IPO listings.
        </p>
      </div>
    );
  }

  return (
    <div
      className={
        view === 'grid'
          ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
          : 'flex flex-col gap-4'
      }
      data-testid="ipo-container"
    >
      {ipos.map((ipo) => (
        <IPOCard key={ipo.id} ipo={ipo} />
      ))}
    </div>
  );
}
