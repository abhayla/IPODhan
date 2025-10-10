'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, useSearchParams } from 'next/navigation';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  hasMore: boolean;
  isLoading?: boolean;
}

export function Pagination({ currentPage, totalPages, hasMore, isLoading = false }: PaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handlePageChange = (newPage: number) => {
    if (isLoading || newPage < 1 || newPage > totalPages) return;

    const params = new URLSearchParams(searchParams);
    params.set('page', newPage.toString());
    router.push(`/dashboard?${params.toString()}`, { scroll: true });

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Generate page numbers to display (show 5 pages at a time)
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxPagesToShow = 5;

    if (totalPages <= maxPagesToShow) {
      // Show all pages if total is less than max
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      const startPage = Math.max(2, currentPage - 1);
      const endPage = Math.min(totalPages - 1, currentPage + 1);

      // Add ellipsis after first page if needed
      if (startPage > 2) {
        pages.push('...');
      }

      // Add pages around current page
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }

      // Add ellipsis before last page if needed
      if (endPage < totalPages - 1) {
        pages.push('...');
      }

      // Always show last page
      pages.push(totalPages);
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();
  const isPrevDisabled = currentPage <= 1 || isLoading;
  const isNextDisabled = currentPage >= totalPages || !hasMore || isLoading;

  return (
    <nav
      className="flex items-center justify-center gap-2 mt-8 p-4 rounded-xl bg-gradient-to-r from-muted/30 to-muted/50 backdrop-blur-sm border border-border/50 animate-in fade-in slide-in-from-bottom-3 duration-500"
      aria-label="Page navigation"
      data-testid="pagination"
    >
      {/* Previous button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={isPrevDisabled}
        aria-label="Previous page"
        className="gap-1 transition-all duration-200 hover:scale-105 hover:border-primary disabled:opacity-50"
      >
        <ChevronLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-1" />
        <span className="hidden sm:inline">Previous</span>
      </Button>

      {/* Page numbers */}
      <div className="hidden md:flex items-center gap-1">
        {pageNumbers.map((page, index) => {
          if (page === '...') {
            return (
              <span key={`ellipsis-${index}`} className="px-2">
                ...
              </span>
            );
          }

          const pageNum = page as number;
          const isActive = pageNum === currentPage;

          return (
            <Button
              key={pageNum}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => handlePageChange(pageNum)}
              disabled={isLoading}
              aria-label={`Page ${pageNum}`}
              aria-current={isActive ? 'page' : undefined}
              className={`w-9 transition-all duration-200 ${
                isActive
                  ? 'scale-110 shadow-md ring-2 ring-primary/20'
                  : 'hover:scale-105 hover:border-primary'
              }`}
            >
              {pageNum}
            </Button>
          );
        })}
      </div>

      {/* Mobile page indicator */}
      <div className="md:hidden px-4 py-2 text-sm font-medium text-primary bg-primary/10 rounded-lg border border-primary/20">
        Page {currentPage} of {totalPages}
      </div>

      {/* Next button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => handlePageChange(currentPage + 1)}
        disabled={isNextDisabled}
        aria-label="Next page"
        className="gap-1 transition-all duration-200 hover:scale-105 hover:border-primary disabled:opacity-50"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
      </Button>
    </nav>
  );
}
