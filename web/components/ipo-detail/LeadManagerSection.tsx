/**
 * Lead Manager Section
 * Displays the Book Running Lead Managers (BRLMs) for an IPO
 *
 * Features:
 * - Numbered list of lead managers
 * - Clean card-based design
 * - Empty state handling
 *
 * @component
 * @note Lead managers data comes from ipoDetails.leadManagers (text array)
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Users } from 'lucide-react';

interface LeadManagerSectionProps {
  leadManagers: string[] | null;
}

export function LeadManagerSection({ leadManagers }: LeadManagerSectionProps) {
  // Don't render if no lead managers data
  if (!leadManagers || leadManagers.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Book Running Lead Managers (BRLMs)
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Merchant bankers managing the IPO process
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {leadManagers.map((manager, index) => (
            <div
              key={index}
              className="flex items-start gap-4 p-4 border rounded-lg hover:bg-accent/50 transition-colors"
            >
              {/* Number Badge */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-lg">
                {index + 1}
              </div>

              {/* Manager Name */}
              <div className="flex-1 pt-2">
                <p className="font-semibold text-base leading-tight">{manager}</p>
              </div>

              {/* Icon */}
              <div className="shrink-0 pt-2">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>
          ))}
        </div>

        {/* Total Count */}
        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <p className="text-sm text-center">
            <strong className="font-semibold">{leadManagers.length}</strong>{' '}
            {leadManagers.length === 1 ? 'Lead Manager' : 'Lead Managers'} appointed for this IPO
          </p>
        </div>

        {/* Info Note */}
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-blue-900 dark:text-blue-100">
            <strong>Role of BRLMs:</strong> Book Running Lead Managers are investment banks responsible for
            managing the IPO process, including pricing, marketing, regulatory filings, and coordinating with
            exchanges and registrars.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
