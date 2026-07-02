'use client';

import { IPO, IPOStatus, ListingPerformance, IPOScore, GMPRecord, Subscription, FinancialData } from '@/lib/db/types';
import { formatPriceBand } from '@/lib/utils/kpi-formatters';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { HighlightedText } from '@/components/search/HighlightedText';
import { ScoreBadge } from './ScoreBadge';
import { formatIPODate } from '@/lib/utils/date-formatter';
import { Building2, GitCompare, ExternalLink } from 'lucide-react';
import { SubscriptionProgressBar } from './SubscriptionProgressBar';
import { AnimatedScore } from './AnimatedScore';
import { GMPSparkline } from './GMPSparkline';
import { CompactSubscriptionBreakdown } from './CompactSubscriptionBreakdown';
import { QuickStatsGrid } from './QuickStatsGrid';
import { useMagneticHover } from '@/hooks/use-magnetic-hover';

interface IPOCardEnhancedProps {
  ipo: IPO & {
    listingPerformance?: ListingPerformance | null;
    ipoScore?: IPOScore | null;
    gmpRecords?: GMPRecord[];
    subscriptions?: Subscription[];
    financialData?: FinancialData | null;
  };
  searchQuery?: string;
  onClick?: () => void;
}

// Status dot colors - matching IPODhan Gold Standard
const getStatusDotConfig = (status: IPOStatus) => {
  switch (status) {
    case 'UPCOMING':
      return {
        dotColor: 'bg-accent', // Electric Blue
        label: 'Upcoming',
        textColor: 'text-accent',
      };
    case 'OPEN':
      return {
        dotColor: 'bg-success', // Vibrant Green
        label: 'Open',
        textColor: 'text-success',
      };
    case 'CLOSED':
      return {
        dotColor: 'bg-muted-foreground', // Gray
        label: 'Closed',
        textColor: 'text-muted-foreground',
      };
    case 'LISTED':
      return {
        dotColor: 'bg-secondary', // Warm Gold
        label: 'Listed',
        textColor: 'text-secondary',
      };
    default:
      return {
        dotColor: 'bg-muted-foreground',
        label: status,
        textColor: 'text-muted-foreground',
      };
  }
};

/**
 * Enhanced IPO Card - Layer 1 (Default View) + Layer 2 (Hover State)
 * Following IPODhan UX Transformation Plan Phase 1
 *
 * Design Philosophy:
 * - Reduced information density (show only essentials)
 * - Large prominent score display
 * - Status dot indicator system
 * - Mini progress bar for subscription
 * - Maximum 2 badges to reduce clutter
 * - Magnetic cursor hover effect (premium feel)
 * - Layer 2 reveals advanced data on hover
 */
