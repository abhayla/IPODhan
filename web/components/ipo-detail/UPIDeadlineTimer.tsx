'use client';

import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Clock, AlertTriangle, CheckCircle } from 'lucide-react';

interface UPIDeadlineTimerProps {
  closeDate: string; // IPO close date (ISO string)
  upiCutoffTime?: string; // "5:00 PM" or "17:00" format
  status?: 'UPCOMING' | 'OPEN' | 'CLOSED';
}

type UrgencyLevel = 'normal' | 'warning' | 'critical' | 'expired';

interface TimerState {
  timeLeft: number;
  urgencyLevel: UrgencyLevel;
}

// India does not observe DST — IST is a fixed UTC+5:30 offset year-round.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * Parse the UPI cutoff time. Handles "5:00 PM", "17:00", "5 PM" formats.
 * Defaults to 5:00 PM (the standard UPI mandate cutoff) if parsing fails.
 */
function parseUPITime(timeStr: string): { hours: number; minutes: number } {
  const cleanTime = timeStr.trim().toUpperCase();

  // Check if it's 24-hour format
  if (cleanTime.match(/^\d{1,2}:\d{2}$/)) {
    const [hours, minutes] = cleanTime.split(':').map(Number);
    return { hours, minutes };
  }

  // Handle 12-hour format
  const match = cleanTime.match(/^(\d{1,2}):?(\d{0,2})\s*(AM|PM)$/);
  if (match) {
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2] || '0');
    const isPM = match[3] === 'PM';

    if (isPM && hours !== 12) {
      hours += 12;
    } else if (!isPM && hours === 12) {
      hours = 0;
    }

    return { hours, minutes };
  }

  // Default to 5:00 PM if parsing fails
  return { hours: 17, minutes: 0 };
}

/**
 * Compute the UPI cutoff instant as an absolute UTC timestamp (ms since epoch),
 * anchored to India Standard Time regardless of the viewer's local timezone.
 *
 * P2-9: the previous implementation built the cutoff via date-fns `set()` on a
 * `parseISO`'d Date, which applies the cutoff hour/minute in the BROWSER's local
 * timezone — a viewer outside IST would get the wrong deadline (e.g. "5:00 PM"
 * local instead of 5:00 PM IST). Computing the offset explicitly makes the
 * cutoff timezone-correct for every viewer.
 */
function getCutoffTimestampMs(closeDate: string, upiCutoffTime: string): number {
  const { hours, minutes } = parseUPITime(upiCutoffTime);
  const [year, month, day] = closeDate.slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes, 0) - IST_OFFSET_MS;
}

/**
 * Pure, side-effect-free computation of the timer state at "now". Callable
 * during the initial render (server AND client, via a lazy useState
 * initializer) so the FIRST paint already reflects reality instead of a
 * client-only useEffect overwriting an incorrect default after hydration.
 *
 * P2-9: the previous implementation initialized timeLeft to 0 and only
 * computed the real value inside useEffect (client-only) — every server render
 * (and the pre-hydration client render) showed "UPI bidding closed" even for
 * IPOs that were genuinely OPEN with time remaining.
 */
function computeTimerState(closeDate: string, upiCutoffTime: string, status: UPIDeadlineTimerProps['status']): TimerState {
  if (status !== 'OPEN') {
    return { timeLeft: 0, urgencyLevel: 'normal' };
  }

  const cutoffMs = getCutoffTimestampMs(closeDate, upiCutoffTime);
  const nowMs = Date.now();

  if (nowMs >= cutoffMs) {
    return { timeLeft: 0, urgencyLevel: 'expired' };
  }

  const seconds = Math.max(0, Math.floor((cutoffMs - nowMs) / 1000));
  const hoursLeft = seconds / 3600;

  let urgencyLevel: UrgencyLevel;
  if (seconds === 0) {
    urgencyLevel = 'expired';
  } else if (hoursLeft <= 2) {
    urgencyLevel = 'critical';
  } else if (hoursLeft <= 24) {
    urgencyLevel = 'warning';
  } else {
    urgencyLevel = 'normal';
  }

  return { timeLeft: seconds, urgencyLevel };
}

