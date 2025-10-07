'use client';

import { IPO } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';

interface InfoSectionProps {
  ipo: IPO;
}

/**
 * InfoSection component displays key IPO information in key-value pairs
 * Includes dates, price range, lot size, face value, exchanges, and lead managers
 */
export function InfoSection({ ipo }: InfoSectionProps) {
  const formatDate = (date: string | null) => {
    if (!date) return 'TBA';
    try {
      return format(new Date(date), 'dd MMM yyyy');
    } catch {
      return 'TBA';
    }
  };

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
  }: {
    label: string;
    value: string | null;
  }) => (
    <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{value || 'N/A'}</span>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>IPO Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Left Column */}
          <div className="space-y-3">
            <InfoRow label="Open Date" value={formatDate(ipo.openDate)} />
            <InfoRow label="Close Date" value={formatDate(ipo.closeDate)} />
            <InfoRow
              label="Allotment Date"
              value={formatDate(ipo.allotmentDate)}
            />
            <InfoRow label="Listing Date" value={formatDate(ipo.listingDate)} />
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
          <div className="space-y-3">
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
