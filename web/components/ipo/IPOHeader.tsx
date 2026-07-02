'use client';

import { IPO, IPOStatus, IpoDetails } from '@/lib/db/types';
import { Badge } from '@/components/ui/badge';
import { RatingDisplay } from './RatingDisplay';
import { AddToCompareButton } from '@/components/tools/AddToCompareButton';
import { StockSymbol } from './StockSymbol';
import { UPIDeadlineTimer } from '@/components/ipo-detail/UPIDeadlineTimer';
import { Building2 } from 'lucide-react';

interface IPOHeaderProps {
  ipo: IPO & {
    ipoDetails?: IpoDetails | null;
  };
}

const getStatusConfig = (status: IPOStatus) => {
  switch (status) {
    case 'UPCOMING':
      return { color: 'bg-blue-600 text-white', label: 'Upcoming' };
    case 'OPEN':
      return { color: 'bg-green-600 text-white', label: 'Open Now' };
    case 'CLOSED':
      return { color: 'bg-gray-600 text-white', label: 'Closed' };
    case 'LISTED':
      return { color: 'bg-purple-600 text-white', label: 'Listed' };
    default:
      return { color: 'bg-gray-600 text-gray-100', label: status };
  }
};

const getOfferingTypeConfig = (offeringType: string | null) => {
  switch (offeringType) {
    case 'IPO':
      return {
        color: 'bg-green-50 text-green-700 border-green-300',
        label: 'IPO',
        showWarning: false
      };
    case 'TENDER':
      return {
        color: 'bg-orange-50 text-orange-700 border-orange-300',
        label: 'Open Offer',
        showWarning: true
      };
    case 'RIGHTS':
      return {
        color: 'bg-purple-50 text-purple-700 border-purple-300',
        label: 'Rights Issue',
        showWarning: true
      };
    case 'OFS':
      return {
        color: 'bg-amber-50 text-amber-700 border-amber-300',
        label: 'OFS',
        showWarning: true
      };
    case 'FPO':
      return {
        color: 'bg-cyan-50 text-cyan-700 border-cyan-300',
        label: 'FPO',
        showWarning: false
      };
    default:
      return {
        color: 'bg-gray-50 text-gray-700 border-gray-300',
        label: offeringType || 'N/A',
        showWarning: false
      };
  }
};

/**
 * IPOHeader component displays the hero section with company information
 * Includes company name, logo (or placeholder), status badge, and rating
 */
export function IPOHeader({ ipo }: IPOHeaderProps) {
  const statusConfig = getStatusConfig(ipo.status);
  const offeringTypeConfig = getOfferingTypeConfig(ipo.offeringType);

  return (
    <div className="w-full border-b bg-gradient-to-br from-background via-background to-muted/30 py-8 md:py-12 transition-all duration-300">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_1fr] md:gap-8 lg:gap-12">
          {/* Company Logo or Placeholder */}
          <div className="flex justify-center md:justify-start">
            <div className="group flex h-20 w-20 items-center justify-center rounded-xl border-2 border-border bg-white shadow-md transition-all duration-300 hover:shadow-xl hover:scale-105 md:h-24 md:w-24 lg:h-32 lg:w-32">
              {/* TODO: In future, add actual company logo support */}
              <Building2 className="h-10 w-10 text-muted-foreground transition-transform duration-300 group-hover:scale-110 md:h-12 md:w-12 lg:h-16 lg:w-16" />
            </div>
          </div>

          {/* Company Info */}
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Company Name and Status */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <h1 className="text-2xl font-bold leading-tight tracking-tight md:text-3xl lg:text-4xl transition-colors duration-200 hover:text-primary">
                {ipo.companyName}
              </h1>
              <Badge
                className={`${statusConfig.color} whitespace-nowrap text-sm font-semibold shadow-sm transition-all duration-300 hover:shadow-md hover:scale-105 animate-in fade-in slide-in-from-right-3 duration-300`}
              >
                {statusConfig.label}
              </Badge>
            </div>

            {/* Stock Symbol (Story 4.9) */}
            {ipo.symbol && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-75">
                <StockSymbol
                  symbol={ipo.symbol}
                  exchange="NSE"
                  size="md"
                />
              </div>
            )}

            {/* Segment and Sector */}
            <div className="flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100">
              <Badge variant="outline" className="text-xs font-medium transition-all duration-200 hover:bg-muted hover:scale-105">
                {ipo.segment || 'N/A'}
              </Badge>
              {/* Enhanced: Display offering type badge with differentiated colors */}
              <Badge
                variant="outline"
                className={`text-xs ${offeringTypeConfig.color} font-semibold transition-all duration-200 hover:scale-105 ${
                  offeringTypeConfig.showWarning ? 'ring-2 ring-offset-2 ring-current' : ''
                }`}
                title={offeringTypeConfig.showWarning ? 'This is not a traditional IPO' : undefined}
              >
                {offeringTypeConfig.showWarning && <span className="mr-1">⚠️</span>}
                {offeringTypeConfig.label}
              </Badge>
              {ipo.sector && (
                <span className="text-sm text-muted-foreground">•</span>
              )}
              {ipo.sector && (
                <span className="text-sm text-muted-foreground font-medium">
                  {ipo.sector}
                </span>
              )}
            </div>

            {/* Rating — hidden until one exists; 'Not Rated' in the hero
                undermines authority (2026-07-02 blind review) */}
            {ipo.rating && (
              <div className="pt-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
                <p className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  IPODhan Rating
                </p>
                <RatingDisplay
                  rating={ipo.rating}
                  rationale={ipo.ratingRationale}
                  showRationale={true}
                  size="lg"
                />
              </div>
            )}

            {/* UPI Deadline Timer - Display for OPEN IPOs */}
            {ipo.status === 'OPEN' && ipo.closeDate && (
              <div className="pt-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-250">
                <UPIDeadlineTimer
                  closeDate={ipo.closeDate}
                  upiCutoffTime={ipo.ipoDetails?.upiCutoffTime || '5:00 PM'}
                  status={ipo.status}
                />
              </div>
            )}

            {/* Add to Compare Button */}
            <div className="pt-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
              <AddToCompareButton
                slug={ipo.slug}
                companyName={ipo.companyName}
                status={ipo.status}
                size="default"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
