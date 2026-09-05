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
 * NOT YET CALLED BY THE RUNNER, and deliberately so — stated here rather than
 * left to look live (`wire-or-retire`): `decideSupersession` and
 * `isStaleInProgress` are specified and unit-tested in this WP because the
 * contract requires the §7.1 transitions and R1-R13 in full, but both need data
 * this WP does not yet produce. Supersession orders by `filing_date`, which is
 * read OFF the document, and staleness only matters once a FOUND row can be
 * claimed for extraction. Both become live in WP C, against these tests.
 *
 * Companion modules: `document-classifier.ts` (what a link IS),
 * `document-download-verifier.ts` (whether a download is real),
 * `document-discovery-runner.ts` (the network/DB side that consumes this).
 */

import {
  DOCUMENT_PRECEDENCE,
  DOCUMENT_TYPES,
  SUPERSEDING_TYPES,
  type DocumentType,
} from './document-types.js';
import type { LifecycleStage } from '../scheduler/stage-reconciler.js';

export type DocumentFetchStateValue =
  | 'WANTED'
  | 'NOT_YET_FILED'
  // W-28: "we looked and could not find it" — NOT "the issuer has not filed it".
  // W-46: `document_fetch_status` gained a NOT_FOUND member (migration 0044) —
  // this state persists as itself now, no aliasing.
  | 'NOT_FOUND'
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
  // T-403 r5 (4): the rung chain did not finish, so nothing was concluded. Not
  // a failure of the sources (BLOCKED_ALL would alert a P2 about an outage that
  // did not happen) and emphatically not "the company has not filed it" — which
  // is what the old `no_link` downgrade wrote. The row stays WANTED and retries.
  | 'chain_incomplete'
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

/**
 * Types an issuer MAY never file at all (W-28 / spec A6).
 *
 * A corrigendum or an addendum only exists if something needed correcting. Their
 * absence is never evidence of a discovery failure, so a miss on one of these
 * stays NOT_YET_FILED for as long as the issue can still produce one — and once
 * the IPO has LISTED, no further corrigendum or addendum can ever be filed, so
 * the row becomes NOT_APPLICABLE and the IPO stops generating fetches forever
 * (ledger W-40: a listed IPO was still burning a full rung chain every cycle).
 */
export const OPTIONAL_DOCUMENT_TYPES: DocumentType[] = ['CORRIGENDUM', 'ADDENDUM'];

export function isOptionalDocType(docType: DocumentType): boolean {
  return OPTIONAL_DOCUMENT_TYPES.includes(docType);
}

/** True once no further filing of `docType` can ever be made for this issue. */
export function isPermanentlyPastDue(docType: DocumentType, stage: LifecycleStage): boolean {
  return stage === 'LISTED' && isOptionalDocType(docType);
}

/**
 * W-143: has this row EVER been attempted? A never-attempted optional type
 * (no row at all, or a row still sitting at `attempts: 0` in its initial
 * `WANTED` state) must NOT be folded into `notApplicable` on first sight of
 * LISTED — that retires it with zero network calls, zero attempts, forever
 * (the 358-IPO / 0-CORRIGENDUM prod gap). `attempts >= 1` or a prior
 * NOT_YET_FILED/NOT_FOUND answer both mean discovery already asked at least
 * once and came back empty — THAT is the legitimate terminal case.
 */
function hasBeenAttempted(row: StateRow | undefined): boolean {
  if (!row) return false;
  if ((row.attempts ?? 0) >= 1) return true;
  return row.state === 'NOT_YET_FILED' || row.state === 'NOT_FOUND';
}

/**
 * True when the stage says this filing is not DUE yet — the only honest reason
 * to write NOT_YET_FILED (W-28). Everything else that fails to find a filing is
 * a discovery miss, not a statement about what the issuer has done.
 */
