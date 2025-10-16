'use client';

/**
 * Results Count Component
 *
 * Displays the total number of historical IPOs matching current filters
 * Shows different messages for filtered vs. unfiltered results
 */

import React from 'react';
import { useHistoricalFilters } from '@/contexts/HistoricalFiltersContext';

interface ResultsCountProps {
  total: number;
  loading?: boolean;
}

export function ResultsCount({ total, loading = false }: ResultsCountProps) {
  const { hasActiveFilters } = useHistoricalFilters();

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading results...
      </div>
    );
  }

  const formattedTotal = total.toLocaleString('en-IN');

  return (
    <div className="text-sm text-muted-foreground">
      Showing <span className="font-semibold text-foreground">{formattedTotal}</span>{' '}
      {total === 1 ? 'IPO' : 'IPOs'}
      {hasActiveFilters && <span className="text-blue-600"> (filtered)</span>}
    </div>
  );
}
