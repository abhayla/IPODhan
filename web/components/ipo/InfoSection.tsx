'use client';

import { IPO, IpoDetails } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatIPODate, getAccessibleDate, getISODate } from '@/lib/utils/date-formatter';
import { ISINDisplay } from './ISINDisplay';
import { RegistrarLogo } from '@/components/registrars/RegistrarLogo';
import { formatDistanceToNow } from 'date-fns';

interface InfoSectionProps {
  ipo: IPO & {
    registrarRelation?: {
      id: string;
      name: string;
      shortName: string | null;
      logoUrl: string | null;
      website: string | null;
      allotmentCheckUrl: string | null;
    } | null;
  };
  ipoDetails?: IpoDetails | null;
}

/**
 * InfoSection component displays key IPO information in key-value pairs
 * Includes dates, price range, lot size, face value, exchanges, and lead managers
 * Story 4.12: Added extended timeline dates with countdown/elapsed time
 */
export function InfoSection({ ipo, ipoDetails }: InfoSectionProps) {
  const formatCurrency = (amount: number | null) => {
    if (amount === null) return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(amount);
  };

  /**
   * Calculate time distance for countdown/elapsed time
   * Returns "In 3 days", "2 days ago", "Today", or null
   */
  const getTimeDistance = (dateString: string | null): string | null => {
    if (!dateString) return null;

    try {
      const date = new Date(dateString);
      const now = new Date();

      // Check if date is today
      const isToday = date.toDateString() === now.toDateString();
      if (isToday) return 'Today';

      // Calculate distance
      const distance = formatDistanceToNow(date, { addSuffix: true });
      return distance;
    } catch {
      return null;
    }
  };

  const InfoRow = ({
    label,
    value,
    isDate,
    dateValue,
    timeDistance,
  }: {
    label: string;
    value: string | null;
    isDate?: boolean;
    dateValue?: string | null;
    timeDistance?: string | null;
  }) => (
    <div className="group flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4 p-2 rounded-md transition-all duration-200 hover:bg-muted/30">
      <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <div className="flex flex-col items-start sm:items-end gap-0.5">
        {isDate && dateValue ? (
          <time
            dateTime={getISODate(dateValue) || undefined}
            aria-label={getAccessibleDate(dateValue)}
            className="text-sm font-bold transition-colors duration-200 group-hover:text-primary"
          >
            {value || 'N/A'}
          </time>
        ) : (
          <span className="text-sm font-bold transition-colors duration-200 group-hover:text-primary">{value || 'N/A'}</span>
        )}
        {timeDistance ? (
          <span className="text-xs text-muted-foreground italic">
            {timeDistance}
          </span>
        ) : null}
      </div>
    </div>
  );

  return (
    <Card className="transition-all duration-300 hover:shadow-lg border-t-4 border-t-primary/20">
      <CardHeader className="bg-gradient-to-r from-background to-muted/20">
        <CardTitle className="text-xl font-bold tracking-tight">IPO Details</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          {/* Left Column - Timeline Dates (Story 4.12) */}
          <div className="space-y-2 animate-in fade-in slide-in-from-left-4 duration-500">
            <InfoRow
              label="Open Date"
              value={formatIPODate(ipo.openDate)}
              isDate
              dateValue={ipo.openDate}
              timeDistance={getTimeDistance(ipo.openDate)}
            />
            <InfoRow
              label="Close Date"
              value={formatIPODate(ipo.closeDate)}
              isDate
              dateValue={ipo.closeDate}
              timeDistance={getTimeDistance(ipo.closeDate)}
            />
            <InfoRow
              label="Allotment Date"
              value={formatIPODate(ipo.allotmentDate)}
              isDate
              dateValue={ipo.allotmentDate}
              timeDistance={getTimeDistance(ipo.allotmentDate)}
            />
            {/* Story 4.12: Basis of Allotment Date */}
            {(ipoDetails?.basisOfAllotmentDate || (ipo.status === 'CLOSED' || ipo.status === 'LISTED')) ? (
              <InfoRow
                label="Basis of Allotment"
                value={ipoDetails?.basisOfAllotmentDate ? formatIPODate(ipoDetails.basisOfAllotmentDate) : 'TBD'}
                isDate={!!ipoDetails?.basisOfAllotmentDate}
                dateValue={ipoDetails?.basisOfAllotmentDate ?? null}
                timeDistance={getTimeDistance(ipoDetails?.basisOfAllotmentDate ?? null)}
              />
            ) : null}
            {/* Story 4.12: Initiation of Refunds Date */}
            {(ipoDetails?.initiationOfRefundsDate || (ipo.status === 'CLOSED' || ipo.status === 'LISTED')) ? (
              <InfoRow
                label="Refunds Initiated"
                value={ipoDetails?.initiationOfRefundsDate ? formatIPODate(ipoDetails.initiationOfRefundsDate) : 'TBD'}
                isDate={!!ipoDetails?.initiationOfRefundsDate}
                dateValue={ipoDetails?.initiationOfRefundsDate ?? null}
                timeDistance={getTimeDistance(ipoDetails?.initiationOfRefundsDate ?? null)}
              />
            ) : null}
            {/* Story 4.12: Credit of Shares Date */}
            {(ipoDetails?.creditOfSharesDate || (ipo.status === 'CLOSED' || ipo.status === 'LISTED')) ? (
              <InfoRow
                label="Shares Credited"
                value={ipoDetails?.creditOfSharesDate ? formatIPODate(ipoDetails.creditOfSharesDate) : 'TBD'}
                isDate={!!ipoDetails?.creditOfSharesDate}
                dateValue={ipoDetails?.creditOfSharesDate ?? null}
                timeDistance={getTimeDistance(ipoDetails?.creditOfSharesDate ?? null)}
              />
            ) : null}
            <InfoRow
              label="Listing Date"
              value={formatIPODate(ipo.listingDate)}
              isDate
              dateValue={ipo.listingDate}
              timeDistance={getTimeDistance(ipo.listingDate)}
            />
            <InfoRow
              label="Price Range"
              value={`${formatCurrency(ipo.priceRangeMin)} - ${formatCurrency(ipo.priceRangeMax)}`}
            />
            <InfoRow
              label="Face Value"
              value={formatCurrency(ipo.faceValue)}
            />
          </div>

          {/* Right Column */}
          <div className="space-y-2 animate-in fade-in slide-in-from-right-4 duration-500 delay-100">
            <InfoRow
              label="Lot Size"
              value={ipo.lotSize ? `${ipo.lotSize} shares` : null}
            />
            <InfoRow
              label="Issue Size"
              value={`₹${ipo.issueSize} Crores`}
            />
            {/* ISIN Display (Story 4.9) */}
            <div className="group flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4 p-2 rounded-md transition-all duration-200 hover:bg-muted/30">
              <ISINDisplay isin={ipo.isin} />
            </div>
            <InfoRow
              label="Listing Exchanges"
              value={
                ipo.listingExchanges && ipo.listingExchanges.length > 0
                  ? ipo.listingExchanges.join(', ')
                  : 'N/A'
              }
            />
            {/* Registrar with Logo (Story 5.8) */}
            <div className="group flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4 p-2 rounded-md transition-all duration-200 hover:bg-muted/30">
              <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Registrar</span>
              <div className="flex items-center gap-2">
                {ipo.registrarRelation ? (
                  <>
                    <RegistrarLogo
                      logoUrl={ipo.registrarRelation.logoUrl}
                      registrarName={ipo.registrarRelation.name}
                      size={40}
                    />
                    {ipo.registrarRelation.website ? (
                      <a
                        href={ipo.registrarRelation.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-bold transition-colors duration-200 hover:text-primary hover:underline"
                      >
                        {ipo.registrarRelation.shortName || ipo.registrarRelation.name}
                      </a>
                    ) : (
                      <span className="text-sm font-bold transition-colors duration-200 group-hover:text-primary">
                        {ipo.registrarRelation.shortName || ipo.registrarRelation.name}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-sm font-bold transition-colors duration-200 group-hover:text-primary">
                    {ipo.registrar || 'N/A'}
                  </span>
                )}
              </div>
            </div>
            <InfoRow
              label="Lead Managers"
              value={
                ipo.leadManagers && ipo.leadManagers.length > 0
                  ? ipo.leadManagers.join(', ')
                  : 'N/A'
              }
            />

            {/* NSE-specific High Priority Fields */}
            {ipoDetails?.sponsorBanks && ipoDetails.sponsorBanks.length > 0 ? (
              <InfoRow
                label="Sponsor Banks"
                value={ipoDetails.sponsorBanks.join(', ')}
              />
            ) : null}
            {ipoDetails?.maxRetailSubscription ? (
              <InfoRow
                label="Max Retail Subscription"
                value={formatCurrency(Number(ipoDetails.maxRetailSubscription))}
              />
            ) : null}
            {ipoDetails?.maxEmployeeSubscription ? (
              <InfoRow
                label="Max Employee Subscription"
                value={formatCurrency(Number(ipoDetails.maxEmployeeSubscription))}
              />
            ) : null}
            {ipoDetails?.employeeDiscount ? (
              <InfoRow
                label="Employee Discount"
                value={`${formatCurrency(Number(ipoDetails.employeeDiscount))} per share`}
              />
            ) : null}
            {ipoDetails?.tickSize ? (
              <InfoRow
                label="Tick Size"
                value={formatCurrency(Number(ipoDetails.tickSize))}
              />
            ) : null}
            {ipoDetails?.ipoMarketTimings ? (
              <InfoRow
                label="Market Timings"
                value={ipoDetails.ipoMarketTimings}
              />
            ) : null}
            {ipoDetails?.categoryDetails ? (
              <InfoRow
                label="Category Details"
                value={typeof ipoDetails.categoryDetails === 'object'
                  ? JSON.stringify(ipoDetails.categoryDetails)
                  : String(ipoDetails.categoryDetails)}
              />
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