export function isNotDueYet(docType: DocumentType, stage: LifecycleStage): boolean {
  return !dueDocTypesForStage(stage).includes(docType);
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
  // A withdrawn issue will never file ANYTHING further, so every type is
  // permanently not applicable (matrix F15). Returning [] here — as the first
  // cut did — meant `planIpoCycle` merely SKIPPED the IPO, leaving any
  // BLOCKED_ALL row blocked forever and the nightly m_blocked_all_age check
  // failing every night with nothing anyone could do about it.
  if (issue.withdrawn === true) return [...DOCUMENT_TYPES];
  if (issue.isFixedPrice !== true) return [];
  // No band to advertise, and no anchor round in a fixed-price issue.
  return ['PRICE_BAND_AD', 'ANCHOR_ALLOCATION_REPORT'];
}

/**
 * Which types a filing we ALREADY HAVE replaces (F-3, matrix "a later filing
 * supersedes").
 *
 * The DRHP is the draft of the RHP and the RHP is the draft of the Prospectus.
 * Once the later one is in hand, chasing the earlier one is not merely wasted —
 * it is actively harmful, because it ends as BLOCKED_ALL and fires a P2 alert.
 * Observed live 2026-08-28: a CLOSED IPO whose RHP was FOUND alerted on its
 * DRHP, because SEBI's draft-filings list no longer shows a June-2026 draft. An
 * alert nobody can act on is noise, and noise is how real alerts get ignored.
 */
export const SUPERSEDED_BY: Partial<Record<DocumentType, DocumentType[]>> = {
  PROSPECTUS: ['RHP', 'DRHP'],
  RHP: ['DRHP'],
};

/** States that mean "we hold this document". */
const HELD_STATES: DocumentFetchStateValue[] = ['FOUND', 'EXTRACTED', 'EXTRACT_FAILED'];

