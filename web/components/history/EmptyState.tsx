'use client';

/**
 * Empty State Component
 *
 * Displays a message when no historical IPOs match the current filters
 * Provides a "Clear Filters" button to reset filter state
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { HiMagnifyingGlassCircle } from 'react-icons/hi2';
import { useHistoricalFilters } from '@/contexts/HistoricalFiltersContext';

export function EmptyState() {
  const { clearFilters, hasActiveFilters } = useHistoricalFilters();

  return (
    <Card className="border-2 border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <HiMagnifyingGlassCircle className="h-16 w-16 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Historical IPOs Found</h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-md">
          {hasActiveFilters
            ? 'No historical IPOs match your current filters. Try adjusting your search criteria or clearing filters.'
            : 'There are no historical IPOs available at the moment.'}
        </p>
        {hasActiveFilters && (
          <Button onClick={clearFilters} variant="outline">
            Clear Filters
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
