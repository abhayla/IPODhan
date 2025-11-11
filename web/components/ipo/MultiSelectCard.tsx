'use client';

import React, { useState, useCallback } from 'react';
import { IPOCardEnhanced } from './IPOCardEnhanced';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IPO, ListingPerformance, IPOScore, GMPRecord, Subscription, FinancialData } from '@/lib/db/types';

/**
 * MultiSelectCard Component - Phase 5: Personalization Engine
 *
 * Extends IPOCardEnhanced with multi-selection functionality for bulk actions.
 * Supports keyboard shortcuts (Space to toggle) and visual selection feedback.
 *
 * Features:
 * - Checkbox for selection (top-right corner)
 * - Visual feedback when selected (border highlight, overlay)
 * - Keyboard accessible (Space to toggle, Enter to open)
 * - Supports bulk compare, export, share actions
 * - Maintains all IPOCardEnhanced features
 *
 * Integration:
 * - Phase 1: Extends IPOCardEnhanced with all visual features
 * - Phase 5: Enables bulk actions (compare, export)
 *
 * @example
 * const [selectedIds, setSelectedIds] = useState<string[]>([]);
 *
 * <MultiSelectCard
 *   ipo={ipo}
 *   isSelected={selectedIds.includes(ipo.id)}
 *   onSelectionChange={(selected) => {
 *     setSelectedIds(prev =>
 *       selected ? [...prev, ipo.id] : prev.filter(id => id !== ipo.id)
 *     );
 *   }}
 * />
 */

export interface MultiSelectCardProps {
  ipo: IPO & {
    listingPerformance?: ListingPerformance | null;
    ipoScore?: IPOScore | null;
    gmpRecords?: GMPRecord[];
    subscriptions?: Subscription[];
    financialData?: FinancialData | null;
  };

  /** Whether this card is currently selected */
  isSelected: boolean;

  /** Callback when selection state changes */
  onSelectionChange: (selected: boolean, ipoId: string) => void;

  /** Callback when card is clicked (not checkbox) */
  onCardClick?: () => void;

  /** Search query for highlighting */
  searchQuery?: string;

  /** Whether multi-select mode is enabled */
  multiSelectEnabled?: boolean;

  className?: string;
}

