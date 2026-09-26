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
// PASS needs one of two things, read from THAT field, never from the step's
// whole evidence blob:
//   - a current_ratio on the IPO's financial_data row; or
//   - E9 `ratioReasons.current_ratio === 'ratio_note_not_in_document'` - the
//     document has no ratio note at all, a fact about the document.
//
// `quick_ratio` ALWAYS carries `balance_sheet_inputs_absent:...`, so an
// any-token match over E9 would pass every document. `ratio_row_not_in_note`
// is not a fact about the document: Schedule III makes the current ratio a
// mandatory row of the note, and on four real prospectuses (A-One Steels RHP +
// DRHP, German Green Steel, Green Asia Impex) that reason meant "the reader
// missed a row that is printed". It is a named FAIL.
//
// NOT CHECKED, said plainly: the extractor does not record WHICH period the
// stored current_ratio belongs to (no ratio_year), so a has-ratio PASS cannot
// assert "latest printed period". What stands in for it: a judged document was
// read by the fixed reader, which takes the newest period's column (German
// Green Steel's stale 1.03 - an older year - is PENDING re-read, not PASS).

export const RATIO_NOTE_ABSENT = 'ratio_note_not_in_document';

/** First extractor build carrying the #771 ratio reader. Pinned to the scraper's
 * EXTRACTOR_VERSION by scripts/tests/ratio-yield-verdict.test.mjs. */
export const RATIO_FIXED_EXTRACTOR_VERSION = 'extract_filing.py@2026-09-26b';

/** Tracking issue a live FAIL is reported against (#771 closes with this fix;
 * signal-ownership.md R2: a FAIL line names its issue number). */
export const RATIO_YIELD_TRACKING_ISSUE = 1179;

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
 * @param {{hasRatio: boolean, stepEvidence: string|object|null}} row
 * @returns {null | string} null = PASS; otherwise the cause of the FAIL.
 */
export function ratioYieldFailure({ hasRatio, stepEvidence }) {
  if (hasRatio) return null;
  const reason = parseEvidence(stepEvidence)?.ratioReasons?.current_ratio;
  if (reason === RATIO_NOTE_ABSENT) return null;
  if (reason === 'ratio_row_not_in_note') {
    return 'ratio note found but its Current Ratio row was not read (reader gap: the row is mandatory under Schedule III)';
  }
  if (typeof reason === 'string' && reason.length > 0) return `no current_ratio; unaccepted reason "${reason}"`;
  return 'no current_ratio and no recorded reason';
}

/**
 * @param {{hasRatio: boolean, stepEvidence: string|object|null, extractorVersion: string|null}} row
 * @returns {{status: 'PASS'|'FAIL'|'PENDING', cause: string|null}}
 */
export function ratioYieldVerdict({ hasRatio, stepEvidence, extractorVersion }) {
  if (!isFixedExtractorVersion(extractorVersion)) {
    return { status: 'PENDING', cause: `pending re-read (stored at ${extractorVersion ?? 'no recorded version'})` };
  }
  const cause = ratioYieldFailure({ hasRatio, stepEvidence });
  return cause === null ? { status: 'PASS', cause: null } : { status: 'FAIL', cause };
}

/**
 * The check's verdict over its whole population. Only judged (fixed-version)
 * documents can PASS or FAIL it; an all-pending population is UNVERIFIABLE,
 * never PASS - nothing has been judged yet.
 */
export function summarizeRatioYield(verdicts) {
  const fails = verdicts.filter((v) => v.status === 'FAIL');
  const pending = verdicts.filter((v) => v.status === 'PENDING').length;
  const judged = verdicts.length - pending;
  const status = judged === 0 ? 'UNVERIFIABLE' : (fails.length === 0 ? 'PASS' : 'FAIL');
  return { status, judged, pending, fails: fails.length };
}
