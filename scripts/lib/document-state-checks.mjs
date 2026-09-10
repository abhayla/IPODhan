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
/**
 * The name the nightly floor delta will diff on.
 *
 * `scripts/ops/floor-delta.mjs` pulls DOUBLE-QUOTED entities out of a check's
 * detail line and reports which ones are new since last night. A check that
 * names nothing - or names it unquoted - can only ever be reported as SAME, no
 * matter which IPOs are in it. Every violation string in this file goes through
 * here so that cannot happen again (#553).
 *
 * Falls back to the ipo id, then to a literal marker: an unnamed row is still
 * worth diffing, and a quoted "(unnamed ipo)" at least changes when the set of
 * unnamed rows changes.
 */
function entityOf(row) {
  return row?.companyName || row?.ipoId || '(unnamed ipo)';
}

export function checkBlockedAllAge(row, now) {
  if (row.state !== 'BLOCKED_ALL') return null;
  const since = row.blockedSinceAt ?? row.lastAttemptAt ?? row.firstSeenAt;
  if (!since) return `"${entityOf(row)}": ${row.docType} is BLOCKED_ALL with no timestamp to age it by`;
  const hours = hoursBetween(now, since);
  if (hours <= BLOCKED_ALL_MAX_HOURS) return null;
  return `"${entityOf(row)}": ${row.docType} BLOCKED_ALL for ${hours.toFixed(1)}h (limit ${BLOCKED_ALL_MAX_HOURS}h)`;
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
  return `"${entityOf(row)}": ${row.docType} has been FOUND but unread for ${hours.toFixed(1)}h (limit ${FOUND_UNREAD_MAX_HOURS}h)`;
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
  return `"${entityOf(ipo)}" is ${status} with 0 document_fetch_state rows — the job never looked at it`;
}

/**
 * How long a LISTED IPO stays inside the rotation's live window (mirrors
 * `LIVE_WINDOW_DAYS_AFTER_LISTING` in
 * `scraper/src/services/document-state-machine.ts` — kept as a literal here
 * rather than imported so this audit script has zero runtime dependency on
 * the scraper package; a drift between the two is a same-class incident, not
 * silently absorbed).
 */
export const LISTED_ROTATION_WINDOW_DAYS = 10;

/**
 * How long a LISTED IPO's incomplete document_fetch_state rows may go
 * untouched before the audit calls it a stall (round 2, W-136). The document
 * cycle runs every 30 minutes, so 24h is ~48 missed opportunities — never a
 * false positive from ordinary jitter, but far short of the days-long
 * staging stall (ESDS Software, Priority Jewels) this shape exists to catch.
 */
export const STALE_ROTATION_HOURS = 24;

/**
 * FAIL — listed_rotation_stall, two shapes.
 *
 * Shape 1 (2026-09-06, listed-rotation-stall-null-fetch-state):
 * `checkLiveIpoHasStateRows` above deliberately excludes LISTED
 * (`LIVE_STATUSES_REQUIRING_STATE = ['UPCOMING','OPEN','CLOSED']`) because
 * `STAGE_DOCUMENT_TYPES.LISTED` is `[]` — no NEW document type becomes due at
 * LISTED. That reasoning is a detection gap: `dueDocTypesForStage` is
 * CUMULATIVE, so a LISTED IPO still needs every PRE_OPEN/OPEN/CLOSED
 * document (DRHP, RHP, Prospectus, ...) to have been fetched already. A
 * LISTED IPO with `documents` rows on file but ZERO `document_fetch_state`
 * rows is not "nothing due" — it is the ordering bug: `document-cycle.ts`'s
 * LISTED-tier candidate order sorts by
 * `MAX(document_fetch_state.last_attempt_at)` NULLS FIRST, so an IPO with no
 * fetch-state rows at all sorts first every cycle forever, and (before the
 * runner's rotation-stamp guard) could stay that way with no row ever
 * written, starving every LISTED row behind it.
 *
 * Shape 2 (2026-09-06 round 2, W-136 — `runDocumentCycle`'s discovery-budget
 * reservation): shape 1 above only fires when a LISTED IPO has ZERO
 * `document_fetch_state` rows. The staging stall this shape catches (ESDS
 * Software, Priority Jewels) already HAD fetch-state rows — the discovery
 * budget just tripped, cycle after cycle, before the LISTED tier was ever
 * reached, so `runIpo` (which stamps `last_attempt_at`) never ran for them.
 * A LISTED IPO in the live window with at least one incomplete row (state
 * not FOUND/NOT_APPLICABLE/SUPERSEDED, or overdue for retry) whose newest
 * `last_attempt_at` across ALL its rows is more than `STALE_ROTATION_HOURS`
 * old — or null, i.e. never attempted at all — is a stall even though rows
 * exist.
 *
 * Both shapes scoped to the live window (not every historical LISTED IPO —
 * an old, fully-retired listing legitimately has no reason to gain
 * fetch-state activity years later).
 */
