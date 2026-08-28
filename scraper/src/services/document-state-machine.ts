/**
 * Per-(IPO, document type) fetch state machine — T-403 WP B.
 *
 * The decision-matrix §7 rules, implemented as PURE functions: every one takes
 * plain rows plus a clock and returns a decision. No network, no database, no
 * `Date.now()` reached for implicitly. That is deliberate — the single most
 * important behaviour in this work package ("an IPO whose documents are all
 * accounted for costs ZERO network calls") is a property of these functions, and
 * it must be provable in a unit test rather than inferred from reading the runner.
 *
 * The defect being removed (RC3): discovery had NO memory. It re-fetched the
 * same NSE payload for every candidate IPO once a day, with a 15 s cap and no
 * retry, and forgot every failure. Skyways' filings were never fetched because
 * the one call it got timed out twice.
 *
 * Companion modules: `document-classifier.ts` (what a link IS),
 * `document-download-verifier.ts` (whether a download is real),
 * `document-discovery-runner.ts` (the network/DB side that consumes this).
 */

import {
  DOCUMENT_PRECEDENCE,
  SUPERSEDING_TYPES,
  type DocumentType,
} from './document-types.js';
import type { LifecycleStage } from '../scheduler/stage-reconciler.js';

export type DocumentFetchStateValue =
  | 'WANTED'
  | 'NOT_YET_FILED'
  | 'FOUND'
  | 'EXTRACTED'
  | 'EXTRACT_FAILED'
  | 'BLOCKED_ALL'
  | 'SUPERSEDED'
  | 'NOT_APPLICABLE';

/** The outcome of trying one document type in one cycle. */
export type AttemptOutcome =
  | 'found' // link present AND the download verified (matrix §3)
  | 'no_link' // the exchange ANSWERED and the field/title was empty — F3
  | 'all_sources_failed' // every source errored/timed out/served a bad file
  | 'not_applicable'; // the type cannot exist for this issue — R9

/** The subset of a `document_fetch_state` row the pure rules reason over. */
export interface StateRow {
  docType: DocumentType;
  state: DocumentFetchStateValue;
  attempts: number;
  nextRetryAt: Date | null;
  blockedSinceAt: Date | null;
  filingDate: string | null;
  extractorVersion: string | null;
  lastAttemptAt: Date | null;
}

// ---------------------------------------------------------------------------
// Stage -> what is due
// ---------------------------------------------------------------------------

/**
 * Document types that BECOME due at each stage (non-cumulative), mirroring
 * decision-matrix §2 and lifecycle-plan §3. `dueDocTypesForStage` accumulates
 * them, so a late-discovered IPO (E1/F14) catches up on everything it missed in
 * one pass instead of only fetching what its current stage introduces.
 */
export const STAGE_DOCUMENT_TYPES: Record<LifecycleStage, DocumentType[]> = {
  // S0: the DRHP exists months before the IPO reaches an exchange board.
  UPCOMING: ['DRHP'],
  // S1/S2: RHP + price band ad + corrigendum, and the anchor report at T-1.
  PRE_OPEN: [
    'RHP',
    'PRICE_BAND_AD',
    'CORRIGENDUM',
    'RATIOS_BASIS_ISSUE_PRICE',
    'ANCHOR_ALLOCATION_REPORT',
  ],
  // S3: addenda appear while the issue is open.
  OPEN: ['ADDENDUM'],
  // S4: the final Prospectus and the basis-of-allotment advertisement.
  CLOSED: ['PROSPECTUS', 'BASIS_OF_ALLOTMENT_AD'],
  // S5: nothing new is filed. Listing data comes from the existing updater.
  LISTED: [],
};

const STAGE_ORDER: LifecycleStage[] = ['UPCOMING', 'PRE_OPEN', 'OPEN', 'CLOSED', 'LISTED'];

