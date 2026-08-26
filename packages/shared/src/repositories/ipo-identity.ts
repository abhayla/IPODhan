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
 *     DIFFERENT existing rows) MUST NOT be silently resolved either way.
 *
 * T-339 (item 2 — key beats name, quarantine on disagreement): the T-318
 * phase logged that disagreement and then returned the NAME row, so the
 * write still landed — on whichever row the weaker tier picked. That is the
 * exact failure this task exists to close: on disagreement the row is now
 * NOT written at all. `resolveIpoRow` throws `IdentityQuarantineError`
 * carrying BOTH candidate ids; the scraper's caller records a quarantine
 * (an unresolved `data_conflicts` HOLD row, reusing the T-328 state shape —
 * no new table) plus a P1 owner page, and skips the IPO. The nightly
 * detection-floor audit FAILs while any quarantine row is older than 24h
 * (`k_identity_quarantine` in docs/reviews/detection-checks.json), so a
 * quarantine cannot sit unnoticed.
 */
import { logger } from '../logger';
import type { IPORepository } from './ipo-repository';
import type { IPO, IPOWithRelations } from './types';

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
}

/**
 * Thrown by `resolveIpoRow` when the natural-key tier (ISIN or exchange
 * symbol) and the name tier resolve to two DIFFERENT existing rows.
 *
 * The key is the stronger identifier, but "stronger" is not "certain": one
 * of the two rows is wrong, and we do not know which. Writing either one
 * risks moving live data onto the wrong company. So the write is refused
 * and the disagreement is quarantined for a human. Callers MUST NOT catch
 * this and fall back to a write — catch it, record the quarantine, skip.
 */
export class IdentityQuarantineError extends Error {
  readonly name = 'IdentityQuarantineError';
  /** Which key tier produced `keyMatchId` — useful in the quarantine record. */
  readonly keyTier: 'ISIN' | 'SYMBOL';
  readonly companyName: string;
  readonly normalizedName: string;
  readonly isin: string | null;
  readonly symbol: string | null;
  readonly keyMatchId: string;
  readonly keyMatchCompanyName: string;
  readonly nameMatchId: string;
  readonly nameMatchCompanyName: string;

  constructor(details: {
    keyTier: 'ISIN' | 'SYMBOL';
    companyName: string;
    normalizedName: string;
    isin?: string | null;
    symbol?: string | null;
    keyMatchId: string;
    keyMatchCompanyName: string;
    nameMatchId: string;
    nameMatchCompanyName: string;
  }) {
    super(
      `identity_quarantine: ${details.keyTier} key for "${details.companyName}" resolves to row ${details.keyMatchId} ` +
      `("${details.keyMatchCompanyName}") but the name tier resolves to row ${details.nameMatchId} ` +
      `("${details.nameMatchCompanyName}") — refusing to write either row`
    );
    this.keyTier = details.keyTier;
    this.companyName = details.companyName;
    this.normalizedName = details.normalizedName;
    this.isin = details.isin ?? null;
    this.symbol = details.symbol ?? null;
    this.keyMatchId = details.keyMatchId;
    this.keyMatchCompanyName = details.keyMatchCompanyName;
    this.nameMatchId = details.nameMatchId;
    this.nameMatchCompanyName = details.nameMatchCompanyName;
  }
}

/** Type guard usable across package boundaries (instanceof survives, but this is cheaper to mock). */
export function isIdentityQuarantineError(e: unknown): e is IdentityQuarantineError {
  return e instanceof IdentityQuarantineError
    || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'IdentityQuarantineError');
}

/**
 * Resolve the existing `ipos` row (if any) that an incoming write or guard
 * check should treat as "this company" — priority order:
 * isin (exact, normalized) -> nse/bse symbol (exact, normalized) ->
 * normalized-name -> slug -> fuzzy (typo) name.
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
  const { companyName, normalizedName, slug, isin, symbol } = identity;

  // Tier 1: ISIN (exact, normalized). Highest-confidence natural key — a
  // 12-character code unique to the security. NULL-safe: findByIsin returns
  // null immediately for an absent/whitespace-only input, so an incoming
  // row with no ISIN can never "match" an existing row that also has no
  // ISIN (both null() calls short-circuit before querying).
  let keyMatch: IPO | null = isin ? await ipoRepository.findByIsin(isin) : null;
  let keyTier: 'ISIN' | 'SYMBOL' = 'ISIN';

  // Tier 2: NSE/BSE ticker symbol (exact, normalized). Same NULL-safety
  // guarantee as ISIN. Deliberately queries ONLY the `symbol` column, never
  // `bseScripCode` — the two are separate keyspaces per the module doc
  // comment, and findBySymbol's implementation enforces this by construction.
  if (!keyMatch && symbol) {
    keyMatch = await ipoRepository.findBySymbol(symbol);
    if (keyMatch) keyTier = 'SYMBOL';
  }

  // Tier 3: normalized company name (existing behaviour, unchanged).
  let nameMatch: IPO | IPOWithRelations | null = normalizedName
    ? await ipoRepository.findByNormalizedName(normalizedName)
    : null;

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

  // T-339 (item 2): the key tier (isin/symbol) resolved to a DIFFERENT row
  // than the name tier. T-318 logged this and returned the NAME row — which
  // meant the write still landed, on the row the weaker tier chose. Now the
  // write is refused outright: throw, so no caller can persist anything for
  // this company until a human resolves which row is real. The caller
  // records the quarantine (see scraper/src/services/identity-quarantine.ts)
  // and skips.
  logger.error({
    companyName,
    normalizedName,
    isin: isin ?? null,
    symbol: symbol ?? null,
    keyTier,
    keyMatchId: keyMatch.id,
    keyMatchCompanyName: keyMatch.companyName,
    nameMatchId: nameMatch.id,
    nameMatchCompanyName: nameMatch.companyName,
  }, 'identity_quarantine: natural-key match and name match disagree on which row this is — refusing to write either row');

  throw new IdentityQuarantineError({
    keyTier,
    companyName,
    normalizedName,
    isin,
    symbol,
    keyMatchId: keyMatch.id,
    keyMatchCompanyName: keyMatch.companyName,
    nameMatchId: nameMatch.id,
    nameMatchCompanyName: nameMatch.companyName,
  });
}
