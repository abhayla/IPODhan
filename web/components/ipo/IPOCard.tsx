'use client';

import { IPO, IPOStatus, ListingPerformance, IPOScore } from '@/lib/db/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { HighlightedText } from '@/components/search/HighlightedText';
import { ListingPerformanceBadge } from './ListingPerformanceBadge';
import { ScoreBadge } from './ScoreBadge';
import { VerdictBadge } from './VerdictBadge';
import { formatIPODate, getAccessibleDate, getISODate } from '@/lib/utils/date-formatter';
import { cn } from '@/lib/utils';

interface IPOCardProps {
  ipo: IPO & {
    listingPerformance?: ListingPerformance | null;
    ipoScore?: IPOScore | null;
  };
  searchQuery?: string;
  onClick?: () => void;
}

const getStatusConfig = (status: IPOStatus) => {
  switch (status) {
    case 'UPCOMING':
      return { color: 'bg-blue-600 text-white', label: 'Upcoming' };
    case 'OPEN':
      return { color: 'bg-green-600 text-white', label: 'Open' };
    case 'CLOSED':
      return { color: 'bg-gray-600 text-white', label: 'Closed' };
    case 'LISTED':
      return { color: 'bg-purple-600 text-white', label: 'Listed' };
    default:
      return { color: 'bg-gray-600 text-gray-100', label: status };
  }
};

const formatCurrency = (amount: number | null) => {
  if (amount === null) return 'N/A';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

const RatingStars = ({ rating }: { rating: number | null }) => {
  if (rating === null) {
    return <span className="text-sm text-muted-foreground">Not Rated</span>;
  }

  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

  return (
    <div className="flex items-center gap-1">
      {[...Array(fullStars)].map((_, i) => (
        <Star key={`full-${i}`} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
      ))}
      {hasHalfStar && (
        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400 opacity-50" />
      )}
      {[...Array(emptyStars)].map((_, i) => (
        <Star key={`empty-${i}`} className="h-4 w-4 text-gray-300" />
      ))}
      <span className="ml-1 text-sm text-muted-foreground">{rating.toFixed(1)}</span>
    </div>
  );
};

export function IPOCard({ ipo, searchQuery, onClick }: IPOCardProps) {
  const statusConfig = getStatusConfig(ipo.status);

  const handleClick = () => {
    if (onClick) {
      onClick();
    }
  };

  // Get listing gain percentage for badge and border color
  const listingGainPercent = ipo.listingPerformance?.listingGainPercent
    ? Number(ipo.listingPerformance.listingGainPercent)
    : null;

  // Determine border color based on listing performance
  const borderColorClass =
    ipo.status === 'LISTED' && listingGainPercent !== null
      ? listingGainPercent > 0
        ? 'border-green-500'
        : 'border-red-500'
      : 'border-border';

  return (
    <Link
      href={`/ipos/${ipo.slug}`}
      onClick={handleClick}
      className="block group focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-lg"
      aria-label={`View details for ${ipo.companyName} IPO`}
    >
      <Card
        data-testid="ipo-card"
        className={cn(
          'h-full cursor-pointer border-2 hover:border-primary hover:shadow-xl transition-all duration-300 ease-out group-hover:scale-[1.03] group-hover:-translate-y-1 overflow-hidden relative',
          borderColorClass
        )}
      >
        {/* Gradient overlay on hover */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

        <CardContent className="p-6 space-y-4 relative z-10">
          {/* Header: Company Name, Status, and Listing Badge */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-lg font-bold leading-tight line-clamp-2 flex-1 group-hover:text-primary transition-colors duration-200">
              <HighlightedText text={ipo.companyName} query={searchQuery || ''} />
            </h3>
            <div className="flex flex-col gap-2 items-end">
              <Badge className={`${statusConfig.color} transition-all duration-200 group-hover:scale-110`}>{statusConfig.label}</Badge>
              {/* IPO Score Badge (Story 4.7) */}
              {ipo.ipoScore ? (
                <ScoreBadge score={ipo.ipoScore.totalScore} size="sm" />
              ) : (
                <Badge variant="outline" className="text-xs bg-gray-100 text-gray-600 border-gray-300">
                  Score Pending
                </Badge>
              )}
              {/* Listing Performance Badge for LISTED IPOs (Story 6.3) */}
              {ipo.status === 'LISTED' && listingGainPercent !== null && (
                <ListingPerformanceBadge
                  listingGainPercent={listingGainPercent}
                  size="small"
                  showIcon={true}
                />
              )}
            </div>
          </div>

          {/* Category, Sector, and Verdict */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {ipo.category}
            </Badge>
            {ipo.sector && (
              <span className="text-xs text-muted-foreground">
                <HighlightedText text={ipo.sector} query={searchQuery || ''} />
              </span>
            )}
            {/* IPO Verdict Badge (Story 4.7) */}
            {ipo.ipoScore && (
              <VerdictBadge verdict={ipo.ipoScore.verdict} size="sm" />
            )}
          </div>

          {/* Price Range */}
          <div className="space-y-1 p-3 rounded-lg bg-muted/50 group-hover:bg-muted transition-colors duration-200">
            <p className="text-sm text-muted-foreground">Price Range</p>
            <p className="text-base font-semibold text-primary">
              {formatCurrency(ipo.priceRangeMin)} - {formatCurrency(ipo.priceRangeMax)}
            </p>
          </div>

          {/* Lot Size */}
          {ipo.lotSize && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Lot Size</p>
              <p className="text-base font-semibold">{ipo.lotSize} shares</p>
            </div>
          )}

          {/* Dates */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">IPO Dates</p>
            <div className="flex flex-col gap-0.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Open:</span>
                <time
                  dateTime={getISODate(ipo.openDate) || undefined}
                  aria-label={getAccessibleDate(ipo.openDate)}
                  className="font-medium"
                >
                  {formatIPODate(ipo.openDate)}
                </time>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Close:</span>
                <time
                  dateTime={getISODate(ipo.closeDate) || undefined}
                  aria-label={getAccessibleDate(ipo.closeDate)}
                  className="font-medium"
                >
                  {formatIPODate(ipo.closeDate)}
                </time>
              </div>
            </div>
          </div>

          {/* Rating */}
          <div className="pt-3 border-t border-border group-hover:border-primary/30 transition-colors duration-200">
            <p className="text-sm text-muted-foreground mb-2">IPODhan Rating</p>
            <div className="group-hover:scale-105 transition-transform duration-200">
              <RatingStars rating={ipo.rating} />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
