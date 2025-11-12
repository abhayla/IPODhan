/**
 * Mainboard Content Sections Component
 *
 * Displays 6 content sections for Mainboard IPOs landing page:
 * 1. Current IPOs (4-6 cards) - USING IPOCardEnhanced (Phase 1)
 * 2. Upcoming IPOs (4-6 cards) - USING IPOCardEnhanced (Phase 1)
 * 3. Recently Listed IPOs (4-6 cards) - USING IPOCardEnhanced (Phase 1)
 * 4. Reviews (4-6 cards)
 * 5. Performance Highlights (top gainers/losers)
 * 6. Subscription Status (4-6 cards)
 *
 * Each section has a "View All" link.
 * Server component with responsive card grids.
 *
 * Story 9.15 - AC#4, AC#5
 * UX Phase 1 Integration: Uses IPOCardEnhanced for premium visual identity
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HiArrowRight, HiArrowTrendingUp, HiArrowTrendingDown } from 'react-icons/hi2';
import { IPOCardEnhanced } from '@/components/ipo/IPOCardEnhanced';
import type { IPO } from '@/lib/db/types';
import type {
  ReviewWithIPO,
  PerformanceHighlight,
  SubscriptionStatusData,
} from '@/lib/services/mainboard-landing-service';

interface MainboardContentSectionsProps {
  currentIPOs: IPO[];
  upcomingIPOs: IPO[];
  recentlyListedIPOs: IPO[];
  reviews: ReviewWithIPO[];
  performanceHighlights: {
    topGainers: PerformanceHighlight[];
    topLosers: PerformanceHighlight[];
  };
  subscriptionStatus: SubscriptionStatusData[];
}

/**
 * Format date for display
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return 'TBD';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Format currency
 */
function formatCurrency(amount: number | null): string {
  if (!amount) return 'N/A';
  return `₹${amount.toFixed(0)}`;
}

/**
 * Format issue size
 */
function formatIssueSize(amount: string | null): string {
  if (!amount) return 'N/A';
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount)) return 'N/A';
  return `₹${(numAmount / 100).toFixed(0)} Cr`;
}

/**
 * Section header with "View All" link
 */
function SectionHeader({ title, viewAllHref }: { title: string; viewAllHref: string }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-2xl font-semibold text-gray-900">{title}</h2>
      <Link
        href={viewAllHref}
        className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline text-sm font-medium transition-colors"
      >
        View All <HiArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

/**
 * Empty state message
 */
function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
      <p className="text-gray-500">{message}</p>
    </div>
  );
}

/**
 * Mainboard Content Sections Component
 */
