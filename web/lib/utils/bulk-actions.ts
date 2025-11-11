/**
 * Bulk Actions Utility - Phase 5: Personalization Engine
 *
 * Provides handlers for bulk operations on selected IPOs.
 * Integrates with MultiSelectCard and CSVExporter components.
 *
 * Features:
 * - Compare multiple IPOs (2-5 max)
 * - Export selected IPOs to CSV
 * - Share IPO collection via Web Share API or URL
 * - Save bulk selection to localStorage
 * - Track bulk actions in behavior history
 *
 * Integration:
 * - Phase 2: Navigate to comparison visualizations
 * - Phase 5: Works with multi-select and export tools
 */

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { getBehaviorTracker } from '@/lib/personalization/behavior-tracker';
import { exportIPOsToCSV } from '@/components/tools/CSVExporter';
import type { IPO } from '@/lib/db/types';

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAX_COMPARE_ITEMS = 5;
export const MIN_COMPARE_ITEMS = 2;

// ============================================================================
// BULK ACTION HANDLERS
// ============================================================================

/**
 * Hook for bulk action handlers
 */
export function useBulkActions() {
  const router = useRouter();

  /**
   * Compare selected IPOs
   * Navigates to comparison page with selected IPO IDs
   */
  const handleCompare = useCallback(
    (ipoIds: string[]) => {
      if (ipoIds.length < MIN_COMPARE_ITEMS) {
        console.warn(`[BulkActions] Need at least ${MIN_COMPARE_ITEMS} IPOs to compare`);
        return;
      }

      if (ipoIds.length > MAX_COMPARE_ITEMS) {
        console.warn(`[BulkActions] Maximum ${MAX_COMPARE_ITEMS} IPOs can be compared`);
        return;
      }

      // Track comparison in behavior history
      try {
        const tracker = getBehaviorTracker();
        tracker.trackComparison(ipoIds);
      } catch (error) {
        console.error('[BulkActions] Failed to track comparison:', error);
      }

      // Navigate to comparison page
      const compareUrl = `/compare?ids=${ipoIds.join(',')}`;
      router.push(compareUrl);
    },
    [router]
  );

  /**
   * Export selected IPOs to CSV
   */
  const handleExport = useCallback(
    async (ipos: IPO[], filename?: string) => {
      if (ipos.length === 0) {
        console.warn('[BulkActions] No IPOs to export');
        return;
      }

      try {
        await exportIPOsToCSV(ipos, filename);

        // Track export action (using search as proxy since no specific export tracking)
        const tracker = getBehaviorTracker();
        tracker.trackSearch(
          `CSV Export: ${ipos.length} IPOs`,
          ipos.length,
          ipos[0]?.id
        );

        return true;
      } catch (error) {
        console.error('[BulkActions] Export failed:', error);
        return false;
      }
    },
    []
  );

  /**
   * Share IPO collection
   * Uses Web Share API if available, falls back to URL copy
   */
  const handleShare = useCallback(
    async (ipoIds: string[], ipoNames: string[]) => {
      if (ipoIds.length === 0) {
        console.warn('[BulkActions] No IPOs to share');
        return;
      }

      const shareUrl = `${window.location.origin}/compare?ids=${ipoIds.join(',')}`;
      const shareTitle = 'IPODhan - IPO Comparison';
      const shareText = `Check out these ${ipoIds.length} IPOs: ${ipoNames.slice(0, 3).join(', ')}${
        ipoNames.length > 3 ? '...' : ''
      }`;

      // Try Web Share API (mobile, modern browsers)
      if (navigator.share) {
        try {
          await navigator.share({
            title: shareTitle,
            text: shareText,
            url: shareUrl,
          });
          return { success: true, method: 'web-share' };
        } catch (error: any) {
          // User cancelled share or error occurred
          if (error.name === 'AbortError') {
            return { success: false, method: 'web-share', cancelled: true };
          }
          console.error('[BulkActions] Web Share failed:', error);
          // Fall through to clipboard
        }
      }

      // Fallback: Copy URL to clipboard
      try {
        await navigator.clipboard.writeText(shareUrl);
        return { success: true, method: 'clipboard' };
      } catch (error) {
        console.error('[BulkActions] Clipboard copy failed:', error);

        // Last resort: Create temporary input and select
        const input = document.createElement('input');
        input.value = shareUrl;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();

        try {
          document.execCommand('copy');
          document.body.removeChild(input);
          return { success: true, method: 'execCommand' };
        } catch (err) {
          document.body.removeChild(input);
          return { success: false, method: 'none' };
        }
      }
    },
    []
  );

  /**
   * Save bulk selection to localStorage
   * Creates a named collection that can be loaded later
   */
  const handleSaveCollection = useCallback(
    (ipoIds: string[], collectionName: string) => {
      try {
        const collections = loadSavedCollections();

        const newCollection = {
          id: `collection-${Date.now()}`,
          name: collectionName,
          ipoIds,
          createdAt: new Date().toISOString(),
        };

        collections.push(newCollection);

        localStorage.setItem('ipodhan-collections', JSON.stringify(collections));

        return { success: true, collection: newCollection };
      } catch (error) {
        console.error('[BulkActions] Failed to save collection:', error);
        return { success: false, error };
      }
    },
    []
  );

  /**
   * Load saved collections from localStorage
   */
  const loadCollections = useCallback(() => {
    return loadSavedCollections();
  }, []);

  /**
   * Delete a saved collection
   */
  const deleteCollection = useCallback((collectionId: string) => {
    try {
      const collections = loadSavedCollections();
      const filtered = collections.filter((c) => c.id !== collectionId);

      localStorage.setItem('ipodhan-collections', JSON.stringify(filtered));

      return { success: true };
    } catch (error) {
      console.error('[BulkActions] Failed to delete collection:', error);
      return { success: false, error };
    }
  }, []);

  /**
   * Save multiple IPOs to user's saved list
   */
  const handleBulkSave = useCallback((ipos: Array<{ id: string; slug: string; companyName: string }>) => {
    try {
      const tracker = getBehaviorTracker();

      ipos.forEach((ipo) => {
        tracker.trackSave(ipo.id, ipo.slug, ipo.companyName);
      });

      return { success: true, count: ipos.length };
    } catch (error) {
      console.error('[BulkActions] Bulk save failed:', error);
      return { success: false, error };
    }
  }, []);

  return {
    handleCompare,
    handleExport,
    handleShare,
    handleSaveCollection,
    handleBulkSave,
    loadCollections,
    deleteCollection,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface SavedCollection {
  id: string;
  name: string;
  ipoIds: string[];
  createdAt: string;
}

/**
 * Load saved collections from localStorage
 */
function loadSavedCollections(): SavedCollection[] {
  try {
    const stored = localStorage.getItem('ipodhan-collections');
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[BulkActions] Failed to load collections:', error);
    return [];
  }
}

/**
 * Validate IPO selection for comparison
 */
export function validateCompareSelection(ipoIds: string[]): {
  valid: boolean;
  error?: string;
} {
  if (ipoIds.length < MIN_COMPARE_ITEMS) {
    return {
      valid: false,
      error: `Select at least ${MIN_COMPARE_ITEMS} IPOs to compare`,
    };
  }

  if (ipoIds.length > MAX_COMPARE_ITEMS) {
    return {
      valid: false,
      error: `Maximum ${MAX_COMPARE_ITEMS} IPOs can be compared at once`,
    };
  }

  // Check for duplicates
  const uniqueIds = new Set(ipoIds);
  if (uniqueIds.size !== ipoIds.length) {
    return {
      valid: false,
      error: 'Duplicate IPOs detected',
    };
  }

  return { valid: true };
}

/**
 * Generate shareable comparison URL
 */
export function generateCompareURL(ipoIds: string[], baseUrl?: string): string {
  const base = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/compare?ids=${ipoIds.join(',')}`;
}

/**
 * Parse IPO IDs from comparison URL
 */
export function parseCompareURL(url: string): string[] {
  try {
    const urlObj = new URL(url);
    const idsParam = urlObj.searchParams.get('ids');

    if (!idsParam) return [];

    return idsParam.split(',').filter(Boolean);
  } catch (error) {
    console.error('[BulkActions] Failed to parse URL:', error);
    return [];
  }
}

/**
 * Get share text for IPO collection
 */
export function getShareText(
  ipoNames: string[],
  count: number
): { title: string; text: string } {
  const displayNames = ipoNames.slice(0, 3).join(', ');
  const hasMore = count > 3;

  return {
    title: 'IPODhan - IPO Comparison',
    text: `Check out these ${count} IPO${count !== 1 ? 's' : ''}: ${displayNames}${
      hasMore ? ` and ${count - 3} more` : ''
    }`,
  };
}

export default useBulkActions;