/** Types made moot by a document this IPO already holds (F-3). */
export function supersededTypes(rows: StateRow[]): DocumentType[] {
  const byType = new Map(rows.map((r) => [r.docType, r]));
  const out = new Set<DocumentType>();
  for (const [later, earlier] of Object.entries(SUPERSEDED_BY) as [DocumentType, DocumentType[]][]) {
    const laterRow = byType.get(later);
    if (!laterRow || !HELD_STATES.includes(laterRow.state)) continue;
    for (const t of earlier) {
      const row = byType.get(t);
      // Only rows still being chased. A DRHP we actually hold stays FOUND —
      // supersession closes the HUNT, it does not discard a document.
      if (row && OPEN_STATES.includes(row.state)) out.add(t);
    }
  }
  return [...out];
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

/** The states from which a document may still be fetched. */
export const OPEN_STATES: DocumentFetchStateValue[] = [
  'WANTED',
  'NOT_YET_FILED',
  'NOT_FOUND',
  'BLOCKED_ALL',
];

/**
 * W-46: the `document_fetch_status` DB enum gained a NOT_FOUND member
 * (migration 0044), so every decided state now persists as itself. A
 * decided-vs-persisted split may return for a future state the enum still
 * lacks — `toPersistedState` stays as the single choke point for that
 * mapping (currently the identity function) so the runner's `state_intent`
 * lineage logic (`document-discovery-runner.ts`) needs no change either way.
 */
export type PersistedFetchStateValue = DocumentFetchStateValue;

/** Map a decided state onto a value the `document_fetch_status` enum accepts. */
export function toPersistedState(state: DocumentFetchStateValue): PersistedFetchStateValue {
  return state;
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
   * Types a LATER filing has already replaced, to mark SUPERSEDED once (F-3).
   */
  toMarkSuperseded: DocumentType[];
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

  const byType = new Map(params.rows.map((r) => [r.docType, r]));

  // R10 / F15: a withdrawn issue stops fetching entirely; documents are kept.
  // It must first CLOSE every still-open row, exactly once, or a BLOCKED_ALL row
  // stays blocked forever and the nightly age check fails permanently.
  if (issue.withdrawn === true) {
    const stillOpen = params.rows
      .filter((r) => OPEN_STATES.includes(r.state))
      .map((r) => r.docType);
    return {
      due: [],
      missingRows: [],
      toMarkNotApplicable: stillOpen,
      toMarkSuperseded: [],
      // Skip only once there is nothing left to close — so the marking pass
      // happens on the first cycle after withdrawal and never again.
      skipIpo: stillOpen.length === 0,
      reason:
        stillOpen.length === 0
          ? 'issue withdrawn — fetching stopped, documents retained (F15)'
          : `issue withdrawn — closing ${stillOpen.length} open row(s) as NOT_APPLICABLE (F15)`,
    };
  }
  const closed = new Set(closedStates(options));
  // W-40/A6: once the IPO has LISTED, no corrigendum or addendum can ever be
  // filed. Left out of this list they stayed due forever (they are cumulative
  // from PRE_OPEN/OPEN), so every listed IPO in the live window burned a full
  // four-rung chain per type per cycle for filings that cannot exist.
  const notApplicable = [
    ...notApplicableTypes(issue),
    // W-143: a never-attempted optional type gets ONE real due cycle before
    // being retired — `hasBeenAttempted` is what tells "genuinely never
    // filed" (attempted, came back empty) apart from "never even asked".
    ...dueDocTypesForStage(params.stage).filter(
      (t) => isPermanentlyPastDue(t, params.stage) && hasBeenAttempted(byType.get(t))
    ),
  ];

  const toMarkNotApplicable = notApplicable.filter(
    (t) => (byType.get(t)?.state ?? 'WANTED') !== 'NOT_APPLICABLE'
  );

  // F-3: a later filing in hand closes the hunt for its drafts, BEFORE anything
  // is called due — otherwise the superseded type is fetched, fails, and alerts.
  const superseded = supersededTypes(params.rows);

  const due: DocumentType[] = [];
  const missingRows: DocumentType[] = [];

  for (const docType of dueDocTypesForStage(params.stage)) {
    if (notApplicable.includes(docType)) continue;
    if (superseded.includes(docType)) continue;

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

  const skipIpo =
    due.length === 0 && toMarkNotApplicable.length === 0 && superseded.length === 0;
  return {
    due,
    missingRows,
    toMarkNotApplicable,
    toMarkSuperseded: superseded,
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
  /**
   * A discovery miss (W-28). Slower than NOT_YET_FILED on purpose: nothing about
   * the issue changed, only our search failed, so hammering the same four rungs
   * every 30 minutes buys nothing and costs a full chain per cycle.
   */
  NOT_FOUND: 60,
  /** Every cycle for the first 24 h — NSE stalls clear within minutes. */
  BLOCKED_FRESH: 30,
  /** After a day of total failure it is an outage or a wrong link, not a blip. */
  BLOCKED_AGED: 6 * 60,
} as const;

/**
 * How many consecutive NOT_FOUND cycles before the row is escalated to
 * BLOCKED_ALL and the owner is alerted (W-28). Five hours of "every rung
 * answered and nobody has it" is no longer a transient miss — either the
 * document is somewhere we do not look, or a source's shape changed.
 */
export const NOT_FOUND_MAX_ATTEMPTS = 5;

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
    case 'NOT_FOUND':
      return plus(RETRY_MINUTES.NOT_FOUND);
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
export interface OutcomeContext {
  /** The IPO's lifecycle stage — decides what a miss MEANS (W-28). */
  stage?: LifecycleStage;
}

export function applyOutcome(
  row: StateRow,
  outcome: AttemptOutcome,
  now: Date = new Date(),
  context: OutcomeContext = {}
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

    case 'chain_incomplete':
      return {
        state: 'WANTED',
        nextRetryAt: computeNextRetryAt('WANTED', now),
        // r6 (4): PRESERVED, not cleared. `blockedSinceAt` is the outage clock —
        // the BLOCKED_ALL ladder backs off by it and the nightly
        // `m_blocked_all_age` check ages rows by it. A chain that concluded
        // nothing has learned nothing about the outage either, so resetting the
        // clock here would make a document that has been unreachable for a week
        // look freshly blocked on every cycle it fails to finish.
        blockedSinceAt: row.blockedSinceAt ?? null,
        alert: false,
        reason: 'the rung chain ran short — nothing was concluded, retry (G4)',
      };

    case 'no_link': {
      // W-28. "Every rung answered and none of them had it" is TWO different
      // facts depending on the stage, and the old code wrote the flattering one
      // for both. A DRHP missing on an UPCOMING IPO is a DISCOVERY MISS — the
      // issuer filed it months ago — yet the row said NOT_YET_FILED, which the
      // E12 badge renders as "not filed yet" and the scheduler reads as "just
      // wait". NOT_YET_FILED is now reserved for the two cases where it is true:
      // the stage says the filing is not due yet, and an optional filing the
      // issue may still produce.
      const stage = context.stage;

      if (stage && isPermanentlyPastDue(row.docType, stage)) {
        return {
          state: 'NOT_APPLICABLE',
          nextRetryAt: null,
          blockedSinceAt: null,
          alert: false,
          reason: `${row.docType} can no longer be filed once the IPO has LISTED (A6/W-40) — terminal, no further fetches`,
        };
      }

      const notYetFiled =
        !stage || isNotDueYet(row.docType, stage) || isOptionalDocType(row.docType);
      if (notYetFiled) {
        return {
          state: 'NOT_YET_FILED',
          nextRetryAt: computeNextRetryAt('NOT_YET_FILED', now),
          blockedSinceAt: null,
          alert: false,
          reason: stage
            ? `${row.docType} is not due (or is optional) at stage ${stage} — not filed yet (F3), not a failure`
            : 'exchange answered with an empty field — not filed yet (F3), not a failure',
        };
      }

      // Due at this stage and still not found: a miss, with a backoff ladder and
      // an escalation to BLOCKED_ALL so the owner eventually hears about it
      // rather than the row sitting in a permanently reassuring state.
      const attempts = (row.attempts ?? 0) + 1;
      if (attempts >= NOT_FOUND_MAX_ATTEMPTS) {
        const blockedSinceAt = row.blockedSinceAt ?? now;
        return {
          state: 'BLOCKED_ALL',
          nextRetryAt: computeNextRetryAt('BLOCKED_ALL', now, blockedSinceAt),
          blockedSinceAt,
          alert: row.state !== 'BLOCKED_ALL',
          reason: `${row.docType} is due at stage ${stage} and was not found in ${attempts} attempts — escalated (W-28)`,
        };
      }
      return {
        state: 'NOT_FOUND',
        nextRetryAt: computeNextRetryAt('NOT_FOUND', now),
        // The outage clock is not ours to reset: every rung ANSWERED here, so we
        // learned nothing about any prior outage this row was carrying.
        blockedSinceAt: row.blockedSinceAt ?? null,
        alert: false,
        reason: `${row.docType} is due at stage ${stage} but no source carried it — discovery miss, attempt ${attempts}/${NOT_FOUND_MAX_ATTEMPTS} (W-28)`,
      };
    }

    case 'all_sources_failed': {
      // Keep the ORIGINAL blockedSinceAt so the 24 h ladder measures the outage,
      // not the time since the most recent attempt. r7: read it regardless of
      // the row's PRIOR state, not only when that state was already
      // BLOCKED_ALL — a row that passed through `chain_incomplete` (WANTED)
      // still carries a `blockedSinceAt` clock from before it entered that
      // state (chain_incomplete preserves it too, per the case above), and
      // that clock must survive into BLOCKED_ALL rather than being reset here.
      const blockedSinceAt = row.blockedSinceAt ?? now;
      return {
        state: 'BLOCKED_ALL',
        nextRetryAt: computeNextRetryAt('BLOCKED_ALL', now, blockedSinceAt),
        blockedSinceAt,
        alert: row.state !== 'BLOCKED_ALL', // P2 once on entry, not every cycle
        reason: 'every source failed',
      };
    }
    default: {
      // Not reachable through the type system, but `strict: false` lets an
      // unassigned `outcome` arrive here as undefined — which previously made
      // this function return undefined and the caller throw on `.state`, three
      // frames away from the actual mistake. Fail where the mistake is.
      throw new Error(`applyOutcome: unknown outcome ${String(outcome)}`);
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
 *
 * NOT YET WIRED — WP C consumes this (see the module header). Implemented and
 * tested now because the ordering rule is the part that is easy to get wrong
 * later and expensive to notice: it decides which of two filings wins.
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
 *
 * NOT YET WIRED: nothing claims a FOUND row for extraction until WP C, so there
 * is no in-progress state to recover from yet.
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
