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
import type { IPORepository } from './ipo-repository';
import type { IPO, IPOWithRelations } from './types';

/**
 * Normalize an open-date value (a `Date` object, an ISO string, or a bare
 * `YYYY-MM-DD` string) to its calendar-date string for tier 3b corroboration
 * (W-108b). `Date -> toISOString().slice(0, 10)` takes the UTC calendar day
 * (this codebase's UTC-date convention — see the module doc comment); a
 * string is truncated to its first 10 characters so an ISO-with-time value
 * ('2026-09-01T18:30:00.000Z') and a bare date ('2026-09-01') that name the
 * same UTC day compare equal. `null`/`undefined` pass through unchanged so
 * callers can still null-guard before comparing.
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
}

/**
 * Resolve the existing `ipos` row (if any) that an incoming write or guard
 * check should treat as "this company" — priority order:
 * isin (exact, normalized) -> nse/bse symbol (exact, normalized) ->
 * normalized-name -> prefix-name with corroboration (W-108) -> slug ->
 * fuzzy (typo) name.
 *
 * Callers MUST resolve identity ONCE per request and pass the SAME resolved
 * row to every downstream step (guard check + write) rather than calling
 * this a second time — a second, independently-timed resolution is exactly
 * how the guard and the write diverged before (§1.4).
 */
export async function resolveIpoRow(
  ipoRepository: IPORepository,
  identity: IpoIdentity
): Promise<IPO | IPOWithRelations | null> {
  const { companyName, normalizedName, slug, isin, symbol, openDate, priceRangeMin } = identity;

  // Tier 1: ISIN (exact, normalized). Highest-confidence natural key — a
  // 12-character code unique to the security. NULL-safe: findByIsin returns
  // null immediately for an absent/whitespace-only input, so an incoming
  // row with no ISIN can never "match" an existing row that also has no
  // ISIN (both null() calls short-circuit before querying).
  let keyMatch: IPO | null = isin ? await ipoRepository.findByIsin(isin) : null;

  // Tier 2: NSE/BSE ticker symbol (exact, normalized). Same NULL-safety
  // guarantee as ISIN. Deliberately queries ONLY the `symbol` column, never
  // `bseScripCode` — the two are separate keyspaces per the module doc
  // comment, and findBySymbol's implementation enforces this by construction.
  if (!keyMatch && symbol) {
    keyMatch = await ipoRepository.findBySymbol(symbol);
  }

  // Tier 3: normalized company name (existing behaviour, unchanged).
  let nameMatch: IPO | IPOWithRelations | null = normalizedName
    ? await ipoRepository.findByNormalizedName(normalizedName)
    : null;

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

      const corroborated = prefixCandidates.filter((candidate) => {
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
        return openDateMatches || priceMatches;
      });

      if (corroborated.length === 1) {
        nameMatch = corroborated[0];
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
    // Tier 4: slug-based lookup (existing behavior)
    nameMatch = await ipoRepository.findBySlug(slug);
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
      if (fuzzyMatch) {
        logger.info({
          companyName,
          normalizedName,
          existingCompanyName: fuzzyMatch.companyName,
          existingSlug: fuzzyMatch.slug,
          newSlug: slug,
        }, '[T-293] Found existing IPO via fuzzy (typo) name matching - preventing duplicate!');
      }
      nameMatch = fuzzyMatch;
    } catch (fuzzyError) {
      logger.warn({
        companyName,
        normalizedName,
        error: fuzzyError instanceof Error ? fuzzyError.message : String(fuzzyError),
      }, '[T-293] Fuzzy duplicate check failed (non-fatal) - continuing without it');
    }
  }

  if (!keyMatch) {
    // No natural key present or no key hit at all — the pre-T-318 name-based
    // result is authoritative (this is also the path every keyless row, and
    // every existing caller/test, takes).
    return nameMatch;
  }

  if (!nameMatch || nameMatch.id === keyMatch.id) {
    // Either the name tier found nothing (key tier wins outright), or both
    // tiers agree on the same row (no conflict) — the key match is strictly
    // higher-confidence, so prefer it.
    return keyMatch;
  }

  // T-318 conflict: the key tier (isin/symbol) resolved to a DIFFERENT row
  // than the name tier. Per the binding design constraint, do NOT silently
  // pick either row in this phase — log a structured warning and fall back
  // to the name-based result (the behavior every caller already had before
  // this task). A future phase may choose to surface this as a
  // merge_candidates row instead of merely logging it.
  logger.warn({
    companyName,
    normalizedName,
    isin,
    symbol,
    keyMatchId: keyMatch.id,
    keyMatchCompanyName: keyMatch.companyName,
    nameMatchId: nameMatch.id,
    nameMatchCompanyName: nameMatch.companyName,
  }, 'identity_conflict: natural-key match and name match disagree on which row this is — falling back to name-based resolution');

  return nameMatch;
}
