/**
 * #1165. The ONE place a figure a document PRINTED becomes a number.
 *
 * The prospectus peer-table reader (`scraper/scripts/peer_table_rows.py`) returns
 * every cell as the string the document printed, by design: "converting them is
 * the persister's job". Before this module the persister's `numOrNull` accepted
 * JS numbers only, so every printed figure (`'18.94'`, `'1,19,694.32'`,
 * `'22.85%'`) was dropped and a document peer set was always saved names-only.
 *
 * Rules, each from a printed form measured on the four real RHP/DRHP fixtures
 * or named in #1165:
 *   - a JS number passes through when finite;
 *   - commas are grouping only, Indian (`1,19,694.32`) or Western
 *     (`119,694.32`); a comma inside the decimals is NOT accepted;
 *   - `(3.45)` is negative (accounting brackets); a leading `-`/`−`/`–` before
 *     a digit is negative;
 *   - a trailing `%`, `x` / `times` (ratio suffix) and footnote marks
 *     (`*`, `#`, `^`, `@`, `†`) are dropped; a leading `₹` / `Rs.` / `INR` is dropped;
 *   - a placeholder (`-`, `–`, `—`, `NA`, `N.A.`, `N/A`, `NA#`, `Nil`, `[●]`,
 *     `[.]`, empty) is ABSENT: null with reason `placeholder`;
 *   - anything else is null with reason `unparseable` and the printed text kept,
 *     so the caller can say WHY a value is missing rather than silently drop it.
 */

export type PrintedNumber =
  | { value: string; reason: null; printed: string | number }
  | { value: null; reason: 'absent' | 'placeholder' | 'unparseable'; printed: unknown };

const PLACEHOLDERS = new Set(['', '-', '–', '—', '--', 'na', 'n.a', 'n.a.', 'n/a', 'na#', 'nil', '[●]', '[•]', '[.]', '[]', '●', '•']);

// Grouped (1,19,694.32 / 119,694.32) or plain (119694.32 / .5) digits.
const NUMBER_BODY = /^(?:\d{1,3}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?$/;

export function parsePrintedNumber(v: unknown): PrintedNumber {
  if (v === null || v === undefined) return { value: null, reason: 'absent', printed: v };
  if (typeof v === 'number') {
    return Number.isFinite(v) ? { value: v.toString(), reason: null, printed: v } : { value: null, reason: 'unparseable', printed: v };
  }
  if (typeof v !== 'string') return { value: null, reason: 'unparseable', printed: v };

  let s = v.replace(/\s+/g, ' ').trim();
  if (PLACEHOLDERS.has(s.toLowerCase())) return { value: null, reason: 'placeholder', printed: v };

  s = s.replace(/[*#^@†‡]+$/u, '').trim();
  s = s.replace(/^(?:₹|rs\.?|inr)\s*/i, '');
  let negative = false;
  const bracketed = /^\((.*)\)$/.exec(s);
  if (bracketed) {
    negative = true;
    s = bracketed[1].trim();
  }
  s = s.replace(/\s*(?:%|x|times)$/i, '').trim();
  if (/^[-−–]\s*\d|^[-−–]\s*\.\d/.test(s)) {
    if (negative) return { value: null, reason: 'unparseable', printed: v };
    negative = true;
    s = s.replace(/^[-−–]\s*/, '');
  }
  if (PLACEHOLDERS.has(s.toLowerCase())) return { value: null, reason: 'placeholder', printed: v };
  if (s === '' || !/\d/.test(s) || !NUMBER_BODY.test(s)) return { value: null, reason: 'unparseable', printed: v };

  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return { value: null, reason: 'unparseable', printed: v };
  const signed = negative && n !== 0 ? -n : n;
  return { value: signed.toString(), reason: null, printed: v };
}