export function IPOCardEnhanced({ ipo, searchQuery, onClick }: IPOCardEnhancedProps) {
  const statusConfig = getStatusDotConfig(ipo.status);

  // Magnetic hover effect for premium feel (200ms transition, 8px max movement)
  const { ref: magneticRef, style: magneticStyle } = useMagneticHover<HTMLDivElement>({
    magnetStrength: 8,
    transitionDuration: 200,
    enabled: true,
  });

  const handleClick = () => {
    if (onClick) {
      onClick();
    }
  };

  // Determine border color based on score (if available)
  const getBorderColor = () => {
    if (!ipo.ipoScore) return 'border-border';

    const score = ipo.ipoScore.totalScore;
    if (score >= 8.5) return 'border-success'; // Exceptional
    if (score >= 7.0) return 'border-accent'; // Strong
    if (score >= 6.0) return 'border-secondary'; // Good
    if (score >= 4.5) return 'border-muted-foreground'; // Average
    return 'border-danger'; // Below average
  };

  return (
    <Link
      href={`/ipos/${ipo.slug}`}
      onClick={handleClick}
      className="block group focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-lg"
      aria-label={`View details for ${ipo.companyName} IPO`}
    >
      <Card
        ref={magneticRef as React.RefObject<HTMLDivElement>}
        data-testid="ipo-card-enhanced"
        style={magneticStyle}
        className={cn(
          'h-full min-h-[280px] cursor-pointer border-2 transition-all duration-300 ease-out',
          'hover:border-primary hover:shadow-2xl hover:scale-[1.02]',
          'relative overflow-hidden',
          getBorderColor()
        )}
      >
        {/* Gradient overlay on hover - Premium feel */}
        <div className="absolute inset-0 bg-gradient-premium opacity-0 group-hover:opacity-5 transition-opacity duration-300 pointer-events-none" />

        <CardContent className="p-5 space-y-4 relative z-10">
          {/* Header: Company Name + Status Dot */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <Building2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <h3 className="text-lg font-bold leading-tight line-clamp-2 group-hover:text-primary transition-colors duration-200">
                <HighlightedText text={ipo.companyName} query={searchQuery || ''} />
              </h3>
            </div>
            {/* Status Dot Indicator */}
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className={cn('w-2 h-2 rounded-full animate-pulse', statusConfig.dotColor)} />
                <span className={cn('text-xs font-medium', statusConfig.textColor)}>
                  {statusConfig.label}
                </span>
              </div>
            </div>
          </div>

          {/* Price Range + Score - Most Important Information */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Price Band</p>
              <p className="text-base font-bold font-mono text-foreground">
                {formatPriceBand(ipo.priceRangeMin, ipo.priceRangeMax)}
              </p>
            </div>
            {/* Large Prominent Score with Count-up Animation */}
            {/* Absent score renders nothing — 'Score Pending' on every card
                reads as a broken pipeline (2026-07-02 blind review) */}
            {ipo.ipoScore && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground mb-1">IPODhan Score</p>
                <AnimatedScore
                  score={ipo.ipoScore.totalScore}
                  size="lg"
                  gradient={true}
                  showSuffix={true}
                  delay={100} // Slight delay for better UX
                />
              </div>
            )}
          </div>

          {/* Badges - Max 2 to reduce clutter */}
          <div className="flex items-center gap-2 flex-wrap">
            {ipo.segment && (
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                {ipo.segment}
              </Badge>
            )}
            {ipo.sector && (
              <span className="text-xs text-muted-foreground truncate">
                <HighlightedText text={ipo.sector} query={searchQuery || ''} />
              </span>
            )}
          </div>

          {/* Mini Progress Bar for Subscription */}
          <SubscriptionProgressBar
            subscriptionMultiplier={null} // TODO: Pass actual subscription data when available
            size="sm"
            showLabel={true}
          />

          {/* Key Dates - Simplified */}
          <div className="pt-3 border-t border-border/50">
            <div className="flex justify-between text-sm">
              <div>
                <span className="text-muted-foreground">Open: </span>
                <span className="font-medium">{formatIPODate(ipo.openDate)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Close: </span>
                <span className="font-medium">{formatIPODate(ipo.closeDate)}</span>
              </div>
            </div>
          </div>

          {/* Layer 2 (Hover State) - Advanced Information */}
          <div className="absolute inset-0 bg-background/95 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-200 ease-out pointer-events-none group-hover:pointer-events-auto z-20 p-5 flex flex-col justify-between">
            {/* Header - Compact */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-bold line-clamp-1">{ipo.companyName}</h4>
              </div>
              <div className={cn('w-2 h-2 rounded-full animate-pulse', statusConfig.dotColor)} />
            </div>

            {/* Main Content Grid */}
            <div className="space-y-4 flex-1 py-4">
              {/* GMP Sparkline */}
              {ipo.gmpRecords && ipo.gmpRecords.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">7-Day GMP Trend</p>
                  <GMPSparkline gmpRecords={ipo.gmpRecords} />
                </div>
              )}

              {/* Subscription Breakdown */}
              {ipo.subscriptions && ipo.subscriptions.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Subscription Breakdown</p>
                  <CompactSubscriptionBreakdown subscription={ipo.subscriptions[ipo.subscriptions.length - 1]} />
                </div>
              )}

              {/* Quick Stats Grid */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Quick Stats</p>
                <QuickStatsGrid
                  ipo={{
                    ...ipo,
                    financialData: ipo.financialData || null,
                    listingPerformance: ipo.listingPerformance || null,
                  }}
                />
              </div>
            </div>

            {/* CTAs - 40px height for better touch targets */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs h-10"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // TODO: Implement compare functionality
                }}
              >
                <GitCompare className="w-3 h-3 mr-1" />
                Compare
              </Button>
              <Button
                size="sm"
                className="flex-1 text-xs h-10 bg-gradient-premium hover:opacity-90"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // Opens the detail page via Link's default behavior
                }}
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                View Details
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
