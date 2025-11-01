/**
 * Stale Data Banner Component
 *
 * Displays a warning banner when IPO data is outdated (> 2 hours old).
 * Story 7.5: Error Handling & Monitoring
 */

'use client';

import { HiExclamationCircle } from 'react-icons/hi2';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export interface StaleDataBannerProps {
  lastUpdated: Date | null;
  isStale: boolean;
  allScrapersFailing?: boolean;
}

export function StaleDataBanner({
  lastUpdated,
  isStale,
  allScrapersFailing = false,
}: StaleDataBannerProps) {
  // Don't show banner if data is fresh
  if (!isStale) {
    return null;
  }

  // Calculate hours ago
  const hoursAgo = lastUpdated
    ? Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60))
    : null;

  // Determine severity
  const variant = allScrapersFailing ? 'destructive' : 'default';

  return (
    <Alert variant={variant} className="mb-4">
      <HiExclamationCircle className="h-4 w-4" />
      <AlertTitle>
        {allScrapersFailing
          ? 'IPO Data Currently Unavailable'
          : 'IPO Data May Be Outdated'}
      </AlertTitle>
      <AlertDescription>
        {allScrapersFailing ? (
          <>
            Our data update services are experiencing issues. We're working to
            restore normal operations. The data shown may not reflect the latest
            information.
          </>
        ) : lastUpdated && hoursAgo !== null ? (
          <>
            Last updated {hoursAgo} {hoursAgo === 1 ? 'hour' : 'hours'} ago.
            We're working to refresh the data.
          </>
        ) : (
          <>
            IPO data is currently unavailable. We're working to restore the
            service.
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}
