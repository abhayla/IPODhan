/**
 * IPO Selector Component
 *
 * Allows users to select 2-3 IPOs for comparison.
 * Features:
 * - Searchable dropdown with autocomplete
 * - Visual selection with removable chips/badges
 * - Maximum 3 IPO limit enforcement
 * - Empty state when no IPOs selected
 * - Only allows active IPOs (OPEN, UPCOMING, CLOSED)
 *
 * @component
 */

'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { IPO } from '@/lib/repositories/types';

// ==================== PROPS INTERFACE ====================

export interface IPOSelectorProps {
  /** Currently selected IPO slugs */
  selectedSlugs: string[];
  /** Callback when selection changes */
  onSelectionChange: (slugs: string[]) => void;
  /** Available IPOs for selection (filtered to active statuses) */
  availableIPOs: IPO[];
  /** Maximum number of IPOs that can be selected */
  maxSelection?: number;
}

// ==================== COMPONENT ====================

export function IPOSelector({
  selectedSlugs,
  onSelectionChange,
  availableIPOs,
  maxSelection = 3,
}: IPOSelectorProps) {
  // Filter out already selected IPOs from dropdown
  const selectableIPOs = availableIPOs.filter(
    (ipo) => !selectedSlugs.includes(ipo.slug)
  );

  // Get selected IPO details for display
  const selectedIPOs = selectedSlugs
    .map((slug) => availableIPOs.find((ipo) => ipo.slug === slug))
    .filter((ipo): ipo is IPO => ipo !== undefined);

  /**
   * Handle IPO selection from dropdown
   */
  const handleSelect = (slug: string) => {
    if (selectedSlugs.length >= maxSelection) {
      return; // Don't allow more than max selection
    }

    if (!selectedSlugs.includes(slug)) {
      onSelectionChange([...selectedSlugs, slug]);
    }
  };

  /**
   * Handle removing an IPO from selection
   */
  const handleRemove = (slug: string) => {
    onSelectionChange(selectedSlugs.filter((s) => s !== slug));
  };

  /**
   * Clear all selections
   */
  const handleClearAll = () => {
    onSelectionChange([]);
  };

  // Determine if more IPOs can be selected
  const canSelectMore = selectedSlugs.length < maxSelection;
  const selectionCount = selectedSlugs.length;

  return (
    <div className="space-y-4">
      {/* Selection Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Select IPOs to Compare</h2>
          <p className="text-sm text-muted-foreground">
            Choose {maxSelection === 2 ? '2' : '2-3'} IPOs to compare side-by-side
          </p>
        </div>
        {selectionCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            className="text-muted-foreground hover:text-foreground"
          >
            Clear All
          </Button>
        )}
      </div>

      {/* Dropdown Selector */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <Select
          onValueChange={handleSelect}
          disabled={!canSelectMore || selectableIPOs.length === 0}
        >
          <SelectTrigger className="w-full sm:w-[400px]">
            <SelectValue
              placeholder={
                canSelectMore
                  ? 'Select an IPO to add...'
                  : `Maximum ${maxSelection} IPOs selected`
              }
            />
          </SelectTrigger>
          <SelectContent>
            {selectableIPOs.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                {selectedSlugs.length === 0
                  ? 'No active IPOs available'
                  : 'All available IPOs selected'}
              </div>
            ) : (
              selectableIPOs.map((ipo) => (
                <SelectItem key={ipo.slug} value={ipo.slug}>
                  <div className="flex flex-col">
                    <span className="font-medium">{ipo.companyName}</span>
                    <span className="text-xs text-muted-foreground">
                      {ipo.status} • Lot Size: {ipo.lotSize ?? 'N/A'} • ₹
                      {ipo.priceRangeMin ?? 'N/A'}-{ipo.priceRangeMax ?? 'N/A'}
                    </span>
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        {/* Selection Counter */}
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {selectionCount} / {maxSelection} selected
        </div>
      </div>

      {/* Selected IPOs Display */}
      {selectionCount > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Selected IPOs:</h3>
          <div className="flex flex-wrap gap-2">
            {selectedIPOs.map((ipo) => (
              <Badge
                key={ipo.slug}
                variant="secondary"
                className="px-3 py-1.5 text-sm flex items-center gap-2"
              >
                <span>{ipo.companyName}</span>
                <button
                  onClick={() => handleRemove(ipo.slug)}
                  className="hover:bg-muted rounded-full p-0.5 transition-colors"
                  aria-label={`Remove ${ipo.companyName}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      ) : (
        // Empty State
        <div className="border border-dashed rounded-lg p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No IPOs selected yet. Choose at least 2 IPOs to start comparing.
          </p>
        </div>
      )}

      {/* Validation Message */}
      {selectionCount === 1 && (
        <div className="text-sm text-amber-600 dark:text-amber-400">
          Please select at least one more IPO to enable comparison.
        </div>
      )}
    </div>
  );
}
