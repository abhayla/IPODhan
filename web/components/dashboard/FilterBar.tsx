'use client';

import { useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { StatusFilter } from '@/components/filters/StatusFilter';
import { SegmentFilter } from '@/components/filters/SegmentFilter';
import { OfferingTypeFilter } from '@/components/filters/OfferingTypeFilter';
import { SectorFilter } from '@/components/filters/SectorFilter';
import { ScoreRangeFilter } from '@/components/filters/ScoreRangeFilter';
import { ClearFiltersButton } from '@/components/filters/ClearFiltersButton';
import { HiFunnel } from 'react-icons/hi2';
import { Button } from '@/components/ui/button';

export function FilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  // Read current filter values from URL
  const status = searchParams.get('status') || 'OPEN';
  const segment = searchParams.get('segment') || 'ALL';
  const sector = searchParams.get('sector') || 'ALL';
  const scoreRange = searchParams.get('scoreRange') || 'all';

  // Story 11.8: offeringType as comma-separated string, default to IPO+FPO to hide TENDER
  const offeringTypeParam = searchParams.get('offeringType');
  const offeringTypes = offeringTypeParam ? offeringTypeParam.split(',') : ['IPO', 'FPO'];

  // Count active filters (non-default)
  const activeFilterCount = [
    status !== 'OPEN' ? 1 : 0,
    segment !== 'ALL' ? 1 : 0,
    sector !== 'ALL' ? 1 : 0,
    scoreRange !== 'all' ? 1 : 0,
    offeringTypes.length !== 2 || !offeringTypes.includes('IPO') || !offeringTypes.includes('FPO') ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  /**
   * Update URL with new filter value (single value filters)
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
   * Update offeringType filter (multi-select)
   * Story 11.8: Handles array of offering types
   */
  const updateOfferingTypes = (types: string[]) => {
    const params = new URLSearchParams(searchParams);

    if (types.length === 0) {
      params.delete('offeringType');
    } else {
      params.set('offeringType', types.join(','));
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
    params.delete('segment');
    params.delete('offeringType');
    params.delete('sector');
    params.delete('scoreRange');

    // Set default status and offeringType
    params.set('status', 'OPEN');
    params.set('offeringType', 'IPO,FPO'); // Default to IPO+FPO
    params.set('page', '1');

    // Navigate to reset URL
    router.push(`${pathname}?${params.toString()}`);
  };

  /**
   * Check if filters are at default values
   */
  const isDefaultFilters =
    status === 'OPEN' &&
    segment === 'ALL' &&
    sector === 'ALL' &&
    scoreRange === 'all' &&
    offeringTypes.length === 2 &&
    offeringTypes.includes('IPO') &&
    offeringTypes.includes('FPO');

  return (
    <div className="mb-6" aria-label="IPO Filters">
      {/* Mobile Filter Toggle (< lg) */}
      <div className="lg:hidden mb-4">
        <Button
          variant="outline"
          className="w-full transition-all duration-200 hover:scale-[1.02] hover:border-primary"
          onClick={() => setIsFiltersOpen(!isFiltersOpen)}
          aria-label="Toggle filters"
          aria-expanded={isFiltersOpen}
        >
          <HiFunnel className={`mr-2 h-4 w-4 transition-transform duration-300 ${isFiltersOpen ? 'rotate-180' : ''}`} />
          Filters {activeFilterCount > 0 && (
            <span className="ml-1 px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-full animate-in fade-in zoom-in duration-200">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {/* Filter Controls */}
      <div
        data-testid="filter-bar"
        className={`
          flex flex-col gap-3 p-4 rounded-lg bg-gradient-to-r from-muted/30 to-muted/50 backdrop-blur-sm border border-border/50
          lg:flex lg:flex-row lg:items-center lg:gap-4
          transition-all duration-300 ease-in-out
          ${isFiltersOpen ? 'animate-in slide-in-from-top-2 fade-in' : 'hidden lg:flex'}
        `}
      >
        <StatusFilter
          value={status}
          onChange={(value) => updateFilter('status', value)}
        />

        <SegmentFilter
          value={segment}
          onChange={(value) => updateFilter('segment', value)}
        />

        <OfferingTypeFilter
          value={offeringTypes}
          onChange={updateOfferingTypes}
        />

        <SectorFilter
          value={sector}
          onChange={(value) => updateFilter('sector', value)}
        />

        <ScoreRangeFilter
          value={scoreRange}
          onChange={(value) => updateFilter('scoreRange', value)}
        />

        <ClearFiltersButton
          onClear={clearFilters}
          disabled={isDefaultFilters}
        />
      </div>
    </div>
  );
}