export function MainboardContentSections({
  currentIPOs,
  upcomingIPOs,
  recentlyListedIPOs,
  reviews,
  performanceHighlights,
  subscriptionStatus,
}: MainboardContentSectionsProps) {
  return (
    <div className="space-y-12">
      {/* Section 1: Current IPOs - Using Phase 1 IPOCardEnhanced */}
      <section>
        <SectionHeader title="Current IPOs" viewAllHref="/mainboard-ipos?filter=current" />
        {currentIPOs.length === 0 ? (
          <EmptyState message="No current Mainboard IPOs" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {currentIPOs.slice(0, 6).map((ipo) => (
              <IPOCardEnhanced key={ipo.id} ipo={ipo} />
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Upcoming IPOs - Using Phase 1 IPOCardEnhanced */}
      <section>
        <SectionHeader title="Upcoming IPOs" viewAllHref="/mainboard-ipos?filter=upcoming" />
        {upcomingIPOs.length === 0 ? (
          <EmptyState message="No upcoming Mainboard IPOs" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingIPOs.slice(0, 6).map((ipo) => (
              <IPOCardEnhanced key={ipo.id} ipo={ipo} />
            ))}
          </div>
        )}
      </section>

      {/* Section 3: Recently Listed IPOs - Using Phase 1 IPOCardEnhanced */}
      <section>
        <SectionHeader title="Recently Listed IPOs" viewAllHref="/mainboard-ipos?filter=listed" />
        {recentlyListedIPOs.length === 0 ? (
          <EmptyState message="No recently listed Mainboard IPOs" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentlyListedIPOs.slice(0, 6).map((ipo) => (
              <IPOCardEnhanced key={ipo.id} ipo={ipo} />
            ))}
          </div>
        )}
      </section>

      {/* Section 4: Reviews */}
      <section>
        <SectionHeader title="IPO Reviews & Analysis" viewAllHref="/mainboard-ipo-reviews" />
        {reviews.length === 0 ? (
          <EmptyState message="No Mainboard IPO reviews available" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reviews.slice(0, 6).map((review) => (
              <Card key={review.reviewId} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <Link href={review.reviewUrl || '#'} className="hover:underline">
                    <CardTitle className="text-lg">{review.reviewTitle}</CardTitle>
                  </Link>
                  <p className="text-sm text-gray-600 mt-1">{review.ipoName}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Author:</span>
                    <span className="font-medium">{review.author}</span>
                  </div>
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-gray-600">Recommendation:</span>
                    <Badge
                      className={
                        review.recommendation === 'Subscribe'
                          ? 'bg-green-600'
                          : review.recommendation === 'May apply'
                            ? 'bg-yellow-600'
                            : 'bg-red-600'
                      }
                    >
                      {review.recommendation}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Published:</span>
                    <span className="font-medium">{formatDate(review.publishedDate)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Section 5: Performance Highlights */}
      <section>
        <SectionHeader title="Performance Highlights" viewAllHref="/mainboard-ipo-performance-tracker" />
        {performanceHighlights.topGainers.length === 0 && performanceHighlights.topLosers.length === 0 ? (
          <EmptyState message="No performance data available" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Gainers */}
            <div>
              <h3 className="text-lg font-semibold mb-3 text-green-700 flex items-center gap-2">
                <HiArrowTrendingUp className="h-5 w-5" />
                Top Gainers
              </h3>
              <div className="space-y-3">
                {performanceHighlights.topGainers.slice(0, 3).map((item) => (
                  <Card key={item.id} className="hover:shadow-md transition-shadow border-l-4 border-green-600">
                    <CardContent className="py-4">
                      <div className="flex justify-between items-center">
                        <Link href={`/ipos/${item.slug}`} className="hover:underline font-semibold">
                          {item.companyName}
                        </Link>
                        <span className="text-green-600 font-bold text-lg">
                          +{item.gainPercent.toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex justify-between text-sm text-gray-600 mt-2">
                        <span>Issue: {formatCurrency(item.issuePrice)}</span>
                        <span>Current: {formatCurrency(item.currentPrice)}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Top Losers */}
            <div>
              <h3 className="text-lg font-semibold mb-3 text-red-700 flex items-center gap-2">
                <HiArrowTrendingDown className="h-5 w-5" />
                Top Losers
              </h3>
              <div className="space-y-3">
                {performanceHighlights.topLosers.slice(0, 3).map((item) => (
                  <Card key={item.id} className="hover:shadow-md transition-shadow border-l-4 border-red-600">
                    <CardContent className="py-4">
                      <div className="flex justify-between items-center">
                        <Link href={`/ipos/${item.slug}`} className="hover:underline font-semibold">
                          {item.companyName}
                        </Link>
                        <span className="text-red-600 font-bold text-lg">
                          {item.gainPercent.toFixed(2)}%
                        </span>
                      </div>
                      <div className="flex justify-between text-sm text-gray-600 mt-2">
                        <span>Issue: {formatCurrency(item.issuePrice)}</span>
                        <span>Current: {formatCurrency(item.currentPrice)}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Section 6: Subscription Status */}
      <section>
        <SectionHeader title="Subscription Status" viewAllHref="/mainboard-ipos?filter=current" />
        {subscriptionStatus.length === 0 ? (
          <EmptyState message="No subscription data available" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {subscriptionStatus.slice(0, 6).map((item) => {
              const isOversubscribed = (item.totalSubscription || 0) > 1;
              return (
                <Card key={item.id} className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <Link href={`/ipos/${item.slug}`} className="hover:underline">
                      <CardTitle className="text-lg">{item.companyName}</CardTitle>
                    </Link>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-gray-600">Total:</span>
                      <span
                        className={`font-bold text-lg ${isOversubscribed ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {item.totalSubscription?.toFixed(2)}x
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">QIB:</span>
                      <span className="font-medium">{item.qibSubscription?.toFixed(2)}x</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">NII:</span>
                      <span className="font-medium">{item.niiSubscription?.toFixed(2)}x</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Retail:</span>
                      <span className="font-medium">{item.retailSubscription?.toFixed(2)}x</span>
                    </div>
                    {item.closeDate && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Closes:</span>
                        <span className="font-medium">{formatDate(item.closeDate)}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
