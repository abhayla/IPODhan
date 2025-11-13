import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, Building2 } from 'lucide-react';
import type { MarketHoliday } from '@/lib/db/types';
import { format, parseISO } from 'date-fns';

interface HolidayCardProps {
  holiday: MarketHoliday;
  isUpcoming: boolean;
  isPast: boolean;
}

/**
 * HolidayCard component
 *
 * Displays market holiday information in a card format.
 * Shows date, holiday name, exchange, and day of week.
 * Story 5.4: Market Holidays Calendar
 *
 * Features:
 * - Displays date in DD MMM YYYY format (e.g., "26 Jan 2025")
 * - Shows "Upcoming" badge for holidays in next 7 days
 * - Applies muted styling for past holidays
 * - Displays exchange badge (NSE, BSE, or Both)
 * - Shows day of week for better context
 */
export function HolidayCard({ holiday, isUpcoming, isPast }: HolidayCardProps) {
  // Parse the date string
  const holidayDate = parseISO(holiday.date);

  // Format date as "DD MMM YYYY" (e.g., "26 Jan 2025")
  const formattedDate = format(holidayDate, 'dd MMM yyyy');

  // Get day of week (e.g., "Monday")
  const dayOfWeek = format(holidayDate, 'EEEE');

  // Determine exchange badge text and color
  const getExchangeBadge = () => {
    switch (holiday.exchange) {
      case 'NSE':
        return { text: 'NSE', variant: 'default' as const };
      case 'BSE':
        return { text: 'BSE', variant: 'secondary' as const };
      case 'BOTH':
        return { text: 'NSE & BSE', variant: 'outline' as const };
      default:
        return { text: holiday.exchange, variant: 'outline' as const };
    }
  };

  const exchangeBadge = getExchangeBadge();

  return (
    <Card className={`transition-colors ${isPast ? 'opacity-60' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left side: Date and holiday info */}
          <div className="flex-1 space-y-2">
            {/* Date and Day of Week */}
            <div className="flex items-center gap-2">
              <Calendar className={`h-4 w-4 ${isPast ? 'text-muted-foreground' : 'text-primary'}`} />
              <div>
                <p className={`font-semibold ${isPast ? 'text-muted-foreground' : 'text-foreground'}`}>
                  {formattedDate}
                </p>
                <p className="text-xs text-muted-foreground">{dayOfWeek}</p>
              </div>
            </div>

            {/* Holiday Name */}
            <h3 className={`font-medium ${isPast ? 'text-muted-foreground' : 'text-foreground'}`}>
              {holiday.description}
            </h3>

            {/* Holiday Type (if not standard trading holiday) */}
            {holiday.type !== 'TRADING' && (
              <p className="text-xs text-muted-foreground">
                Type: {holiday.type === 'SETTLEMENT' ? 'Settlement Only' : 'Trading & Settlement'}
              </p>
            )}
          </div>

          {/* Right side: Badges */}
          <div className="flex flex-col items-end gap-2">
            {/* Upcoming Badge */}
            {isUpcoming && !isPast && (
              <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                Upcoming
              </Badge>
            )}

            {/* Exchange Badge */}
            <div className="flex items-center gap-1">
              <Building2 className="h-3 w-3 text-muted-foreground" />
              <Badge variant={exchangeBadge.variant}>
                {exchangeBadge.text}
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
