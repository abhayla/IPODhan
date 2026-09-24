/**
 * OD-39 — the line under a key-facts block saying where its numbers came from
 * and when that source was read (OD-72: "From the offer document, read 21 Sep 2026").
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
  /** null, or a row with no source, renders nothing — see the file header. */
  provenance: Pick<
    FieldProvenance,
    'chosenSource' | 'chosenDocumentType' | 'confirmedAt'
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * The instant's wall-clock parts in IST (ist-timezone rule: every time a human
 * reads is IST; storage is UTC). Built from the offset, not from a locale's
 * month names: ICU prints "Sept" for en-GB on some runtimes, so a server and a
 * test runner could disagree about the same date.
 */
function istParts(at: Date) {
  const ist = new Date(at.getTime() + (5 * 60 + 30) * 60_000);
  return {
    day: ist.getUTCDate(),
    month: MONTHS[ist.getUTCMonth()],
    year: ist.getUTCFullYear(),
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
  };
}

/** "21 Sep 2026" -- OD-72's wording, the IST calendar date the source was read. */
export function readDateIst(at: Date): string {
  const p = istParts(at);
  return `${p.day} ${p.month} ${p.year}`;
}

/** "10:30 PM, 22 Sep" -- OD-72's wording for the time of a live figure, IST. */
export function figureTimeIst(at: Date): string {
  const p = istParts(at);
  const h12 = p.hours % 12 === 0 ? 12 : p.hours % 12;
  const mm = String(p.minutes).padStart(2, '0');
  return `${h12}:${mm} ${p.hours < 12 ? 'AM' : 'PM'}, ${p.day} ${p.month}`;
}

/**
 * OD-72 (2026-09-23, "Facts, no marker"): the line states only facts -- the
 * source and the date it was READ. No age-based stale marker. A row with a
 * source but no recorded read date (supplied before the read date was stored)
 * names the source and no date: a date nobody recorded is never shown.
 */
export function FieldProvenanceLine({ provenance }: FieldProvenanceLineProps) {
  if (!provenance || !provenance.chosenSource) return null;

  const words = sourceWords(provenance.chosenSource);
  const text = provenance.confirmedAt
    ? `From ${words}, read ${readDateIst(provenance.confirmedAt)}`
    : `From ${words}`;

  return <p className="mt-1 text-xs text-gray-600">{text}</p>;
}

export interface LiveFigureAsAtProps {
  /** Reader-facing name of the figure, e.g. "Subscription". */
  label: string;
  /** The source's own observation time of the figure; null/invalid renders nothing. */
  at: Date | string | null | undefined;
}

/**
 * OD-72: a live bidding figure shows the time of the figure --
 * "Subscription as at 10:30 PM, 22 Sep". The time is the source's observation
 * time (subscriptions.timestamp, W-38), never the time we fetched it.
 */
export function LiveFigureAsAt({ label, at }: LiveFigureAsAtProps) {
  if (!at) return null;
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) return null;
  return (
    <p className="mt-1 text-xs text-gray-600">
      {label} as at {figureTimeIst(when)}
    </p>
  );
}
