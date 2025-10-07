'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, DollarSign, Users, LineChart } from 'lucide-react';

interface KeyMetricsCardsProps {
  issueSize: number;
  subscription: number | null;
  subscriptionTrend?: 'up' | 'down' | 'neutral';
  gmp: number | null;
  gmpPercent: number | null;
}

/**
 * KeyMetricsCards component displays 3 key metrics in card format:
 * - Issue Size (in INR crores)
 * - Subscription (with trend indicator)
 * - GMP (Grey Market Premium with percentage)
 */
export function KeyMetricsCards({
  issueSize,
  subscription,
  subscriptionTrend = 'neutral',
  gmp,
  gmpPercent,
}: KeyMetricsCardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatSubscription = (times: number | null) => {
    if (times === null) return 'N/A';
    return `${times.toFixed(2)}x`;
  };

  const getTrendIcon = () => {
    if (subscriptionTrend === 'up') {
      return <TrendingUp className="h-4 w-4 text-green-600" />;
    }
    if (subscriptionTrend === 'down') {
      return <TrendingDown className="h-4 w-4 text-red-600" />;
    }
    return null;
  };

  const getGMPColor = () => {
    if (gmpPercent === null || gmpPercent === 0) return 'text-muted-foreground';
    return gmpPercent > 0 ? 'text-green-600' : 'text-red-600';
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* Issue Size Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Issue Size
          </CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrency(issueSize * 10000000)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            ₹{issueSize} Crores
          </p>
        </CardContent>
      </Card>

      {/* Subscription Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Subscription
          </CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold">
              {formatSubscription(subscription)}
            </div>
            {getTrendIcon()}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {subscription !== null && subscription > 1
              ? 'Oversubscribed'
              : subscription !== null
              ? 'Undersubscribed'
              : 'Not available'}
          </p>
        </CardContent>
      </Card>

      {/* GMP Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Grey Market Premium
          </CardTitle>
          <LineChart className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${getGMPColor()}`}>
            {gmp !== null ? formatCurrency(gmp) : 'N/A'}
          </div>
          <p className={`text-xs mt-1 font-medium ${getGMPColor()}`}>
            {gmpPercent !== null
              ? `${gmpPercent > 0 ? '+' : ''}${gmpPercent.toFixed(2)}%`
              : 'Not available'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
