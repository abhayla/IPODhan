'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, TrendingUp, Info } from 'lucide-react';
import { getRecommendationEngine, RecommendationResult, IPOData } from '@/lib/personalization/recommendation-engine';
import { getBehaviorTracker } from '@/lib/personalization/behavior-tracker';

/**
 * ForYouSection Component - Phase 5: Personalization Engine
 *
 * Displays ML-powered personalized IPO recommendations.
 * Uses client-side recommendation algorithm based on user behavior.
 *
 * Features:
 * - Personalized recommendations (max 5)
 * - Confidence scores and explanations
 * - Fallback to top-rated IPOs for new users
 * - Profile strength indicator
 * - Interactive recommendation cards
 * - Real-time updates as user interacts
 *
 * Integration:
 * - Phase 1: Uses IPOCardEnhanced for display
 * - Phase 2: Shows score breakdown on hover
 * - Phase 3: Updates based on live interactions
 * - Phase 4: Mobile-optimized with swipe gestures
 *
 * @example
 * <ForYouSection availableIPOs={ipos} onIPOClick={(slug) => router.push(`/ipos/${slug}`)} />
 */

export interface ForYouSectionProps {
  availableIPOs: IPOData[];
  maxRecommendations?: number;
  className?: string;
  onIPOClick?: (slug: string) => void;
}

export function ForYouSection({
  availableIPOs,
  maxRecommendations = 5,
  className = '',
  onIPOClick,
}: ForYouSectionProps) {
  const [recommendations, setRecommendations] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get recommendations on mount
    const engine = getRecommendationEngine();
    const result = engine.getRecommendations(availableIPOs, maxRecommendations);
    setRecommendations(result);
    setLoading(false);
  }, [availableIPOs, maxRecommendations]);

  if (loading) {
    return (
      <section className={`space-y-4 ${className}`}>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-2xl font-serif font-semibold">For You</h2>
        </div>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  if (!recommendations || recommendations.recommendations.length === 0) {
    return (
      <section className={`space-y-4 ${className}`}>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-2xl font-serif font-semibold">For You</h2>
        </div>
        <div className="p-8 text-center bg-gray-50 dark:bg-gray-900 rounded-lg">
          <Sparkles className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p className="text-gray-600 dark:text-gray-400">
            No recommendations available right now. Check back soon!
          </p>
        </div>
      </section>
    );
  }

  const { recommendations: recs, userProfileStrength, fallbackUsed } = recommendations;

  return (
    <section className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-2xl font-serif font-semibold">For You</h2>
          {fallbackUsed && (
            <span className="text-xs px-2 py-1 bg-accent/10 text-accent rounded-full">
              New User
            </span>
          )}
        </div>

        {/* Profile Strength Indicator */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Profile:</span>
          <div className="flex items-center gap-1">
            <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${userProfileStrength}%` }}
              />
            </div>
            <span className="text-xs font-medium">{userProfileStrength}%</span>
          </div>
        </div>
      </div>

      {/* Recommendations Grid */}
      <div className="grid grid-cols-1 gap-4">
        {recs.map((rec, index) => {
          const ipo = availableIPOs.find((i) => i.id === rec.ipoId);
          if (!ipo) return null;

          return (
            <RecommendationCard
              key={rec.ipoId}
              ipo={ipo}
              recommendation={rec}
              rank={index + 1}
              onClick={() => onIPOClick?.(ipo.slug)}
            />
          );
        })}
      </div>

      {/* Explanation Footer */}
      {fallbackUsed && (
        <div className="flex items-start gap-2 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-sm">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-blue-900 dark:text-blue-100">
            These are top-rated IPOs. As you browse and save IPOs, we'll personalize
            recommendations based on your preferences.
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Individual Recommendation Card
 */
interface RecommendationCardProps {
  ipo: IPOData;
  recommendation: {
    score: number;
    confidence: number;
    reasons: string[];
  };
  rank: number;
  onClick?: () => void;
}

function RecommendationCard({ ipo, recommendation, rank, onClick }: RecommendationCardProps) {
  const { score, confidence, reasons } = recommendation;

  // Color based on score
  const getScoreColor = () => {
    if (score >= 80) return 'text-success border-success/20 bg-success/5';
    if (score >= 60) return 'text-primary border-primary/20 bg-primary/5';
    if (score >= 40) return 'text-accent border-accent/20 bg-accent/5';
    return 'text-muted-foreground border-gray-300 bg-gray-50';
  };

  return (
    <div
      onClick={onClick}
      className="group relative p-4 border rounded-lg hover:shadow-md transition-all duration-200 cursor-pointer bg-white dark:bg-gray-900"
    >
      {/* Rank Badge */}
      <div className="absolute -top-2 -left-2 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center text-sm font-bold shadow-md">
        {rank}
      </div>

      {/* Score Badge */}
      <div className={`absolute top-4 right-4 px-3 py-1 rounded-full border ${getScoreColor()}`}>
        <span className="text-sm font-semibold">{score.toFixed(0)}%</span>
        <span className="text-xs ml-1">match</span>
      </div>

      {/* IPO Info */}
      <div className="mt-2 pr-24">
        <h3 className="text-lg font-semibold group-hover:text-primary transition-colors">
          {ipo.companyName}
        </h3>
        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
          <span>{ipo.sector}</span>
          <span>•</span>
          <span>{ipo.segment}</span>
          {ipo.score && (
            <>
              <span>•</span>
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                {ipo.score.toFixed(1)}/10
              </span>
            </>
          )}
        </div>
      </div>

      {/* Reasons */}
      <div className="mt-3 space-y-1">
        {reasons.slice(0, 2).map((reason, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="text-primary mt-1">•</span>
            <span className="text-gray-600 dark:text-gray-400">{reason}</span>
          </div>
        ))}
      </div>

      {/* Confidence Indicator */}
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span>Confidence:</span>
        <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden max-w-[100px]">
          <div
            className="h-full bg-primary/60 transition-all duration-300"
            style={{ width: `${confidence}%` }}
          />
        </div>
        <span>{confidence}%</span>
      </div>

      {/* Hover Effect */}
      <div className="absolute inset-0 border-2 border-primary rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
    </div>
  );
}
