/**
 * Event Search Component
 *
 * Client component for searching calendar events by company name.
 * Features:
 * - Search input with real-time filtering
 * - Clear button to reset search
 * - Enter key support for search submission
 * - URL query param sync (?search=keyword)
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// ==================== TYPES ====================

interface EventSearchProps {
  initialSearch?: string;
}

// ==================== MAIN COMPONENT ====================

/**
 * Event Search Component
 *
 * Provides search input to filter calendar events by company name.
 * Updates URL with ?search=keyword query param.
 */
export default function EventSearch({ initialSearch = '' }: EventSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(initialSearch);

  // Sync local state with URL search param
  useEffect(() => {
    const urlSearch = searchParams.get('search') || '';
    if (urlSearch !== searchQuery) {
      setSearchQuery(urlSearch);
    }
  }, [searchParams]);

  /**
   * Handle search submission (Enter key or Search button)
   */
  const handleSearch = () => {
    const params = new URLSearchParams(searchParams.toString());

    if (searchQuery.trim()) {
      params.set('search', searchQuery.trim());
    } else {
      params.delete('search');
    }

    router.push(`${pathname}?${params.toString()}`);
  };

  /**
   * Handle clear search
   */
  const handleClear = () => {
    setSearchQuery('');

    const params = new URLSearchParams(searchParams.toString());
    params.delete('search');

    router.push(`${pathname}?${params.toString()}`);
  };

  /**
   * Handle Enter key press
   */
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Search Icon */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          type="text"
          placeholder="Search by company name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyPress={handleKeyPress}
          className="pl-10 pr-10"
          aria-label="Search calendar events"
        />
        {searchQuery && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Search Button */}
      <Button
        onClick={handleSearch}
        size="sm"
        aria-label="Search"
        className="flex items-center gap-1"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search</span>
      </Button>
    </div>
  );
}
