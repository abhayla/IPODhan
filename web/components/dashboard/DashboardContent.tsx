'use client';

import { IPO } from '@/lib/api-client';
import { IPOGrid } from '@/components/ipo/IPOGrid';
import { Pagination } from '@/components/ui/pagination';
import { ViewToggle } from '@/components/ui/view-toggle';
import { FilterBar } from '@/components/dashboard/FilterBar';

interface DashboardContentProps {
  initialIPOs: IPO[];
  initialPagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  initialView: string;
  initialStatus?: string;
  initialCategory?: string;
}

export function DashboardContent({
  initialIPOs,
  initialPagination,
  initialView
}: DashboardContentProps) {
  const view = (initialView === 'list' ? 'list' : 'grid') as 'grid' | 'list';

  // Calculate total pages
  const totalPages = Math.ceil(initialPagination.total / initialPagination.limit);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              IPO Dashboard
            </h1>
            <p className="text-muted-foreground">
              Browse current and upcoming IPOs. {initialPagination.total} IPOs found.
            </p>
          </div>
          <ViewToggle currentView={view} />
        </div>
      </div>

      {/* Filter Bar */}
      <FilterBar />

      {/* IPO Grid */}
      <IPOGrid ipos={initialIPOs} view={view} />

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          currentPage={initialPagination.page}
          totalPages={totalPages}
          hasMore={initialPagination.hasMore}
        />
      )}
    </div>
  );
}
