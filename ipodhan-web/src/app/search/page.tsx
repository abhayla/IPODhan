'use client';

import React, { useEffect, useState, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { IPOCard } from '@/components/ipo';
import { IPOListSkeleton, Button } from '@/components/common';
import { FiltersBar, SortSelector } from '@/components/filters';
import { useIPOStore } from '@/stores/ipoStore';
import { IPOSearch } from '@/lib/search/IPOSearch';
import type { SearchFilters, SortOption } from '@/types/ipo';

/**
 * SearchPageContent Component
 * Search results page with filters and sorting
 * Wrapped in Suspense to handle useSearchParams()
 */
function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams?.get('q') || '';

  const { ipos, scores, loading, error, fetchIPOs, fetchIPOScore } = useIPOStore();

  const [filters, setFilters] = useState<SearchFilters>({});
  const [sortBy, setSortBy] = useState<SortOption>('relevance');

  // Load all IPOs on mount
  useEffect(() => {
    fetchIPOs({});
  }, [fetchIPOs]);

  // Fetch scores for displayed IPOs
  useEffect(() => {
    ipos.forEach(ipo => {
      if (!scores[ipo.id]) {
        fetchIPOScore(ipo.id);
      }
    });
  }, [ipos, scores, fetchIPOScore]);

  // Search and filter IPOs
  const searchResults = useMemo(() => {
    if (!ipos.length) return [];

    // Apply filters first
    let filteredIPOs = IPOSearch.applyFilters(ipos, filters);

    // If there's a search query, use fuzzy search
    if (query.trim().length >= 2) {
      const searcher = new IPOSearch(filteredIPOs);
      const results = searcher.search(query);

      // Convert search results back to IPOs with relevance scores
      const relevanceMap: Record<string, number> = {};
      results.forEach(result => {
        relevanceMap[result.id] = result.relevance || 0;
      });

      filteredIPOs = filteredIPOs.filter(ipo => relevanceMap[ipo.id] !== undefined);

      // Sort by relevance if that's selected
      if (sortBy === 'relevance') {
        // Convert scores to scoreMap for sorting
        const scoreMapForRelevance: Record<string, number> = {};
        Object.entries(scores).forEach(([id, score]) => {
          scoreMapForRelevance[id] = score.totalScore;
        });
        return IPOSearch.sortIPOs(filteredIPOs, sortBy, scoreMapForRelevance, relevanceMap);
      }
    }

    // Apply sorting
    const scoreMap: Record<string, number> = {};
    Object.entries(scores).forEach(([id, score]) => {
      scoreMap[id] = score.totalScore;
    });

    return IPOSearch.sortIPOs(filteredIPOs, sortBy, scoreMap);
  }, [ipos, query, filters, sortBy, scores]);

  const handleFilterChange = (newFilters: Partial<SearchFilters>) => {
    setFilters((prev: SearchFilters) => ({ ...prev, ...newFilters }));
  };

  const handleClearFilters = () => {
    setFilters({});
  };

  const handleBackToHome = () => {
    router.push('/');
  };

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-6">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" onClick={handleBackToHome} leftIcon={<span>←</span>}>
              Back to Home
            </Button>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Search Results</h1>
          {query && (
            <p className="text-gray-600">
              Showing results for <span className="font-semibold">"{query}"</span>
            </p>
          )}
          <p className="text-sm text-gray-500 mt-2">
            {searchResults.length} {searchResults.length === 1 ? 'result' : 'results'} found
          </p>
        </div>
      </div>

      {/* Filters */}
      <FiltersBar
        filters={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
      />

      {/* Sort and Results */}
      <section className="max-w-7xl mx-auto px-4 py-8">
        {/* Sort Controls */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-gray-900">
            {query ? 'Search Results' : 'All IPOs'}
          </h2>
          <SortSelector sortBy={sortBy} onSortChange={setSortBy} />
        </div>

        {/* Error State */}
        {error && (
          <div
            className="bg-danger-light border border-danger text-danger-dark px-4 py-3 rounded mb-6"
            role="alert"
          >
            <p className="font-medium">Error loading IPOs</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <IPOListSkeleton count={6} />
        ) : searchResults.length === 0 ? (
          /* Empty State */
          <div className="text-center py-12">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No results found</h3>
            <p className="text-gray-600 mb-6">
              {query
                ? `No IPOs match your search for "${query}"`
                : 'Try adjusting your filters'}
            </p>
            {query && (
              <Button variant="primary" onClick={handleBackToHome}>
                Browse All IPOs
              </Button>
            )}
          </div>
        ) : (
          /* Results Grid */
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            role="list"
            aria-label="Search results"
          >
            {searchResults.map(ipo => (
              <div key={ipo.id} role="listitem">
                <IPOCard ipo={ipo} score={scores[ipo.id]} showSubscription={ipo.status === 'LIVE'} />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

/**
 * SearchPage with Suspense boundary
 * Required for useSearchParams() in Next.js 14+
 */
export default function SearchPage() {
  return (
    <Suspense fallback={<IPOListSkeleton count={6} />}>
      <SearchPageContent />
    </Suspense>
  );
}