export function checkListedRotationStall(ipo) {
  const status = String(ipo.status ?? '').toUpperCase();
  if (status !== 'LISTED') return null;
  const daysSinceListing = Number(ipo.daysSinceListing);
  if (!Number.isFinite(daysSinceListing) || daysSinceListing > LISTED_ROTATION_WINDOW_DAYS) return null;
  const label = `${ipo.companyName ?? ipo.slug} (${ipo.slug ?? 'no-slug'}) is LISTED ${daysSinceListing.toFixed(1)}d ago`;

  if ((ipo.documentsRowCount ?? 0) > 0 && (ipo.stateRowCount ?? 0) === 0) {
    return `${label}, has documents on file, but 0 document_fetch_state rows — rotation stall (listed_rotation_stall)`;
  }

  if ((ipo.incompleteRowCount ?? 0) >= 1) {
    const hoursSinceLastAttempt = ipo.hoursSinceLastAttempt === null || ipo.hoursSinceLastAttempt === undefined
      ? null
      : Number(ipo.hoursSinceLastAttempt);
    const stale = hoursSinceLastAttempt === null || !Number.isFinite(hoursSinceLastAttempt) || hoursSinceLastAttempt > STALE_ROTATION_HOURS;
    if (stale) {
      const lastTouched = hoursSinceLastAttempt === null ? 'never' : `${hoursSinceLastAttempt.toFixed(1)}h ago`;
      return `${label}, has ${ipo.incompleteRowCount} incomplete document_fetch_state row(s), last touched ${lastTouched} (> ${STALE_ROTATION_HOURS}h) — rotation stall (listed_rotation_stall)`;
    }
  }

  return null;
}

/** WARN — an extractor that failed 3x needs a human, but is not a data outage. */
export function checkExtractFailed(row) {
  if (row.state !== 'EXTRACT_FAILED') return null;
  return `"${entityOf(row)}": ${row.docType} EXTRACT_FAILED after repeated attempts (extractor_version ${row.extractorVersion ?? 'unset'})`;
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
  return `"${entityOf(row)}": ${stored} lead manager(s) stored but the BSE payload lists ${payload}`;
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
  return `"${row.title || row.url}": stored as ${row.type} but classifies as ${suggested}`;
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

  return `"${entityOf(row)}": ${row.docType} still NOT_YET_FILED ${age.toFixed(1)}d after ${label} (limit ${limit}d)`;
}

