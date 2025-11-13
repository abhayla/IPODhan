'use client';

/**
 * Listings Pagination Component
 *
 * Provides pagination controls for IPO listings pages with
 * Previous/Next buttons and page information display.
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ListingsPaginationProps {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  recordsPerPage: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

export function ListingsPagination({
  currentPage,
  totalPages,
  totalRecords,
  recordsPerPage,
  onPageChange,
  disabled = false,
}: ListingsPaginationProps) {
  const startRecord = totalRecords > 0 ? (currentPage - 1) * recordsPerPage + 1 : 0;
  const endRecord = Math.min(currentPage * recordsPerPage, totalRecords);

  const handlePrevious = () => {
    if (currentPage > 1 && !disabled) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages && !disabled) {
      onPageChange(currentPage + 1);
    }
  };

  if (totalRecords === 0) {
    return null;
  }

  return (
    <div className="flex items-center justify-between px-4 py-4 border-t border-gray-200 sm:px-6">
      <div className="flex flex-1 justify-between sm:hidden">
        <Button
          onClick={handlePrevious}
          disabled={currentPage === 1 || disabled}
          variant="outline"
          size="sm"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>
        <Button
          onClick={handleNext}
          disabled={currentPage === totalPages || disabled}
          variant="outline"
          size="sm"
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-700">
            Showing <span className="font-medium">{startRecord}</span> to{' '}
            <span className="font-medium">{endRecord}</span> of{' '}
            <span className="font-medium">{totalRecords}</span> listings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handlePrevious}
            disabled={currentPage === 1 || disabled}
            variant="outline"
            size="sm"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <div className="text-sm text-gray-700">
            Page <span className="font-medium">{currentPage}</span> of{' '}
            <span className="font-medium">{totalPages}</span>
          </div>
          <Button
            onClick={handleNext}
            disabled={currentPage === totalPages || disabled}
            variant="outline"
            size="sm"
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
