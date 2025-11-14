/**
 * Important Dates Section
 * Displays a timeline of all key IPO dates
 *
 * Features:
 * - Timeline view of important dates
 * - Icons for each date type
 * - Filters out null dates automatically
 * - Color-coded date cards
 *
 * @component
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, TrendingUp, Clock, CheckCircle, DollarSign, Activity } from 'lucide-react';

interface ImportantDatesSectionProps {
  openDate: string | null;
  closeDate: string | null;
  allotmentDate: string | null;
  basisOfAllotmentDate: string | null;
  initiationOfRefundsDate: string | null;
  creditOfSharesDate: string | null;
  listingDate: string | null;
}

interface DateItem {
  label: string;
  date: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}

/**
 * Format date to readable format
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Check if date is in the past
 */
function isPastDate(dateString: string): boolean {
  const date = new Date(dateString);
  const now = new Date();
  return date < now;
}

export function ImportantDatesSection({
  openDate,
  closeDate,
  allotmentDate,
  basisOfAllotmentDate,
  initiationOfRefundsDate,
  creditOfSharesDate,
  listingDate
}: ImportantDatesSectionProps) {
  // Build dates array (only include dates that exist)
  const dates: DateItem[] = [];

  if (openDate) {
    dates.push({
      label: 'IPO Opens',
      date: openDate,
      icon: <Calendar className="h-5 w-5" />,
      color: 'text-blue-600',
      description: 'Bidding starts'
    });
  }

  if (closeDate) {
    dates.push({
      label: 'IPO Closes',
      date: closeDate,
      icon: <Clock className="h-5 w-5" />,
      color: 'text-orange-600',
      description: 'Last day for bidding'
    });
  }

  if (basisOfAllotmentDate) {
    dates.push({
      label: 'Basis of Allotment',
      date: basisOfAllotmentDate,
      icon: <Activity className="h-5 w-5" />,
      color: 'text-purple-600',
      description: 'Allotment finalized'
    });
  }

  if (initiationOfRefundsDate) {
    dates.push({
      label: 'Initiation of Refunds',
      date: initiationOfRefundsDate,
      icon: <DollarSign className="h-5 w-5" />,
      color: 'text-yellow-600',
      description: 'Refunds processed'
    });
  }

  if (creditOfSharesDate) {
    dates.push({
      label: 'Credit of Shares',
      date: creditOfSharesDate,
      icon: <CheckCircle className="h-5 w-5" />,
      color: 'text-green-600',
      description: 'Shares credited to Demat'
    });
  }

  if (allotmentDate) {
    dates.push({
      label: 'Allotment Date',
      date: allotmentDate,
      icon: <CheckCircle className="h-5 w-5" />,
      color: 'text-green-600',
      description: 'Shares allotted'
    });
  }

  if (listingDate) {
    dates.push({
      label: 'Listing Date',
      date: listingDate,
      icon: <TrendingUp className="h-5 w-5" />,
      color: 'text-emerald-600',
      description: 'Shares start trading'
    });
  }

  // Don't render if no dates available
  if (dates.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Important Dates
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Key dates for the IPO process
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {dates.map((item, index) => {
            const past = isPastDate(item.date);

            return (
              <div
                key={index}
                className={`relative flex items-center justify-between p-4 rounded-lg border transition-all ${
                  past
                    ? 'bg-muted/30 border-muted opacity-70'
                    : 'bg-background border-primary/20 shadow-sm hover:shadow-md'
                }`}
              >
                {/* Left: Icon and Label */}
                <div className="flex items-center gap-4">
                  <div className={`${item.color} ${past ? 'opacity-50' : ''}`}>
                    {item.icon}
                  </div>
                  <div>
                    <p className={`font-semibold ${past ? 'text-muted-foreground' : ''}`}>
                      {item.label}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>

                {/* Right: Date */}
                <div className="text-right">
                  <p className={`font-bold ${past ? 'text-muted-foreground' : 'text-primary'}`}>
                    {formatDate(item.date)}
                  </p>
                  {past && (
                    <p className="text-xs text-muted-foreground mt-1">Completed</p>
                  )}
                </div>

                {/* Connector Line (except for last item) */}
                {index < dates.length - 1 && (
                  <div className="absolute left-7 top-full h-3 w-0.5 bg-border" />
                )}
              </div>
            );
          })}
        </div>

        {/* Info Banner */}
        <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-900 dark:text-amber-100">
            <strong>Note:</strong> All dates are tentative and subject to change based on market conditions
            and regulatory approvals. The company/merchant bankers reserve the right to revise the timeline.
            Please refer to the official prospectus for the most up-to-date information.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
