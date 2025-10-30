'use client';

import { useEffect, useState } from 'react';
import { differenceInSeconds, format, parseISO, set, isAfter, isBefore } from 'date-fns';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ClockIcon, AlertTriangleIcon, CheckCircleIcon } from 'lucide-react';

interface UPIDeadlineTimerProps {
  closeDate: string; // IPO close date (ISO string)
  upiCutoffTime?: string; // "5:00 PM" or "17:00" format
  status?: 'UPCOMING' | 'OPEN' | 'CLOSED';
}

export function UPIDeadlineTimer({
  closeDate,
  upiCutoffTime = '5:00 PM',
  status = 'OPEN'
}: UPIDeadlineTimerProps) {
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [urgencyLevel, setUrgencyLevel] = useState<'normal' | 'warning' | 'critical' | 'expired'>('normal');

  useEffect(() => {
    if (status !== 'OPEN') {
      return;
    }

    // Parse the UPI cutoff time
    const parseUPITime = (timeStr: string): { hours: number; minutes: number } => {
      // Handle formats like "5:00 PM", "17:00", "5 PM"
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
    };

    const { hours, minutes } = parseUPITime(upiCutoffTime);

    // Create the cutoff datetime
    const closeDateObj = parseISO(closeDate);
    const cutoffDateTime = set(closeDateObj, { hours, minutes, seconds: 0 });

    const calculateTimeLeft = () => {
      const now = new Date();

      // Check if IPO has already closed
      if (isAfter(now, cutoffDateTime)) {
        setTimeLeft(0);
        setUrgencyLevel('expired');
        return;
      }

      const seconds = differenceInSeconds(cutoffDateTime, now);
      setTimeLeft(Math.max(0, seconds));

      // Set urgency level based on time remaining
      const hoursLeft = seconds / 3600;
      if (seconds === 0) {
        setUrgencyLevel('expired');
      } else if (hoursLeft <= 2) {
        setUrgencyLevel('critical');
      } else if (hoursLeft <= 24) {
        setUrgencyLevel('warning');
      } else {
        setUrgencyLevel('normal');
      }
    };

    // Calculate immediately
    calculateTimeLeft();

    // Update every second
    const timer = setInterval(calculateTimeLeft, 1000);

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
        return <AlertTriangleIcon className="h-4 w-4" />;
      case 'expired':
        return <CheckCircleIcon className="h-4 w-4" />;
      default:
        return <ClockIcon className="h-4 w-4" />;
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
      return `UPI mandate must be approved by ${upiCutoffTime} on the closing day to complete your application.`;
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
            Closes: {format(parseISO(closeDate), 'MMM dd, yyyy')} at {upiCutoffTime}
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
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [urgencyLevel, setUrgencyLevel] = useState<'normal' | 'warning' | 'critical' | 'expired'>('normal');

  useEffect(() => {
    if (status !== 'OPEN') {
      return;
    }

    const parseUPITime = (timeStr: string): { hours: number; minutes: number } => {
      const cleanTime = timeStr.trim().toUpperCase();

      if (cleanTime.match(/^\d{1,2}:\d{2}$/)) {
        const [hours, minutes] = cleanTime.split(':').map(Number);
        return { hours, minutes };
      }

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

      return { hours: 17, minutes: 0 };
    };

    const { hours, minutes } = parseUPITime(upiCutoffTime);
    const closeDateObj = parseISO(closeDate);
    const cutoffDateTime = set(closeDateObj, { hours, minutes, seconds: 0 });

    const calculateTimeLeft = () => {
      const now = new Date();

      if (isAfter(now, cutoffDateTime)) {
        setTimeLeft(0);
        setUrgencyLevel('expired');
        return;
      }

      const seconds = differenceInSeconds(cutoffDateTime, now);
      setTimeLeft(Math.max(0, seconds));

      const hoursLeft = seconds / 3600;
      if (seconds === 0) {
        setUrgencyLevel('expired');
      } else if (hoursLeft <= 2) {
        setUrgencyLevel('critical');
      } else if (hoursLeft <= 24) {
        setUrgencyLevel('warning');
      } else {
        setUrgencyLevel('normal');
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);

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
      <ClockIcon className="h-3 w-3" />
      UPI: {formatCompact()}
    </Badge>
  );
}