'use client';

/**
 * Historical IPO Card List Component
 *
 * Mobile card view for displaying historical IPOs
 * Shows listing performance with color-coded badges and borders
 */

import React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { HistoricalIPO } from '@/lib/repositories/types';

interface HistoricalIPOCardListProps {
  ipos: HistoricalIPO[];
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (date: Date | string) => {
  return format(new Date(date), 'dd MMM yyyy');
};

const formatSubscription = (value: number) => {
  return `${value.toFixed(2)}x`; // 2-dp, consistent with KeyMetricsCards/IPOScoreSection
};

export function HistoricalIPOCardList({ ipos }: HistoricalIPOCardListProps) {
  if (!ipos || ipos.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8">No historical IPOs found.</p>
    );
  }

  return (
    <div className="space-y-4">
      {ipos.map((ipo) => {
        const gainPercent = ipo.listingGainPercent;
        const hasGain = gainPercent !== null && gainPercent !== undefined && Number.isFinite(gainPercent);
        const isPositiveGain = hasGain && gainPercent >= 0;
        // Quiet reference language (R16 #4/#12): a thin left color-tick, not a
        // full saturated border; light-tint gain chip, not a solid fill.
        const tickColor = !hasGain ? 'border-l-border' : isPositiveGain ? 'border-l-green-500' : 'border-l-red-500';
        const gainColor = !hasGain ? 'bg-muted text-muted-foreground' : isPositiveGain ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700';
        const gainSign = hasGain && isPositiveGain ? '+' : '';
        const GainIcon = isPositiveGain ? ArrowUp : ArrowDown;

        return (
          <Link key={ipo.id} href={`/ipos/${ipo.slug}`} className="block">
            <Card
              className={`border border-l-4 ${tickColor} transition-shadow duration-200 hover:shadow-md cursor-pointer`}
            >
              <CardContent className="p-4 space-y-3">
                {/* Header: Company Name and Status */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-semibold leading-tight line-clamp-2 flex-1">
                    {ipo.companyName}
                  </h3>
                  <Badge className="bg-gray-100 text-gray-600 hover:bg-gray-100">Listed</Badge>
                </div>

                {/* Listing Gain Badge - Prominent */}
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span className="text-sm font-medium text-muted-foreground">Listing Gain</span>
                  {hasGain ? (
                    <Badge className={`${gainColor} text-base font-bold px-3 py-1`}>
                      <GainIcon className="h-4 w-4 inline mr-1" />
                      {gainSign}
                      {gainPercent.toFixed(2)}%
                    </Badge>
                  ) : (
                    <Badge
                      className={`${gainColor} text-base font-bold px-3 py-1`}
                      aria-label="Listing gain not available"
                    >
                      —
                    </Badge>
                  )}
                </div>

                {/* Sector */}
                {ipo.sector && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {ipo.sector}
                    </Badge>
                  </div>
                )}

                {/* Listing Date */}
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Listing Date</p>
                  <p className="text-base font-semibold">
                    {ipo.listingDate ? formatDate(ipo.listingDate) : 'N/A'}
                  </p>
                </div>

                {/* Prices */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Issue Price</p>
                    <p className="text-base font-semibold">
                      {ipo.issuePrice !== null && ipo.issuePrice !== undefined ? formatCurrency(ipo.issuePrice) : 'N/A'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Listing Price</p>
                    <p className="text-base font-semibold">
                      {ipo.listingClose !== null && ipo.listingClose !== undefined ? formatCurrency(ipo.listingClose) : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Subscription — hidden when absent; 'Subscription: N/A' repeated
                    on 20+ cards erodes trust (2026-07-02 blind review) */}
                {ipo.subscriptionOverall !== null && ipo.subscriptionOverall !== undefined && (
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Subscription</p>
                    <p className="text-base font-semibold">
                      {formatSubscription(ipo.subscriptionOverall)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
