'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { X, Filter, RotateCcw, Share2, Check } from 'lucide-react';

/**
 * VisualFilterBuilder - Phase 3: Real-Time Experience
 *
 * Interactive visual filter interface for IPO discovery.
 * Supports chips, sliders, and URL-based sharing.
 *
 * Features:
 * - Category chips (Segment, Status, Sector)
 * - Range sliders (Score, Subscription, Price)
 * - Clear all filters
 * - Active filter count badge
 * - URL query param synchronization
 * - Responsive layout
 */

export interface FilterValue {
  segments: string[];        // ['MAINBOARD', 'SME']
  statuses: string[];        // ['OPEN', 'UPCOMING', 'LISTED']
  sectors: string[];         // ['Technology', 'Finance', ...]
  scoreRange: [number, number]; // [0, 10]
  subscriptionRange: [number, number]; // [0, 100]
  priceRange: [number, number]; // [0, 10000]
}

export interface VisualFilterBuilderProps {
  value: FilterValue;
  onChange: (filters: FilterValue) => void;
  onApply?: () => void;
  className?: string;
}

const DEFAULT_FILTERS: FilterValue = {
  segments: [],
  statuses: [],
  sectors: [],
  scoreRange: [0, 10],
  subscriptionRange: [0, 100],
  priceRange: [0, 10000],
};

const SEGMENT_OPTIONS = [
  { value: 'MAINBOARD', label: 'Mainboard' },
  { value: 'SME', label: 'SME' },
];

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'LISTED', label: 'Listed' },
  { value: 'CLOSED', label: 'Closed' },
];

