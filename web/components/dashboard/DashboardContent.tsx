'use client';

import { IPO } from '@/lib/api-client';
import { IPOGrid } from '@/components/ipo/IPOGrid';
import { Pagination } from '@/components/ui/pagination';
import { ViewToggle } from '@/components/ui/view-toggle';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { SearchBar } from '@/components/dashboard/SearchBar';

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
  initialSegment?: string;
  initialSearch?: string;
}

export function DashboardContent({
  initialIPOs,
  initialPagination,
  initialView,
  initialStatus,
  initialSegment,
  initialSearch
}: DashboardContentProps) {
  const view = (initialView === 'list' ? 'list' : 'grid') as 'grid' | 'list';

  // Format status for display
  const getStatusLabel = (status?: string) => {
    if (!status || status === 'ALL') return '';
    return status.charAt(0) + status.slice(1).toLowerCase();
  };

  // Calculate total pages
  const totalPages = Math.ceil(initialPagination.total / initialPagination.limit);

  return (
    <div className="container mx-auto px-4 py-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="mb-10 animate-in slide-in-from-top-3 duration-500">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-4">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text">
              IPO Dashboard
            </h1>
            <p className="text-muted-foreground text-lg flex items-center gap-2">
              Browse current and upcoming IPOs.
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-semibold border border-primary/20 animate-in zoom-in duration-300 delay-100">
                {initialPagination.total} {getStatusLabel(initialStatus)} {initialSegment ? `${initialSegment} ` : ''}IPOs
              </span>
            </p>
          </div>
          <div className="animate-in slide-in-from-right duration-500 delay-100">
            <ViewToggle currentView={view} />
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-8 animate-in slide-in-from-left duration-500 delay-150">
        <SearchBar />
      </div>

      {/* Filter Bar */}
      <div className="animate-in slide-in-from-right duration-500 delay-200">
        <FilterBar />
      </div>

      {/* IPO Listings Section */}
      <div className="mt-10">
        <h2 className="sr-only">IPO Listings</h2>
        <IPOGrid ipos={initialIPOs} view={view} searchQuery={initialSearch} />
      </div>

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
