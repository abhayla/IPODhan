/**
 * Mainboard Content Sections Component
 *
 * Displays 6 content sections with cards:
 * - Current IPOs, Upcoming IPOs, Recently Listed, Reviews, Performance, Subscription
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import {
  IPO,
  ReviewWithIPO,
  PerformanceHighlight,
  SubscriptionStatusData,
} from '@/lib/services/mainboard-landing-service';
import { renderFunctions } from '@/components/shared/DataTable';

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
      {/* Section 1: Current IPOs */}
      <Section title="Current IPOs" viewAllLink="/mainboard-ipos?filter=current">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {currentIPOs.length > 0 ? (
            currentIPOs.map((ipo) => (
              <IPOCard key={ipo.id} ipo={ipo} badgeText="OPEN" badgeVariant="default" />
            ))
          ) : (
            <EmptyState message="No current Mainboard IPOs" />
          )}
        </div>
      </Section>

      {/* Section 2: Upcoming IPOs */}
      <Section title="Upcoming IPOs" viewAllLink="/mainboard-ipos?filter=upcoming">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {upcomingIPOs.length > 0 ? (
            upcomingIPOs.map((ipo) => (
              <IPOCard key={ipo.id} ipo={ipo} badgeText="UPCOMING" badgeVariant="secondary" />
            ))
          ) : (
            <EmptyState message="No upcoming Mainboard IPOs" />
          )}
        </div>
      </Section>

      {/* Section 3: Recently Listed */}
      <Section title="Recently Listed IPOs" viewAllLink="/mainboard-ipos?filter=listed">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recentlyListedIPOs.length > 0 ? (
            recentlyListedIPOs.map((ipo) => (
              <IPOCard key={ipo.id} ipo={ipo} badgeText="LISTED" badgeVariant="outline" />
            ))
          ) : (
            <EmptyState message="No recently listed Mainboard IPOs" />
          )}
        </div>
      </Section>

      {/* Section 4: Reviews */}
      <Section title="IPO Reviews & Analysis" viewAllLink="/mainboard-ipo-reviews">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reviews.length > 0 ? (
            reviews.map((review) => <ReviewCard key={review.id} review={review} />)
          ) : (
            <EmptyState message="No Mainboard IPO reviews available" />
          )}
        </div>
      </Section>

      {/* Section 5: Performance Highlights */}
      <Section title="Performance Highlights" viewAllLink="/mainboard-ipo-performance-tracker">
        <div className="space-y-6">
          <div>
            <h4 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              Top Gainers
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {performanceHighlights.topGainers.length > 0 ? (
                performanceHighlights.topGainers.map((perf) => (
                  <PerformanceCard key={perf.ipoId} performance={perf} />
                ))
              ) : (
                <EmptyState message="No performance data available" />
              )}
            </div>
          </div>
          <div>
            <h4 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-600" />
              Top Losers
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {performanceHighlights.topLosers.length > 0 ? (
                performanceHighlights.topLosers.map((perf) => (
                  <PerformanceCard key={perf.ipoId} performance={perf} />
                ))
              ) : (
                <EmptyState message="No performance data available" />
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* Section 6: Subscription Status */}
      <Section title="Subscription Status" viewAllLink="/mainboard-ipos?filter=current">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subscriptionStatus.length > 0 ? (
            subscriptionStatus.map((sub) => <SubscriptionCard key={sub.ipoId} subscription={sub} />)
          ) : (
            <EmptyState message="No subscription data available" />
          )}
        </div>
      </Section>
    </div>
  );
}

// Helper Components

function Section({
  title,
  viewAllLink,
  children,
}: {
  title: string;
  viewAllLink: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-2xl font-semibold">{title}</h3>
        <Link
          href={viewAllLink}
          className="text-blue-600 hover:underline flex items-center gap-1 text-sm"
        >
          View All <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      {children}
    </div>
  );
}

function IPOCard({
  ipo,
  badgeText,
  badgeVariant,
}: {
  ipo: IPO;
  badgeText: string;
  badgeVariant: 'default' | 'secondary' | 'outline';
}) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <Link
            href={`/ipos/${ipo.slug}`}
            className="text-blue-600 hover:underline font-semibold text-sm"
          >
            {ipo.companyName}
          </Link>
          <Badge variant={badgeVariant}>{badgeText}</Badge>
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-gray-600">Open:</span>
          <span>{renderFunctions.date(ipo.openDate)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Close:</span>
          <span>{renderFunctions.date(ipo.closeDate)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Issue Size:</span>
          <span>{renderFunctions.currency(ipo.issueSize ? parseFloat(ipo.issueSize) : null)} Cr</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewCard({ review }: { review: ReviewWithIPO }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <Link
          href={`/ipo-reviews/${review.id}`}
          className="text-blue-600 hover:underline font-semibold text-sm line-clamp-2"
        >
          {review.reviewTitle}
        </Link>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        <div>
          <span className="text-gray-600">IPO: </span>
          <Link href={`/ipos/${review.ipoSlug}`} className="text-blue-600 hover:underline">
            {review.ipoName}
          </Link>
        </div>
        <div>
          <span className="text-gray-600">Author: </span>
          <span>{review.author}</span>
        </div>
        <Badge variant="secondary">{review.recommendation}</Badge>
      </CardContent>
    </Card>
  );
}

function PerformanceCard({ performance }: { performance: PerformanceHighlight }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <Link
          href={`/ipos/${performance.slug}`}
          className="text-blue-600 hover:underline font-semibold text-sm"
        >
          {performance.companyName}
        </Link>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-gray-600">Gain:</span>
          {renderFunctions.percentWithColor(performance.gainPercent)}
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Current:</span>
          <span>{renderFunctions.currency(performance.currentPrice)}</span>
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>Issue:</span>
          <span>{renderFunctions.currency(performance.issuePrice)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function SubscriptionCard({ subscription }: { subscription: SubscriptionStatusData }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <Link
          href={`/ipos/${subscription.slug}`}
          className="text-blue-600 hover:underline font-semibold text-sm"
        >
          {subscription.companyName}
        </Link>
      </CardHeader>
      <CardContent className="text-sm space-y-1">
        <div className="flex justify-between font-semibold">
          <span className="text-gray-600">Total:</span>
          <span>{renderFunctions.subscription(subscription.totalSubscription)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">QIB:</span>
          <span>{renderFunctions.subscription(subscription.qibSubscription)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">NII:</span>
          <span>{renderFunctions.subscription(subscription.niiSubscription)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Retail:</span>
          <span>{renderFunctions.subscription(subscription.retailSubscription)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="col-span-full text-center py-8 text-gray-500">
      <p>{message}</p>
    </div>
  );
}
