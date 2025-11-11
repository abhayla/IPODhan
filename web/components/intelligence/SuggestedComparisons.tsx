'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Scale, TrendingUp, ArrowRight, Sparkles } from 'lucide-react';
import { getBehaviorTracker } from '@/lib/personalization/behavior-tracker';
import type { IPOData } from '@/lib/personalization/recommendation-engine';

/**
 * SuggestedComparisons Component - Phase 5: Personalization Engine
 *
 * Intelligently suggests IPO comparisons based on user's browsing history.
 * Analyzes viewed and saved IPOs to identify meaningful comparison opportunities.
 *
 * Features:
 * - Suggests 2-3 IPO comparison sets based on similarity
 * - Factors: Same sector, similar price range, similar scores
 * - Only suggests IPOs that are different enough to be worth comparing
 * - One-click comparison initiation
 * - Updates in real-time as user browses
 *
 * Algorithm:
 * - Finds IPOs in user's view/save history
 * - Groups by sector
 * - Identifies pairs/triplets with similar characteristics but different scores
 * - Prioritizes comparisons user hasn't made yet
 *
 * Integration:
 * - Phase 1: Uses IPO data structure
 * - Phase 2: Links to comparison visualization
 * - Phase 5: Uses behavior tracker for history
 *
 * @example
 * <SuggestedComparisons
 *   availableIPOs={ipos}
 *   onCompare={(ipoIds) => router.push(`/compare?ids=${ipoIds.join(',')}`)}
 * />
 */

export interface SuggestedComparisonsProps {
  availableIPOs: IPOData[];
  maxSuggestions?: number;
  className?: string;
  onCompare?: (ipoIds: string[]) => void;
}

interface ComparisonSuggestion {
  id: string;
  ipos: IPOData[];
  reason: string;
  relevanceScore: number;
}

