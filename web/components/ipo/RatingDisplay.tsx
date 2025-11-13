'use client';

import { Star } from 'lucide-react';
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
          className={`${starSize} fill-yellow-400 text-yellow-400 transition-all duration-300 hover:scale-125 hover:rotate-12 animate-in zoom-in duration-300`}
          style={{ animationDelay: `${i * 50}ms` }}
        />
      ))}
      {hasHalfStar && (
        <Star
          className={`${starSize} fill-yellow-400 text-yellow-400 transition-all duration-300 hover:scale-125 animate-in zoom-in duration-300`}
          style={{ animationDelay: `${fullStars * 50}ms` }}
        />
      )}
      {[...Array(emptyStars)].map((_, i) => (
        <Star 
          key={`empty-${i}`}
          className={`${starSize} text-gray-300 dark:text-gray-600 transition-all duration-300 hover:scale-110 animate-in fade-in duration-300`}
          style={{ animationDelay: `${(fullStars + (hasHalfStar ? 1 : 0) + i) * 50}ms` }}
        />
      ))}
      <span className="ml-2 text-sm font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
        {rating.toFixed(1)}
      </span>
    </div>
  );

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-help">{stars}</div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs shadow-lg">
            <p className="text-sm font-medium">
              IPODhan rating based on financials, valuation, business model, and
              management quality.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {showRationale && rationale && (
        <div className="p-3 rounded-lg bg-muted/50 border border-muted-foreground/10 animate-in fade-in slide-in-from-bottom-1 duration-500 delay-100">
          <p className="text-sm text-muted-foreground leading-relaxed">{rationale}</p>
        </div>
      )}
    </div>
  );
}