// --- M-6 (r6): NOT_YET_FILED written on a chain in which nobody answered -----
//
// THE SHAPE THIS CATCHES, and why it is not covered by any check above.
// `m_not_yet_filed_age` fires when an absence has aged past its filing calendar
// — days later. This one fires the FIRST night, on the evidence itself: a row
// that claims "the company has not filed it" while its own recorded rung chain
// shows that not one source ANSWERED the question. That is the exact shape of
// T-403's Class 1, found four rounds running: r3 (SEBI failures returned null),
// r4 (a 503 written as "not filed"), r5-review (budget refusals returning
// 'absent'), r6 (an unsettled `no_link` inherited through an escalation whose
// every rung was skipped). Each fix removed the instances that were visible; the
// next round found another. A nightly check does not care which door it came
// through.
//
// SCOPE. Only types the exchanges cannot serve. For an exchange-served type a
// clean `EXCHANGES:no_link` from complete coverage IS the evidence, and flagging
// it would fire on every legitimately-unfiled document in the system.

/**
 * Mirror of `EXCHANGE_SERVED_TYPES` in
 * scraper/src/services/document-types.ts, inverted: the exchanges list an issue
 * only once it reaches a board, and the DRHP predates that. Mirrored (not
 * imported) because the audit runs as plain Node on the VPS with no TypeScript
 * toolchain — same convention as this file's other mirrored constants — and
 * pinned by its self-test so the mirror cannot drift unnoticed.
 */
export const EXCHANGE_UNSERVED_DOC_TYPES = ['DRHP'];

/** Rung sources whose answer says nothing about a type the exchanges cannot serve. */
const OUT_OF_SCOPE_RUNG_SOURCES = ['EXCHANGES'];

/**
 * A rung is skipped once the exchanges have already settled the question for
 * this cycle — that skip is itself the answer, not a gap. Mirrors the runner's
 * `*:skipped:exchanges_settled_it` rungs (document-discovery-runner.ts).
 */
const EXCHANGES_SETTLED_SKIP_VERDICT = 'skipped:exchanges_settled_it';

/**
 * Verdicts that mean a rung ANSWERED the question — an explicit allow-list
 * (r7), not "anything that isn't failed/skipped" (r6's shape, which counted an
 * unrecognised label as an answer by default — the false-PASS direction).
 * Mirrors every non-skip/non-failed outcome `rungs.push`ed in
 * document-discovery-runner.ts: `found`, `not_listed`, `no_link`,
 * `found_via_corrected_link`, `no_new_link`. A new answered label added to the
 * runner without being added here is a SKIP miss, not a silent PASS — the safe
 * failure direction for a detection check.
 */
const ANSWERED_RUNG_VERDICTS = ['found', 'not_listed', 'no_link', 'found_via_corrected_link', 'no_new_link'];

/** Parse a `rungs[<docType>]: A:v -> B:v -> ...` chain into `{source, verdict}` tokens. */
function parseChainTokens(chain) {
  const body = String(chain).replace(/^rungs\[[^\]]*\]:\s*/, '');
  return body
    .split('->')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map((token) => {
      const idx = token.indexOf(':');
      return {
        source: idx === -1 ? token : token.slice(0, idx),
        verdict: idx === -1 ? '' : token.slice(idx + 1),
      };
    });
}

/**
 * Pull the `rungs[<docType>]: ...` line this cycle wrote for one document type
 * out of a `document_fetch_state.last_attempt` payload. Returns null when the
 * row carries no chain for that type — a row we cannot judge, never a FAIL.
 */
