'use client';

import { useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { StatusFilter } from '@/components/filters/StatusFilter';
import { CategoryFilter } from '@/components/filters/CategoryFilter';
import { SectorFilter } from '@/components/filters/SectorFilter';
import { ClearFiltersButton } from '@/components/filters/ClearFiltersButton';
import { Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function FilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  // Read current filter values from URL
  const status = searchParams.get('status') || 'OPEN';
  const category = searchParams.get('category') || 'ALL';
  const sector = searchParams.get('sector') || 'ALL';

  // Count active filters (non-default)
  const activeFilterCount = [
    status !== 'OPEN' ? 1 : 0,
    category !== 'ALL' ? 1 : 0,
    sector !== 'ALL' ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  /**
   * Update URL with new filter value
   * Resets page to 1 when filters change
   */
  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);

    // Handle 'ALL' option by removing param (except status which defaults to OPEN)
    if (value === 'ALL' || !value) {
      params.delete(key);
      if (key === 'status') {
        params.set('status', 'OPEN'); // Keep status=OPEN as default
      }
    } else {
      params.set(key, value);
    }

    // Reset pagination when filters change
    params.set('page', '1');

    // Navigate to updated URL
    router.push(`${pathname}?${params.toString()}`);
  };

  /**
   * Clear all filters and reset to defaults
   */
  const clearFilters = () => {
    const params = new URLSearchParams(searchParams);

    // Remove all filter params
    params.delete('status');
    params.delete('category');
    params.delete('sector');

    // Set default status
    params.set('status', 'OPEN');
    params.set('page', '1');

    // Navigate to reset URL
    router.push(`${pathname}?${params.toString()}`);
  };

  /**
   * Check if filters are at default values
   */
  const isDefaultFilters = status === 'OPEN' && category === 'ALL' && sector === 'ALL';

  return (
    <div className="mb-6" aria-label="IPO Filters">
      {/* Mobile Filter Toggle (< lg) */}
      <div className="lg:hidden mb-4">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setIsFiltersOpen(!isFiltersOpen)}
          aria-label="Toggle filters"
          aria-expanded={isFiltersOpen}
        >
          <Filter className="mr-2 h-4 w-4" />
          Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
        </Button>
      </div>

      {/* Filter Controls */}
      <div
        data-testid="filter-bar"
        className={`
          flex flex-col gap-3
          lg:flex lg:flex-row lg:items-center lg:gap-4
          ${isFiltersOpen ? 'block' : 'hidden lg:flex'}
        `}
      >
        <StatusFilter
          value={status}
          onChange={(value) => updateFilter('status', value)}
        />

        <CategoryFilter
          value={category}
          onChange={(value) => updateFilter('category', value)}
        />

        <SectorFilter
          value={sector}
          onChange={(value) => updateFilter('sector', value)}
        />

        <ClearFiltersButton
          onClear={clearFilters}
          disabled={isDefaultFilters}
        />
      </div>
    </div>
  );
}
