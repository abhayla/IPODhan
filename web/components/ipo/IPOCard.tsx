'use client';

import { IPO, IPOStatus } from '@/lib/db/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { format } from 'date-fns';
import { Star } from 'lucide-react';
import { HighlightedText } from '@/components/search/HighlightedText';

interface IPOCardProps {
  ipo: IPO;
  searchQuery?: string;
  onClick?: () => void;
}

const getStatusConfig = (status: IPOStatus) => {
  switch (status) {
    case 'UPCOMING':
      return { color: 'bg-blue-500 text-white', label: 'Upcoming' };
    case 'OPEN':
      return { color: 'bg-green-500 text-white', label: 'Open' };
    case 'CLOSED':
      return { color: 'bg-gray-500 text-white', label: 'Closed' };
    case 'LISTED':
      return { color: 'bg-purple-500 text-white', label: 'Listed' };
    default:
      return { color: 'bg-gray-300 text-gray-800', label: status };
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

const formatDate = (date: string | null) => {
  if (!date) return 'TBA';
  return format(new Date(date), 'dd MMM yyyy');
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

  return (
    <Link
      href={`/ipos/${ipo.slug}`}
      onClick={handleClick}
      className="block transition-all duration-200 hover:scale-[1.02]"
    >
      <Card className="h-full cursor-pointer border-2 border-border hover:border-primary hover:shadow-lg transition-all duration-200">
        <CardContent className="p-6 space-y-4">
          {/* Header: Company Name and Status */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-lg font-bold leading-tight line-clamp-2 flex-1">
              <HighlightedText text={ipo.companyName} query={searchQuery || ''} />
            </h3>
            <Badge className={statusConfig.color}>{statusConfig.label}</Badge>
          </div>

          {/* Category and Sector */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {ipo.category}
            </Badge>
            {ipo.sector && (
              <span className="text-xs text-muted-foreground">
                <HighlightedText text={ipo.sector} query={searchQuery || ''} />
              </span>
            )}
          </div>

          {/* Price Range */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Price Range</p>
            <p className="text-base font-semibold">
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
                <span className="font-medium">{formatDate(ipo.openDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Close:</span>
                <span className="font-medium">{formatDate(ipo.closeDate)}</span>
              </div>
            </div>
          </div>

          {/* Rating */}
          <div className="pt-2 border-t">
            <p className="text-sm text-muted-foreground mb-2">IPODhan Rating</p>
            <RatingStars rating={ipo.rating} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
