'use client';

import * as React from 'react';
import { HiChevronLeft, HiChevronRight, HiEllipsisHorizontal } from 'react-icons/hi2';
import { Button } from '@/components/ui/button';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  hasMore: boolean;
  isLoading?: boolean;
}

const PaginationRoot = React.forwardRef<
  HTMLElement,
  React.ComponentProps<'nav'>
>(({ className, ...props }, ref) => (
  <nav
    ref={ref}
    role="navigation"
    aria-label="pagination"
    className={cn('mx-auto flex w-full justify-center', className)}
    {...props}
  />
));
PaginationRoot.displayName = 'Pagination';

const PaginationContent = React.forwardRef<
  HTMLUListElement,
  React.ComponentProps<'ul'>
>(({ className, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn('flex flex-row items-center gap-1', className)}
    {...props}
  />
));
PaginationContent.displayName = 'PaginationContent';

const PaginationItem = React.forwardRef<
  HTMLLIElement,
  React.ComponentProps<'li'>
>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn('', className)} {...props} />
));
PaginationItem.displayName = 'PaginationItem';

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<React.ComponentProps<typeof Button>, 'size'> &
  React.ComponentProps<'button'>;

const PaginationLink = ({
  className,
  isActive,
  size = 'sm',
  ...props
}: PaginationLinkProps) => (
  <Button
    variant={isActive ? 'default' : 'outline'}
    size={size}
    className={cn(className)}
    {...props}
  />
);
PaginationLink.displayName = 'PaginationLink';

const PaginationPrevious = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to previous page"
    size="sm"
    className={cn('gap-1 pl-2.5', className)}
    {...props}
  >
    <HiChevronLeft className="h-4 w-4" />
    <span>Previous</span>
  </PaginationLink>
);
PaginationPrevious.displayName = 'PaginationPrevious';

const PaginationNext = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    aria-label="Go to next page"
    size="sm"
    className={cn('gap-1 pr-2.5', className)}
    {...props}
  >
    <span>Next</span>
    <HiChevronRight className="h-4 w-4" />
  </PaginationLink>
);
PaginationNext.displayName = 'PaginationNext';

const PaginationEllipsis = ({
  className,
  ...props
}: React.ComponentProps<'span'>) => (
  <span
    aria-hidden
    className={cn('flex h-9 w-9 items-center justify-center', className)}
    {...props}
  >
    <HiEllipsisHorizontal className="h-4 w-4" />
    <span className="sr-only">More pages</span>
  </span>
);
PaginationEllipsis.displayName = 'PaginationEllipsis';

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
        <HiChevronLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-1" />
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
        <HiChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
      </Button>
    </nav>
  );
}

// Export individual components
export {
  PaginationRoot as PaginationRootComponent,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
};
