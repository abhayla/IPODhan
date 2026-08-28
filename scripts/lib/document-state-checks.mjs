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