export function MultiSelectCard({
  ipo,
  isSelected,
  onSelectionChange,
  onCardClick,
  searchQuery,
  multiSelectEnabled = true,
  className = '',
}: MultiSelectCardProps) {
  const [isFocused, setIsFocused] = useState(false);

  /**
   * Handle checkbox toggle
   */
  const handleCheckboxChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      e.stopPropagation();
      onSelectionChange(e.target.checked, ipo.id);
    },
    [ipo.id, onSelectionChange]
  );

  /**
   * Handle keyboard events
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ' && multiSelectEnabled) {
        e.preventDefault();
        e.stopPropagation();
        onSelectionChange(!isSelected, ipo.id);
      } else if (e.key === 'Enter') {
        // Let the link handle Enter key
        return;
      }
    },
    [isSelected, ipo.id, multiSelectEnabled, onSelectionChange]
  );

  /**
   * Handle card wrapper click
   */
  const handleWrapperClick = useCallback(
    (e: React.MouseEvent) => {
      // If clicked on the wrapper (not the link), toggle selection
      if (multiSelectEnabled && e.target === e.currentTarget) {
        e.preventDefault();
        onSelectionChange(!isSelected, ipo.id);
      }
    },
    [isSelected, ipo.id, multiSelectEnabled, onSelectionChange]
  );

  return (
    <div
      className={cn(
        'relative group/multiselect',
        multiSelectEnabled && 'cursor-pointer',
        className
      )}
      onClick={handleWrapperClick}
      onKeyDown={handleKeyDown}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      tabIndex={multiSelectEnabled ? 0 : -1}
      role="checkbox"
      aria-checked={isSelected}
      aria-label={`${isSelected ? 'Deselect' : 'Select'} ${ipo.companyName}`}
    >
      {/* Selection overlay */}
      {isSelected && (
        <div className="absolute inset-0 bg-primary/5 border-2 border-primary rounded-lg z-10 pointer-events-none transition-all duration-200" />
      )}

      {/* Checkbox - Top right corner */}
      {multiSelectEnabled && (
        <div className="absolute top-3 right-3 z-20">
          <label
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded-md border-2 cursor-pointer transition-all duration-200',
              'bg-background/95 backdrop-blur-sm shadow-sm',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:border-primary/50',
              isFocused && 'ring-2 ring-primary ring-offset-2'
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={handleCheckboxChange}
              className="sr-only"
              aria-label={`Select ${ipo.companyName}`}
            />
            {isSelected && <Check className="w-4 h-4" strokeWidth={3} />}
          </label>
        </div>
      )}

      {/* IPO Card */}
      <div className={cn(isSelected && 'opacity-95')}>
        <IPOCardEnhanced
          ipo={ipo}
          searchQuery={searchQuery}
          onClick={onCardClick}
        />
      </div>

      {/* Selection count badge (only show when selected and multiple items) */}
      {isSelected && (
        <div className="absolute bottom-3 right-3 z-20 pointer-events-none">
          <div className="px-2 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-lg animate-in zoom-in-50 fade-in duration-200">
            ✓ Selected
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Bulk Action Bar Component
 *
 * Shows at the bottom of screen when items are selected.
 * Provides quick actions: Compare, Export CSV, Share, Clear selection.
 */
export interface BulkActionBarProps {
  selectedCount: number;
  onCompare: () => void;
  onExport: () => void;
  onShare?: () => void;
  onClearSelection: () => void;
  maxCompareItems?: number;
}

export function BulkActionBar({
  selectedCount,
  onCompare,
  onExport,
  onShare,
  onClearSelection,
  maxCompareItems = 5,
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  const canCompare = selectedCount >= 2 && selectedCount <= maxCompareItems;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom duration-200">
      <div className="bg-primary text-primary-foreground shadow-2xl border-t-2 border-primary-foreground/10">
        <div className="container max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            {/* Selection count */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary-foreground/20 flex items-center justify-center">
                <span className="text-sm font-bold">{selectedCount}</span>
              </div>
              <span className="text-sm font-medium">
                {selectedCount} IPO{selectedCount !== 1 ? 's' : ''} selected
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Compare */}
              <button
                onClick={onCompare}
                disabled={!canCompare}
                className={cn(
                  'px-4 py-2 rounded-md text-sm font-medium transition-all duration-200',
                  canCompare
                    ? 'bg-primary-foreground text-primary hover:bg-primary-foreground/90 shadow-md hover:scale-105'
                    : 'bg-primary-foreground/20 text-primary-foreground/50 cursor-not-allowed'
                )}
                title={
                  !canCompare
                    ? `Select 2-${maxCompareItems} IPOs to compare`
                    : 'Compare selected IPOs'
                }
              >
                Compare
              </button>

              {/* Export */}
              <button
                onClick={onExport}
                className="px-4 py-2 rounded-md bg-primary-foreground text-primary text-sm font-medium hover:bg-primary-foreground/90 transition-all duration-200 shadow-md hover:scale-105"
              >
                Export CSV
              </button>

              {/* Share (optional) */}
              {onShare && (
                <button
                  onClick={onShare}
                  className="px-4 py-2 rounded-md bg-primary-foreground/10 text-primary-foreground text-sm font-medium hover:bg-primary-foreground/20 transition-colors"
                >
                  Share
                </button>
              )}

              {/* Clear */}
              <button
                onClick={onClearSelection}
                className="px-4 py-2 rounded-md bg-primary-foreground/10 text-primary-foreground text-sm font-medium hover:bg-danger/90 hover:text-white transition-all duration-200"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Helper text */}
          {!canCompare && selectedCount > 0 && (
            <div className="mt-2 text-xs text-primary-foreground/70">
              {selectedCount < 2
                ? 'Select at least one more IPO to enable comparison'
                : `Maximum ${maxCompareItems} IPOs can be compared at once`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to manage multi-selection state
 */
export function useMultiSelect() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const toggleSelection = useCallback((ipoId: string) => {
    setSelectedIds((prev) =>
      prev.includes(ipoId) ? prev.filter((id) => id !== ipoId) : [...prev, ipoId]
    );
  }, []);

  const setSelection = useCallback((selected: boolean, ipoId: string) => {
    setSelectedIds((prev) =>
      selected ? (prev.includes(ipoId) ? prev : [...prev, ipoId]) : prev.filter((id) => id !== ipoId)
    );
  }, []);

  const selectAll = useCallback((ipoIds: string[]) => {
    setSelectedIds(ipoIds);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const isSelected = useCallback(
    (ipoId: string) => {
      return selectedIds.includes(ipoId);
    },
    [selectedIds]
  );

  return {
    selectedIds,
    selectedCount: selectedIds.length,
    toggleSelection,
    setSelection,
    selectAll,
    clearSelection,
    isSelected,
  };
}

export default MultiSelectCard;
