// T-403 WP B — the nightly checks over `document_fetch_state` (decision-matrix
// §7.4 item 4). PURE predicates, no DB and no clock reached for implicitly:
// same convention as scripts/lib/detection-floor-checks.mjs, which these
// deliberately do NOT duplicate (that file owns the round-7 data classes; this
// file owns "did the document machine actually do its job last night").
//
// Each predicate returns null (pass) or a human-readable violation string,
// consumed by scripts/audit-detection-floor.mjs and unit-tested against
// state-row-shaped fixtures in scripts/tests/document-state-checks.test.mjs.
//
// WHY THESE FIVE. The document pipeline can fail in ways that look like success:
// a job that quietly stopped creating state rows, a document downloaded but
// never read, a source blocked for a week with the P2 alert long since scrolled
// off. Each check below turns one of those silences into a nightly FAIL.

/** BLOCKED_ALL past this age is an outage or a wrong link, not a passing blip. */
export const BLOCKED_ALL_MAX_HOURS = 24;

/** A downloaded document nobody read within this window is a stalled extractor. */
export const FOUND_UNREAD_MAX_HOURS = 48;

const hoursBetween = (later, earlier) =>
  (new Date(later).getTime() - new Date(earlier).getTime()) / 3_600_000;

/**
 * FAIL — a document has been blocked on every source for over 24 h.
 *
 * `blockedSinceAt` (not `lastAttemptAt`) is the age that matters: a row retried
 * every 30 minutes has a fresh last-attempt forever, so measuring from it would
 * mean this check could never fire.
 */
export function checkBlockedAllAge(row, now) {
  if (row.state !== 'BLOCKED_ALL') return null;
  const since = row.blockedSinceAt ?? row.lastAttemptAt ?? row.firstSeenAt;
  if (!since) return `${row.docType} is BLOCKED_ALL with no timestamp to age it by`;
  const hours = hoursBetween(now, since);
  if (hours <= BLOCKED_ALL_MAX_HOURS) return null;
  return `${row.docType} BLOCKED_ALL for ${hours.toFixed(1)}h (limit ${BLOCKED_ALL_MAX_HOURS}h)`;
}

/**
 * FAIL — a document was found over 48 h ago and still has not been extracted.
 *
 * Only meaningful once the extractor is wired (WP C): while extraction is off,
 * FOUND is the terminal state by design, so this check would fail every row on
 * day one. `extractionWired` makes that explicit instead of leaving a check that
 * quietly means nothing.
 */
export function checkFoundNotExtracted(row, now, extractionWired = true) {
  if (!extractionWired) return null;
  if (row.state !== 'FOUND') return null;
  const since = row.lastAttemptAt ?? row.firstSeenAt;
  if (!since) return null;
  const hours = hoursBetween(now, since);
  if (hours <= FOUND_UNREAD_MAX_HOURS) return null;
  return `${row.docType} has been FOUND but unread for ${hours.toFixed(1)}h (limit ${FOUND_UNREAD_MAX_HOURS}h)`;
}

/**
 * FAIL — a live IPO has NO state rows at all: the job forgot it entirely.
 *
 * This is the check that catches the whole machine silently stopping. Every
 * other check reads rows the job wrote; only this one notices that it wrote
 * none. UPCOMING is included alongside OPEN because a DRHP is due there.
 */
export const LIVE_STATUSES_REQUIRING_STATE = ['UPCOMING', 'OPEN', 'CLOSED'];

export function checkLiveIpoHasStateRows(ipo) {
  const status = String(ipo.status ?? '').toUpperCase();
  if (!LIVE_STATUSES_REQUIRING_STATE.includes(status)) return null;
  if ((ipo.stateRowCount ?? 0) > 0) return null;
  return `${ipo.companyName} is ${status} with 0 document_fetch_state rows — the job never looked at it`;
}

/** WARN — an extractor that failed 3x needs a human, but is not a data outage. */
export function checkExtractFailed(row) {
  if (row.state !== 'EXTRACT_FAILED') return null;
  return `${row.docType} EXTRACT_FAILED after repeated attempts (extractor_version ${row.extractorVersion ?? 'unset'})`;
}

/**
 * FAIL — we stored fewer lead managers than the BSE payload actually lists.
 *
 * The detection upgrade for the F17 class. The co-BRLM bug (Skyways: 3 in the
 * payload, 2 stored) was invisible for as long as it existed because nothing
 * ever compared the two counts. Storing MORE than BSE lists is not flagged:
 * other sources legitimately add managers BSE omits.
 */
