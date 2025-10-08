'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { HistoricalIPO } from '@/lib/repositories/types';

interface HistoricalIPOCardListProps {
  ipos: HistoricalIPO[];
}

const formatCurrency = (amount: number | null) => {
  if (amount === null) return 'N/A';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (date: string | null) => {
  if (!date) return 'N/A';
  return format(new Date(date), 'dd MMM yyyy');
};

const formatGainPercent = (percent: number | null) => {
  if (percent === null) return 'N/A';
  const sign = percent >= 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
};

const getGainColor = (percent: number | null) => {
  if (percent === null) return 'text-muted-foreground';
  return percent >= 0 ? 'text-green-600' : 'text-red-600';
};

const getGainBgColor = (percent: number | null) => {
  if (percent === null) return 'bg-muted';
  return percent >= 0 ? 'bg-green-50 dark:bg-green-950' : 'bg-red-50 dark:bg-red-950';
};

export function HistoricalIPOCardList({ ipos }: HistoricalIPOCardListProps) {
  if (ipos.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No historical IPOs found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ipos.map((ipo) => (
        <Link key={ipo.id} href={`/ipos/${ipo.slug}`} className="block">
          <Card className="hover:shadow-lg transition-shadow duration-200">
            <CardContent className="p-4">
              <div className="space-y-3">
                {/* Header: Company Name and Category */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold truncate">{ipo.companyName}</h3>
                    {ipo.sector && (
                      <p className="text-sm text-muted-foreground truncate mt-0.5">
                        {ipo.sector}
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs flex-shrink-0">
                    {ipo.category}
                  </Badge>
                </div>

                {/* Listing Gain - Prominent Display */}
                <div className={`rounded-lg p-3 ${getGainBgColor(ipo.listingGainPercent ?? null)}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {ipo.listingGainPercent !== null && ipo.listingGainPercent !== undefined && (
                        ipo.listingGainPercent >= 0 ? (
                          <TrendingUp className="h-5 w-5 text-green-600" />
                        ) : (
                          <TrendingDown className="h-5 w-5 text-red-600" />
                        )
                      )}
                      <span className="text-sm text-muted-foreground">Listing Gain</span>
                    </div>
                    <span className={`text-lg font-bold ${getGainColor(ipo.listingGainPercent ?? null)}`}>
                      {formatGainPercent(ipo.listingGainPercent ?? null)}
                    </span>
                  </div>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Issue Price</p>
                    <p className="font-medium">{formatCurrency(ipo.issuePrice || null)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Subscription</p>
                    <p className="font-medium">
                      {ipo.subscription ? (
                        `${ipo.subscription.toFixed(2)}x`
                      ) : (
                        'N/A'
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Listing Date</p>
                    <p className="font-medium">{formatDate(ipo.listingDate)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Year</p>
                    <p className="font-medium">{ipo.year || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