export function chainFromLastAttempt(lastAttempt, docType) {
  let attempts = lastAttempt;
  if (typeof attempts === 'string') {
    try {
      attempts = JSON.parse(attempts);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(attempts)) return null;
  const prefix = `rungs[${docType}]`;
  const hit = attempts.find(
    (a) => a && a.source === 'CHAIN' && String(a.outcome ?? '').startsWith(prefix)
  );
  return hit ? String(hit.outcome) : null;
}

/**
 * The rungs in a chain that ANSWERED — an explicit allow-list of verdicts
 * (`ANSWERED_RUNG_VERDICTS`), never "neither skipped nor failed" (see that
 * constant's comment for why the allow-list direction is the safe one).
 */
export function answeredRungsIn(chain) {
  return parseChainTokens(chain)
    .filter((r) => !OUT_OF_SCOPE_RUNG_SOURCES.includes(r.source))
    .filter((r) => ANSWERED_RUNG_VERDICTS.includes(r.verdict));
}

/**
 * FAIL — the row claims the document is not filed, and its own chain shows that
 * nobody who could have known was ever able to answer.
 *
 * SCOPE (r7): by CHAIN SHAPE, not by `row.docType` membership in
 * `EXCHANGE_UNSERVED_DOC_TYPES`. r6 scoped this check to DRHP only, on the
 * theory that an exchange-served type's own `EXCHANGES:no_link` from complete
 * coverage IS the evidence — true, but it silently exempted every OTHER
 * doc type from ever being checked, even when its non-EXCHANGES rungs also
 * all skipped or failed (a CORRIGENDUM or RHP can hit the same unconstructible
 * shape the DRHP did). The chain itself already says whether the exchanges
 * settled it: a `*:skipped:exchanges_settled_it` rung on a non-EXCHANGES
 * source means the exchanges answered and everything else stood down on
 * purpose — that is a PASS regardless of doc type. Any other all-skipped/
 * all-failed chain is the same unobserved-absence shape T-403 keeps finding,
 * whatever the doc type.
 */
export function checkAbsenceWithoutEvidence(row) {
  if (row.state !== 'NOT_YET_FILED') return null;
  const chain = row.chain ?? chainFromLastAttempt(row.lastAttempt, row.docType);
  if (!chain) return null; // nothing recorded to judge — skipped, never guessed
  const inScopeRungs = parseChainTokens(chain).filter((r) => !OUT_OF_SCOPE_RUNG_SOURCES.includes(r.source));
  if (inScopeRungs.length === 0) return null; // nothing to judge
  if (answeredRungsIn(chain).length > 0) return null;
  if (inScopeRungs.some((r) => r.verdict === EXCHANGES_SETTLED_SKIP_VERDICT)) return null;
  return `"${entityOf(row)}": ${row.docType} is NOT_YET_FILED but no rung answered — ${chain}`;
}

/**
 * Cadence D-13 / cycle-overrun RCA (2026-09-06 observed 1,210-1,278s document
 * cycles): the document cycle's discovery+extraction budgets used to be
 * independent, so a cycle could run past a healthy wake length with nothing
 * failing loudly — the cycle just quietly ran long, or a second wake started
 * before the first one finished (PM2's `cron_restart` force-restarts, it does
 * not wait). This is the DETECTION half of that fix: it reads the SAME
 * `scraper_steps` step-ledger rows `k_step_ledger_silence` already reads
 * (`step = 'primarySourceDiscovery'`, one row per wake, `durationMs` +
 * `createdAt` written by `index.ts`'s `runStep` wrapper) and fails when a
 * cycle ran too long, or when two cycles' wall-clock windows overlapped.
 *
 * Pure — no DB, no clock reached implicitly (`now` is never read here; every
 * timestamp comes from the rows). `createdAt` is written AFTER the step
 * function resolves, so it is the step's END time; `durationMs` recovers the
 * start.
 */
export const CYCLE_OVERRUN_MAX_MS = 25 * 60 * 1000;

/**
 * @param {Array<{ cycleId: string, createdAt: string | Date, durationMs: number }>} rows
 *   `primarySourceDiscovery` step-ledger rows for the audit window, any order.
 * @returns {string | null} null (pass) or a human-readable violation string.
 */
export function checkCycleOverrun(rows) {
  if (!rows || rows.length === 0) return null;

  const tooLong = rows.filter((r) => r.durationMs > CYCLE_OVERRUN_MAX_MS);

  const sorted = [...rows]
    .map((r) => ({ ...r, endMs: new Date(r.createdAt).getTime(), startMs: new Date(r.createdAt).getTime() - r.durationMs }))
    .sort((a, b) => a.startMs - b.startMs);
  const overlaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.cycleId !== cur.cycleId && cur.startMs < prev.endMs) {
      overlaps.push(`${prev.cycleId} (ended ${new Date(prev.endMs).toISOString()}) overlapped ${cur.cycleId} (started ${new Date(cur.startMs).toISOString()})`);
    }
  }

  if (tooLong.length === 0 && overlaps.length === 0) return null;

  const parts = [];
  if (tooLong.length > 0) {
    parts.push(
      `${tooLong.length} cycle(s) exceeded ${CYCLE_OVERRUN_MAX_MS / 60_000}min: ` +
        tooLong.map((r) => `${r.cycleId}=${(r.durationMs / 1000).toFixed(0)}s`).join(', ')
    );
  }
  if (overlaps.length > 0) {
    parts.push(`${overlaps.length} overlapping wake(s): ${overlaps.join('; ')}`);
  }
  return parts.join(' | ');
}

