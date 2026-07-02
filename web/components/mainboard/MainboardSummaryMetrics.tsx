/**
 * Mainboard Summary Metrics Component
 *
 * Displays 6 summary metric cards for Mainboard IPOs landing page:
 * - Total Mainboard IPOs
 * - IPOs Listed in Gain
 * - IPOs Listed in Loss
 * - Upcoming & OnGoing IPOs
 * - IPOs in Gain (All Over Time)
 * - IPOs in Loss (All Over Time)
 *
 * Server component with responsive grid layout.
 *
 * Story 9.15 - AC#3: Summary metrics section displays all 6 cards
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, CheckCircle, XCircle, Bell, Signal } from 'lucide-react';
import type { MainboardSummaryMetrics } from '@/lib/services/mainboard-landing-service';

interface MainboardSummaryMetricsProps {
  metrics: MainboardSummaryMetrics;
}

/**
 * Mainboard Summary Metrics Component
 */
export function MainboardSummaryMetrics({ metrics }: MainboardSummaryMetricsProps) {
  const metricCards = [
    {
      id: 'total-ipos',
      title: 'Total Mainboard IPOs (all years)',
      value: metrics.totalIPOs,
      icon: Signal,
      iconColor: 'text-blue-600',
      bgColor: 'bg-blue-50',
      suffix: '',
    },
    {
      id: 'listed-gain',
      title: 'Listed in Gain',
      value: metrics.listedInGain,
      icon: CheckCircle,
      iconColor: 'text-green-600',
      bgColor: 'bg-green-50',
      valueColor: 'text-green-700',
      suffix: '',
    },
    {
      id: 'listed-loss',
      title: 'Listed in Loss',
      value: metrics.listedInLoss,
      icon: XCircle,
      iconColor: 'text-red-600',
      bgColor: 'bg-red-50',
      valueColor: 'text-red-700',
      suffix: '',
    },
    {
      id: 'upcoming-ongoing',
      title: 'Upcoming & OnGoing',
      value: metrics.upcomingAndOngoing,
      icon: Bell,
      iconColor: 'text-purple-600',
      bgColor: 'bg-purple-50',
      suffix: '',
    },
    {
      id: 'gain-aot',
      title: 'Gain (All Over Time)',
      value: metrics.gainAOT !== null ? metrics.gainAOT.toFixed(2) : null,
      icon: TrendingUp,
      iconColor: 'text-green-600',
      bgColor: 'bg-green-50',
      valueColor: 'text-green-700',
      suffix: '%',
    },
    {
      id: 'loss-aot',
      title: 'Loss (All Over Time)',
      value: metrics.lossAOT !== null ? metrics.lossAOT.toFixed(2) : null,
      icon: TrendingDown,
      iconColor: 'text-red-600',
      bgColor: 'bg-red-50',
      valueColor: 'text-red-700',
      suffix: '%',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {metricCards.filter((m) => m.value !== null && m.value !== undefined).map((metric) => {
        const Icon = metric.icon;
        return (
          <Card
            key={metric.id}
            className="hover:shadow-md transition-shadow duration-200 border-l-4"
            style={{ borderLeftColor: metric.iconColor.replace('text-', '#').replace('600', '6B7280') }}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                {metric.title}
              </CardTitle>
              <div className={`p-2 rounded-full ${metric.bgColor}`}>
                <Icon className={`h-4 w-4 ${metric.iconColor}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${metric.valueColor || 'text-gray-900'}`}>
                {metric.value}
                {metric.suffix && <span className="text-2xl ml-1">{metric.suffix}</span>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