export function SuggestedComparisons({
  availableIPOs,
  maxSuggestions = 3,
  className = '',
  onCompare,
}: SuggestedComparisonsProps) {
  const [suggestions, setSuggestions] = useState<ComparisonSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  // Generate suggestions based on user behavior
  useEffect(() => {
    try {
      const tracker = getBehaviorTracker();
      const history = tracker.getHistory();

      // Get IPO IDs from viewing and saving history
      const viewedIds = new Set(history.viewedIPOs.map((v) => v.ipoId));
      const savedIds = new Set(history.savedIPOs.map((s) => s.ipoId));
      const comparedSets = new Set(
        history.comparedIPOs.map((c) => c.ipos.sort().join(','))
      );

      // Filter available IPOs to only those user has interacted with
      const interactedIPOs = availableIPOs.filter(
        (ipo) => viewedIds.has(ipo.id) || savedIds.has(ipo.id)
      );

      if (interactedIPOs.length < 2) {
        setLoading(false);
        return;
      }

      // Generate comparison suggestions
      const suggestionCandidates: ComparisonSuggestion[] = [];

      // Strategy 1: Same sector, different scores
      const bySector = groupBySector(interactedIPOs);
      Object.entries(bySector).forEach(([sector, ipos]) => {
        if (ipos.length >= 2) {
          const pairs = findComparablePairs(ipos, comparedSets);
          pairs.forEach((pair) => {
            suggestionCandidates.push({
              id: `sector-${sector}-${pair.map((i) => i.id).join('-')}`,
              ipos: pair,
              reason: `Compare ${sector} sector IPOs`,
              relevanceScore: calculateRelevance(pair, savedIds, viewedIds),
            });
          });
        }
      });

      // Strategy 2: Similar price range, different sectors (diversification)
      const priceGroups = groupByPriceRange(interactedIPOs);
      Object.entries(priceGroups).forEach(([range, ipos]) => {
        if (ipos.length >= 2) {
          const pairs = findDiversePairs(ipos, comparedSets);
          pairs.forEach((pair) => {
            suggestionCandidates.push({
              id: `price-${range}-${pair.map((i) => i.id).join('-')}`,
              ipos: pair,
              reason: `Similar price, different sectors`,
              relevanceScore: calculateRelevance(pair, savedIds, viewedIds) * 0.8,
            });
          });
        }
      });

      // Strategy 3: High vs Low score in same sector (quality comparison)
      Object.entries(bySector).forEach(([sector, ipos]) => {
        const highScoreIPOs = ipos.filter((i) => (i.score ?? 0) >= 7.5);
        const lowScoreIPOs = ipos.filter((i) => (i.score ?? 0) < 6.5);

        if (highScoreIPOs.length > 0 && lowScoreIPOs.length > 0) {
          const pair = [highScoreIPOs[0], lowScoreIPOs[0]];
          const pairKey = pair
            .map((i) => i.id)
            .sort()
            .join(',');

          if (!comparedSets.has(pairKey)) {
            suggestionCandidates.push({
              id: `quality-${sector}-${pairKey}`,
              ipos: pair,
              reason: `High vs Low quality in ${sector}`,
              relevanceScore: calculateRelevance(pair, savedIds, viewedIds) * 1.2,
            });
          }
        }
      });

      // Sort by relevance and take top N
      const topSuggestions = suggestionCandidates
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxSuggestions);

      setSuggestions(topSuggestions);
      setLoading(false);
    } catch (error) {
      console.error('[SuggestedComparisons] Failed to generate suggestions:', error);
      setLoading(false);
    }
  }, [availableIPOs, maxSuggestions]);

  if (loading) {
    return (
      <div className={`suggested-comparisons ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Scale className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-serif font-semibold">Suggested Comparisons</h3>
        </div>
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div className={`suggested-comparisons ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <Scale className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-serif font-semibold">Suggested Comparisons</h3>
        </div>
        <div className="p-6 text-center bg-gray-50 dark:bg-gray-900 rounded-lg">
          <Scale className="w-10 h-10 mx-auto mb-3 text-gray-400" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Browse more IPOs to get personalized comparison suggestions
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`suggested-comparisons ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Scale className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-serif font-semibold">Suggested Comparisons</h3>
        <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-full">
          {suggestions.length} suggestions
        </span>
      </div>

      {/* Suggestions */}
      <div className="space-y-3">
        {suggestions.map((suggestion) => (
          <ComparisonCard
            key={suggestion.id}
            suggestion={suggestion}
            onCompare={onCompare}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Individual Comparison Suggestion Card
 */
interface ComparisonCardProps {
  suggestion: ComparisonSuggestion;
  onCompare?: (ipoIds: string[]) => void;
}

function ComparisonCard({ suggestion, onCompare }: ComparisonCardProps) {
  const { ipos, reason, relevanceScore } = suggestion;

  return (
    <div className="group p-4 rounded-lg border border-border bg-card hover:border-primary/50 hover:shadow-md transition-all duration-200">
      {/* Reason badge */}
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-medium text-muted-foreground">{reason}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {Math.round(relevanceScore)}% match
        </span>
      </div>

      {/* IPO comparison preview */}
      <div className="flex items-center gap-2 mb-3">
        {ipos.map((ipo, index) => (
          <React.Fragment key={ipo.id}>
            {index > 0 && <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                {ipo.companyName}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {ipo.score && (
                  <span className="flex items-center gap-0.5">
                    <TrendingUp className="w-3 h-3" />
                    {ipo.score.toFixed(1)}
                  </span>
                )}
                <span>{ipo.segment}</span>
              </div>
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* Compare button */}
      <button
        onClick={() => onCompare?.(ipos.map((i) => i.id))}
        className="w-full py-2 px-4 rounded-md bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary text-sm font-medium transition-all duration-200 group-hover:bg-primary group-hover:text-primary-foreground"
      >
        <Scale className="inline-block w-3.5 h-3.5 mr-1.5" />
        Compare Now
      </button>
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Group IPOs by sector
 */
function groupBySector(ipos: IPOData[]): Record<string, IPOData[]> {
  const groups: Record<string, IPOData[]> = {};
  ipos.forEach((ipo) => {
    if (!groups[ipo.sector]) {
      groups[ipo.sector] = [];
    }
    groups[ipo.sector].push(ipo);
  });
  return groups;
}

/**
 * Group IPOs by price range
 */
function groupByPriceRange(ipos: IPOData[]): Record<string, IPOData[]> {
  const groups: Record<string, IPOData[]> = {
    'low': [],      // < 200
    'medium': [],   // 200-500
    'high': [],     // 500-1000
    'premium': [],  // > 1000
  };

  ipos.forEach((ipo) => {
    const price = ipo.priceMax ?? ipo.priceMin ?? 0;
    if (price < 200) groups['low'].push(ipo);
    else if (price < 500) groups['medium'].push(ipo);
    else if (price < 1000) groups['high'].push(ipo);
    else groups['premium'].push(ipo);
  });

  return groups;
}

/**
 * Find comparable pairs (same sector, different scores)
 */
function findComparablePairs(
  ipos: IPOData[],
  alreadyCompared: Set<string>
): IPOData[][] {
  const pairs: IPOData[][] = [];

  // Sort by score
  const sorted = [...ipos].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  for (let i = 0; i < sorted.length - 1; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const pair = [sorted[i], sorted[j]];
      const pairKey = pair
        .map((ipo) => ipo.id)
        .sort()
        .join(',');

      // Check if already compared
      if (alreadyCompared.has(pairKey)) continue;

      // Check if scores are different enough (at least 1 point difference)
      const scoreDiff = Math.abs((sorted[i].score ?? 0) - (sorted[j].score ?? 0));
      if (scoreDiff >= 1.0) {
        pairs.push(pair);
      }
    }
  }

  return pairs.slice(0, 2); // Limit to 2 pairs per sector
}

/**
 * Find diverse pairs (different sectors, similar price)
 */
function findDiversePairs(
  ipos: IPOData[],
  alreadyCompared: Set<string>
): IPOData[][] {
  const pairs: IPOData[][] = [];

  for (let i = 0; i < ipos.length - 1; i++) {
    for (let j = i + 1; j < ipos.length; j++) {
      const pair = [ipos[i], ipos[j]];
      const pairKey = pair
        .map((ipo) => ipo.id)
        .sort()
        .join(',');

      // Check if already compared
      if (alreadyCompared.has(pairKey)) continue;

      // Check if different sectors
      if (ipos[i].sector !== ipos[j].sector) {
        pairs.push(pair);
      }
    }
  }

  return pairs.slice(0, 1); // Limit to 1 diverse pair per price range
}

/**
 * Calculate relevance score based on user interaction
 */
function calculateRelevance(
  ipos: IPOData[],
  savedIds: Set<string>,
  viewedIds: Set<string>
): number {
  let score = 50; // Base score

  // Boost if any IPO is saved
  const hasSaved = ipos.some((ipo) => savedIds.has(ipo.id));
  if (hasSaved) score += 30;

  // Boost if all IPOs are viewed
  const allViewed = ipos.every((ipo) => viewedIds.has(ipo.id));
  if (allViewed) score += 20;

  // Boost if IPOs have high scores
  const avgScore = ipos.reduce((sum, ipo) => sum + (ipo.score ?? 0), 0) / ipos.length;
  if (avgScore >= 7.5) score += 10;

  return Math.min(100, score);
}

export default SuggestedComparisons;