/** A required doc type stuck in extraction is a data outage past this age. */
export const EXTRACTION_STUCK_MAX_HOURS = 48;

/** Prospectus-chain document types that gate the pipeline — a filing everyone
 * downstream (financials, valuation, risk factors) waits on. */
export const REQUIRED_EXTRACTION_DOC_TYPES = new Set(['DRHP', 'RHP', 'PROSPECTUS']);

const LIVE_EXTRACTION_STATUSES = new Set(['UPCOMING', 'OPEN', 'CLOSED', 'LISTED']);

/** `documents.extraction_error` marker set by filing-auto-persist's hard-failure
 * escalation ladder (`HARD_FAILURE:<n>:<original error>`, see
 * scraper/src/services/filing-auto-persist.ts HARD_FAILURE_MARKER). */
const HARD_FAILURE_MARKER = 'HARD_FAILURE';

/**
 * Mirror of `MAX_EXTRACTION_ATTEMPTS` in
 * `scraper/src/services/filing-auto-persist.ts` — the retry ladder's own
 * ceiling, above which a document is parked in MANUAL_REVIEW (already caught
 * by the `isManualReview` shape below). Mirrored, not imported, for the same
 * reason every other constant in this file is: this audit runs as plain Node
 * with no TypeScript toolchain.
 */
export const MAX_EXTRACTION_ATTEMPTS = 10;

/**
 * How many consecutive FAILED cycles without escalation is itself the
 * anomaly (#396). One retry is routine; two is still ordinary backoff; three
 * with no HARD_FAILURE marker means the ordinary hard-failure ladder
 * (`hardFailureCount >= 2` triggers the 24h floor per
 * `documentExtractionBlocked`) never engaged even though the document keeps
 * failing — the exact gap a spawn-level error (ETIMEDOUT on the spawn call
 * itself, not the extractor process) fell through before commit `3c11ba12`.
 */
export const NEVER_ESCALATES_MIN_RETRIES = 3;

