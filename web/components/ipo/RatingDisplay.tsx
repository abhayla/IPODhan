'use client';

import { Star, StarHalf } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface RatingDisplayProps {
  rating: number | null;
  rationale?: string | null;
  showRationale?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * RatingDisplay component displays IPO rating as stars (1-5, with 0.5 increments)
 * Reusable for both header and card sections
 */
export function RatingDisplay({
  rating,
  rationale,
  showRationale = false,
  size = 'md',
}: RatingDisplayProps) {
  if (rating === null) {
    return <span className="text-sm text-muted-foreground">Not Rated</span>;
  }

  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

  const sizeClasses = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  const starSize = sizeClasses[size];

  const stars = (
    <div className="flex items-center gap-1">
      {[...Array(fullStars)].map((_, i) => (
        <Star
          key={`full-${i}`}
          className={`${starSize} fill-yellow-400 text-yellow-400`}
        />
      ))}
      {hasHalfStar && (
        <StarHalf
          className={`${starSize} fill-yellow-400 text-yellow-400`}
        />
      )}
      {[...Array(emptyStars)].map((_, i) => (
        <Star key={`empty-${i}`} className={`${starSize} text-gray-300`} />
      ))}
      <span className="ml-1 text-sm text-muted-foreground">
        {rating.toFixed(1)}
      </span>
    </div>
  );

  return (
    <div className="space-y-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>{stars}</div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-sm">
              IPODhan rating based on financials, valuation, business model, and
              management quality.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {showRationale && rationale && (
        <p className="text-sm text-muted-foreground">{rationale}</p>
      )}
    </div>
  );
}
