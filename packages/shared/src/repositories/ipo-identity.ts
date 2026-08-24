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
 * This is now the ONLY place the three-tier logic exists. Every caller
 * (guard or write) gets the identical resolution, in the identical order:
 * normalized-name -> slug -> fuzzy (typo) name. Do not change the order or
 * the fuzzy threshold without updating every caller's shared behaviour —
 * see the plan's B7 correction: there is deliberately no `mode` parameter,
 * because two independently-chosen modes is exactly how this bug reopened.
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
}

/**
 * Resolve the existing `ipos` row (if any) that an incoming write or guard
 * check should treat as "this company" — the three-tier lookup:
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
  const { companyName, normalizedName, slug } = identity;

  let existingIPO: IPO | IPOWithRelations | null = normalizedName
    ? await ipoRepository.findByNormalizedName(normalizedName)
    : null;

  if (!existingIPO) {
    // Fallback to slug-based lookup (existing behavior)
    existingIPO = await ipoRepository.findBySlug(slug);
  }

  if (!existingIPO) {
    // P2-2a (T-293): the exact + compact-whitespace tiers above cannot
    // catch a genuine SPELLING typo ("Hybird" vs "Hybrid") — only a
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
      existingIPO = fuzzyMatch;
    } catch (fuzzyError) {
      logger.warn({
        companyName,
        normalizedName,
        error: fuzzyError instanceof Error ? fuzzyError.message : String(fuzzyError),
      }, '[T-293] Fuzzy duplicate check failed (non-fatal) - continuing without it');
    }
  }

  return existingIPO;
}
