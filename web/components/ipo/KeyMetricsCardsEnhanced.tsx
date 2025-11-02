'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChartBase } from '@/components/ipo/charts';
import { HiArrowTrendingUp, HiArrowTrendingDown, HiCurrencyDollar, HiUsers, HiChartBar } from 'react-icons/hi2';
import { transformSubscriptionData, transformGMPData } from '@/components/ipo/charts';
import type { SubscriptionDataRaw, GMPRecordRaw } from '@/components/ipo/charts';

interface KeyMetricsCardsEnhancedProps {
  issueSize: number;
  subscription: number | null;
  subscriptionTrend?: 'up' | 'down' | 'neutral';
  gmp: number | null;
  gmpPercent: number | null;
  /** Historical subscription data for sparkline (optional) */
  subscriptions?: SubscriptionDataRaw[];
  /** Historical GMP data for sparkline (optional) */
  gmpRecords?: GMPRecordRaw[];
  /** Show sparklines (default: true) */
  showSparklines?: boolean;
}

/**
 * KeyMetricsCardsEnhanced - Enhanced version with sparkline charts
 *
 * Displays 3 key metrics in card format with mini trend charts:
 * - Issue Size (static value)
 * - Subscription (with sparkline showing trend over time)
 * - GMP (with sparkline showing historical GMP)
 *
 * Falls back to KeyMetricsCards behavior if no historical data provided.
 *
 * @example
 * ```tsx
 * <KeyMetricsCardsEnhanced
 *   issueSize={500000000}
 *   subscription={2.5}
 *   subscriptionTrend="up"
 *   gmp={50}
 *   gmpPercent={10}
 *   subscriptions={subscriptionData}
 *   gmpRecords={gmpData}
 * />
 * ```
 */
export function KeyMetricsCardsEnhanced({
  issueSize,
  subscription,
  subscriptionTrend = 'neutral',
  gmp,
  gmpPercent,
  subscriptions = [],
  gmpRecords = [],
  showSparklines = true,
}: KeyMetricsCardsEnhancedProps) {
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
      return <HiArrowTrendingUp className="h-4 w-4 text-green-600" />;
    }
    if (subscriptionTrend === 'down') {
      return <HiArrowTrendingDown className="h-4 w-4 text-red-600" />;
    }
    return null;
  };

  const getGMPColor = () => {
    if (gmpPercent === null || gmpPercent === 0) return 'text-muted-foreground';
    return gmpPercent > 0 ? 'text-green-600' : 'text-red-600';
  };

  // Transform data for sparklines
  const subscriptionChartData = showSparklines && subscriptions.length > 0
    ? transformSubscriptionData(subscriptions).slice(-7) // Last 7 data points
    : [];

  const gmpChartData = showSparklines && gmpRecords.length > 0
    ? transformGMPData(gmpRecords).slice(-7) // Last 7 data points
    : [];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* Issue Size Card */}
      <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 border-l-4 border-l-blue-500">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent dark:from-blue-950/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Issue Size
          </CardTitle>
          <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/30 transition-transform duration-300 group-hover:scale-110">
            <HiCurrencyDollar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
        </CardHeader>
        <CardContent className="relative">
          <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 dark:from-blue-400 dark:to-blue-600 bg-clip-text text-transparent transition-all duration-300">
            ₹{(issueSize / 10000000).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Crores
          </div>
          <p className="text-xs text-muted-foreground mt-1 font-medium">
            Total Issue Size
          </p>
        </CardContent>
      </Card>

      {/* Subscription Card with Sparkline */}
      <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 border-l-4 border-l-purple-500">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-50/50 to-transparent dark:from-purple-950/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Subscription
          </CardTitle>
          <div className="rounded-full bg-purple-100 p-2 dark:bg-purple-900/30 transition-transform duration-300 group-hover:scale-110">
            <HiUsers className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </div>
        </CardHeader>
        <CardContent className="relative">
          <div className="flex items-center gap-2">
            <div className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-purple-800 dark:from-purple-400 dark:to-purple-600 bg-clip-text text-transparent transition-all duration-300">
              {formatSubscription(subscription)}
            </div>
            <div className="transition-transform duration-300 group-hover:scale-125">
              {getTrendIcon()}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1 font-medium">
            {subscription !== null && subscription > 1
              ? 'Oversubscribed'
              : subscription !== null
              ? 'Undersubscribed'
              : 'Not available'}
          </p>

          {/* Sparkline Chart */}
          {subscriptionChartData.length > 0 && (
            <div className="mt-3 h-12 opacity-60 group-hover:opacity-100 transition-opacity duration-300">
              <LineChartBase
                data={subscriptionChartData}
                lines={[
                  {
                    dataKey: 'overall',
                    label: 'Subscription',
                    color: '#9333ea', // purple-600
                    strokeWidth: 2,
                    showDots: false,
                  },
                ]}
                xAxisKey="time"
                height={48}
                showGrid={false}
                showLegend={false}
                enableAnimations={false}
                margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* GMP Card with Sparkline */}
      <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 border-l-4 border-l-emerald-500">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 to-transparent dark:from-emerald-950/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Grey Market Premium
          </CardTitle>
          <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-900/30 transition-transform duration-300 group-hover:scale-110">
            <HiChartBar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
        </CardHeader>
        <CardContent className="relative">
          <div className={`text-2xl font-bold transition-all duration-300 ${getGMPColor()}`}>
            {gmp !== null ? formatCurrency(gmp) : 'N/A'}
          </div>
          <p className={`text-xs mt-1 font-semibold transition-all duration-300 ${getGMPColor()}`}>
            {gmpPercent !== null
              ? `${gmpPercent > 0 ? '+' : ''}${gmpPercent.toFixed(2)}%`
              : 'Not available'}
          </p>

          {/* Sparkline Chart */}
          {gmpChartData.length > 0 && (
            <div className="mt-3 h-12 opacity-60 group-hover:opacity-100 transition-opacity duration-300">
              <LineChartBase
                data={gmpChartData}
                lines={[
                  {
                    dataKey: 'gmp',
                    label: 'GMP',
                    color: gmp !== null && gmp > 0 ? '#10b981' : '#ef4444', // emerald-500 or red-500
                    strokeWidth: 2,
                    showDots: false,
                  },
                ]}
                xAxisKey="date"
                height={48}
                showGrid={false}
                showLegend={false}
                enableAnimations={false}
                margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
