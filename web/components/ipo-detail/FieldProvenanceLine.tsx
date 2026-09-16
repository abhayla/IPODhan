/**
 * OD-39 — the line under a key-facts block saying where its numbers came from
 * and when they were last confirmed.
 *
 * When there is nothing to say it renders NOTHING. No "source unknown", no grey
 * placeholder, no skeleton. The whole value of this line is that a reader can
 * trust it; a placeholder under every block on every page teaches them within a
 * week that the line means nothing, and then the real one is invisible too.
 *
 * A disagreement between sources is never shown here. Per OD-39 that is
 * admin-only — `data_conflicts` has its own surface, and a reader cannot act on
 * "two sources disagree" anyway.
 */

import type { FieldProvenance } from '@/lib/repositories/ipo-field-plan-repository';
import { MULTIPLE_SOURCES } from '@/lib/repositories/ipo-field-plan-repository';

export interface FieldProvenanceLineProps {
  /** null renders nothing — see the file header. */
  provenance: Pick<
    FieldProvenance,
    'chosenSource' | 'chosenDocumentType' | 'confirmedAt' | 'isStale'
  > | null;
}

/**
 * Reader-facing words for a source code. A code with no entry here is printed
 * as itself rather than given an invented friendly name: showing "NEW_FEED" is
 * honest and obviously unfinished; showing "the offer document" for it would be
 * a lie nobody could spot.
 */
const SOURCE_WORDS: Readonly<Record<string, string>> = {
  DOC: 'the offer document',
  DRHP: 'the offer document',
  RHP: 'the offer document',
  NSE: 'NSE',
  BSE: 'BSE',
  CHITTORGARH: 'Chittorgarh',
  API_FALLBACK: 'the exchange API',
  ADMIN: 'a manual correction',
  [MULTIPLE_SOURCES]: 'more than one source',
};

function sourceWords(source: string | null): string {
  if (!source) return 'an unnamed source';
  return SOURCE_WORDS[source] ?? source;
}

/** "6 September 2026" — the date a reader would say out loud, not an ISO stamp. */
function readableDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function FieldProvenanceLine({ provenance }: FieldProvenanceLineProps) {
  if (!provenance || !provenance.confirmedAt) return null;

  const date = readableDate(provenance.confirmedAt);

  if (provenance.isStale) {
    return (
      <p className="mt-1 text-xs text-gray-500">
        last confirmed {date}, being rechecked
      </p>
    );
  }

  return (
    <p className="mt-1 text-xs text-gray-600">
      From {sourceWords(provenance.chosenSource)}, confirmed {date}
    </p>
  );
}
