'use client';

import { Button } from '@/components/ui/button';
import { FileX2 } from 'lucide-react';

interface EmptyStateProps {
  onClearFilters: () => void;
}

export function EmptyState({ onClearFilters }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="rounded-full bg-muted p-6 mb-6">
        <FileX2 className="h-12 w-12 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">No IPOs Found</h3>
      <p className="text-muted-foreground mb-6 max-w-md">
        We couldn&apos;t find any historical IPOs matching your current filters.
        Try adjusting your search criteria or clear all filters to see all results.
      </p>
      <Button onClick={onClearFilters} variant="default">
        Clear All Filters
      </Button>
    </div>
  );
}
