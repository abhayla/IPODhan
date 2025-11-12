'use client';

import { IPO } from '@/lib/db/types';
import { IPOCard } from '@/components/ipo/IPOCard';
import { HiInbox, HiMagnifyingGlass as SearchIcon } from 'react-icons/hi2';
import { EmptyState } from '@/components/shared/EmptyState';
import { useRouter } from 'next/navigation';

interface IPOGridProps {
  ipos: IPO[];
  view: 'grid' | 'list';
  searchQuery?: string;
}

export function IPOGrid({ ipos, view, searchQuery }: IPOGridProps) {
  const router = useRouter();

  if (ipos.length === 0) {
    if (searchQuery) {
      return (
        <EmptyState
          icon={SearchIcon}
          title={`No IPOs found for "${searchQuery}"`}
          description="Try different keywords or clear your search to see all IPOs."
          action={{
            label: 'Clear Search',
            onClick: () => router.push('/dashboard'),
          }}
        />
      );
    }

    return (
      <EmptyState
        icon={HiInbox}
        title="No IPOs found"
        description="Try adjusting your filters or check back later for new IPO listings."
        action={{
          label: 'Clear Filters',
          onClick: () => router.push('/dashboard'),
        }}
      />
    );
  }

  return (
    <div
      className={
        view === 'grid'
          ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 animate-in fade-in duration-500'
          : 'flex flex-col gap-4 animate-in fade-in duration-500'
      }
      data-testid="ipo-container"
    >
      {ipos.map((ipo, index) => (
        <div
          key={ipo.id}
          className="animate-in fade-in slide-in-from-bottom-4 duration-500"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <IPOCard ipo={ipo} searchQuery={searchQuery} />
        </div>
      ))}
    </div>
  );
}
