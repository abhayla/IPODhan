/**
 * Pending Data Notice
 *
 * One compact strip that replaces the stack of per-section "Data Not Available"
 * cards on the IPO detail page (2026-07-02 UI review: 8+ empty-state blocks made
 * the page admit it has no answer more often than it answers). Sections with no
 * data render nothing; this notice names what is still awaited, once.
 */

import { Info } from 'lucide-react';

interface PendingDataNoticeProps {
  pendingSections: string[];
  status: string;
}

export function PendingDataNotice({ pendingSections, status }: PendingDataNoticeProps) {
  if (pendingSections.length === 0) return null;

  const reason =
    status === 'UPCOMING'
      ? 'These arrive as the prospectus is filed and exchange data is published.'
      : 'These are updated as filings and exchange data become available.';

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
      role="note"
      aria-label="Data still being collected"
    >
      <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-medium text-foreground">Awaiting data:</span>{' '}
        {pendingSections.join(' · ')}. {reason}
      </p>
    </div>
  );
}