/** Every document type due at or before `stage`. */
export function dueDocTypesForStage(stage: LifecycleStage): DocumentType[] {
  const idx = STAGE_ORDER.indexOf(stage);
  const out: DocumentType[] = [];
  for (let i = 0; i <= idx; i++) {
    for (const t of STAGE_DOCUMENT_TYPES[STAGE_ORDER[i]]) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** What we know about the issue that makes some document types impossible. */
export interface IssueShape {
  /** A fixed-price issue has no price band and no anchor round. */
  isFixedPrice?: boolean;
  withdrawn?: boolean;
}

/**
 * R9 — types that CANNOT exist for this issue, and so must be marked
 * NOT_APPLICABLE once and never retried. Retrying a price-band advertisement
 * on a fixed-price issue every 30 minutes forever is a self-inflicted
 * BLOCKED_ALL that would drown the real alerts.
 */
export function notApplicableTypes(issue: IssueShape): DocumentType[] {
  if (issue.withdrawn === true) return [];
  if (issue.isFixedPrice !== true) return [];
  // No band to advertise, and no anchor round in a fixed-price issue.
  return ['PRICE_BAND_AD', 'ANCHOR_ALLOCATION_REPORT'];
}

// ---------------------------------------------------------------------------
// Which states are still open
// ---------------------------------------------------------------------------

export interface CycleOptions {
  /**
   * WP C wires the extractor. Until then FOUND is TERMINAL: the document is on
   * disk and there is nothing further this cycle can do with it, so an IPO whose
   * filings are all FOUND must cost zero network calls. Once extraction is
   * wired, FOUND becomes open again (it is waiting to be read) and the cycle
   * picks it up — no other code changes.
   */
  extractionEnabled?: boolean;
  /** Bumping this re-queues EXTRACTED rows built by an older extractor (R5). */
  extractorVersion?: string;
  now?: Date;
}

/** States that need no further work this cycle. */
export function closedStates(options: CycleOptions = {}): DocumentFetchStateValue[] {
  const closed: DocumentFetchStateValue[] = [
    'EXTRACTED',
    'SUPERSEDED',
    'NOT_APPLICABLE',
    // No automatic retry until extractor_version changes (§7.3) — handled by R5.
    'EXTRACT_FAILED',
  ];
  if (options.extractionEnabled !== true) closed.push('FOUND');
  return closed;
}

/**
 * R5 — an EXTRACTED row whose `extractor_version` is older than the current one
 * is re-queued for extraction exactly once. This is the ONLY case an EXTRACTED
 * row is reprocessed.
 */
export function needsReExtraction(row: StateRow, options: CycleOptions): boolean {
  if (options.extractionEnabled !== true) return false;
  if (!options.extractorVersion) return false;
  if (row.state !== 'EXTRACTED' && row.state !== 'EXTRACT_FAILED') return false;
  return row.extractorVersion !== options.extractorVersion;
}

// ---------------------------------------------------------------------------
// The per-cycle plan
// ---------------------------------------------------------------------------

export interface CyclePlan {
  /** Document types to look for this cycle, in stage order. */
  due: DocumentType[];
  /** Types with no state row yet — the runner creates them as WANTED. */
  missingRows: DocumentType[];
  /** Types to mark NOT_APPLICABLE once (R9). */
  toMarkNotApplicable: DocumentType[];
  /**
   * TRUE when this IPO must be skipped entirely, WITHOUT a single network call.
   * The whole point of the state table (§7.2, "found + read = don't touch").
   */
  skipIpo: boolean;
  reason: string;
}

/**
 * Decide what one IPO costs this cycle.
 *
 * Returns `skipIpo: true` — and an empty `due` — whenever nothing is
 * outstanding, whether that is because everything is accounted for or because
 * every open row's `next_retry_at` is still in the future. The runner MUST make
 * no request at all in that case; that is what makes run 2 of the acceptance
 * run cost zero calls.
 */
export function planIpoCycle(params: {
  stage: LifecycleStage;
  rows: StateRow[];
  issue?: IssueShape;
  options?: CycleOptions;
}): CyclePlan {
  const options = params.options ?? {};
  const now = options.now ?? new Date();
  const issue = params.issue ?? {};

  // R10 / F15: a withdrawn issue stops fetching entirely; documents are kept.
  if (issue.withdrawn === true) {
    return {
      due: [],
      missingRows: [],
      toMarkNotApplicable: [],
      skipIpo: true,
      reason: 'issue withdrawn — fetching stopped, documents retained (F15)',
    };
  }

  const byType = new Map(params.rows.map((r) => [r.docType, r]));
  const closed = new Set(closedStates(options));
  const notApplicable = notApplicableTypes(issue);

  const toMarkNotApplicable = notApplicable.filter(
    (t) => (byType.get(t)?.state ?? 'WANTED') !== 'NOT_APPLICABLE'
  );

  const due: DocumentType[] = [];
  const missingRows: DocumentType[] = [];

  for (const docType of dueDocTypesForStage(params.stage)) {
    if (notApplicable.includes(docType)) continue;

    const row = byType.get(docType);
    if (!row) {
      missingRows.push(docType);
      due.push(docType);
      continue;
    }

    if (closed.has(row.state) && !needsReExtraction(row, options)) continue;

    // Still open — but is it due YET? The retry ladder (§7.3) lives in
    // next_retry_at, so an unexpired backoff means "not this cycle".
    if (row.nextRetryAt && row.nextRetryAt.getTime() > now.getTime()) continue;

    due.push(docType);
  }

  const skipIpo = due.length === 0 && toMarkNotApplicable.length === 0;
  return {
    due,
    missingRows,
    toMarkNotApplicable,
    skipIpo,
    reason: skipIpo
      ? 'nothing due — every document is found or not yet retryable (zero network calls)'
      : `${due.length} document type(s) due at stage ${params.stage}`,
  };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/** Retry cadences, in minutes (§7.3). Named, not magic. */
export const RETRY_MINUTES = {
  /** A filing can appear any time and the call is one cheap API hit. */
  NOT_YET_FILED: 30,
  /** Every cycle for the first 24 h — NSE stalls clear within minutes. */
  BLOCKED_FRESH: 30,
  /** After a day of total failure it is an outage or a wrong link, not a blip. */
  BLOCKED_AGED: 6 * 60,
} as const;

/** How long BLOCKED_ALL stays on the fast ladder before backing off. */
export const BLOCKED_FAST_LADDER_HOURS = 24;

/**
 * When should this row be tried again? Returns null for states that are not
 * retried at all, so a closed row can never be scheduled by accident.
 */
export function computeNextRetryAt(
  state: DocumentFetchStateValue,
  now: Date,
  blockedSinceAt: Date | null = null
): Date | null {
  const plus = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  switch (state) {
    case 'WANTED':
    case 'NOT_YET_FILED':
      return plus(RETRY_MINUTES.NOT_YET_FILED);
    case 'BLOCKED_ALL': {
      const since = blockedSinceAt ?? now;
      const blockedHours = (now.getTime() - since.getTime()) / 3_600_000;
      return plus(
        blockedHours >= BLOCKED_FAST_LADDER_HOURS
          ? RETRY_MINUTES.BLOCKED_AGED
          : RETRY_MINUTES.BLOCKED_FRESH
      );
    }
    default:
      return null;
  }
}

export interface Transition {
  state: DocumentFetchStateValue;
  nextRetryAt: Date | null;
  blockedSinceAt: Date | null;
  /** True the first time BLOCKED_ALL is entered — the P2 alert trigger (§7.3). */
  alert: boolean;
  reason: string;
}

/**
 * Apply one cycle's outcome to one row.
 *
 * NOT_YET_FILED is emphatically NOT a failure: `attempts` still counts the try
 * (it is a record of work done) but nothing is alerted and the row goes back on
 * the 30-minute ladder. Treating "the company has not filed it yet" as an error
 * is what would fill the audit with noise and hide the real BLOCKED_ALL rows.
 */
export function applyOutcome(
  row: StateRow,
  outcome: AttemptOutcome,
  now: Date = new Date()
): Transition {
  switch (outcome) {
    case 'found':
      return {
        state: 'FOUND',
        nextRetryAt: null,
        blockedSinceAt: null,
        alert: false,
        reason: 'link found and download verified',
      };

    case 'not_applicable':
      return {
        state: 'NOT_APPLICABLE',
        nextRetryAt: null,
        blockedSinceAt: null,
        alert: false,
        reason: 'document type cannot exist for this issue (R9)',
      };

    case 'no_link':
      return {
        state: 'NOT_YET_FILED',
        nextRetryAt: computeNextRetryAt('NOT_YET_FILED', now),
        blockedSinceAt: null,
        alert: false,
        reason: 'exchange answered with an empty field — not filed yet (F3), not a failure',
      };

    case 'all_sources_failed': {
      // Keep the ORIGINAL blockedSinceAt so the 24 h ladder measures the outage,
      // not the time since the most recent attempt.
      const blockedSinceAt = row.state === 'BLOCKED_ALL' && row.blockedSinceAt ? row.blockedSinceAt : now;
      return {
        state: 'BLOCKED_ALL',
        nextRetryAt: computeNextRetryAt('BLOCKED_ALL', now, blockedSinceAt),
        blockedSinceAt,
        alert: row.state !== 'BLOCKED_ALL', // P2 once on entry, not every cycle
        reason: 'every source failed',
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Supersession
// ---------------------------------------------------------------------------

export interface SupersessionCandidate {
  docType: DocumentType;
  filingDate: string | null;
  sha256?: string | null;
}

export type SupersessionDecision =
  | { action: 'none'; reason: string }
  | { action: 'update_url_only'; reason: string }
  | { action: 'supersede'; supersededTypes: DocumentType[]; reason: string };

/**
 * Decide what an incoming document does to what we already hold.
 *
 * Ordering is by `filing_date`, NEVER by fetch order (lifecycle-plan E1/E8): a
 * late-discovered IPO fetches its filings newest-first, so "the one that arrived
 * second" is routinely the OLDER document and must not overwrite the newer one.
 *
 * R3 is handled here too: an identical sha256 means the same bytes reached us by
 * a different URL, so nothing is superseded and nothing is re-extracted — only
 * the URL list on the existing row grows.
 */
export function decideSupersession(
  existing: { docType: DocumentType; filingDate: string | null; sha256?: string | null } | null,
  incoming: SupersessionCandidate,
  alsoHeld: DocumentType[] = []
): SupersessionDecision {
  if (existing && incoming.sha256 && existing.sha256 && existing.sha256 === incoming.sha256) {
    return {
      action: 'update_url_only',
      reason: 'identical sha256 — same document via a different URL (R3): no re-download, no re-extract',
    };
  }

  if (existing && existing.docType === incoming.docType) {
    // R4 — same type, different bytes (a re-uploaded RHP). Newer filing wins.
    if (!isStrictlyNewer(incoming.filingDate, existing.filingDate)) {
      return {
        action: 'none',
        reason: `incoming filing_date ${incoming.filingDate ?? '(none)'} is not newer than ${existing.filingDate ?? '(none)'} — kept as-is`,
      };
    }
    return {
      action: 'supersede',
      supersededTypes: [existing.docType],
      reason: 'newer filing of the same type (R4) — old row deactivated',
    };
  }

  // A superseding TYPE arriving supersedes the filings it overrides.
  if (!SUPERSEDING_TYPES.includes(incoming.docType)) {
    return { action: 'none', reason: `${incoming.docType} supersedes nothing` };
  }
  const outranked = alsoHeld.filter(
    (t) => DOCUMENT_PRECEDENCE[t] < DOCUMENT_PRECEDENCE[incoming.docType]
  );
  if (outranked.length === 0) {
    return { action: 'none', reason: `${incoming.docType} outranks nothing currently held` };
  }
  return {
    action: 'supersede',
    supersededTypes: outranked,
    reason: `${incoming.docType} outranks ${outranked.join(', ')} for the fields it carries`,
  };
}

/** True when `a` is a strictly later filing date than `b`. A null date never wins. */
export function isStrictlyNewer(a: string | null, b: string | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return a > b; // ISO 'YYYY-MM-DD' compares correctly lexicographically
}

// ---------------------------------------------------------------------------
// Crash recovery and budgets
// ---------------------------------------------------------------------------

/** R6 — an extraction claimed longer ago than this is assumed to have crashed. */
export const IN_PROGRESS_STALE_MINUTES = 30;

/**
 * R6 — a row left mid-extraction by a crashed process is treated as FOUND again
 * so it is picked up next cycle. No row is ever left stuck.
 */
export function isStaleInProgress(row: StateRow, now: Date = new Date()): boolean {
  if (row.state !== 'FOUND') return false;
  if (!row.lastAttemptAt) return false;
  return now.getTime() - row.lastAttemptAt.getTime() > IN_PROGRESS_STALE_MINUTES * 60_000;
}

/** R12 — the cycle's budgets. Discovery must never starve the 30-minute scrape. */
export const CYCLE_BUDGET = {
  /** Whole-discovery wall-clock ceiling across all IPOs. */
  DISCOVERY_MS: 60_000,
  /** At most one document is EXTRACTED per cycle (WP C). */
  EXTRACTIONS_PER_CYCLE: 1,
} as const;

/**
 * R10 — an IPO listed more than this long ago gets no state rows at all. Its
 * PDFs are already purged (D4) and the live cycle must not go looking for
 * filings that no longer exist; historical gaps are WP F's explicit backfill.
 */
export const LIVE_WINDOW_DAYS_AFTER_LISTING = 10;

export function isInLiveWindow(params: {
  status: string | null;
  listingDate: Date | string | null;
  now?: Date;
}): boolean {
  const status = String(params.status ?? '').toUpperCase();
  if (['UPCOMING', 'OPEN', 'CLOSED'].includes(status)) return true;
  if (status !== 'LISTED') return false;
  if (!params.listingDate) return false;
  const listed =
    params.listingDate instanceof Date ? params.listingDate : new Date(params.listingDate);
  if (Number.isNaN(listed.getTime())) return false;
  const days = ((params.now ?? new Date()).getTime() - listed.getTime()) / 86_400_000;
  return days <= LIVE_WINDOW_DAYS_AFTER_LISTING;
}
