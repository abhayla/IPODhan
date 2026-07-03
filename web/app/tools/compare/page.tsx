/**
 * IPO Comparison Tool - Standalone Page
 *
 * Dedicated page for comparing 2-3 IPOs side-by-side
 * Features:
 * - URL query param support: /tools/compare?ipos=slug1,slug2,slug3
 * - Pre-population from URL params
 * - Session storage for persistent selection
 * - SEO optimized with metadata
 * - Mobile-responsive design
 *
 * @route /tools/compare
 */

'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { IPOSelector } from '@/components/tools/IPOSelector';
import { ComparisonTable } from '@/components/tools/ComparisonTable';
import type { IPO } from '@/lib/repositories/types';
import type { ComparisonResponse } from '@/lib/types/comparison';

// ==================== CONSTANTS ====================

const SESSION_STORAGE_KEY = 'comparisonIPOs';

// ==================== PAGE COMPONENT ====================

function CompareIPOsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // State
  const [availableIPOs, setAvailableIPOs] = React.useState<IPO[]>([]);
  const [selectedSlugs, setSelectedSlugs] = React.useState<string[]>([]);
  const [comparisonData, setComparisonData] = React.useState<ComparisonResponse['comparisons']>([]);
  const [isLoadingComparison, setIsLoadingComparison] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // One-time guard so a default selection is seeded exactly once and never
  // fights the user clearing their picks (R20 #7).
  const seededDefaultRef = React.useRef(false);

  /**
   * Seed a default 2-IPO comparison on landing so the tool DEMONSTRATES its
   * value (the side-by-side metric grid) instead of showing an empty state.
   * Only when nothing came from the URL or session, and only once.
   */
  React.useEffect(() => {
    if (seededDefaultRef.current) return;
    if (availableIPOs.length < 2 || selectedSlugs.length > 0) return;
    if (searchParams.get('ipos')) return;
    if (typeof window !== 'undefined' && sessionStorage.getItem(SESSION_STORAGE_KEY)) return;
    seededDefaultRef.current = true;
    // Prefer CLOSED IPOs for the default pair — they carry real subscription/GMP
    // data (subscription has completed), so the demo isn't a wall of N/A (R25 #3).
    const rank = (s: string) => (s === 'CLOSED' ? 0 : s === 'OPEN' ? 1 : 2);
    const seed = [...availableIPOs]
      .sort((a, b) => rank(a.status) - rank(b.status))
      .slice(0, 2);
    setSelectedSlugs(seed.map((ipo) => ipo.slug));
  }, [availableIPOs, selectedSlugs.length, searchParams]);

  /**
   * Fetch available IPOs on mount. Only OPEN/UPCOMING/CLOSED are comparable
   * (the compare API rejects LISTED); the default seed prefers CLOSED, which
   * carry real subscription/GMP data, so the demo isn't a wall of N/A (R25 #3).
   */
  React.useEffect(() => {
    async function fetchAvailableIPOs() {
      try {
        const response = await fetch(
          '/api/ipos?status=OPEN&status=UPCOMING&status=CLOSED&limit=100'
        );

        if (!response.ok) {
          throw new Error('Failed to fetch IPOs');
        }

        const data = await response.json();
        setAvailableIPOs(data.data || []);
      } catch (err) {
        console.error('Error fetching IPOs:', err);
        setError('Failed to load available IPOs. Please refresh the page.');
      }
    }

    fetchAvailableIPOs();
  }, []);

  /**
   * Initialize selected slugs from URL params or session storage
   */
  React.useEffect(() => {
    const slugsFromUrl = searchParams.get('ipos')?.split(',').filter(Boolean) || [];

    if (slugsFromUrl.length > 0) {
      // Use URL params if available
      setSelectedSlugs(slugsFromUrl.slice(0, 3)); // Limit to 3
    } else if (typeof window !== 'undefined') {
      // Fall back to session storage
      try {
        const savedSlugs = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (savedSlugs) {
          const parsedSlugs = JSON.parse(savedSlugs);
          if (Array.isArray(parsedSlugs)) {
            setSelectedSlugs(parsedSlugs.slice(0, 3));
          }
        }
      } catch (err) {
        console.error('Error reading from session storage:', err);
      }
    }
  }, [searchParams]);

  /**
   * Fetch comparison data when selection changes
   */
  React.useEffect(() => {
    async function fetchComparisonData() {
      if (selectedSlugs.length < 2) {
        setComparisonData([]);
        return;
      }

      try {
        setIsLoadingComparison(true);
        setError(null);

        const response = await fetch('/api/tools/compare', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ipoSlugs: selectedSlugs,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to fetch comparison data');
        }

        const data: ComparisonResponse = await response.json();
        setComparisonData(data.comparisons);
      } catch (err) {
        console.error('Error fetching comparison:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to load comparison data'
        );
        setComparisonData([]);
      } finally {
        setIsLoadingComparison(false);
      }
    }

    fetchComparisonData();
  }, [selectedSlugs]);

  /**
   * Handle selection change
   * Updates URL params and session storage
   */
  const handleSelectionChange = React.useCallback(
    (newSlugs: string[]) => {
      setSelectedSlugs(newSlugs);

      // Update URL query params
      if (newSlugs.length > 0) {
        router.push(`/tools/compare?ipos=${newSlugs.join(',')}`, {
          scroll: false,
        });
      } else {
        router.push('/tools/compare', { scroll: false });
      }

      // Save to session storage
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSlugs));
        } catch (err) {
          console.error('Error writing to session storage:', err);
        }
      }
    },
    [router]
  );

  // Breadcrumbs
  const breadcrumbItems = [
    { label: 'Home', href: '/' },
    { label: 'Tools', href: '/tools/lot-calculator' },
    { label: 'Compare IPOs', href: '/tools/compare' },
  ];

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">

      {/* Breadcrumbs */}
      <Breadcrumbs items={breadcrumbItems} />

      {/* Page Header */}
      <div className="space-y-2 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">IPO Comparison Tool</h1>
        <p className="text-muted-foreground">
          Compare multiple IPOs side-by-side to make informed investment decisions
        </p>
      </div>

      {/* IPO Selector */}
      <div className="bg-card border rounded-lg p-6 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150 hover:shadow-lg transition-shadow">
        <IPOSelector
          selectedSlugs={selectedSlugs}
          onSelectionChange={handleSelectionChange}
          availableIPOs={availableIPOs}
          maxSelection={3}
        />
      </div>

      {/* Comparison Table */}
      {selectedSlugs.length >= 2 && (
        <div className="bg-card border rounded-lg p-6 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 hover:shadow-lg transition-shadow">
          <ComparisonTable
            comparisonData={comparisonData}
            isLoading={isLoadingComparison}
            error={error}
          />
        </div>
      )}

      {/* Info Section — collapsed by default so the comparison table is the
          page's focus, not a wall of instructional prose (R36 #1) */}
      <details className="group rounded-lg border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-medium text-foreground">
          How to use this tool
          <span className="text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="space-y-4 border-t px-5 py-5">
        <div className="space-y-3 text-sm text-muted-foreground">
          <div>
            <h3 className="font-medium text-foreground mb-1">1. Select IPOs</h3>
            <p>
              Choose 2-3 active IPOs from the dropdown menu. Only IPOs with
              OPEN, UPCOMING, or CLOSED status can be compared.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-foreground mb-1">2. Review Comparison</h3>
            <p>
              The comparison table shows key metrics side-by-side, with best
              values highlighted in green. Compare subscription status, GMP,
              financial ratios, and ratings.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-foreground mb-1">3. Share Your Comparison</h3>
            <p>
              The URL updates automatically as you select IPOs. Copy and share
              the URL to show others your comparison.
            </p>
          </div>
        </div>

        {/* Tips */}
        <div className="pt-4 border-t">
          <h3 className="font-medium text-foreground mb-2">Comparison Tips</h3>
          <ul className="space-y-1 text-sm text-muted-foreground list-disc list-inside">
            <li>Lower P/E ratio generally indicates better value</li>
            <li>Higher ROE suggests better profitability</li>
            <li>Strong subscription indicates high investor demand</li>
            <li>Positive GMP may indicate listing gains potential</li>
            <li>Consider all metrics together, not in isolation</li>
          </ul>
        </div>
        </div>
      </details>
    </div>
  );
}

// ==================== EXPORTED PAGE WITH SUSPENSE ====================

export default function CompareIPOsPage() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-8">Loading comparison tool...</div>}>
      <CompareIPOsContent />
    </Suspense>
  );
}
