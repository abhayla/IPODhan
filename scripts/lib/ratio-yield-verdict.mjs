// issuer_ratio_yield (#610, #771): one COMPLETED prospectus-family document's
// verdict on the issuer's current ratio.
//
// PASS needs one of two things, read from THAT field, never from the step's
// whole evidence blob:
//   - a current_ratio on the IPO's financial_data row; or
//   - E9 `ratioReasons.current_ratio === 'ratio_note_not_in_document'` - the
//     document has no ratio note at all, a fact about the document.
//
// #771 measured why the old test (any of three reason tokens anywhere in the
// E9 text) cannot stand: `quick_ratio` ALWAYS carries
// `balance_sheet_inputs_absent:...`, so once E9 carried reasons at all, every
// document would PASS whatever happened to its current ratio. And
// `ratio_row_not_in_note` is not a fact about the document: Schedule III makes
// the current ratio a mandatory row of the note, and on four real prospectuses
// (A-One Steels RHP + DRHP, German Green Steel, Green Asia Impex) that reason
// meant "the reader missed a row that is printed". It is a named FAIL.

export const RATIO_NOTE_ABSENT = 'ratio_note_not_in_document';

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