/**
 * FAIL — a required document type (DRHP/RHP/PROSPECTUS) on a LIVE-window IPO
 * is stuck in extraction with nothing surfacing it.
 *
 * RCA (round 5, #333 follow-up): two ETIMEDOUTs hit the 24h floor, the retry
 * ladder ran out at 10 attempts, and the row landed in `MANUAL_REVIEW` — a
 * state nothing FAIL-level ever watches. `m_extract_failed`
 * (`checkExtractFailed`) is WARN-only and keys ONLY off
 * `document_fetch_state.state === 'EXTRACT_FAILED'`; it is blind to
 * `documents.extraction_status === 'MANUAL_REVIEW'` entirely, and blind to a
 * `documents.extraction_status === 'FAILED'` row stuck behind a
 * `HARD_FAILURE:<n>:` marker (filing-auto-persist's own escalation ladder) —
 * `grep -rn MANUAL_REVIEW scripts/` was empty before this check.
 *
 * 4th shape (T-494, #396): a document can also fail repeatedly WITHOUT ever
 * tripping the `HARD_FAILURE:` marker at all — issue #396's `spawnSync nice
 * ETIMEDOUT` is thrown by the spawn call before `defaultExtractorRunner` ever
 * sets `hardFailure` (pre-`3c11ba12` SHA), so `documentExtractionBlocked`
 * keeps the document on the ordinary 6h-capped exponential backoff forever:
 * `retryCount` climbs (6->7 across six cycles, per the pm2 log), the row
 * never reaches MANUAL_REVIEW (that needs `retryCount` past
 * `MAX_EXTRACTION_ATTEMPTS`, i.e. 10) and never reaches the 24h hard floor
 * (that needs a `HARD_FAILURE:` marker this error path never writes) — so
 * neither of the first three shapes above, nor `m_extract_failed`, nor
 * `checkStepConsecutiveFailures` (keyed on named post-scrape STEPS, not
 * per-document rows) can see it. The DB keeps only the LATEST error text and
 * a monotonic `retryCount`, not a per-cycle history, so this shape reads
 * `retryCount` itself as the evidence of repetition (it only increments on a
 * FAILED/IN_PROGRESS cycle for THIS document and only resets on COMPLETED —
 * `filing-auto-persist.ts`'s retry ladder) rather than re-deriving "same
 * error text" from attempts the row no longer carries.
 *
 * Takes ONE row per (ipo, required doc type) already carrying BOTH signals —
 * the `documents.extraction_status`/`extraction_error`/`retry_count` triple
 * AND the sibling `document_fetch_state.state` for the same (ipo, doc_type),
 * left-joined by the caller's query. Any of the four stuck shapes, older than
 * EXTRACTION_STUCK_MAX_HOURS by the UTC-parsed `hoursSinceUpdate`, FAILs.
 */
export function checkExtractionStuck(row) {
  const ipoStatus = String(row.ipoStatus ?? '').toUpperCase();
  if (!LIVE_EXTRACTION_STATUSES.has(ipoStatus)) return null;
  const docType = String(row.docType ?? '').toUpperCase();
  if (!REQUIRED_EXTRACTION_DOC_TYPES.has(docType)) return null;

  const extractionStatus = row.extractionStatus ?? null;
  const fetchState = row.fetchState ?? null;
  const extractionError = row.extractionError ?? '';
  const retryCount = row.retryCount === null || row.retryCount === undefined ? NaN : Number(row.retryCount);

  const isManualReview = extractionStatus === 'MANUAL_REVIEW';
  const isFetchStateFailed = fetchState === 'EXTRACT_FAILED';
  const hasHardFailureMarker =
    typeof extractionError === 'string' && extractionError.startsWith(`${HARD_FAILURE_MARKER}:`);
  const isHardFailure = extractionStatus === 'FAILED' && hasHardFailureMarker;
  const isNeverEscalating =
    extractionStatus === 'FAILED' &&
    !hasHardFailureMarker &&
    Number.isFinite(retryCount) &&
    retryCount >= NEVER_ESCALATES_MIN_RETRIES &&
    retryCount < MAX_EXTRACTION_ATTEMPTS;

  if (!isManualReview && !isFetchStateFailed && !isHardFailure && !isNeverEscalating) return null;

  const hours = row.hoursSinceUpdate === null || row.hoursSinceUpdate === undefined ? null : Number(row.hoursSinceUpdate);
  if (hours === null || !Number.isFinite(hours) || hours <= EXTRACTION_STUCK_MAX_HOURS) return null;

  const shape = isManualReview
    ? 'MANUAL_REVIEW'
    : isFetchStateFailed
      ? 'EXTRACT_FAILED'
      : isHardFailure
        ? `FAILED (${HARD_FAILURE_MARKER})`
        : `FAILED (never-escalates, retryCount=${retryCount})`;
  const label = row.companyName ?? row.slug ?? row.ipoId ?? 'unknown IPO';
  return `${label}: ${docType} stuck ${shape} for ${hours.toFixed(1)}h (> ${EXTRACTION_STUCK_MAX_HOURS}h) — needs-decision`;
}
