'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HistoricalPaginationProps {
  currentPage: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  onPageChange: (page: number) => void;
}

export function HistoricalPagination({
  currentPage,
  totalPages,
  hasNext,
  hasPrev,
  onPageChange,
}: HistoricalPaginationProps) {
  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = 7; // Max page numbers to show

    if (totalPages <= maxVisible) {
      // Show all pages
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage <= 3) {
        // Near the beginning
        for (let i = 2; i <= 5; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        // Near the end
        pages.push('ellipsis');
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // In the middle
        pages.push('ellipsis');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    }

    return pages;
  };

  if (totalPages <= 1) {
    return null;
  }

  const pageNumbers = getPageNumbers();

  return (
    <nav
      className="flex items-center justify-center gap-2 mt-8"
      aria-label="Page navigation"
      data-testid="pagination"
    >
      {/* Previous button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => hasPrev && onPageChange(currentPage - 1)}
        disabled={!hasPrev}
        aria-label="Previous page"
        className="gap-1"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Previous</span>
      </Button>

      {/* Page numbers */}
      <div className="hidden md:flex items-center gap-1">
        {pageNumbers.map((page, index) => {
          if (page === 'ellipsis') {
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
              onClick={() => onPageChange(pageNum)}
              aria-label={`Page ${pageNum}`}
              aria-current={isActive ? 'page' : undefined}
              className="w-9"
            >
              {pageNum}
            </Button>
          );
        })}
      </div>

      {/* Mobile page indicator */}
      <div className="md:hidden px-3 py-1 text-sm text-muted-foreground">
        Page {currentPage} of {totalPages}
      </div>

      {/* Next button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => hasNext && onPageChange(currentPage + 1)}
        disabled={!hasNext}
        aria-label="Next page"
        className="gap-1"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  );
}