export function UPIDeadlineTimer({
  closeDate,
  upiCutoffTime = '5:00 PM',
  status = 'OPEN'
}: UPIDeadlineTimerProps) {
  const [{ timeLeft, urgencyLevel }, setTimerState] = useState<TimerState>(() =>
    computeTimerState(closeDate, upiCutoffTime, status)
  );

  useEffect(() => {
    if (status !== 'OPEN') {
      return;
    }

    const tick = () => setTimerState(computeTimerState(closeDate, upiCutoffTime, status));

    // Recompute immediately in case time passed between the lazy initial
    // state and mount (e.g. a slow hydration).
    tick();
    const timer = setInterval(tick, 1000);

    return () => clearInterval(timer);
  }, [closeDate, upiCutoffTime, status]);

  // Don't show timer for non-open IPOs
  if (status !== 'OPEN') {
    return null;
  }

  // Format time remaining
  const formatTimeLeft = (seconds: number): string => {
    if (seconds === 0) {
      return 'UPI bidding closed';
    }

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 && days === 0) parts.push(`${secs}s`); // Only show seconds if less than a day

    return parts.join(' ');
  };

  const getIcon = () => {
    switch (urgencyLevel) {
      case 'critical':
        return <AlertTriangle className="h-4 w-4" />;
      case 'expired':
        return <CheckCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getAlertVariant = () => {
    switch (urgencyLevel) {
      case 'critical':
        return 'destructive';
      case 'warning':
        return 'default';
      case 'expired':
        return 'default';
      default:
        return 'default';
    }
  };

  const getBadgeVariant = () => {
    switch (urgencyLevel) {
      case 'critical':
        return 'destructive';
      case 'warning':
        return 'secondary';
      case 'expired':
        return 'outline';
      default:
        return 'default';
    }
  };

  const getMessage = () => {
    if (urgencyLevel === 'expired') {
      return 'UPI mandate acceptance window has closed. No new applications can be submitted.';
    } else if (urgencyLevel === 'critical') {
      return 'Critical: Less than 2 hours remaining! Complete your UPI mandate approval immediately to avoid application rejection.';
    } else if (urgencyLevel === 'warning') {
      return 'Warning: Less than 24 hours remaining. Ensure your UPI mandate is approved before the deadline.';
    } else {
      return `UPI mandate must be approved by ${upiCutoffTime} IST on the closing day to complete your application.`;
    }
  };

  // Main timer display
  const timerDisplay = (
    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <div className="flex items-center gap-3">
        {getIcon()}
        <div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            UPI Mandate Deadline
          </p>
          <p className={`text-2xl font-bold ${
            urgencyLevel === 'critical' ? 'text-red-600' :
            urgencyLevel === 'warning' ? 'text-yellow-600' :
            urgencyLevel === 'expired' ? 'text-gray-500' :
            'text-green-600'
          }`}>
            {formatTimeLeft(timeLeft)}
          </p>
        </div>
      </div>
      <div className="text-right">
        <Badge variant={getBadgeVariant()}>
          {urgencyLevel === 'expired' ? 'Closed' :
           urgencyLevel === 'critical' ? 'Critical' :
           urgencyLevel === 'warning' ? 'Closing Soon' :
           'Open'}
        </Badge>
        {timeLeft > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Closes: {format(parseISO(closeDate), 'MMM dd, yyyy')} at {upiCutoffTime} IST
          </p>
        )}
      </div>
    </div>
  );

  // Alert message
  if (urgencyLevel === 'critical' || urgencyLevel === 'warning') {
    return (
      <div className="space-y-3">
        {timerDisplay}
        <Alert variant={getAlertVariant()}>
          {getIcon()}
          <AlertDescription>
            {getMessage()}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return timerDisplay;
}

// Inline timer component for headers/cards
export function UPIDeadlineTimerInline({
  closeDate,
  upiCutoffTime = '5:00 PM',
  status = 'OPEN'
}: UPIDeadlineTimerProps) {
  const [{ timeLeft, urgencyLevel }, setTimerState] = useState<TimerState>(() =>
    computeTimerState(closeDate, upiCutoffTime, status)
  );

  useEffect(() => {
    if (status !== 'OPEN') {
      return;
    }

    const tick = () => setTimerState(computeTimerState(closeDate, upiCutoffTime, status));

    tick();
    const timer = setInterval(tick, 1000);

    return () => clearInterval(timer);
  }, [closeDate, upiCutoffTime, status]);

  if (status !== 'OPEN' || timeLeft === 0) {
    return null;
  }

  const days = Math.floor(timeLeft / 86400);
  const hours = Math.floor((timeLeft % 86400) / 3600);
  const minutes = Math.floor((timeLeft % 3600) / 60);

  const formatCompact = () => {
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  return (
    <Badge
      variant={
        urgencyLevel === 'critical' ? 'destructive' :
        urgencyLevel === 'warning' ? 'secondary' :
        'outline'
      }
      className="inline-flex items-center gap-1"
    >
      <Clock className="h-3 w-3" />
      UPI: {formatCompact()}
    </Badge>
  );
}
