'use client';

import { IPO, IPOStatus } from '@/lib/db/types';
import { Badge } from '@/components/ui/badge';
import { RatingDisplay } from './RatingDisplay';
import { Building2 } from 'lucide-react';

interface IPOHeaderProps {
  ipo: IPO;
}

const getStatusConfig = (status: IPOStatus) => {
  switch (status) {
    case 'UPCOMING':
      return { color: 'bg-blue-500 text-white', label: 'Upcoming' };
    case 'OPEN':
      return { color: 'bg-green-500 text-white', label: 'Open Now' };
    case 'CLOSED':
      return { color: 'bg-gray-500 text-white', label: 'Closed' };
    case 'LISTED':
      return { color: 'bg-purple-500 text-white', label: 'Listed' };
    default:
      return { color: 'bg-gray-300 text-gray-800', label: status };
  }
};

/**
 * IPOHeader component displays the hero section with company information
 * Includes company name, logo (or placeholder), status badge, and rating
 */
export function IPOHeader({ ipo }: IPOHeaderProps) {
  const statusConfig = getStatusConfig(ipo.status);

  return (
    <div className="w-full border-b bg-gradient-to-br from-background to-muted/20 py-8 md:py-12">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_1fr] md:gap-8 lg:gap-12">
          {/* Company Logo or Placeholder */}
          <div className="flex justify-center md:justify-start">
            <div className="flex h-20 w-20 items-center justify-center rounded-lg border-2 border-border bg-white shadow-sm md:h-24 md:w-24 lg:h-32 lg:w-32">
              {/* TODO: In future, add actual company logo support */}
              <Building2 className="h-10 w-10 text-muted-foreground md:h-12 md:w-12 lg:h-16 lg:w-16" />
            </div>
          </div>

          {/* Company Info */}
          <div className="space-y-4">
            {/* Company Name and Status */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <h1 className="text-2xl font-bold leading-tight md:text-3xl lg:text-4xl">
                {ipo.companyName}
              </h1>
              <Badge
                className={`${statusConfig.color} whitespace-nowrap text-sm font-semibold`}
              >
                {statusConfig.label}
              </Badge>
            </div>

            {/* Category and Sector */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs font-medium">
                {ipo.category}
              </Badge>
              {ipo.sector && (
                <span className="text-sm text-muted-foreground">•</span>
              )}
              {ipo.sector && (
                <span className="text-sm text-muted-foreground">
                  {ipo.sector}
                </span>
              )}
            </div>

            {/* Rating */}
            <div className="pt-2">
              <p className="mb-2 text-sm font-medium text-muted-foreground">
                IPODhan Rating
              </p>
              <RatingDisplay
                rating={ipo.rating}
                rationale={ipo.ratingRationale}
                showRationale={false}
                size="lg"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
