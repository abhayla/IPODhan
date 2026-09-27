// issuer_ratio_yield (#610, #771): one COMPLETED prospectus-family document's
// verdict on the issuer's current ratio.
//
// WHO IS JUDGED. Only documents whose stored extraction was produced by the
// FIXED ratio reader: `document_fetch_state.extractor_version` at or after
// RATIO_FIXED_EXTRACTOR_VERSION. The stored VERSION is compared, never a
// wall-clock date: staging re-read 9 documents at 'extract_filing.py@2026-09-26'
// with the OLD reader, so "extracted after the merge" is not "read by the fix".
// Every older document is PENDING re-read - the version bump re-opens it and the
// pipeline's own re-read replaces its values - and is never a FAIL. Judging a
// pre-fix row against post-fix behaviour is a FAIL no night can clear, pointed
// at an issue that will be closed (signal-ownership.md R5).
//
// #771 round 3 - judged PER DOCUMENT from its own E9 evidence, not from
// `financial_data.current_ratio IS NOT NULL` (that row can come from another
// document, and a has-ratio PASS could never say WHICH period it held):
//   - a value was read: PASS only when `ratioRead.current_ratio.period` equals
//     `latest_statement_period` (the period of the stored net worth / EPS) and
//     the value is within 0-50. A value with no recorded period is a FAIL.
//   - `ratio_note_not_in_document`: PASS only when no page of the document
//     prints a "Current Ratio" line with two or more decimals
//     (`current_ratio_line_pages` empty). Studds and Water Infra claimed "no
//     note" while printing it under headings the reader did not know.
//   - `ratio_row_not_in_note`: a reader gap (Schedule III makes the row
//     mandatory), FAIL.
//   - a NAMED REFUSAL (headings unreadable, count mismatch, latest period not
//     printed, rows disagree, out of range, basis differs, statement period
//     unknown): REFUSED - the reader wrote nothing rather than another period's
//     value, which is the Tier A behaviour. Counted and shown, never a PASS
//     that hides it and never a FAIL no fix can clear.
//   - anything else, including `quick_ratio`'s always-present reason standing
//     in for a missing current-ratio reason: FAIL.

export const RATIO_NOTE_ABSENT = 'ratio_note_not_in_document';

/** First extractor build carrying the #771 round-3 (period-matched) reader. Pinned
 * to the scraper's EXTRACTOR_VERSION by scripts/tests/ratio-yield-verdict.test.mjs. */
export const RATIO_FIXED_EXTRACTOR_VERSION = 'extract_filing.py@2026-09-27';

/** Tracking issue a live FAIL is reported against (signal-ownership.md R2). */
export const RATIO_YIELD_TRACKING_ISSUE = 1179;

/** Reasons the reader gives when it deliberately writes nothing (#771 round 3). */
export const RATIO_REFUSALS = new Set([
  'ratio_period_headings_unreadable',
  'ratio_heading_count_differs_from_value_count',
  'ratio_latest_period_not_in_headings',
  'ratio_rows_disagree_for_latest_period',
  'ratio_value_out_of_range',
  'ratio_basis_differs_from_statement',
  'ratio_statement_period_unknown',
]);

const RATIO_MAX = 50;
const VERSION_PREFIX = 'extract_filing.py@';

/**
 * true when `stored` was produced by the fixed reader. Versions are
 * 'extract_filing.py@YYYY-MM-DD' with an optional letter suffix, so the part
 * after '@' orders correctly as a string. Anything else (null, another
 * extractor) is not fixed.
 */
export function isFixedExtractorVersion(stored, fixed = RATIO_FIXED_EXTRACTOR_VERSION) {
  if (typeof stored !== 'string' || !stored.startsWith(VERSION_PREFIX)) return false;
  return stored.slice(VERSION_PREFIX.length) >= fixed.slice(VERSION_PREFIX.length);
}

function parseEvidence(stepEvidence) {
  if (!stepEvidence) return null;
  if (typeof stepEvidence === 'object') return stepEvidence;
  try {
    return JSON.parse(stepEvidence);
  } catch {
    return null;
  }
}

/**
 * @param {{stepEvidence: string|object|null}} row
 * @returns {{status: 'PASS'|'FAIL'|'REFUSED', cause: string|null}}
 */
export function ratioYieldJudgement({ stepEvidence }) {
  const ev = parseEvidence(stepEvidence);
  const read = ev?.ratioRead?.current_ratio ?? null;
  const reason = ev?.ratioReasons?.current_ratio;
  if (read && read.value !== null && read.value !== undefined) {
    if (!read.period || !read.latest_statement_period) {
      return { status: 'FAIL', cause: 'current_ratio read with no recorded period' };
    }
    if (read.period !== read.latest_statement_period) {
      return { status: 'FAIL', cause: `current_ratio read for ${read.period}, statement period is ${read.latest_statement_period}` };
    }
    if (!(Number(read.value) >= 0 && Number(read.value) <= RATIO_MAX)) {
      return { status: 'FAIL', cause: `current_ratio ${read.value} outside 0-${RATIO_MAX}` };
    }
    return { status: 'PASS', cause: null };
  }
  if (reason === RATIO_NOTE_ABSENT) {
    const pages = Array.isArray(read?.current_ratio_line_pages) ? read.current_ratio_line_pages : null;
    if (pages === null) return { status: 'FAIL', cause: 'no-note claim with no page evidence recorded' };
    if (pages.length > 0) {
      return { status: 'FAIL', cause: `claims no ratio note, but page(s) ${pages.join(',')} print a Current Ratio line` };
    }
    return { status: 'PASS', cause: null };
  }
  if (reason === 'ratio_row_not_in_note') {
    return { status: 'FAIL', cause: 'ratio note found but its Current Ratio row was not read (reader gap: the row is mandatory under Schedule III)' };
  }
  if (typeof reason === 'string' && RATIO_REFUSALS.has(reason)) return { status: 'REFUSED', cause: reason };
  if (typeof reason === 'string' && reason.length > 0) return { status: 'FAIL', cause: `no current_ratio; unaccepted reason "${reason}"` };
  return { status: 'FAIL', cause: 'no current_ratio and no recorded reason' };
}

/**
 * @param {{stepEvidence: string|object|null, extractorVersion: string|null}} row
 * @returns {{status: 'PASS'|'FAIL'|'REFUSED'|'PENDING', cause: string|null}}
 */
export function ratioYieldVerdict({ stepEvidence, extractorVersion }) {
  if (!isFixedExtractorVersion(extractorVersion)) {
    return { status: 'PENDING', cause: `pending re-read (stored at ${extractorVersion ?? 'no recorded version'})` };
  }
  return ratioYieldJudgement({ stepEvidence });
}

/**
 * The check's verdict over its whole population. Only judged (fixed-version)
 * documents can PASS or FAIL it; an all-pending population is UNVERIFIABLE,
 * never PASS - nothing has been judged yet. REFUSED documents are judged and
 * counted, and do not fail the check.
 */
export function summarizeRatioYield(verdicts) {
  const fails = verdicts.filter((v) => v.status === 'FAIL');
  const pending = verdicts.filter((v) => v.status === 'PENDING').length;
  const refused = verdicts.filter((v) => v.status === 'REFUSED').length;
  const judged = verdicts.length - pending;
  const status = judged === 0 ? 'UNVERIFIABLE' : (fails.length === 0 ? 'PASS' : 'FAIL');
  return { status, judged, pending, refused, fails: fails.length };
}
