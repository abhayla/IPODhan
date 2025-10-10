'use client';

import { IPO } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatIPODate, getAccessibleDate, getISODate } from '@/lib/utils/date-formatter';

interface InfoSectionProps {
  ipo: IPO;
}

/**
 * InfoSection component displays key IPO information in key-value pairs
 * Includes dates, price range, lot size, face value, exchanges, and lead managers
 */
export function InfoSection({ ipo }: InfoSectionProps) {
  const formatCurrency = (amount: number | null) => {
    if (amount === null) return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const InfoRow = ({
    label,
    value,
    isDate,
    dateValue,
  }: {
    label: string;
    value: string | null;
    isDate?: boolean;
    dateValue?: string | null;
  }) => (
    <div className="group flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4 p-2 rounded-md transition-all duration-200 hover:bg-muted/30">
      <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
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
    </div>
  );

  return (
    <Card className="transition-all duration-300 hover:shadow-lg border-t-4 border-t-primary/20">
      <CardHeader className="bg-gradient-to-r from-background to-muted/20">
        <CardTitle className="text-xl font-bold tracking-tight">IPO Details</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          {/* Left Column */}
          <div className="space-y-2 animate-in fade-in slide-in-from-left-4 duration-500">
            <InfoRow label="Open Date" value={formatIPODate(ipo.openDate)} isDate dateValue={ipo.openDate} />
            <InfoRow label="Close Date" value={formatIPODate(ipo.closeDate)} isDate dateValue={ipo.closeDate} />
            <InfoRow
              label="Allotment Date"
              value={formatIPODate(ipo.allotmentDate)}
              isDate
              dateValue={ipo.allotmentDate}
            />
            <InfoRow label="Listing Date" value={formatIPODate(ipo.listingDate)} isDate dateValue={ipo.listingDate} />
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
            <InfoRow
              label="Listing Exchanges"
              value={
                ipo.listingExchanges && ipo.listingExchanges.length > 0
                  ? ipo.listingExchanges.join(', ')
                  : 'N/A'
              }
            />
            <InfoRow label="Registrar" value={ipo.registrar} />
            <InfoRow
              label="Lead Managers"
              value={
                ipo.leadManagers && ipo.leadManagers.length > 0
                  ? ipo.leadManagers.join(', ')
                  : 'N/A'
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
