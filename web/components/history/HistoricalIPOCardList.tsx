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
        const borderColor = !hasGain ? 'border-border' : isPositiveGain ? 'border-green-500' : 'border-red-500';
        const gainColor = !hasGain ? 'bg-muted-foreground/20 text-muted-foreground' : isPositiveGain ? 'bg-green-500 text-white' : 'bg-red-500 text-white';
        const gainSign = hasGain && isPositiveGain ? '+' : '';
        const GainIcon = isPositiveGain ? ArrowUp : ArrowDown;

        return (
          <Link key={ipo.id} href={`/ipos/${ipo.slug}`} className="block">
            <Card
              className={`border-2 ${borderColor} hover:shadow-lg transition-all duration-200 cursor-pointer`}
            >
              <CardContent className="p-6 space-y-4">
                {/* Header: Company Name and Status */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-bold leading-tight line-clamp-2 flex-1">
                    {ipo.companyName}
                  </h3>
                  <Badge className="bg-purple-500 text-white">LISTED</Badge>
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

                {/* Subscription */}
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Subscription</p>
                  <p className="text-base font-semibold">
                    {ipo.subscriptionOverall !== null && ipo.subscriptionOverall !== undefined ? formatSubscription(ipo.subscriptionOverall) : 'N/A'}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
