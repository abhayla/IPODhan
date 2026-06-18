'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, DollarSign, Users, BarChart } from 'lucide-react';
import { formatMarketCap } from '@/lib/utils/kpi-formatters';

interface KeyMetricsCardsProps {
  issueSize: number;
  subscription: number | null;
  subscriptionTrend?: 'up' | 'down' | 'neutral';
  gmp: number | null;
  gmpPercent: number | null;
  /** Timestamp of the GMP record being shown — drives the "as of <date>" staleness label (C1). */
  gmpAsOf?: string | Date | null;
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
  gmpAsOf,
}: KeyMetricsCardsProps) {
  const gmpAsOfLabel = (() => {
    if (gmp === null || !gmpAsOf) return null;
    const d = gmpAsOf instanceof Date ? gmpAsOf : new Date(gmpAsOf);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  })();
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
      <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 border-l-4 border-l-blue-500">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent dark:from-blue-950/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Issue Size
          </CardTitle>
          <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/30 transition-transform duration-300 group-hover:scale-110">
            <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
        </CardHeader>
        <CardContent className="relative">
          <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 dark:from-blue-400 dark:to-blue-600 bg-clip-text text-transparent transition-all duration-300">
            {/* issue_size is stored in RUPEES → /1e7 to crores → SSOT formatter (₹X Cr). */}
            {formatMarketCap(issueSize / 10000000)}
          </div>
          <p className="text-xs text-muted-foreground mt-1 font-medium">
            Total Issue Size
          </p>
        </CardContent>
      </Card>

      {/* Subscription Card */}
      <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 border-l-4 border-l-purple-500">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-50/50 to-transparent dark:from-purple-950/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Subscription
          </CardTitle>
          <div className="rounded-full bg-purple-100 p-2 dark:bg-purple-900/30 transition-transform duration-300 group-hover:scale-110">
            <Users className="h-4 w-4 text-purple-600 dark:text-purple-400" />
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
        </CardContent>
      </Card>

      {/* GMP Card */}
      <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 border-l-4 border-l-emerald-500">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/50 to-transparent dark:from-emerald-950/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Grey Market Premium
          </CardTitle>
          <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-900/30 transition-transform duration-300 group-hover:scale-110">
            <BarChart className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
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
          {gmpAsOfLabel && (
            <p className="text-[10px] mt-1 text-muted-foreground" data-testid="gmp-as-of">
              as of {gmpAsOfLabel}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
