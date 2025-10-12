/**
 * Mainboard Summary Metrics Component
 *
 * Displays 6 key metric cards summarizing Mainboard IPO statistics.
 * Server component - receives metrics data as props.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, CheckCircle, XCircle, Bell, Activity } from 'lucide-react';
import { MainboardSummaryMetrics } from '@/lib/services/mainboard-landing-service';

interface MainboardSummaryMetricsProps {
  metrics: MainboardSummaryMetrics;
}

export function MainboardSummaryMetricsSection({ metrics }: MainboardSummaryMetricsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {/* Card 1: Total Mainboard IPOs */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-gray-600">
              Total Mainboard IPOs
            </CardTitle>
            <Activity className="h-5 w-5 text-blue-600" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-gray-900">{metrics.totalIPOs}</div>
        </CardContent>
      </Card>

      {/* Card 2: IPOs Listed in Gain */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-gray-600">
              Listed in Gain
            </CardTitle>
            <CheckCircle className="h-5 w-5 text-green-600" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-green-600">{metrics.listedInGain}</div>
        </CardContent>
      </Card>

      {/* Card 3: IPOs Listed in Loss */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-gray-600">
              Listed in Loss
            </CardTitle>
            <XCircle className="h-5 w-5 text-red-600" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-red-600">{metrics.listedInLoss}</div>
        </CardContent>
      </Card>

      {/* Card 4: Upcoming & OnGoing IPOs */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-gray-600">
              Upcoming & OnGoing
            </CardTitle>
            <Bell className="h-5 w-5 text-yellow-600" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-yellow-600">{metrics.upcomingAndOngoing}</div>
        </CardContent>
      </Card>

      {/* Card 5: IPOs in Gain (AOT) */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-gray-600">
              Gain (All Over Time)
            </CardTitle>
            <TrendingUp className="h-5 w-5 text-green-600" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-green-600">
            {metrics.gainAOT.toFixed(2)}%
          </div>
        </CardContent>
      </Card>

      {/* Card 6: IPOs in Loss (AOT) */}
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-gray-600">
              Loss (All Over Time)
            </CardTitle>
            <TrendingDown className="h-5 w-5 text-red-600" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-red-600">
            {metrics.lossAOT.toFixed(2)}%
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
