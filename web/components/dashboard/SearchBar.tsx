/**
 * SearchBar Component
 *
 * Search input for filtering IPOs by company name or sector.
 * Features:
 * - Debounced search (300ms delay)
 * - URL state synchronization
 * - Clear button (X icon)
 * - Keyboard navigation (Enter, Escape)
 * - Recent searches dropdown
 * - Loading indicator
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Search, X, Clock } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { saveSearch, getRecentSearches } from '@/lib/search-history';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

export function SearchBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Local state
  const [searchInput, setSearchInput] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Debounced search value (300ms delay)
  const debouncedSearch = useDebounce(searchInput, 300);

  // Initialize search input from URL on mount
  useEffect(() => {
    const initialSearch = searchParams.get('search') || '';
    setSearchInput(initialSearch);

    // Load recent searches
    setRecentSearches(getRecentSearches());
  }, [searchParams]);

  // Update URL when debounced search changes
  useEffect(() => {
    const currentSearch = searchParams.get('search') || '';

    // Only update if search value actually changed
    if (debouncedSearch !== currentSearch) {
      updateSearchParam(debouncedSearch);
      setIsSearching(false);

      // Save to recent searches if not empty
      if (debouncedSearch && debouncedSearch.trim().length >= 2) {
        saveSearch(debouncedSearch);
        setRecentSearches(getRecentSearches());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, searchParams]);

  /**
   * Update search parameter in URL
   */
  const updateSearchParam = useCallback(
    (query: string) => {
      const params = new URLSearchParams(searchParams);

      if (query && query.trim().length >= 2) {
        params.set('search', query);
      } else {
        params.delete('search');
      }

      // Reset pagination when search changes
      params.set('page', '1');

      // Navigate with updated params (shallow routing - no page reload)
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  /**
   * Handle input change
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    setIsSearching(true);
  };

  /**
   * Handle clear button click
   */
  const handleClear = () => {
    setSearchInput('');
    setIsSearching(false);
    updateSearchParam('');
    setShowRecent(false);
  };

  /**
   * Handle keyboard events
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Immediate search on Enter (bypass debounce)
      e.preventDefault();
      updateSearchParam(searchInput);
      setIsSearching(false);
      setShowRecent(false);

      // Save to recent searches
      if (searchInput && searchInput.trim().length >= 2) {
        saveSearch(searchInput);
        setRecentSearches(getRecentSearches());
      }
    } else if (e.key === 'Escape') {
      // Clear search on Escape
      handleClear();
    }
  };

  /**
   * Handle recent search selection
   */
  const handleRecentSearchClick = (query: string) => {
    setSearchInput(query);
    updateSearchParam(query);
    setShowRecent(false);
  };

  /**
   * Handle input focus
   */
  const handleFocus = () => {
    if (recentSearches.length > 0) {
      setShowRecent(true);
    }
  };

  /**
   * Handle input blur
   */
  const handleBlur = () => {
    // Delay hiding to allow clicking on recent searches
    setTimeout(() => {
      setShowRecent(false);
    }, 200);
  };

  return (
    <div className="relative w-full">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />

        <Input
          type="search"
          value={searchInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Search IPOs by company or sector..."
          aria-label="Search IPOs by company or sector"
          className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />

        {/* Clear Button */}
        {searchInput && (
          <button
            onClick={handleClear}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
          </button>
        )}

        {/* Loading Indicator */}
        {isSearching && (
          <div className="absolute right-10 top-1/2 -translate-y-1/2">
            <LoadingSpinner size="sm" />
          </div>
        )}
      </div>

      {/* Recent Searches Dropdown */}
      {showRecent && recentSearches.length > 0 && (
        <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-60 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-medium text-gray-500 border-b border-gray-100">
            Recent Searches
          </div>
          {recentSearches.map((query, index) => (
            <button
              key={index}
              onClick={() => handleRecentSearchClick(query)}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm"
            >
              <Clock className="h-4 w-4 text-gray-400" />
              <span>{query}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
