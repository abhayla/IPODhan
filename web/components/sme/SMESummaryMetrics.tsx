/**
 * SME Summary Metrics Component
 *
 * Displays 6 metric cards showing key SME IPO statistics:
 * 1. Total SME IPOs
 * 2. IPOs Listed in Gain
 * 3. IPOs Listed in Loss
 * 4. Upcoming & OnGoing IPOs
 * 5. IPOs in Gain (AOT - All Over Time)
 * 6. IPOs in Loss (AOT - All Over Time)
 *
 * Story 9.16: SME IPOs Landing Page
 * AC#3: Summary metrics section displays all 6 cards with correct calculated values
 * AC#20: Responsive design (1 col mobile, 2 col tablet, 3 col desktop)
 */

import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, CheckCircle, XCircle, Bell, TrendingDown } from 'lucide-react';
import type { SMESummaryMetrics } from '@/lib/services/sme-landing-service';

interface SMESummaryMetricsProps {
  metrics: SMESummaryMetrics;
}

export function SMESummaryMetrics({ metrics }: SMESummaryMetricsProps) {
  const metricCards = [
    {
      id: 'total-ipos',
      icon: TrendingUp,
      iconColor: 'text-blue-600',
      bgColor: 'bg-blue-50',
      value: metrics.totalIPOs,
      label: 'Total SME IPOs',
      valueColor: 'text-gray-900',
    },
    {
      id: 'listed-gain',
      icon: CheckCircle,
      iconColor: 'text-green-600',
      bgColor: 'bg-green-50',
      value: metrics.listedInGain,
      label: 'Listed in Gain',
      valueColor: 'text-green-600',
    },
    {
      id: 'listed-loss',
      icon: XCircle,
      iconColor: 'text-red-600',
      bgColor: 'bg-red-50',
      value: metrics.listedInLoss,
      label: 'Listed in Loss',
      valueColor: 'text-red-600',
    },
    {
      id: 'upcoming-ongoing',
      icon: Bell,
      iconColor: 'text-orange-600',
      bgColor: 'bg-orange-50',
      value: metrics.upcomingAndOngoing,
      label: 'Upcoming & OnGoing',
      valueColor: 'text-gray-900',
    },
    {
      id: 'gain-aot',
      icon: TrendingUp,
      iconColor: 'text-green-600',
      bgColor: 'bg-green-50',
      value: `${metrics.gainAOT.toFixed(2)}%`,
      label: 'Gain (All Over Time)',
      valueColor: 'text-green-600',
    },
    {
      id: 'loss-aot',
      icon: TrendingDown,
      iconColor: 'text-red-600',
      bgColor: 'bg-red-50',
      value: `${metrics.lossAOT.toFixed(2)}%`,
      label: 'Loss (All Over Time)',
      valueColor: 'text-red-600',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {metricCards.map((card) => {
        const Icon = card.icon;
        return (
          <Card
            key={card.id}
            className="transition-all duration-200 hover:shadow-md hover:border-gray-300"
          >
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-600 mb-2">{card.label}</p>
                  <p className={`text-3xl font-bold ${card.valueColor}`}>{card.value}</p>
                </div>
                <div className={`p-3 rounded-lg ${card.bgColor}`}>
                  <Icon className={`h-6 w-6 ${card.iconColor}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
