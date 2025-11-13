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
 * - Slug validation to prevent 404 errors (ISS-027)
 *
 * @component
 */

'use client';

import * as React from 'react';
import { X, AlertCircle } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { IPO } from '@/lib/repositories/types';

// ==================== TYPES ====================

interface ValidatedIPO extends IPO {
  isValid: boolean;
}

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

// ==================== VALIDATION CACHE ====================

// In-memory cache for slug validation results
const slugValidationCache = new Map<string, boolean>();

/**
 * Validate IPO slug by checking if it exists via API
 * Uses HEAD request for efficiency and caches results
 */
async function validateIPOSlug(slug: string): Promise<boolean> {
  // Check cache first
  const cached = slugValidationCache.get(slug);
  if (cached !== undefined) {
    return cached;
  }

  try {
    // Use HEAD request to avoid fetching full data
    const response = await fetch(`/api/ipos/${slug}`, {
      method: 'HEAD',
    });

    const isValid = response.ok;

    // Cache the result
    slugValidationCache.set(slug, isValid);

    if (!isValid) {
      console.warn(`[IPO Compare] Invalid slug detected: ${slug}`);
    }

    return isValid;
  } catch (error) {
    console.error(`[IPO Compare] Error validating slug "${slug}":`, error);
    // Mark as invalid on error to be safe
    slugValidationCache.set(slug, false);
    return false;
  }
}

/**
 * Validate an array of IPOs
 * Returns array of IPOs with validation status
 */
async function validateIPOSlugs(ipos: IPO[]): Promise<ValidatedIPO[]> {
  const validationResults = await Promise.all(
    ipos.map(async (ipo) => {
      const isValid = await validateIPOSlug(ipo.slug);
      return {
        ...ipo,
        isValid,
      };
    })
  );

  return validationResults;
}

// ==================== COMPONENT ====================

export function IPOSelector({
  selectedSlugs,
  onSelectionChange,
  availableIPOs,
  maxSelection = 3,
}: IPOSelectorProps) {
  // State for validated IPOs
  const [validatedIPOs, setValidatedIPOs] = React.useState<ValidatedIPO[]>([]);
  const [isValidating, setIsValidating] = React.useState(false);
  const [filteredCount, setFilteredCount] = React.useState(0);

  /**
   * Validate IPOs on mount and when availableIPOs changes
   */
  React.useEffect(() => {
    async function loadAndValidateIPOs() {
      if (availableIPOs.length === 0) {
        setValidatedIPOs([]);
        return;
      }

      setIsValidating(true);
      try {
        const validated = await validateIPOSlugs(availableIPOs);

        // Filter out invalid IPOs
        const validIPOs = validated.filter((ipo) => ipo.isValid);
        const invalidCount = validated.length - validIPOs.length;

        setValidatedIPOs(validIPOs);
        setFilteredCount(invalidCount);

        if (invalidCount > 0) {
          console.warn(
            `[IPO Compare] Filtered out ${invalidCount} IPO(s) with invalid slugs`
          );
        }
      } catch (error) {
        console.error('[IPO Compare] Error validating IPOs:', error);
        // On error, show all IPOs (fail-safe)
        setValidatedIPOs(
          availableIPOs.map((ipo) => ({ ...ipo, isValid: true }))
        );
      } finally {
        setIsValidating(false);
      }
    }

    loadAndValidateIPOs();
  }, [availableIPOs]);

  // Filter out already selected IPOs from dropdown
  const selectableIPOs = validatedIPOs.filter(
    (ipo) => !selectedSlugs.includes(ipo.slug)
  );

  // Get selected IPO details for display
  const selectedIPOs = selectedSlugs
    .map((slug) => validatedIPOs.find((ipo) => ipo.slug === slug))
    .filter((ipo): ipo is ValidatedIPO => ipo !== undefined);

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

      {/* Validation Warning Alert */}
      {filteredCount > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {filteredCount} IPO{filteredCount > 1 ? 's' : ''} filtered due to
            invalid slugs. Contact support if you expected to see more IPOs.
          </AlertDescription>
        </Alert>
      )}

      {/* Dropdown Selector */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <Select
          onValueChange={handleSelect}
          disabled={!canSelectMore || selectableIPOs.length === 0 || isValidating}
        >
          <SelectTrigger className="w-full sm:w-[400px]">
            <SelectValue
              placeholder={
                isValidating
                  ? 'Validating IPOs...'
                  : canSelectMore
                    ? 'Select an IPO to add...'
                    : `Maximum ${maxSelection} IPOs selected`
              }
            />
          </SelectTrigger>
          <SelectContent>
            {isValidating ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                Validating IPOs...
              </div>
            ) : selectableIPOs.length === 0 ? (
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
      <div suppressHydrationWarning>
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
      </div>

      {/* Validation Message */}
      {selectionCount === 1 && (
        <div className="text-sm text-amber-600 dark:text-amber-400" suppressHydrationWarning>
          Please select at least one more IPO to enable comparison.
        </div>
      )}
    </div>
  );
}
