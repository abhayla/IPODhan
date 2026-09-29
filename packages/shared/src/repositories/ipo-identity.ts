/**
 * IPO identity resolution — the SINGLE source of truth for "which row is this?"
 *
 * Extracted (T-307, write-path hardening Phase 1 — see
 * docs/architecture/write-path-hardening.md §1.4 and §2(a) step 1) from
 * data-persister.ts, where three independent hand-copies of this lookup had
 * drifted: the guard (BaseScraperOrchestrator) and the two write paths
 * (data-persister.upsertIPO, DataConsolidationOrchestrator) each carried
 * their own two- or three-tier version, kept "in sync" only by a comment.
 * When T-293 added a fuzzy (typo) tier to the write path only, the guard
 * silently stopped seeing rows the write still hit — protection was skipped
 * on exactly the rows the write updated.
 *
 * This is now the ONLY place the tiered logic exists. Every caller (guard or
 * write) gets the identical resolution, in the identical order. Do not
 * change the order or the fuzzy threshold without updating every caller's
 * shared behaviour — see the plan's B7 correction: there is deliberately no
 * `mode` parameter, because two independently-chosen modes is exactly how
 * this bug reopened.
 *
 * T-318 (IDENT — NULL-safe key-first identity, converged build order step 2
 * per docs/architecture/fable-review-2026-08-24.md §5): natural exchange
 * keys (ISIN, then NSE/BSE symbol) are now tried BEFORE name-based matching.
 * Binding design constraints (T-314C/T-316C findings, carried in this
 * task's contract):
 *   - NULL is NEVER a key value. An absent/empty isin or symbol on either
 *     side must never be treated as a match — Postgres permits many NULLs
 *     in a "unique" column, and 962/962 measured "symbol conflicts" in prod
 *     turned out to be 100% NULL-on-one-side, not genuine disagreements.
 *   - `bse_scrip_code` is a SEPARATE keyspace from the NSE/BSE `symbol`
 *     column and is NEVER cross-compared against it (this resolver does not
 *     query `bseScripCode` at all — see `findBySymbol`'s doc comment).
 *   - 69/303 production rows have NEITHER symbol NOR isin (measured,
 *     T-314C/T-317). Name-based matching stays as the TAIL of the priority
 *     chain specifically so those keyless rows keep resolving — it is not
 *     legacy code to delete, it is the fallback for ~23% of the table.
 *   - A key-tier hit and a name-tier hit that disagree (point to two
 *     DIFFERENT existing rows) MUST NOT be silently resolved either way in
 *     this phase — log a structured `identity_conflict` warning and fall
 *     back to the pre-T-318 name-based result, so no data silently moves
 *     rows. See `resolveIpoRow`'s conflict-detection step below.
 */
import { logger } from '../logger';
import { foldCompanyIdentity } from '../utils/company-identity-fold.js';
import {
  stripIdentityNameDecoration,
  stripIdentitySlugSuffix,
  strictIdentityCompanyName,
} from '../utils/identity-decoration';
import { normalizeCompanyNameForMatching } from '../utils/company-name-normalizer';
import { normalizeCin } from '../utils/cin';
import { generateIPOSlug } from '../utils/slug';
import { classifyPrefixBoundary } from './ipo-repository';
import type { IPORepository } from './ipo-repository';
import type { IPO, IPOWithRelations } from './types';

export { IdentityHeldForReviewError } from '../errors/repository-errors';
import { IdentityHeldForReviewError } from '../errors/repository-errors';
import {
  resolveBySourceKeys,
  planSourceKeyWrite,
  findDisputedKeysOnRow,
  normalizeSourceKeyValue,
  normalizeSourceKeyRefs,
  SourceKeyDuplicateError,
  SourceKeySupersededError,
  type SourceKeyRef,
} from './ipo-source-keys';
import { noteSourceKeyBind } from './source-key-lineage';

/**
 * LIGHT normalization for boundary-kind classification only (T-403 item 2)
 * — lowercase + trim + collapse whitespace, and NOTHING else. Deliberately
 * NOT `normalizeCompanyNameForMatching`: that normalizer folds hyphens,
 * parentheses, and periods to spaces (so "Indo-MIM" and "INDO MIM" agree for
 * DEDUP matching), which would erase the very punctuation this boundary
 * check needs to see — "Rays of Belief Limited- For Profit Social
 * Enterprise" would misclassify as a WHITESPACE boundary instead of the
 * PUNCTUATION boundary it actually is, wrongly demanding both corroborating
 * keys for the flagship W-108 case. Boundary classification therefore
 * always runs on the RAW company names, lightly cased/trimmed only.
 */
