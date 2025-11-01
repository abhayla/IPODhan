'use client';

/**
 * Historical IPO HiMagnifyingGlass Bar Component
 *
 * Provides search functionality for filtering historical IPOs by company name
 * Features debounced input (500ms) to reduce API calls
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { HiMagnifyingGlass, HiXMark } from 'react-icons/hi2';
import { useHistoricalFilters } from '@/contexts/HistoricalFiltersContext';

export function HistoricalSearchBar() {
  const { filters, setSearchQuery } = useHistoricalFilters();
  const [localValue, setLocalValue] = useState(filters.searchQuery);

  // Debounce search query updates
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== filters.searchQuery) {
        setSearchQuery(localValue);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [localValue, setSearchQuery, filters.searchQuery]);

  // Sync with external filter changes
  useEffect(() => {
    if (filters.searchQuery !== localValue) {
      setLocalValue(filters.searchQuery);
    }
  }, [filters.searchQuery]);

  const handleClear = useCallback(() => {
    setLocalValue('');
    setSearchQuery('');
  }, [setSearchQuery]);

  return (
    <div className="relative w-full max-w-md">
      <HiMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="text"
        placeholder="Search by company name..."
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        className="pl-10 pr-10"
      />
      {localValue && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Clear search"
        >
          <HiXMark className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
