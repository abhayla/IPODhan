'use client';

import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HistoricalSearchBarProps {
  value?: string;
  onSearch: (query: string | undefined) => void;
  placeholder?: string;
  debounceMs?: number;
}

export function HistoricalSearchBar({
  value = '',
  onSearch,
  placeholder = 'Search by company name...',
  debounceMs = 500,
}: HistoricalSearchBarProps) {
  const [searchInput, setSearchInput] = useState(value);

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(searchInput || undefined);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [searchInput, debounceMs, onSearch]);

  // Update local state when prop changes (e.g., from URL)
  useEffect(() => {
    setSearchInput(value);
  }, [value]);

  const handleClear = useCallback(() => {
    setSearchInput('');
    onSearch(undefined);
  }, [onSearch]);

  return (
    <div className="relative w-full max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        type="text"
        placeholder={placeholder}
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="pl-10 pr-10"
      />
      {searchInput && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Clear search</span>
        </Button>
      )}
    </div>
  );
}
