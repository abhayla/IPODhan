/**
 * Recommendation Summary Section
 * Story 11.16: IPO Recommendations Summary Display
 *
 * Displays comprehensive broker recommendation summary including:
 * - Average rating with star visualization
 * - Review count and recommendation breakdown
 * - Sentiment analysis (positive/negative split)
 * - Top Apply and Avoid reasons
 * - Latest 3 sample reviews
 * - Link to full reviews page
 *
 * @component
 * @param {Object} reviewSummary - Aggregated review data from ReviewRepository
 * @param {string} ipoSegment - IPO segment for navigation (MAINBOARD or SME)
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Star, TrendingUp, TrendingDown, MessageSquare, Award } from 'lucide-react';
import type { ReviewSummary } from '@/lib/repositories/review-repository';

interface RecommendationSummarySectionProps {
  reviewSummary: ReviewSummary | null;
  ipoSegment: 'MAINBOARD' | 'SME';
}

/**
 * Render star rating visualization
 * @param rating - Numeric rating (0-5)
 * @returns Array of star icons (filled and empty)
 */
function renderStarRating(rating: number): React.ReactElement[] {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

  const stars: React.ReactElement[] = [];

  // Full stars
  for (let i = 0; i < fullStars; i++) {
    stars.push(
      <Star key={`full-${i}`} className="h-5 w-5 fill-yellow-500 text-yellow-500" />
    );
  }

  // Half star
  if (hasHalfStar) {
    stars.push(
      <Star key="half" className="h-5 w-5 fill-yellow-500/50 text-yellow-500" />
    );
  }

  // Empty stars
  for (let i = 0; i < emptyStars; i++) {
    stars.push(
      <Star key={`empty-${i}`} className="h-5 w-5 text-gray-300" />
    );
  }

  return stars;
}

/**
 * Get Badge variant and custom class based on recommendation type
 */
function getRecommendationStyle(recommendation: string): {
  variant: 'default' | 'destructive' | 'secondary';
  className?: string;
} {
  switch (recommendation) {
    case 'May apply':
      return {
        variant: 'default',
        className: 'bg-green-600 hover:bg-green-700 border-green-600',
      };
    case 'Subscribe':
      return { variant: 'default' };
    case 'Avoid':
    case 'Not Recommended':
      return { variant: 'destructive' };
    default:
      return { variant: 'secondary' };
  }
}

/**
 * Format date to Indian locale
 */
function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Recommendation Bar Component
 * Visual progress bar with label and percentage
 */
interface RecommendationBarProps {
  label: string;
  count: number;
  total: number;
  color: string;
}

function RecommendationBar({ label, count, total, color }: RecommendationBarProps) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {count} ({percentage}%)
        </span>
      </div>
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className={`rounded-full h-2 transition-all ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Empty State Component
 */
function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-muted-foreground" />
          <CardTitle>Broker Recommendations</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-center py-8">
          <Award className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-lg font-medium text-muted-foreground mb-2">
            No broker reviews available yet
          </p>
          <p className="text-sm text-muted-foreground">
            Expert opinions will appear here once brokers publish their analysis.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Main Component
 */
export function RecommendationSummarySection({
  reviewSummary,
  ipoSegment,
}: RecommendationSummarySectionProps) {
  // Show empty state if no reviews
  if (!reviewSummary) {
    return <EmptyState />;
  }

  const {
    averageRating,
    totalReviews,
    recommendationBreakdown,
    sentimentAnalysis,
    topApplyReasons,
    topAvoidReasons,
    latestReviews,
  } = reviewSummary;

  // Determine review page URL based on segment
  const reviewsPageUrl =
    ipoSegment === 'MAINBOARD' ? '/mainboard-ipo-reviews' : '/sme-ipo-reviews';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <CardTitle>Broker Recommendations</CardTitle>
        </div>

        {/* Star Rating and Review Count */}
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex">{renderStarRating(averageRating)}</div>
            <span className="text-2xl font-bold">{averageRating.toFixed(1)}</span>
            <span className="text-muted-foreground">/5</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Based on {totalReviews} broker {totalReviews === 1 ? 'review' : 'reviews'}
          </p>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-6">
          {/* Recommendation Breakdown */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Recommendation Breakdown</h3>
            <div className="space-y-3">
              <RecommendationBar
                label="May Apply"
                count={recommendationBreakdown.apply}
                total={totalReviews}
                color="bg-green-500"
              />
              <RecommendationBar
                label="Subscribe"
                count={recommendationBreakdown.subscribe}
                total={totalReviews}
                color="bg-blue-500"
              />
              <RecommendationBar
                label="Avoid"
                count={recommendationBreakdown.avoid}
                total={totalReviews}
                color="bg-red-500"
              />
              <RecommendationBar
                label="Not Recommended"
                count={recommendationBreakdown.notRecommended}
                total={totalReviews}
                color="bg-gray-500"
              />
            </div>
          </div>

          {/* Sentiment Analysis */}
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">Sentiment Analysis</h3>
            <div className="grid grid-cols-2 gap-4">
              {/* Positive Sentiment */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  <span className="font-semibold text-green-900">Positive</span>
                </div>
                <p className="text-3xl font-bold text-green-600">
                  {sentimentAnalysis.positive}%
                </p>
              </div>

              {/* Negative Sentiment */}
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingDown className="h-5 w-5 text-red-600" />
                  <span className="font-semibold text-red-900">Negative</span>
                </div>
                <p className="text-3xl font-bold text-red-600">
                  {sentimentAnalysis.negative}%
                </p>
              </div>
            </div>
          </div>

          {/* Top Reasons Grid */}
          {(topApplyReasons.length > 0 || topAvoidReasons.length > 0) && (
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Key Reasons</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Apply Reasons */}
                {topApplyReasons.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp className="h-4 w-4 text-green-600" />
                      <h4 className="font-semibold text-green-900">Why Apply</h4>
                    </div>
                    <ul className="space-y-2">
                      {topApplyReasons.map((reason, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm">
                          <span className="font-semibold text-green-600 mt-0.5">
                            {index + 1}.
                          </span>
                          <span className="text-muted-foreground">{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Avoid Reasons */}
                {topAvoidReasons.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingDown className="h-4 w-4 text-red-600" />
                      <h4 className="font-semibold text-red-900">Why Avoid</h4>
                    </div>
                    <ul className="space-y-2">
                      {topAvoidReasons.map((reason, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm">
                          <span className="font-semibold text-red-600 mt-0.5">
                            {index + 1}.
                          </span>
                          <span className="text-muted-foreground">{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Latest Reviews */}
          {latestReviews.length > 0 && (
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Latest Reviews</h3>
              <div className="space-y-4">
                {latestReviews.map((review) => (
                  <div
                    key={review.id}
                    className="border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold">{review.author}</p>
                          <Badge
                            variant={getRecommendationStyle(review.recommendation).variant}
                            className={getRecommendationStyle(review.recommendation).className}
                          >
                            {review.recommendation}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(review.publishedDate)}
                        </p>
                      </div>
                    </div>
                    {review.reviewTitle && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {review.reviewTitle}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* View All Reviews Link */}
          <div className="border-t pt-6">
            <Link href={reviewsPageUrl}>
              <Button variant="outline" className="w-full md:w-auto">
                View All {totalReviews} Reviews
              </Button>
            </Link>
          </div>

          {/* Information Note */}
          <div className="text-xs text-muted-foreground border-t pt-4">
            <p>
              <strong>Note:</strong> Broker recommendations are based on their research and
              analysis. Please conduct your own due diligence before making investment decisions.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
