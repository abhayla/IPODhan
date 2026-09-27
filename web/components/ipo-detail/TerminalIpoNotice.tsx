/**
 * Terminal IPO Notice (OD-8 freeze mechanism)
 *
 * §2.9 of docs/design/data-sourcing-pull-model.md: a WITHDRAWN or DELISTED IPO's
 * page stays at its URL rather than redirecting — someone who applied, or who
 * held the stock, will search for it — but it is frozen: existing values are
 * kept as a record, and nothing on the page implies the issue is still live.
 *
 * #975 (OD-8 extended to DELISTED, #983/OD-132): a delisted company is no
 * longer traded on any exchange; the page states that plainly, with the date,
 * and the caller must not render live price/GMP/subscription figures beside it.
 */

import { AlertTriangle } from 'lucide-react';
import { formatIPODate } from '@/lib/utils/date-formatter';

export type TerminalStatus = 'WITHDRAWN' | 'DELISTED';

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['WITHDRAWN', 'DELISTED']);

export function isTerminalNoticeStatus(status: string | null | undefined): boolean {
  return TERMINAL_STATUSES.has((status || '').toUpperCase());
}

interface TerminalIpoNoticeProps {
  status: string;
  /** `ipos.delisted_at` — the third strike's instant. Only meaningful for DELISTED. */
  delistedAt: string | Date | null;
}

export function TerminalIpoNotice({ status, delistedAt }: TerminalIpoNoticeProps) {
  const upper = (status || '').toUpperCase();
  if (!isTerminalNoticeStatus(upper)) return null;

  const message =
    upper === 'DELISTED'
      ? delistedAt
        ? `This company was delisted on ${formatIPODate(delistedAt, { includeTimezone: true })} and no longer trades on any exchange. The figures below are kept as a historical record and are not updated.`
        : 'This company was delisted and no longer trades on any exchange. The figures below are kept as a historical record and are not updated.'
      : 'This IPO was withdrawn and will not proceed. The figures below are kept as a record of what was originally offered.';

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      aria-label={upper === 'DELISTED' ? 'Delisted notice' : 'Withdrawn notice'}
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">
          {upper === 'DELISTED' ? 'Delisted.' : 'Withdrawn.'}
        </span>{' '}
        {message}
      </p>
    </div>
  );
}
