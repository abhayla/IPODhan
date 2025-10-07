'use client';

import { Subscription } from '@/lib/db/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';

interface SubscriptionBreakdownProps {
  subscription: Subscription | null;
}

interface CategoryData {
  label: string;
  value: number | string | null;
}

/**
 * SubscriptionBreakdown component displays subscription data with progress bars
 * Color-coded: Green (>1x), Yellow (0.5-1x), Red (<0.5x)
 */
export function SubscriptionBreakdown({
  subscription,
}: SubscriptionBreakdownProps) {
  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Subscription data not available yet
          </p>
        </CardContent>
      </Card>
    );
  }

  const categories: CategoryData[] = [
    {
      label: 'QIB (Qualified Institutional Buyers)',
      value: subscription.qibSubscription,
    },
    {
      label: 'NII (Non-Institutional Investors)',
      value: subscription.niiSubscription,
    },
    {
      label: 'Retail Individual Investors',
      value: subscription.retailSubscription,
    },
  ];

  const getBarColor = (value: number | string | null) => {
    if (value === null) return 'bg-gray-300';
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (numValue >= 1) return 'bg-green-500';
    if (numValue >= 0.5) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getBarWidth = (value: number | string | null) => {
    if (value === null) return '0%';
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    // Cap at 100% for display, but show actual value in text
    const percentage = Math.min((numValue / Math.max(numValue, 10)) * 100, 100);
    return `${percentage}%`;
  };

  const formatValue = (value: number | string | null) => {
    if (value === null) return '0.00';
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return numValue.toFixed(2);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription Breakdown</CardTitle>
        <p className="text-sm text-muted-foreground">
          Last updated:{' '}
          {format(new Date(subscription.timestamp), 'dd MMM yyyy, HH:mm')}
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Total Subscription */}
          <div className="rounded-lg bg-muted/50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Total Subscription</span>
              <span className="text-2xl font-bold">
                {formatValue(subscription.totalSubscription)}x
              </span>
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="space-y-4">
            {categories.map((category) => (
              <div key={category.label} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{category.label}</span>
                  <span className="text-sm font-bold">
                    {formatValue(category.value)}x
                  </span>
                </div>
                <div className="relative h-6 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full transition-all duration-300 ${getBarColor(category.value)}`}
                    style={{ width: getBarWidth(category.value) }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Additional Metrics */}
          {subscription.totalApplications && subscription.totalApplications > 0 && (
            <div className="grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">
                  Total Applications
                </p>
                <p className="text-lg font-semibold">
                  {subscription.totalApplications.toLocaleString('en-IN')}
                </p>
              </div>
              {subscription.totalSharesBid && (
                <div>
                  <p className="text-sm text-muted-foreground">
                    Shares Bid
                  </p>
                  <p className="text-lg font-semibold">
                    {subscription.totalSharesBid.toLocaleString('en-IN')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
