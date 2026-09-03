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

/** One appointed intermediary (`ipo_intermediaries`). */
export interface IntermediaryView {
  role: string;
  name: string;
  sebiRegNo: string | null;
}

/** A BRLM's recent record (`brlm_track_record`). */
export interface BrlmTrackRecordView {
  brlmName: string;
  issues3y: number | null;
  closedBelowIssuePrice: number | null;
}

interface LeadManagerSectionProps {
  leadManagers: string[] | null;
  /** Every appointed intermediary, by role. */
  intermediaries?: IntermediaryView[];
  /** Track record rows, matched to a BRLM by name. */
  brlmTrackRecords?: BrlmTrackRecordView[];
}

const ROLE_LABELS: Record<string, string> = {
  REGISTRAR: 'Registrar to the issue',
  SYNDICATE: 'Syndicate members',
  SUB_SYNDICATE: 'Sub-syndicate members',
  SPONSOR_BANK: 'Sponsor banks',
  ESCROW_BANK: 'Escrow collection banks',
  PUBLIC_ISSUE_BANK: 'Public issue banks',
};

/** Order the non-BRLM roles are listed in - closest to the investor first. */
const ROLE_ORDER = [
  'REGISTRAR',
  'SYNDICATE',
  'SUB_SYNDICATE',
  'SPONSOR_BANK',
  'ESCROW_BANK',
  'PUBLIC_ISSUE_BANK',
];

export function LeadManagerSection({
  leadManagers,
  intermediaries = [],
  brlmTrackRecords = [],
}: LeadManagerSectionProps) {
  const brlms = intermediaries.filter((i) => i.role === 'BRLM');

  // The BRLM names come from ipo_intermediaries when available; the legacy
  // ipo_details.leadManagers text array is the fallback.
  const brlmNames: string[] =
    brlms.length > 0 ? brlms.map((b) => b.name) : leadManagers ?? [];

  const regNoByName = new Map(brlms.map((b) => [b.name, b.sebiRegNo]));
  const trackByName = new Map(brlmTrackRecords.map((t) => [t.brlmName, t]));

  const otherRoles = ROLE_ORDER.map((role) => ({
    role,
    members: intermediaries.filter((i) => i.role === role),
  })).filter((g) => g.members.length > 0);

  // Don't render if there is nothing at all to show
  if (brlmNames.length === 0 && otherRoles.length === 0) {
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
          {brlmNames.map((manager, index) => (
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
                {regNoByName.get(manager) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    SEBI registration no. {regNoByName.get(manager)}
                  </p>
                )}
                {trackByName.get(manager) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Track record:{' '}
                    {trackByName.get(manager)!.issues3y ?? '—'} issues in the last 3
                    years,{' '}
                    {trackByName.get(manager)!.closedBelowIssuePrice ?? '—'} closed below
                    the issue price on listing day
                  </p>
                )}
              </div>

              {/* Icon */}
              <div className="shrink-0 pt-2">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
            </div>
          ))}
        </div>

        {/* Total Count */}
        {brlmNames.length > 0 && (
          <div className="mt-6 p-4 bg-muted/50 rounded-lg">
            <p className="text-sm text-center">
              <strong className="font-semibold">{brlmNames.length}</strong>{' '}
              {brlmNames.length === 1 ? 'Lead Manager' : 'Lead Managers'} appointed for this IPO
            </p>
          </div>
        )}

        {/* The rest of the appointed intermediaries, grouped by their role.
            Each group renders only when the issue actually named someone. */}
        {otherRoles.map((group) => (
          <div key={group.role} className="mt-6">
            <h4 className="text-sm font-semibold mb-3">
              {ROLE_LABELS[group.role] ?? group.role}
            </h4>
            <ul className="space-y-2">
              {group.members.map((m, i) => (
                <li key={`${m.name}-${i}`} className="text-sm border rounded-lg p-3">
                  <span className="font-medium">{m.name}</span>
                  {m.sebiRegNo && (
                    <span className="text-muted-foreground">
                      {' '}
                      · SEBI reg. no. {m.sebiRegNo}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

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