export function checkLeadManagerCount(row) {
  const stored = Number(row.storedLeadManagerCount ?? 0);
  const payload = Number(row.bsePayloadLeadManagerCount ?? 0);
  if (!Number.isFinite(payload) || payload === 0) return null;
  if (stored >= payload) return null;
  return `${row.companyName}: ${stored} lead manager(s) stored but the BSE payload lists ${payload}`;
}

/** Count BRLM + all '#'-separated co-BRLMs in a raw BSE payload pair. */
export function countBsePayloadLeadManagers(brlmField, coField) {
  const count = (field) =>
    String(field ?? '')
      .split('#')
      .map((s) => s.split('^')[0].trim())
      .filter((s) => s !== '').length;
  return count(brlmField) + count(coField);
}

/**
 * FAIL — a stored `documents.type` disagrees with what the classifier says the
 * URL/title is (T-403 M6).
 *
 * The detection upgrade for the mis-classification class. Fixing the classifier
 * only helped documents discovered afterwards; nothing compared the corpus
 * against it, so a Prospectus stored as RHP was invisible. `classifyUrlOrTitle`
 * is injected (the audit runs as plain Node on the box with no TS toolchain, so
 * it cannot import the TypeScript classifier — same convention as this repo's
 * other mirrored constants).
 *
 * Only a REFINEMENT mismatch is a FAIL: an unrelated reclassification is a
 * source/classifier change for a human, and is reported separately by the
 * re-type script rather than paged nightly.
 */
export function checkDocumentTypeMatchesClassifier(row, classifyUrlOrTitle, refinements) {
  const suggested = classifyUrlOrTitle(row.url ?? '', row.title ?? '');
  if (!suggested || suggested === row.type) return null;
  const allowed = (refinements ?? {})[row.type] ?? [];
  if (!allowed.includes(suggested)) return null; // unrelated — not a nightly FAIL
  return `${row.title || row.url}: stored as ${row.type} but classifies as ${suggested}`;
}
// --- M-4: NOT_YET_FILED that has aged past the point of plausibility ---------
//
// THE SHAPE THIS CATCHES. `NOT_YET_FILED` is deliberately not a failure — it
// means the exchange answered and the company has not filed the document yet —
// so nothing about it is alarming on its own. That is exactly what makes it
// dangerous: a document the pipeline can never reach settles here and stays,
// silently, forever. T-403's B-1 was precisely that shape — the SEBI rung could
// never fire for a DRHP, so every DRHP sat NOT_YET_FILED for the life of the
// IPO and no check anywhere would have noticed.
//
// The thresholds are the filing calendar, not round numbers:
//   DRHP        14 d at UPCOMING — a DRHP exists months before the IPO reaches
//               an exchange, so two weeks with none found means we cannot see it
//   RHP          2 d before open — the RHP is filed T-7..T-3; still missing two
//               days out is a real gap (matrix §2 "after T-2 with no RHP = P2")
//   PROSPECTUS   3 d after close — listing is T+3 and a company cannot list
//               before the Prospectus is filed with the RoC (matrix §8 Q1)
//   ANCHOR       1 d after open — the anchor round is T-1; a day into the issue
//               it exists

export const NOT_YET_FILED_MAX_DAYS = {
  DRHP: 14,
  RHP: 2,
  PROSPECTUS: 3,
  ANCHOR_ALLOCATION_REPORT: 1,
};

const daysBetween = (later, earlier) =>
  (new Date(later).getTime() - new Date(earlier).getTime()) / 86_400_000;

/**
 * FAIL when a NOT_YET_FILED row has aged past what its filing calendar allows.
 *
 * Each type is measured from the date that actually governs it — open date for
 * the RHP and the anchor report, close date for the Prospectus, first-seen for
 * the DRHP (which has no exchange milestone). A row whose governing date is
 * missing is SKIPPED rather than guessed at: firing on absent data would train
 * everyone to ignore this check.
 */
export function checkNotYetFiledAge(row, now) {
  if (row.state !== 'NOT_YET_FILED') return null;
  const limit = NOT_YET_FILED_MAX_DAYS[row.docType];
  if (limit === undefined) return null;

  let governingDate = null;
  let label = '';
  if (row.docType === 'DRHP') {
    governingDate = row.firstSeenAt;
    label = 'first seen';
  } else if (row.docType === 'PROSPECTUS') {
    governingDate = row.closeDate;
    label = 'close';
  } else {
    governingDate = row.openDate;
    label = 'open';
  }
  if (!governingDate) return null;

  const age = daysBetween(now, governingDate);
  // Not yet past the milestone at all — nothing is late.
  if (age <= limit) return null;

  return `${row.companyName}: ${row.docType} still NOT_YET_FILED ${age.toFixed(1)}d after ${label} (limit ${limit}d)`;
}