function lightNormalizeForBoundaryCheck(companyName: string): string {
  return companyName.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Normalize an open-date value (a `Date` object, an ISO string, or a bare
 * `YYYY-MM-DD` string) to its calendar-date string for tier 3b corroboration
 * (W-108b). `Date -> toISOString().slice(0, 10)` takes the UTC calendar day
 * (this codebase's UTC-date convention — see the module doc comment); a
 * string is truncated to its first 10 characters so an ISO-with-time value
 * ('2026-09-01T18:30:00.000Z') and a bare date ('2026-09-01') that name the
 * same UTC day compare equal. `null`/`undefined` pass through unchanged so
 * callers can still null-guard before comparing.
 *
 * T-403 Tier-A review (item 6): this UTC-calendar-day convention is
 * intentional and codebase-wide, not a local choice — every write path
 * stores naive timestamps as true UTC (`options: '-c timezone=UTC'` on every
 * pool) and every read normalizes them back via
 * `configureUtcTimestampParsing()` (see
 * `.claude/rules/utc-naive-timestamp-normalization.md`). A `Date` built from
 * IST-local wall-clock components (rather than an already-UTC instant) would
 * map to the PREVIOUS UTC day here — that is a caller bug (constructing the
 * `Date` wrong), not a bug in this function, so the slice-based conversion
 * is left as-is.
 */
function toCalendarDateString(value: string | Date | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

export interface IpoIdentity {
  /** Raw (un-normalized) company name — carried through for log context only. */
  companyName: string;
  /** normalizeCompanyNameForMatching(companyName) — computed by the caller. */
  normalizedName: string;
  /** generateSlug(companyName) — computed by the caller. */
  slug: string;
  /**
   * Raw (un-normalized) ISIN, when the caller has one. Optional/nullable —
   * absent for the ~23% of rows with no natural key. Normalized (trim +
   * uppercase) inside `findByIsin`, never here, so every caller normalizes
   * identically.
   */
  isin?: string | null;
  /**
   * Raw (un-normalized) NSE/BSE ticker symbol, when the caller has one.
   * Optional/nullable, same reasoning as `isin`. This is deliberately the
   * exchange `symbol` field — NEVER a BSE scrip code, which is a separate
   * keyspace (see module doc comment).
   */
  symbol?: string | null;
  /**
   * Incoming open_date (YYYY-MM-DD), when the caller has one. Used ONLY as a
   * corroborating key for tier 3b (W-108, prefix-name matching) — never a
   * primary identity key on its own. Optional/nullable: a caller that omits
   * it simply cannot corroborate via this key (price_range_min may still
   * corroborate) — see `resolveIpoRow`.
   */
  openDate?: string | Date | null;
  /**
   * Incoming price_range_min (integer, whole rupees), when the caller has
   * one. Same role as `openDate`: a corroborating key for tier 3b only.
   */
  priceRangeMin?: number | null;
  /**
   * Incoming price_range_max, when the caller has one. Used only by the §9.2 item 26 corroboration
   * of an admin-removed identifier: when both sides know both bounds, both must match (MINOR-C).
   */
  priceRangeMax?: number | null;
  /**
   * Incoming exchange segment ('MAINBOARD' | 'SME'), when the caller has
   * one. T-403 Tier-A review (item 3): name/prefix/fuzzy matching alone
   * cannot tell an SME and a mainboard offering of the same name apart — two
   * genuinely different companies can list the same day with the same name.
   * When BOTH the incoming identity and a candidate row have a segment set
   * and they DISAGREE, the candidate is dropped from every name-based tier
   * (3, 3b, 4 slug, 5 fuzzy) below. A `null`/`undefined` segment on either
   * side never excludes a candidate — it simply cannot corroborate or
   * contradict.
   */
  segment?: 'MAINBOARD' | 'SME' | null;
  /**
   * Incoming offering_type ('IPO' | 'OFS' | ...), when the caller has one.
   * T-478 round 2 (issue #225 follow-up, the T-292/Mopshop class): an OFS
   * record must resolve ONLY to an existing OFS row, and an IPO record must
   * never resolve to an existing OFS row — without this guard, tier 2
   * (symbol) or a name tier can match a listed company's genuine IPO row to
   * an incoming OFS scrape, and the write path's
   * `resolveOfferingTypeKeepingClassification` (which protects only a
   * non-IPO existing value from being demoted BACK to IPO) then flips the
   * real IPO row to OFS, stomping its dates/prices/status. A `null`/
   * `undefined` offeringType on either side is "no information" and never
   * excludes a candidate — same posture as `segment`.
   */
  offeringType?: string | null;
  /**
   * Incoming Corporate Identification Number (MCA, 21 characters), when the
   * caller has one. OD-34 step 1 (§2.3.3.2): the strongest identifier, tried
   * before every other step. Normalised here (whitespace removed, upper-cased);
   * anything that is not 21 alphanumerics after that is treated as absent.
   */
  cin?: string | null;
  /**
   * OD-85 (§2.3.3.2 "Source record keys"): the source's own OFFERING-level record numbers this
   * record carries (BSE IPO_NO, Chittorgarh page id, NSE SYMBOL|SERIES). Tried BEFORE every other
   * step; a hit is re-checked against the row. Absent/empty = the pre-OD-85 order, unchanged.
   */
  sourceKeys?: SourceKeyRef[] | null;
}

/**
 * OD-69: a candidate whose stored CIN is known and differs from the incoming
 * one is a different company, whatever its name, slug or symbol says. An
 * absent CIN on either side neither proves nor refutes.
 */
function cinContradiction(incomingCin: string | null, candidateCin: unknown): string | null {
  if (!incomingCin) return null;
  const stored = normalizeCin(typeof candidateCin === 'string' ? candidateCin : null);
  return stored && stored !== incomingCin ? `CIN differs (${incomingCin} vs ${stored})` : null;
}

/**
 * OD-35: two KNOWN offering types that differ are two offerings of one
 * company (a rights issue, a buyback, an OFS is never written into the IPO
 * row) — this includes IPO <-> FPO: OD-35's own text is explicit ("Same
 * identifier, offering type changes (IPO -> FPO, IPO -> rights) | new row"),
 * so this CIN-step guard does not exempt that pair. This function is used
 * ONLY by `resolveByCin` (the CIN step) — the unrelated write-path
 * reclassification helper `guardSmeOfferingTypeAgainstFpo` is untouched by
 * this change and keeps its own IPO<->FPO handling.
 */
function separateOffering(
  identityOfferingType: string | null | undefined,
  candidateOfferingType: string | null | undefined
): boolean {
  if (!identityOfferingType || !candidateOfferingType) {
    return false;
  }
  return identityOfferingType !== candidateOfferingType;
}

/**
 * True when exactly one side of the match is OFS — an OFS record identifies
 * a DIFFERENT calendar entry than the company's IPO row and must never
 * resolve to it (or vice versa). Deliberately narrower than "any offering
 * type mismatch": IPO<->FPO reclassification (a real, existing use of this
 * resolver — see `guardSmeOfferingTypeAgainstFpo`) must keep resolving to
 * the same row. Either side unset means "no information", never a conflict.
 */
function ofsIdentityConflict(
  identityOfferingType: string | null | undefined,
  candidateOfferingType: string | null | undefined
): boolean {
  if (!identityOfferingType || !candidateOfferingType) {
    return false;
  }
  return (identityOfferingType === 'OFS') !== (candidateOfferingType === 'OFS');
}

/**
 * True when `identitySegment` and `candidateSegment` are both set and
 * disagree — the segment guard (T-403 item 3). Either side unset means "no
 * information", which is never treated as a mismatch.
 */
function segmentsConflict(
  identitySegment: 'MAINBOARD' | 'SME' | null | undefined,
  candidateSegment: string | null | undefined
): boolean {
  return identitySegment != null && candidateSegment != null && identitySegment !== candidateSegment;
}

/**
 * Resolve the existing `ipos` row (if any) that an incoming write or guard
 * check should treat as "this company" — priority order:
 * cin (OD-34 step 1, §2.3.3.2) -> isin (exact, normalized) -> nse/bse symbol (exact, normalized) ->
 * normalized-name -> prefix-name with corroboration (W-108) -> slug ->
 * fuzzy (typo) name.
 *
 * Callers MUST resolve identity ONCE per request and pass the SAME resolved
 * row to every downstream step (guard check + write) rather than calling
 * this a second time — a second, independently-timed resolution is exactly
 * how the guard and the write diverged before (§1.4).
 */
/**
 * Item 12 slice D — log that two LIVE rows on the same open date fold to one
 * company identity. OBSERVE ONLY: it never merges, never writes, and its return
 * value is discarded.
 *
 * FLAG, and why not the slot-aware helper: `slotAwareFlagDefault()` returns true
 * on staging when the variable is unset. This flag uses the plain
 * `=== 'true'` convention so it is OFF in every slot until someone sets it —
 * an observe-only feature that silently switches itself on in one slot is how a
 * "why is this logging" mystery starts.
 *
 * WHY open_date FILTERS THE QUERY rather than walking every live row: a same-day
 * query returns a handful of rows, where a full live scan would cost an O(n)
 * fold on EVERY identity resolution — and identity resolution runs on every
 * scraped record.
 *
 * SIZED BEFORE IT WAS BUILT (read-only, both slots): staging has 13 candidate
 * groups over ~30 rows; production has ZERO among 333 live rows. So on prod this
 * is PREVENTIVE. Read only a prod run and you would think it does nothing; read
 * only staging and you would think the estate is full of duplicates.
 *
 * IT SWALLOWS ITS OWN FAILURES. Every scraper write depends on `resolveIpoRow`;
 * an observation must never be able to break it.
 */
async function logDuplicateCandidates(
  ipoRepository: IPORepository,
  identity: IpoIdentity
): Promise<void> {
  if (process.env.ENABLE_DISCOVERY_DUPLICATE_CHECK !== 'true') return;
  const { companyName, openDate } = identity;
  if (!openDate) return;

  try {
    const finder = (ipoRepository as { findLiveByOpenDate?: (d: string | Date) => Promise<IPO[]> })
      .findLiveByOpenDate;
    // An older caller (or a narrow test double) may not have this method. A
    // missing observation is fine; a crash in the write path is not.
    if (typeof finder !== 'function') return;

    const sameDay = await finder.call(ipoRepository, openDate);
    if (!Array.isArray(sameDay) || sameDay.length < 2) return;

    const key = foldCompanyIdentity(companyName);
    if (!key) return;

    const matches = sameDay.filter((row) => foldCompanyIdentity(row.companyName) === key);
    if (matches.length < 2) return;

    // Identities, never a bare count (signal-ownership R1): a reader must be
    // able to open both rows without running a second query.
    logger.warn(
      {
        foldKey: key,
        openDate: typeof openDate === 'string' ? openDate : openDate.toISOString().slice(0, 10),
        slugs: matches.map((r) => r.slug),
        ids: matches.map((r) => r.id),
        companyNames: matches.map((r) => r.companyName),
      },
      'duplicate_candidate: two or more LIVE rows share an open date and fold to one company identity — not merged, not written, flagged for a human'
    );
  } catch (error) {
    logger.debug(
      { error: (error as Error).message },
      'duplicate_candidate scan failed — identity resolution is unaffected'
    );
  }
}


/**
 * OD-68 corroboration: a positive price (0 is how several aggregators say
 * "not known yet" — the Rays of Belief chittorgarh shape carried 0/0), else null.
 */
function knownPrice(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** OD-35: open dates within this many days are one offering (a postponement), beyond it a new one. */
export const SAME_OFFERING_WINDOW_DAYS = 180;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/**
 * OD-68 + OD-35 + OD-71 (PR #910 review round 1, MAJOR-1; round 2 fix): may a NAME match bind?
 *
 * The rule, in order — a candidate is REFUSED when:
 *   0. the candidate's status is WITHDRAWN (OD-71: a withdrawn draft means the refiling is a
 *      new offering, never an update to the withdrawn row — `holdIfIdentityUnbound`
 *      (ipo-repository.ts) already excludes WITHDRAWN from the hold query, but every BIND path
 *      (findByNormalizedName, findBySlug, the fuzzy and fold tiers) fed this function a candidate
 *      with no status check at all, so a refiled record silently bound to and overwrote the
 *      withdrawn row instead of creating a new one);
 *   1. the segments are both known and differ (an SME and a mainboard issue are two offerings);
 *   2. the price bands are both known (> 0) and differ;
 *   3. the open dates are both known and more than 180 days apart (OD-35: a new offering);
 *   4. the open dates are both known and differ AT ALL, and the match came from a LOOSE tier
 *      (3b prefix-with-corroboration or 5 fuzzy/typo) — a guess about the NAME may not also
 *      absorb a guess about the DATE, which is the OD-69 look-alike case (Himalayan Solar /
 *      Himalaya Nutravedics opened 3 days apart).
 * Otherwise it binds. So an EXACT name / slug match whose open date moved by up to 180 days,
 * with no band or segment contradiction, is the SAME offering postponed or corrected, and the
 * incoming record UPDATES that row — before this round the date difference alone declined the
 * bind and the create was then held, so a postponed keyless issue kept its stale date forever.
 * A value unknown on either side neither proves nor refutes.
 */
function nameMatchContradiction(
  identity: Pick<IpoIdentity, 'openDate' | 'priceRangeMin' | 'segment' | 'cin'>,
  candidate: { openDate?: unknown; priceRangeMin?: unknown; segment?: unknown; status?: unknown; cin?: unknown },
  opts: { looseTier: boolean }
): string | null {
  const cinConflict = cinContradiction(normalizeCin(identity.cin), candidate.cin);
  if (cinConflict) {
    return `${cinConflict} (OD-69: a differing identifier never joins, whatever the names fold to)`;
  }
  if (candidate.status === 'WITHDRAWN') {
    return 'candidate is WITHDRAWN (OD-71: a refiling is a new offering, never a bind to the withdrawn row)';
  }
  if (segmentsConflict(identity.segment, (candidate.segment as string | null | undefined) ?? null)) {
    return `segment differs (${String(identity.segment)} vs ${String(candidate.segment)})`;
  }
  const incomingPrice = knownPrice(identity.priceRangeMin);
  const candidatePrice = knownPrice(candidate.priceRangeMin);
  if (incomingPrice != null && candidatePrice != null && incomingPrice !== candidatePrice) {
    return `price band differs (${incomingPrice} vs ${candidatePrice})`;
  }
  const incomingDay = toCalendarDateString(identity.openDate ?? null);
  const candidateDay = toCalendarDateString((candidate.openDate as string | Date | null | undefined) ?? null);
  if (incomingDay && candidateDay && incomingDay !== candidateDay) {
    const gap = daysApart(incomingDay, candidateDay);
    if (gap > SAME_OFFERING_WINDOW_DAYS) {
      return `open date ${Math.round(gap)} days away (${incomingDay} vs ${candidateDay}) - beyond OD-35's ${SAME_OFFERING_WINDOW_DAYS}-day window, a new offering`;
    }
    if (opts.looseTier) {
      return `open date differs (${incomingDay} vs ${candidateDay}) on a prefix/fuzzy name match`;
    }
  }
  return null;
}

/**
 * §9.2 item 26 + OD-35: may a row found only through an ALIAS (an identifier an admin replaced,
 * `ipo_identifier_aliases`) bind this record? A remembered symbol or ISIN is weaker than a live one
 * (symbols are reused across years), so the alias binds only a row that can be the same offering:
 * not WITHDRAWN (OD-71), same segment, same offering type (OD-35 "offering type changes -> new
 * row") and open dates within OD-35's 180 days. The CIN contradiction (OD-69) is checked for every
 * ISIN/symbol match by the caller.
 * Returns null when the alias may bind; otherwise the reason, and whether the record must be HELD
 * (the alias cannot be placed: the incoming open date is unknown, Tier A review MINOR-1) or only
 * declined (the row is provably another offering, so the record may be a new one).
 */
function aliasBindRefusal(
  identity: Pick<IpoIdentity, 'openDate' | 'segment' | 'offeringType'>,
  candidate: { openDate?: unknown; segment?: unknown; status?: unknown; offeringType?: unknown }
): { reason: string; hold: boolean } | null {
  const refusal = aliasOfferingRefusal(identity, candidate);
  if (refusal) return { reason: refusal, hold: false };
  if (!toCalendarDateString(identity.openDate ?? null)) {
    return { reason: "incoming open date unknown - a kept alias alone cannot place the record in OD-35's 180-day window", hold: true };
  }
  return null;
}

function aliasOfferingRefusal(
  identity: Pick<IpoIdentity, 'openDate' | 'segment' | 'offeringType'>,
  candidate: { openDate?: unknown; segment?: unknown; status?: unknown; offeringType?: unknown }
): string | null {
  if (candidate.status === 'WITHDRAWN') return 'candidate is WITHDRAWN (OD-71)';
  if (segmentsConflict(identity.segment, (candidate.segment as string | null | undefined) ?? null)) {
    return `segment differs (${String(identity.segment)} vs ${String(candidate.segment)})`;
  }
  if (separateOffering(identity.offeringType, (candidate.offeringType as string | null | undefined) ?? null)) {
    return `offering type differs (${String(identity.offeringType)} vs ${String(candidate.offeringType)})`;
  }
  const incomingDay = toCalendarDateString(identity.openDate ?? null);
  const candidateDay = toCalendarDateString((candidate.openDate as string | Date | null | undefined) ?? null);
  if (incomingDay && candidateDay && daysApart(incomingDay, candidateDay) > SAME_OFFERING_WINDOW_DAYS) {
    return `open date ${Math.round(daysApart(incomingDay, candidateDay))} days away (${incomingDay} vs ${candidateDay}) - beyond OD-35's ${SAME_OFFERING_WINDOW_DAYS}-day window`;
  }
  return null;
}

/**
 * §9.2 item 26, Tier A review CRITICAL-1 and round 2 MAJOR-A/B (OD-68): an admin removes an
 * identifier (replaces OR clears it) often because it was WRONG (a promoter's CIN, a mis-keyed ISIN,
 * another offering's BSE IPO number), so the removed value can belong to another company. A match
 * reached ONLY through an admin-removed value (a kept alias in `ipo_identifier_aliases`, or a source
 * key an admin edit SUPERSEDED, `isAdminRemovedSourceKey`) binds only when the record is
 * corroborated: its OD-68 identity fold equals the row's, or it has the same open date AND the same
 * known price band (both bounds when both sides know both, MINOR-C). This holds whatever the row
 * carries now: a different value, or none. Otherwise the record is held (OD-68 hold path:
 * audit_logs IDENTITY_HELD_FOR_REVIEW, nightly i_identity_held), never bound, never created.
 */
function adminRemovedMatchCorroborated(
  identity: Pick<IpoIdentity, 'companyName' | 'openDate' | 'priceRangeMin' | 'priceRangeMax'>,
  candidate: { companyName?: unknown; openDate?: unknown; priceRangeMin?: unknown; priceRangeMax?: unknown }
): boolean {
  const fold = strictIdentityCompanyName(identity.companyName ?? '');
  if (fold && typeof candidate.companyName === 'string' && strictIdentityCompanyName(candidate.companyName) === fold) return true;
  const inDay = toCalendarDateString(identity.openDate ?? null);
  const rowDay = toCalendarDateString((candidate.openDate as string | Date | null | undefined) ?? null);
  const inMin = knownPrice(identity.priceRangeMin);
  if (!inDay || inDay !== rowDay || inMin == null || inMin !== knownPrice(candidate.priceRangeMin)) return false;
  const inMax = knownPrice(identity.priceRangeMax);
  const rowMax = knownPrice(candidate.priceRangeMax);
  return inMax == null || rowMax == null || inMax === rowMax;
}

type AliasVerdict = { kind: 'bind' } | { kind: 'decline'; reason: string } | { kind: 'hold'; reason: string };

/** The full item 26 rule for a row matched only through a kept alias of `kind`. */
function judgeAliasMatch(
  identity: IpoIdentity,
  candidate: { [k: string]: unknown },
  kind: 'CIN' | 'ISIN' | 'SYMBOL',
  currentValue: string | null
): AliasVerdict {
  if (kind !== 'CIN') {
    // OD-69: a known CIN that differs proves another company - declined (it may be a new row), not held.
    const conflict = cinContradiction(normalizeCin(identity.cin), candidate.cin);
    if (conflict) return { kind: 'decline', reason: `${conflict} (OD-69)` };
  }
  const refusal = aliasBindRefusal(identity, candidate);
  if (refusal) return refusal.hold ? { kind: 'hold', reason: refusal.reason } : { kind: 'decline', reason: refusal.reason };
  if (!adminRemovedMatchCorroborated(identity, candidate)) {
    return {
      kind: 'hold',
      reason: `matched only through a kept ${kind} alias (§9.2 item 26) while the row now carries ${currentValue ? `${kind} ${currentValue}` : `no ${kind}`}; ` +
        'not corroborated by the OD-68 name fold nor by the same open date and known price band',
    };
  }
  return { kind: 'bind' };
}

function currentIdentifier(candidate: { [k: string]: unknown }, column: 'cin' | 'isin' | 'symbol'): string | null {
  const c = candidate[column];
  if (typeof c !== 'string') return null;
  const v = column === 'cin' ? normalizeCin(c) : c.trim().toUpperCase();
  return v ? v : null;
}

/** An alias-only match the rule refused to bind: the record is held for review (OD-68). */
interface AliasHold { candidate: IPO; reason: string }

async function holdAliasOnlyMatch(ipoRepository: IPORepository, identity: IpoIdentity, hold: AliasHold): Promise<never> {
  const c = hold.candidate;
  const incoming = {
    companyName: identity.companyName,
    slug: identity.slug,
    openDate: toCalendarDateString(identity.openDate ?? null),
    priceRangeMin: identity.priceRangeMin ?? null,
  };
  const candidates = [{
    id: c.id, slug: c.slug ?? '', companyName: c.companyName ?? '', openDate: c.openDate ?? null,
    priceRangeMin: (c as { priceRangeMin?: unknown }).priceRangeMin ?? null, status: c.status ?? null,
  }];
  logger.warn({ incoming, candidateId: c.id, candidateSlug: c.slug, reason: hold.reason },
    'identity_held_for_review: [§9.2 item 26] alias-only match not corroborated - NOT bound, NOT created (OD-68)');
  const recorder = (ipoRepository as { recordAliasIdentityHold?: (...a: unknown[]) => Promise<void> }).recordAliasIdentityHold;
  if (typeof recorder === 'function') await recorder.call(ipoRepository, incoming, candidates, hold.reason);
  throw new IdentityHeldForReviewError(
    `resolveIpoRow: "${identity.companyName}" held for review (OD-68, §9.2 item 26) - ${hold.reason}; candidate ${c.slug}; nothing written`,
    incoming,
    candidates
  );
}

/**
 * Every row carrying `value` live or as a kept alias (live first). Tier A review MINOR-2: the whole
 * list is walked so a refused first match cannot hide a valid second one. A repository without the
 * list finder (an older test double) falls back to the single-row finder and its T-478 retry.
 */
async function keyTierCandidates(
  ipoRepository: IPORepository,
  kind: 'isin' | 'symbol',
  value: string,
  offeringType: IpoIdentity['offeringType']
): Promise<IPO[]> {
  const listName = kind === 'isin' ? 'findAllByIsin' : 'findAllBySymbol';
  const list = (ipoRepository as unknown as Record<string, unknown>)[listName];
  if (typeof list === 'function') return ((await list.call(ipoRepository, value)) as IPO[] | null) ?? [];
  const one = (v: string, t?: string) => {
    const find = kind === 'isin' ? ipoRepository.findByIsin.bind(ipoRepository) : ipoRepository.findBySymbol.bind(ipoRepository);
    return t === undefined ? find(v) : find(v, t);
  };
  const first = await one(value);
  if (!first) return [];
  if (offeringType && ofsIdentityConflict(offeringType, first.offeringType)) {
    const retried = await one(value, offeringType);
    return retried ? [first, retried] : [first];
  }
  return [first];
}

/** True when `candidate` carries `value` in `column` live (not only as a remembered alias). */
function carriesLive(candidate: { [k: string]: unknown }, column: 'isin' | 'symbol', value: string | null | undefined): boolean {
  const v = value?.trim().toUpperCase();
  const c = candidate[column];
  return !!v && typeof c === 'string' && c.trim().toUpperCase() === v;
}

/**
 * OD-68 S1/S3: strip page-status suffixes and page-title text from the
 * incoming name and slug BEFORE any tier runs. The caller's `normalizedName`
 * and `slug` were computed from the raw name, so both are recomputed from the
 * stripped name when it differs. An OFS slug (`-ofs-<year>`) is kept as the
 * caller built it — its suffix is identity, not decoration.
 */
function stripIncomingDecoration(identity: IpoIdentity): IpoIdentity {
  const cleanedName = stripIdentityNameDecoration(identity.companyName);
  const isOfsSlug = /-ofs-(\d{4}|unknown)$/.test(identity.slug ?? '');
  if (!cleanedName || cleanedName === identity.companyName.trim()) {
    const slug = isOfsSlug ? identity.slug : stripIdentitySlugSuffix(identity.slug);
    return slug === identity.slug ? identity : { ...identity, slug };
  }
  logger.info(
    { companyName: identity.companyName, strippedCompanyName: cleanedName, slug: identity.slug },
    '[OD-68] incoming name carried a page-status suffix or page-title text - stripped before matching'
  );
  return {
    ...identity,
    normalizedName: normalizeCompanyNameForMatching(cleanedName),
    slug: isOfsSlug ? identity.slug : stripIdentitySlugSuffix(generateIPOSlug(cleanedName)),
  };
}

/**
 * OD-34 step 1. Every row carrying this CIN is read; the ones that cannot be
 * the incoming OFFERING are dropped (WITHDRAWN, a different segment, a
 * different offering type, an open date beyond OD-35's 180 days). Exactly one
 * left binds. None left falls through to the later steps unchanged. Two or
 * more left is ambiguous — the company is stored twice (the live Rays of
 * Belief pair shares one CIN) — so the CIN does not pick one; the later steps
 * decide and the pair is left to the nightly duplicate check.
 *
 * A repository without `findByCin` (an older test double) is treated as "no
 * row carries this CIN", never as a failure: identity resolution runs on
 * every scraped record.
 */
async function resolveByCin(
  ipoRepository: IPORepository,
  identity: IpoIdentity,
  cin: string
): Promise<{ row: IPO | null; hold: AliasHold | null; viaAlias?: true }> {
  const finder = (ipoRepository as { findByCin?: (c: string) => Promise<IPO[]> }).findByCin;
  if (typeof finder !== 'function') return { row: null, hold: null };
  const all = (await finder.call(ipoRepository, cin)) ?? [];
  if (all.length === 0) return { row: null, hold: null };

  // §9.2 item 26 (Tier A review CRITICAL-1, MINOR-2): a row whose live CIN differs was reached only
  // through a kept alias. A live holder always wins over a remembered one; the alias rows are judged
  // only when no row carries the CIN live, and each must pass judgeAliasMatch (OD-68 corroboration).
  const live = all.filter((r) => normalizeCin((r as { cin?: string | null }).cin ?? null) === cin);
  const aliasOnly = all.filter((r) => !live.includes(r));
  if (live.length === 0 && aliasOnly.length > 0) {
    const bindable: IPO[] = [];
    let hold: AliasHold | null = null;
    for (const r of aliasOnly) {
      const v = judgeAliasMatch(identity, r as never, 'CIN', currentIdentifier(r as never, 'cin'));
      if (v.kind === 'bind') bindable.push(r);
      else {
        logger.warn({ companyName: identity.companyName, cin, candidateId: r.id, candidateSlug: r.slug, reason: v.reason },
          `[§9.2 item 26] CIN alias match ${v.kind === 'hold' ? 'held' : 'declined'} - ${v.reason}`);
        if (v.kind === 'hold' && !hold) hold = { candidate: r, reason: v.reason };
      }
    }
    if (bindable.length === 1) {
      logger.info({ companyName: identity.companyName, cin, boundId: bindable[0].id, boundSlug: bindable[0].slug },
        '[OD-34 / §9.2 item 26] bound on a kept CIN alias (corroborated)');
      return { row: bindable[0], hold: null, viaAlias: true };
    }
    if (bindable.length > 1) {
      logger.warn({ companyName: identity.companyName, cin, eligibleSlugs: bindable.map((r) => r.slug) },
        '[OD-34] several rows keep this CIN as an alias and could be this offering - ambiguous, not bound on CIN');
      return { row: null, hold: null };
    }
    return { row: null, hold };
  }
  const rows = live;

  const incomingDay = toCalendarDateString(identity.openDate ?? null);
  const eligible = rows.filter((row) => {
    if (row.status === 'WITHDRAWN') return false;
    if (segmentsConflict(identity.segment, row.segment)) return false;
    if (separateOffering(identity.offeringType, row.offeringType)) return false;
    const rowDay = toCalendarDateString((row.openDate as string | Date | null | undefined) ?? null);
    if (incomingDay && rowDay && daysApart(incomingDay, rowDay) > SAME_OFFERING_WINDOW_DAYS) return false;
    return true;
  });

  if (eligible.length === 1) {
    logger.info({
      companyName: identity.companyName, cin, boundId: eligible[0].id, boundSlug: eligible[0].slug,
    }, '[OD-34] bound on CIN');
    return { row: eligible[0], hold: null };
  }
  logger.warn({
    companyName: identity.companyName,
    cin,
    rows: rows.map((r) => ({ id: r.id, slug: r.slug, status: r.status, offeringType: r.offeringType })),
    eligibleSlugs: eligible.map((r) => r.slug),
  }, eligible.length === 0
    ? '[OD-34] rows carry this CIN but none can be this offering (withdrawn, other type/segment, or beyond 180 days) - not bound on CIN'
    : '[OD-34] several rows carry this CIN and could be this offering - ambiguous, not bound on CIN; later steps decide');
  return { row: null, hold: null };
}

/** The repository's database handle for the key table, or null for a test double without one. */
function sourceKeyDb(ipoRepository: IPORepository): Parameters<typeof resolveBySourceKeys>[0] | null {
  const getter = (ipoRepository as { sourceKeyDb?: () => unknown }).sourceKeyDb;
  return typeof getter === 'function' ? (getter.call(ipoRepository) as Parameters<typeof resolveBySourceKeys>[0]) : null;
}

function heldError(identity: IpoIdentity, candidate: { id: string; slug?: string | null }, reason: string): IdentityHeldForReviewError {
  return new IdentityHeldForReviewError(
    `resolveIpoRow: "${identity.companyName}" held (OD-85 key_contradiction) - ${reason}; nothing written`,
    { companyName: identity.companyName, slug: identity.slug, openDate: identity.openDate ?? null, priceRangeMin: identity.priceRangeMin ?? null },
    [{ id: candidate.id, slug: candidate.slug ?? '', companyName: '', openDate: null, priceRangeMin: null, status: null }]
  );
}

/**
 * OD-85 read rule in front of the existing order (§2.3.3.2):
 *   key hit + re-check passes      -> that row (ACTIVE) / write nothing (SUPERSEDED, throws)
 *   key hit + re-check fails       -> held, nothing written (CIN/ISIN contradiction: key DISPUTED)
 *   keys hit two rows              -> duplicate reported, nothing written (throws)
 *   no hit                         -> the existing order (CIN, ISIN, symbol, name, OD-68 hold),
 *                                     and a row it binds is accepted only if the record's keys
 *                                     would be (a different ACTIVE key of the same source must
 *                                     pass OD-83, else held).
 * A repository without `sourceKeyDb` (a test double) or a record with no keys runs the existing
 * order exactly as before.
 */
export async function resolveIpoRow(
  ipoRepository: IPORepository,
  rawIdentity: IpoIdentity
): Promise<IPO | IPOWithRelations | null> {
  const keys = normalizeSourceKeyRefs(rawIdentity.sourceKeys ?? []);
  const db = keys.length > 0 ? sourceKeyDb(ipoRepository) : null;
  if (!db) return refuseNameOnlyBindToAdminRow(ipoRepository, rawIdentity, await resolveIpoRowByOrderWithTier(ipoRepository, rawIdentity));

  const byKey = await resolveBySourceKeys(db, rawIdentity, keys);
  switch (byKey.kind) {
    case 'bound': {
      const row = await ipoRepository.findByIdUncached(byKey.ipoId);
      if (row) {
        logger.info({ companyName: rawIdentity.companyName, ipoId: row.id, slug: row.slug }, '[OD-85] bound by source key');
        noteSourceKeyBind(row.id, byKey.keyIds);
        return row;
      }
      break;
    }
    case 'admin_removed': {
      // §9.2 item 26 (round 2 MAJOR-B): every key hit was removed from the row by an admin edit.
      const row = await ipoRepository.findByIdUncached(byKey.ipoId);
      if (!row) break;
      if (!adminRemovedMatchCorroborated(stripIncomingDecoration(rawIdentity), row as never)) {
        await holdAliasOnlyMatch(ipoRepository, rawIdentity, {
          candidate: row as IPO,
          reason: 'matched only through a source key an admin edit removed from the row (§9.2 item 26); ' +
            'not corroborated by the OD-68 name fold nor by the same open date and known price band',
        });
      }
      throw new SourceKeySupersededError(
        `resolveIpoRow: "${rawIdentity.companyName}" carries a source key an admin edit SUPERSEDED (§9.2 item 26, corroborated) - binds ${byKey.ipoId}, writes nothing`,
        byKey.ipoId,
        byKey.keyIds
      );
    }
    case 'superseded':
      throw new SourceKeySupersededError(
        `resolveIpoRow: "${rawIdentity.companyName}" carries a SUPERSEDED source key (OD-83 relaunch) - binds ${byKey.ipoId}, writes nothing`,
        byKey.ipoId,
        byKey.keyIds
      );
    case 'held':
      throw heldError(rawIdentity, { id: byKey.ipoId }, byKey.reason);
    case 'duplicate':
      throw new SourceKeyDuplicateError(
        `resolveIpoRow: "${rawIdentity.companyName}" source keys hit ${byKey.ipoIds.length} different rows (${byKey.ipoIds.join(', ')}) - duplicate reported, nothing written (OD-85)`,
        byKey.ipoIds,
        keys
      );
    case 'miss':
      break;
  }

  const bound = await resolveIpoRowByOrderWithTier(ipoRepository, rawIdentity);
  const row = bound.row;
  if (row) {
    // A key this record carries is DISPUTED on the row the fallback picked: that row was already
    // proved wrong for this key (CIN/ISIN contradiction). Refuse it until an admin resolves it.
    const disputed = await findDisputedKeysOnRow(db, row.id, keys);
    if (disputed.length > 0) {
      const reason = `key_disputed_rebind_refused: ${disputed.map((k) => `${k.source} ${k.keyType} ${k.keyValue}`).join(', ')} is DISPUTED on this row`;
      logger.warn({ companyName: rawIdentity.companyName, ipoId: row.id, slug: row.slug, disputed: disputed.map((k) => k.id) },
        '[OD-85] key_disputed_rebind_refused: the fallback order picked a row this record key is DISPUTED on - held');
      throw heldError(rawIdentity, row, reason);
    }
    // OD-69 / the key re-check: a KNOWN ISIN that differs is another company, whichever tier bound it.
    const inIsin = normalizeSourceKeyValue(rawIdentity.isin);
    const rowIsin = normalizeSourceKeyValue((row as { isin?: unknown }).isin);
    if (inIsin && rowIsin && inIsin !== rowIsin) {
      const reason = `ISIN differs (${inIsin} vs ${rowIsin})`;
      logger.warn({ companyName: rawIdentity.companyName, ipoId: row.id, slug: row.slug, reason },
        '[OD-69] isin_contradiction on a fallback bind - held');
      throw heldError(rawIdentity, row, reason);
    }
    const plan = await planSourceKeyWrite(db, row.id, keys);
    if (!plan.ok) {
      logger.warn({ companyName: rawIdentity.companyName, ipoId: row.id, reason: plan.reason }, '[OD-85] key_contradiction on a fallback bind - held');
      throw heldError(rawIdentity, row, plan.reason ?? 'key_contradiction on a fallback bind');
    }
  }
  return refuseNameOnlyBindToAdminRow(ipoRepository, rawIdentity, bound);
}

/**
 * The tier of the fallback order that bound the row: an identifier the record carries live on the
 * row (CIN, ISIN, symbol), a kept identifier alias that passed §9.2 item 26's corroboration, or a
 * name tier (3, 3b, 4 slug, 5 fuzzy, 6 identity fold). A source-key bind returns before the order.
 */
export type IpoBindTier = 'cin' | 'isin' | 'symbol' | 'alias' | 'name';

interface OrderResolution {
  row: IPO | IPOWithRelations | null;
  tier: IpoBindTier | null;
}

/**
 * §9.2 item 15 (OD-111): an admin-created row binds a scraped record only through one of its
 * identifiers (OD-34 / OD-85, and a kept alias per item 26). A record the fallback order bound to it
 * through a NAME tier is held for review (OD-68), never bound. The decision reads the tier the order
 * itself reported - never a re-comparison of the row's current identifier values, which an admin edit
 * may have changed (item 26). The audit lookup runs only on a name-tier bind. A repository without
 * `isAdminCreated` (a test double) is treated as "no admin-created rows".
 */
async function refuseNameOnlyBindToAdminRow(
  ipoRepository: IPORepository,
  identity: IpoIdentity,
  bound: OrderResolution
): Promise<IPO | IPOWithRelations | null> {
  const { row, tier } = bound;
  if (!row || tier !== 'name') return row;
  const repo = ipoRepository as {
    isAdminCreated?: (id: string) => Promise<boolean>;
    holdNameOnlyBindToAdminRow?: (incoming: unknown, candidate: unknown) => Promise<never>;
  };
  if (typeof repo.isAdminCreated !== 'function' || typeof repo.holdNameOnlyBindToAdminRow !== 'function') return row;
  if (!(await repo.isAdminCreated.call(ipoRepository, row.id))) return row;
  return repo.holdNameOnlyBindToAdminRow.call(
    ipoRepository,
    { companyName: identity.companyName, slug: identity.slug, openDate: identity.openDate ?? null, priceRangeMin: identity.priceRangeMin ?? null },
    { id: row.id, slug: row.slug, companyName: row.companyName, openDate: row.openDate, priceRangeMin: row.priceRangeMin, status: row.status }
  );
}

async function resolveIpoRowByOrderWithTier(
  ipoRepository: IPORepository,
  rawIdentity: IpoIdentity
): Promise<OrderResolution> {
  const identity = stripIncomingDecoration(rawIdentity);
  const { companyName, normalizedName, slug, isin, symbol, openDate, priceRangeMin, segment, offeringType } = identity;

  // Item 12 slice D: OBSERVE duplicate candidates. Deliberately placed HERE,
  // before the tier chain, and awaited for its side effect only — it reads
  // nothing the tiers produce and feeds nothing back, so it CANNOT change which
  // row this function returns no matter what it finds or how it fails. Putting
  // it after the chain would have meant threading it past three separate
  // `return` statements, and the first thing to go wrong there is a return that
  // skips it.
  await logDuplicateCandidates(ipoRepository, identity);

  // OD-34 step 1 (§2.3.3.2): the CIN, before every other identifier. First
  // match wins and a later identifier never re-opens it, so a CIN bind returns
  // here. A CIN names the COMPANY, not the offering, so only a row that can be
  // the same offering is eligible (OD-35 window, OD-70 type, OD-71 withdrawn).
  const cin = normalizeCin(identity.cin);
  // §9.2 item 26: an alias-only match the rule refused to bind. It holds the record only when no
  // later tier binds it (a later identifier or name that binds a row is itself the corroboration).
  let aliasHold: AliasHold | null = null;
  if (cin) {
    const cinResult = await resolveByCin(ipoRepository, identity, cin);
    if (cinResult.row) return { row: cinResult.row, tier: cinResult.viaAlias ? 'alias' : 'cin' };
    aliasHold = cinResult.hold;
  }

  // T-403 Tier-A review (item 4): tracks whether the accepted `nameMatch`
  // came from the WEAK tier 3b prefix-with-corroboration path, so the
  // key/name conflict check below can prefer the higher-confidence key
  // match over a tier 3b guess (it still prefers tier 3's exact-name match,
  // as before — only tier 3b is downgraded).
  let nameMatchIsTier3b = false;
  // PR #910 review round 1 (MAJOR-1): the fuzzy tier is a guess about the name,
  // so it may not also tolerate a moved open date (see nameMatchContradiction).
  let nameMatchIsFuzzy = false;

  // Tier 1: ISIN (exact, normalized). Highest-confidence natural key — a
  // 12-character code unique to the security. NULL-safe: findByIsin returns
  // null immediately for an absent/whitespace-only input, so an incoming
  // row with no ISIN can never "match" an existing row that also has no
  // ISIN (both null() calls short-circuit before querying).
  // §9.2 item 26 (Tier A review MINOR-2): every candidate is walked, live holders first; a row
  // matched only through a kept alias must pass judgeAliasMatch (OD-35 window, OD-68 corroboration).
  // The tier that bound `keyMatch`: the identifier itself when the row carries it live, 'alias' when
  // only a kept alias matched and judgeAliasMatch let it bind.
  let keyTier: IpoBindTier | null = null;
  const pickKeyMatch = (kind: 'isin' | 'symbol', value: string, candidates: IPO[]): IPO | null => {
    const tier = kind === 'isin' ? 'Tier 1 ISIN' : 'Tier 2 symbol';
    for (const candidate of candidates) {
      if (ofsIdentityConflict(offeringType, candidate.offeringType)) {
        logger.warn({
          companyName, [kind]: value, identityOfferingType: offeringType, candidateId: candidate.id,
          candidateOfferingType: candidate.offeringType,
        }, `[T-478] ${tier} match declined - OFS/IPO identity conflict`);
        continue;
      }
      if (carriesLive(candidate as never, kind, value)) {
        keyTier = kind;
        return candidate;
      }
      const verdict = judgeAliasMatch(identity, candidate as never, kind === 'isin' ? 'ISIN' : 'SYMBOL', currentIdentifier(candidate as never, kind));
      if (verdict.kind === 'bind') {
        keyTier = 'alias';
        return candidate;
      }
      logger.warn({ companyName, [kind]: value, candidateId: candidate.id, candidateSlug: candidate.slug, reason: verdict.reason },
        `[§9.2 item 26] ${kind === 'isin' ? 'ISIN' : 'symbol'} alias match ${verdict.kind === 'hold' ? 'held' : 'declined'} - ${verdict.reason}`);
      if (verdict.kind === 'hold' && !aliasHold) aliasHold = { candidate, reason: verdict.reason };
    }
    return null;
  };

  // Tier 1: ISIN (exact, normalized). Highest-confidence natural key — a
  // 12-character code unique to the security. NULL-safe: an absent ISIN never
  // queries, so a row with no ISIN can never "match" another with none.
  // T-478 round 3 (item 2): a candidate of the WRONG offering type is skipped,
  // not the end of the tier — a row of the right type may share the ISIN.
  let keyMatch: IPO | null = isin ? pickKeyMatch('isin', isin, await keyTierCandidates(ipoRepository, 'isin', isin, offeringType)) : null;

  // Tier 2: NSE/BSE ticker symbol (exact, normalized). Same NULL-safety
  // guarantee as ISIN. Deliberately queries ONLY the `symbol` column, never
  // `bseScripCode` — the two are separate keyspaces per the module doc
  // comment, and findBySymbol's implementation enforces this by construction.
  if (!keyMatch && symbol) {
    keyMatch = pickKeyMatch('symbol', symbol, await keyTierCandidates(ipoRepository, 'symbol', symbol, offeringType));
  }

  // OD-69: a symbol is reused across time and an ISIN can be mis-keyed; a key
  // row whose stored CIN differs from the incoming one is another company.
  if (keyMatch) {
    const conflict = cinContradiction(cin, (keyMatch as { cin?: unknown }).cin);
    if (conflict) {
      logger.warn({
        companyName, isin, symbol, candidateId: keyMatch.id, candidateSlug: keyMatch.slug, reason: conflict,
      }, '[OD-69] ISIN/symbol match declined - ' + conflict + ' - not bound');
      keyMatch = null;
    }
  }

  // Tier 3: normalized company name. T-403 Tier-A review (item 3): a
  // segment mismatch (SME vs MAINBOARD) between the incoming identity and
  // the candidate row means they cannot be the same listing even with an
  // identical name — drop the candidate rather than merge across segments.
  let nameMatch: IPO | IPOWithRelations | null = normalizedName
    ? await ipoRepository.findByNormalizedName(normalizedName)
    : null;
  if (nameMatch && segmentsConflict(segment, nameMatch.segment)) {
    logger.warn({
      companyName,
      normalizedName,
      identitySegment: segment,
      candidateSegment: nameMatch.segment,
      candidateId: nameMatch.id,
    }, '[T-403] Tier 3 normalized-name match declined - segment mismatch');
    nameMatch = null;
  } else if (nameMatch && ofsIdentityConflict(offeringType, nameMatch.offeringType)) {
    let retried = offeringType && normalizedName
      ? await ipoRepository.findByNormalizedName(normalizedName, offeringType)
      : null;
    if (retried && ofsIdentityConflict(offeringType, retried.offeringType)) retried = null;
    if (retried) {
      logger.info({
        companyName, normalizedName, offeringType, candidateId: retried.id,
      }, '[T-478] Tier 3 normalized-name match declined but a same-type row was found on retry');
    } else {
      logger.warn({
        companyName,
        normalizedName,
        identityOfferingType: offeringType,
        candidateOfferingType: nameMatch.offeringType,
        candidateId: nameMatch.id,
      }, '[T-478] Tier 3 normalized-name match declined - OFS/IPO identity conflict');
    }
    nameMatch = retried;
  }

  if (!nameMatch) {
    // Tier 3b (W-108): exact/compact-whitespace name matching (tier 3) and
    // spelling-typo fuzzy matching (tier 5, below) both miss the case where
    // two legitimate sources genuinely disagree on the FULL company name —
    // one carries a whole extra descriptive suffix the other omits
    // ("Rays of Belief Limited" vs "Rays of Belief Limited- For Profit
    // Social Enterprise"). That is a real, recurring disagreement between
    // exchanges/aggregators, not a typo, so it needs its own tier — but a
    // prefix relationship ALONE is too weak a signal on its own ("Rays of
    // Belief Limited" is also a prefix-neighbor of an unrelated "Rays of
    // Hope Limited" by first-word overlap in the candidate pre-filter, and
    // two genuinely different companies can share a name prefix). This tier
    // therefore REQUIRES at least one corroborating key (open_date or
    // price_range_min agreement) before it will resolve, and declines to
    // match (same conflict-avoidance posture as the T-318 key/name
    // disagreement below) when more than one candidate corroborates.
    try {
      const prefixCandidates = normalizedName
        ? await ipoRepository.findByNormalizedNamePrefix(normalizedName)
        : [];

      // T-403 Tier-A review (item 3): a segment mismatch rules a candidate
      // out before corroboration is even considered — an SME and a
      // mainboard offering sharing a name prefix are two different listings.
      const segmentEligible = prefixCandidates.filter(
        (candidate) => !segmentsConflict(segment, candidate.segment) && !ofsIdentityConflict(offeringType, candidate.offeringType)
      );

      const corroborated = segmentEligible.filter((candidate) => {
        const boundaryKind = classifyPrefixBoundary(
          lightNormalizeForBoundaryCheck(companyName),
          lightNormalizeForBoundaryCheck(candidate.companyName)
        );

        const normalizedOpenDate = toCalendarDateString(openDate);
        const normalizedCandidateOpenDate = toCalendarDateString(candidate.openDate);
        const openDateMatches =
          normalizedOpenDate != null &&
          normalizedCandidateOpenDate != null &&
          normalizedOpenDate === normalizedCandidateOpenDate;
        const priceMatches =
          priceRangeMin != null &&
          candidate.priceRangeMin != null &&
          Number(candidate.priceRangeMin) === Number(priceRangeMin);

        // T-403 Tier-A review (item 2): a punctuation/exact boundary
        // ("Rays of Belief Limited" -> "Rays of Belief Limited- For Profit
        // Social Enterprise") needs only ONE corroborating key, as before.
        // A whitespace boundary ("Rays of Belief Limited" -> "Rays of
        // Belief Limited Holdings") is a WEAKER signal — that reads as a
        // different legal entity, not the same company under two names — so
        // it requires BOTH keys to agree before it can resolve.
        if (boundaryKind === 'whitespace') {
          return openDateMatches && priceMatches;
        }
        return openDateMatches || priceMatches;
      });

      if (corroborated.length === 1) {
        nameMatch = corroborated[0];
        nameMatchIsTier3b = true;
        logger.info({
          companyName,
          normalizedName,
          existingCompanyName: corroborated[0].companyName,
          existingSlug: corroborated[0].slug,
          newSlug: slug,
        }, '[W-108] Found existing IPO via tier 3b prefix-name matching with corroboration - preventing duplicate!');
      } else if (corroborated.length > 1) {
        logger.warn({
          companyName,
          normalizedName,
          candidateIds: corroborated.map((c) => c.id),
        }, '[W-108] Multiple tier 3b prefix candidates corroborated - declining to match (ambiguous)');
      }
    } catch (prefixError) {
      // Advisory, same posture as the fuzzy tier below: a lookup failure
      // must never fail resolution — fall through to the remaining tiers.
      logger.warn({
        companyName,
        normalizedName,
        error: prefixError instanceof Error ? prefixError.message : String(prefixError),
      }, '[W-108] Tier 3b prefix-name check failed (non-fatal) - continuing without it');
    }
  }

  if (!nameMatch) {
    // Tier 4: slug-based lookup (existing behavior), segment-guarded per
    // T-403 Tier-A review (item 3).
    const slugMatch = await ipoRepository.findBySlug(slug);
    if (slugMatch && segmentsConflict(segment, slugMatch.segment)) {
      logger.warn({
        companyName,
        normalizedName,
        identitySegment: segment,
        candidateSegment: slugMatch.segment,
        candidateId: slugMatch.id,
      }, '[T-403] Tier 4 slug match declined - segment mismatch');
    } else if (slugMatch && ofsIdentityConflict(offeringType, slugMatch.offeringType)) {
      logger.warn({
        companyName,
        normalizedName,
        identityOfferingType: offeringType,
        candidateOfferingType: slugMatch.offeringType,
        candidateId: slugMatch.id,
      }, '[T-478] Tier 4 slug match declined - OFS/IPO identity conflict');
    } else {
      nameMatch = slugMatch;
    }
  }

  if (!nameMatch) {
    // Tier 5 (T-293, P2-2a): the exact + compact-whitespace tiers above
    // cannot catch a genuine SPELLING typo ("Hybird" vs "Hybrid") — only a
    // similarity check can. Advisory check: a fuzzy-match failure (bad
    // connection, query error) MUST NEVER fail resolution — fall through to
    // "not found" and let the caller's normal not-found handling (create,
    // or the post-insert duplicate-sweep job) proceed.
    try {
      const fuzzyMatch = await ipoRepository.findByFuzzyName(normalizedName);
      if (fuzzyMatch && segmentsConflict(segment, fuzzyMatch.segment)) {
        // T-403 Tier-A review (item 3): a fuzzy (typo) name match across
        // segments is still a segment mismatch — decline it.
        logger.warn({
          companyName,
          normalizedName,
          identitySegment: segment,
          candidateSegment: fuzzyMatch.segment,
          candidateId: fuzzyMatch.id,
        }, '[T-403] Tier 5 fuzzy match declined - segment mismatch');
      } else if (fuzzyMatch && ofsIdentityConflict(offeringType, fuzzyMatch.offeringType)) {
        logger.warn({
          companyName,
          normalizedName,
          identityOfferingType: offeringType,
          candidateOfferingType: fuzzyMatch.offeringType,
          candidateId: fuzzyMatch.id,
        }, '[T-478] Tier 5 fuzzy match declined - OFS/IPO identity conflict');
      } else if (fuzzyMatch) {
        logger.info({
          companyName,
          normalizedName,
          existingCompanyName: fuzzyMatch.companyName,
          existingSlug: fuzzyMatch.slug,
          newSlug: slug,
        }, '[T-293] Found existing IPO via fuzzy (typo) name matching - preventing duplicate!');
        nameMatch = fuzzyMatch;
        nameMatchIsFuzzy = true;
      }
    } catch (fuzzyError) {
      logger.warn({
        companyName,
        normalizedName,
        error: fuzzyError instanceof Error ? fuzzyError.message : String(fuzzyError),
      }, '[T-293] Fuzzy duplicate check failed (non-fatal) - continuing without it');
    }
  }

  // OD-68 gate: whichever name tier (3, 3b, 4 slug, 5 fuzzy) produced the
  // match, a KNOWN open date or price band that differs means it is not this
  // row. Declined here; if nothing else binds, the caller's create is held by
  // `IPORepository.create` (never a second row, never written into this one).
  if (nameMatch) {
    const contradiction = nameMatchContradiction(identity, nameMatch, { looseTier: nameMatchIsTier3b || nameMatchIsFuzzy });
    if (contradiction) {
      logger.warn({
        companyName,
        normalizedName,
        openDate: toCalendarDateString(openDate ?? null),
        priceRangeMin: priceRangeMin ?? null,
        candidateId: nameMatch.id,
        candidateSlug: nameMatch.slug,
        candidateCompanyName: nameMatch.companyName,
        reason: contradiction,
      }, '[OD-68] name match declined - ' + contradiction + ' - not bound on the name');
      nameMatch = null;
      nameMatchIsTier3b = false;
      nameMatchIsFuzzy = false;
    } else {
      const incomingDay = toCalendarDateString(openDate ?? null);
      const candidateDay = toCalendarDateString((nameMatch.openDate as string | Date | null | undefined) ?? null);
      if (incomingDay && candidateDay && incomingDay !== candidateDay) {
        logger.info({
          companyName,
          candidateId: nameMatch.id,
          candidateSlug: nameMatch.slug,
          from: candidateDay,
          to: incomingDay,
        }, '[OD-68/OD-35] same offering, open date moved within 180 days - bound; the write updates the date');
      }
    }
  }

  // Tier 6 (OD-68 S3): the identity fold + the SAME open date. Catches a
  // stored name that carries page-title text in a shape the prefix tier cannot
  // see ("Rays of Belief Limited- For Profit Social Enterprise" vs an incoming
  // "Rays of Belief Limited" whose band disagrees with nothing but is not a
  // punctuation-boundary prefix). Bounded by the open-date query; binds only a
  // single, uncontradicted candidate of a compatible segment/offering type.
  if (!nameMatch && !keyMatch && openDate) {
    try {
      const finder = (ipoRepository as { findLiveByOpenDate?: (d: string | Date) => Promise<IPO[]> })
        .findLiveByOpenDate;
      // The STRICT fold: a bind has consequences, so "Laxmi India Finance" may
      // not meet "Laxmi Finance" here (PR #910 review round 1, MAJOR-3).
      const fold = strictIdentityCompanyName(companyName);
      if (fold && typeof finder === 'function') {
        const sameDay = (await finder.call(ipoRepository, openDate)) ?? [];
        const folded = sameDay.filter(
          (row) =>
            strictIdentityCompanyName(row.companyName) === fold &&
            !segmentsConflict(segment, row.segment) &&
            !ofsIdentityConflict(offeringType, row.offeringType) &&
            nameMatchContradiction(identity, row, { looseTier: true }) === null
        );
        if (folded.length === 1) {
          nameMatch = folded[0];
          logger.info({
            companyName,
            identityFold: fold,
            existingSlug: folded[0].slug,
            existingCompanyName: folded[0].companyName,
          }, '[OD-68] bound via the identity fold + same open date');
        } else if (folded.length > 1) {
          logger.warn({
            companyName,
            identityFold: fold,
            candidateIds: folded.map((r) => r.id),
            candidateSlugs: folded.map((r) => r.slug),
          }, '[OD-68] several rows share this identity fold and open date - declining to bind (ambiguous)');
        }
      }
    } catch (foldError) {
      logger.warn({
        companyName,
        error: foldError instanceof Error ? foldError.message : String(foldError),
      }, '[OD-68] identity-fold tier failed (non-fatal) - continuing without it');
    }
  }

  if (!keyMatch) {
    // §9.2 item 26 (Tier A review CRITICAL-1): an alias-only match was refused and nothing else
    // bound the record - hold it (OD-68), never create a second row from a kept identifier.
    if (!nameMatch && aliasHold) await holdAliasOnlyMatch(ipoRepository, identity, aliasHold);
    // No natural key present or no key hit at all — the pre-T-318 name-based
    // result is authoritative (this is also the path every keyless row, and
    // every existing caller/test, takes).
    return { row: nameMatch, tier: nameMatch ? 'name' : null };
  }

  if (!nameMatch || nameMatch.id === keyMatch.id) {
    // Either the name tier found nothing (key tier wins outright), or both
    // tiers agree on the same row (no conflict) — the key match is strictly
    // higher-confidence, so prefer it.
    return { row: keyMatch, tier: keyTier };
  }

  // T-318 conflict: the key tier (isin/symbol) resolved to a DIFFERENT row
  // than the name tier. Per the binding design constraint, do NOT silently
  // pick either row without logging — a structured warning always fires.
  //
  // T-403 Tier-A review (item 4): WHICH row wins now depends on how the
  // name tier found its match. Tier 3 (exact/compact-whitespace name) keeps
  // the pre-T-318 behavior — fall back to the name-based result, since that
  // is what every existing caller already relied on. Tier 3b (prefix +
  // corroboration) is a weaker, heuristic match than an exact-normalized-key
  // hit — when tier 3b is what produced `nameMatch`, the higher-confidence
  // key match wins instead. Either way, the disagreement is always logged so
  // it stays visible for a future merge_candidates surface.
  const resolution = nameMatchIsTier3b ? keyMatch : nameMatch;
  logger.warn({
    companyName,
    normalizedName,
    isin,
    symbol,
    keyMatchId: keyMatch.id,
    keyMatchCompanyName: keyMatch.companyName,
    nameMatchId: nameMatch.id,
    nameMatchCompanyName: nameMatch.companyName,
    nameMatchTier: nameMatchIsTier3b ? '3b' : 'exact-or-slug-or-fuzzy',
    resolution: nameMatchIsTier3b ? 'key-match' : 'name-match',
  }, 'identity_conflict: natural-key match and name match disagree on which row this is — falling back to the higher-confidence tier');

  return { row: resolution, tier: nameMatchIsTier3b ? keyTier : 'name' };
}
