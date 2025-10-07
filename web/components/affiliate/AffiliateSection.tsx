/**
 * AffiliateSection Component
 *
 * "Apply for this IPO" section for IPO detail pages.
 * Features:
 * - Displays all active broker buttons
 * - Tracks clicks with IPO context
 * - Mobile-responsive layout
 * - Clear call-to-action
 *
 * @component
 */

'use client';

import { BrokerButton } from './BrokerButton';
import { affiliateConfig } from '@/lib/config/affiliate-links';

interface AffiliateSectionProps {
  ipoId: string;
  companyName?: string; // Optional for future use
}

export function AffiliateSection({ ipoId }: AffiliateSectionProps) {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-xl font-semibold">Apply for this IPO</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a demat account or apply through your existing broker
          </p>
        </div>

        {/* Broker Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row">
          {affiliateConfig.brokers.map((broker) => (
            <BrokerButton
              key={broker.id}
              broker={broker}
              source="ipo_detail"
              ipoId={ipoId}
              size="lg"
              className="flex-1"
            />
          ))}
        </div>

        {/* Disclaimer */}
        <p className="text-xs text-muted-foreground">
          {affiliateConfig.disclaimer.shortText}
        </p>
      </div>
    </div>
  );
}