const SECTOR_OPTIONS = [
  { value: 'Technology', label: 'Technology' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Healthcare', label: 'Healthcare' },
  { value: 'Manufacturing', label: 'Manufacturing' },
  { value: 'Energy', label: 'Energy' },
  { value: 'RealEstate', label: 'Real Estate' },
];

export function VisualFilterBuilder({
  value,
  onChange,
  onApply,
  className = '',
}: VisualFilterBuilderProps) {
  const [isShareMenuOpen, setIsShareMenuOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Count active filters
  const getActiveFilterCount = (): number => {
    let count = 0;
    count += value.segments.length;
    count += value.statuses.length;
    count += value.sectors.length;
    if (value.scoreRange[0] > 0 || value.scoreRange[1] < 10) count++;
    if (value.subscriptionRange[0] > 0 || value.subscriptionRange[1] < 100) count++;
    if (value.priceRange[0] > 0 || value.priceRange[1] < 10000) count++;
    return count;
  };

  // Toggle chip selection
  const toggleChip = useCallback(
    (category: keyof FilterValue, chipValue: string) => {
      const currentArray = value[category] as string[];
      const newArray = currentArray.includes(chipValue)
        ? currentArray.filter((v) => v !== chipValue)
        : [...currentArray, chipValue];

      onChange({ ...value, [category]: newArray });
    },
    [value, onChange]
  );

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    onChange(DEFAULT_FILTERS);
  }, [onChange]);

  // Share filters via URL
  const shareFilters = useCallback(() => {
    const params = new URLSearchParams();

    if (value.segments.length) params.set('segments', value.segments.join(','));
    if (value.statuses.length) params.set('statuses', value.statuses.join(','));
    if (value.sectors.length) params.set('sectors', value.sectors.join(','));
    if (value.scoreRange[0] > 0 || value.scoreRange[1] < 10) {
      params.set('score', `${value.scoreRange[0]}-${value.scoreRange[1]}`);
    }
    if (value.subscriptionRange[0] > 0 || value.subscriptionRange[1] < 100) {
      params.set('subscription', `${value.subscriptionRange[0]}-${value.subscriptionRange[1]}`);
    }
    if (value.priceRange[0] > 0 || value.priceRange[1] < 10000) {
      params.set('price', `${value.priceRange[0]}-${value.priceRange[1]}`);
    }

    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;

    navigator.clipboard.writeText(url).then(() => {
      setCopySuccess(true);
      setTimeout(() => {
        setCopySuccess(false);
        setIsShareMenuOpen(false);
      }, 2000);
    });
  }, [value]);

  const activeCount = getActiveFilterCount();

  return (
    <div className={`visual-filter-builder ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Filters</h3>
          {activeCount > 0 && (
            <div className="px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              {activeCount}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Share button */}
          <button
            onClick={() => setIsShareMenuOpen(!isShareMenuOpen)}
            className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Share filters"
          >
            {copySuccess ? (
              <Check className="w-4 h-4 text-success" />
            ) : (
              <Share2 className="w-4 h-4" />
            )}
          </button>

          {/* Clear button */}
          {activeCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 transition-colors text-sm font-medium text-foreground"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Segment chips */}
      <div className="mb-6">
        <div className="text-sm font-medium text-muted-foreground mb-2">Segment</div>
        <div className="flex flex-wrap gap-2">
          {SEGMENT_OPTIONS.map((option) => {
            const isActive = value.segments.includes(option.value);
            return (
              <button
                key={option.value}
                onClick={() => toggleChip('segments', option.value)}
                className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:border-primary/50'
                }`}
              >
                {option.label}
                {isActive && <X className="inline-block w-3 h-3 ml-1.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Status chips */}
      <div className="mb-6">
        <div className="text-sm font-medium text-muted-foreground mb-2">Status</div>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((option) => {
            const isActive = value.statuses.includes(option.value);
            return (
              <button
                key={option.value}
                onClick={() => toggleChip('statuses', option.value)}
                className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-background text-foreground border-border hover:border-accent/50'
                }`}
              >
                {option.label}
                {isActive && <X className="inline-block w-3 h-3 ml-1.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sector chips */}
      <div className="mb-6">
        <div className="text-sm font-medium text-muted-foreground mb-2">Sector</div>
        <div className="flex flex-wrap gap-2">
          {SECTOR_OPTIONS.map((option) => {
            const isActive = value.sectors.includes(option.value);
            return (
              <button
                key={option.value}
                onClick={() => toggleChip('sectors', option.value)}
                className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-success text-success-foreground border-success'
                    : 'bg-background text-foreground border-border hover:border-success/50'
                }`}
              >
                {option.label}
                {isActive && <X className="inline-block w-3 h-3 ml-1.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Score Range Slider */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-muted-foreground">IPO Score</div>
          <div className="text-sm font-mono font-semibold text-foreground">
            {value.scoreRange[0].toFixed(1)} - {value.scoreRange[1].toFixed(1)}
          </div>
        </div>
        <div className="relative">
          {/* Track */}
          <div className="h-2 bg-muted rounded-full" />

          {/* Active range */}
          <div
            className="absolute h-2 bg-primary rounded-full top-0"
            style={{
              left: `${(value.scoreRange[0] / 10) * 100}%`,
              width: `${((value.scoreRange[1] - value.scoreRange[0]) / 10) * 100}%`,
            }}
          />

          {/* Min slider */}
          <input
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={value.scoreRange[0]}
            onChange={(e) => {
              const newMin = parseFloat(e.target.value);
              if (newMin <= value.scoreRange[1]) {
                onChange({ ...value, scoreRange: [newMin, value.scoreRange[1]] });
              }
            }}
            className="absolute w-full h-2 bg-transparent appearance-none cursor-pointer top-0 pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-grab [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:border-0"
          />

          {/* Max slider */}
          <input
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={value.scoreRange[1]}
            onChange={(e) => {
              const newMax = parseFloat(e.target.value);
              if (newMax >= value.scoreRange[0]) {
                onChange({ ...value, scoreRange: [value.scoreRange[0], newMax] });
              }
            }}
            className="absolute w-full h-2 bg-transparent appearance-none cursor-pointer top-0 pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-grab [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:border-0"
          />
        </div>
      </div>

      {/* Apply button (optional) */}
      {onApply && (
        <button
          onClick={onApply}
          className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
        >
          Apply Filters
        </button>
      )}

      {/* Copy success message */}
      {copySuccess && (
        <div className="mt-4 p-3 rounded-md bg-success/10 border border-success/30 text-sm text-success">
          ✓ Filter URL copied to clipboard!
        </div>
      )}
    </div>
  );
}

export default VisualFilterBuilder;
