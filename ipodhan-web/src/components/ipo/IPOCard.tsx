import React from 'react';
import Link from 'next/link';
import { ScoreDisplay, VerdictBadge, Button } from '@/components/common';
import type { IPO, IPOScore } from '@/types/ipo';

export interface IPOCardProps {
  ipo: IPO;
  score?: IPOScore;
  showSubscription?: boolean;
  onClick?: () => void;
}

/**
 * Format date to readable string
 */
const formatDate = (date: Date | string): string => {
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * Calculate days left until close date
 */
const getDaysLeft = (closeDate: Date | string): number => {
  const today = new Date();
  const close = new Date(closeDate);
  const diffTime = close.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * Format currency in Indian format
 */
const formatCurrency = (amount: number): string => {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)} Cr`;
  } else if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(2)} L`;
  } else {
    return `₹${amount.toLocaleString('en-IN')}`;
  }
};

/**
 * IPOCard Component
 * Displays IPO information in a card format
 */
export const IPOCard: React.FC<IPOCardProps> = ({
  ipo,
  score,
  showSubscription = false,
  onClick,
}) => {
  const daysLeft = ipo.status === 'LIVE' ? getDaysLeft(ipo.dates.close) : null;
  const minInvestment = ipo.priceBand.high * ipo.lotSize;

  return (
    <div
      className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 border border-gray-200 overflow-hidden"
      role="article"
      aria-label={`IPO card for ${ipo.companyName}`}
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900 mb-1">{ipo.companyName}</h3>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">{ipo.symbol}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  ipo.category === 'MAINBOARD'
                    ? 'bg-primary-100 text-primary-700'
                    : 'bg-purple-light text-purple-dark'
                }`}
              >
                {ipo.category}
              </span>
            </div>
          </div>
          {score && (
            <div className="ml-4">
              <ScoreDisplay score={score.totalScore} size="sm" />
            </div>
          )}
        </div>

        {/* Verdict Badge */}
        {score && (
          <div className="mb-4">
            <VerdictBadge verdict={score.verdict} score={score.totalScore} size="sm" />
          </div>
        )}

        {/* Key Dates */}
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-gray-500 text-xs mb-1">Open</p>
              <p className="font-medium text-gray-900">{formatDate(ipo.dates.open)}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-1">Close</p>
              <p className="font-medium text-gray-900">{formatDate(ipo.dates.close)}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-1">
                {ipo.status === 'LIVE' ? 'Days Left' : 'Listing'}
              </p>
              <p className="font-medium text-gray-900">
                {ipo.status === 'LIVE'
                  ? `${daysLeft} days`
                  : ipo.dates.listing
                  ? formatDate(ipo.dates.listing)
                  : 'TBA'}
              </p>
            </div>
          </div>
        </div>

        {/* Price Information */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-gray-500 text-xs mb-1">Price Band</p>
            <p className="font-semibold text-gray-900">
              ₹{ipo.priceBand.low} - ₹{ipo.priceBand.high}
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-xs mb-1">Lot Size</p>
            <p className="font-semibold text-gray-900">{ipo.lotSize} shares</p>
          </div>
        </div>

        {/* Minimum Investment */}
        <div className="mb-4 p-3 bg-primary-50 rounded-lg border border-primary-200">
          <p className="text-primary-700 text-xs mb-1">Minimum Investment</p>
          <p className="font-bold text-primary-900 text-lg">{formatCurrency(minInvestment)}</p>
        </div>

        {/* Subscription Status (for live IPOs) */}
        {showSubscription && ipo.status === 'LIVE' && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-600 mb-2">
              <span>Subscription Status</span>
              <span className="font-medium">Overall: --x</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-success to-success-dark w-0"></div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Link href={`/ipo/${ipo.id}`} className="flex-1">
            <Button variant="primary" size="sm" fullWidth onClick={onClick}>
              View Details
            </Button>
          </Link>
          <Button variant="outline" size="sm" className="flex-1">
            Watchlist
          </Button>
        </div>
      </div>

      {/* Status Indicator */}
      <div
        className={`h-1 ${
          ipo.status === 'LIVE'
            ? 'bg-success'
            : ipo.status === 'UPCOMING'
            ? 'bg-primary-500'
            : 'bg-gray-400'
        }`}
        aria-label={`Status: ${ipo.status}`}
      ></div>
    </div>
  );
};
