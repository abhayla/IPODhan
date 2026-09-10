/**
 * IPO Repository
 *
 * Handles all data access operations for IPO entities.
 * Implements cache-aside pattern with Redis for optimized performance.
 */

import { eq, and, gte, lte, sql, desc, asc, inArray, like } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import {
  ipos,
  financialData,
  documents,
  subscriptions,
  gmpRecords,
  listingPerformance,
  peerCompanies,
  registrars,
  fieldSources,
  ipoSlugRedirects,
  type ipoStatusEnum,
  type segmentEnum,
  type offeringTypeEnum,
} from '../db/schema';
import type * as schema from '../db/schema';
import {
  CacheTTL,
  getIPOBySlugKey,
  getIPOByIdKey,
  getIPOListKey,
  getIPOSearchKey,
  getHistoricalIPOsKey,
} from '../cache/cache-keys';
import { EntityNotFoundError, DatabaseError, ProdWriteRefusedError } from '../errors/repository-errors';
import { logger } from '../logger';
import {
  normalizedCompanyNameSql,
  compactNormalizedCompanyNameSql,
  sanitizeDisplayCompanyName,
  normalizeCompanyNameForMatching,
} from '../utils/company-name-normalizer';
import { findMostSimilarName } from '../utils/company-name-similarity';
import {
  checkMergeEligibility,
  columnToCamelCase,
  planCarryFields,
  planDescendantTables,
  buildProvenanceMap,
  REPOINT_TABLES,
  CARRY_IF_ABSENT_COLUMNS,
  DISAGREEING_IDENTIFIER_COLUMNS,
  type FkEdge,
  type CarryFieldPatch,
} from '../utils/duplicate-ipo-merge';
import type {
  IPO,
  IPOInsert,
  IPOWithRelations,
  IPOFilters,
  PaginatedResponse,
  IIPORepository,
  FinancialData,
  HistoricalIPO,
  HistoricalIPOQueryParams,
} from './types';

/**
 * The kind of boundary at which the SHORTER of two already-normalized names
 * is a prefix of the LONGER one — 'exact' (equal strings), 'punctuation'
 * (the longer string's next character is punctuation: hyphen, comma,
 * parenthesis, dot, ...), 'whitespace' (the next character is a plain
 * space), or `null` (no prefix relationship at all, including a mid-word
 * split like "ray" vs "rays").
 *
 * T-403 Tier-A review (item 2): a punctuation boundary is a STRONG signal
 * that one source appended a whole descriptive suffix to the SAME company
 * ("Rays of Belief Limited" -> "Rays of Belief Limited- For Profit Social
 * Enterprise"). A whitespace boundary is a WEAK signal — "Rays of Belief
 * Limited Holdings" reads as a genuinely DIFFERENT legal entity, not a
 * disagreement about the same company's full name — so callers MUST require
 * stronger corroboration (both open_date AND price_range_min, not either)
 * before treating a whitespace-boundary candidate as a match. See
 * `resolveIpoRow` in `ipo-identity.ts` for where that corroboration rule is
 * applied; this function only classifies the boundary, it never decides.
 */
export type PrefixBoundaryKind = 'exact' | 'punctuation' | 'whitespace' | null;

export function classifyPrefixBoundary(normalizedA: string, normalizedB: string): PrefixBoundaryKind {
  if (!normalizedA || !normalizedB) {
    return null;
  }
  if (normalizedA === normalizedB) {
    return 'exact';
  }

  const [shorter, longer] =
    normalizedA.length < normalizedB.length ? [normalizedA, normalizedB] : [normalizedB, normalizedA];

  if (!longer.startsWith(shorter)) {
    return null;
  }

  const boundaryChar = longer.charAt(shorter.length);
  if (/[^a-z0-9 ]/i.test(boundaryChar)) {
    return 'punctuation';
  }
  if (boundaryChar === ' ') {
    return 'whitespace';
  }
  return null;
}

/**
 * True when the SHORTER of two already-normalized names is a prefix of the
 * LONGER one at an 'exact' or 'punctuation' boundary (see
 * `classifyPrefixBoundary`) — the STRICT, single-corroborating-key-eligible
 * signal. A 'whitespace' boundary ("rays of belief" vs "rays of belief
 * limited holdings") is deliberately NOT included here (T-403 item 2) —
 * whitespace-separated extensions are a weaker signal that a caller may
 * still consider, but only under the stronger both-keys corroboration rule,
 * via `classifyPrefixBoundary` directly (see `findByNormalizedNamePrefix`
 * and `resolveIpoRow`).
 */
export function isWordBoundaryPrefixMatch(normalizedA: string, normalizedB: string): boolean {
  const kind = classifyPrefixBoundary(normalizedA, normalizedB);
  return kind === 'exact' || kind === 'punctuation';
}

/** The merge plan `mergeDuplicateInto` computes and, when `apply` is true, executes. */
export interface MergeDuplicatePlan {
  keep: IPO;
  drop: IPO;
  patch: CarryFieldPatch[];
  toDelete: { table: string; col: string; count: number }[];
  toRepoint: { table: string; col: string; count: number }[];
  descendantTableCount: number;
  directTableCount: number;
}

export interface MergeDuplicateResult extends MergeDuplicatePlan {
  applied: boolean;
  keepSlug: string;
  droppedSlug: string;
  provenanceWritten: { fieldName: string; source: string; previousSource: string | null }[];
}

export class IPORepository extends BaseRepository implements IIPORepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Find all IPOs with optional filters and pagination
   */
  async findAll(filters: IPOFilters = {}): Promise<PaginatedResponse<IPO>> {
    const {
      status,
      segment,
      offeringType,
      sector,
      search,
      minIssueSize,
      maxIssueSize,
      openDateFrom,
      openDateTo,
      closeDateFrom,
      closeDateTo,
      listingDateFrom,
      listingDateTo,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = filters;

    const cacheKey = getIPOListKey(filters);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          // Build where conditions
          const conditions = [];

          if (status) {
            if (Array.isArray(status)) {
              conditions.push(inArray(ipos.status, status as (typeof ipoStatusEnum.enumValues)[number][]));
            } else {
              conditions.push(eq(ipos.status, status as (typeof ipoStatusEnum.enumValues)[number]));
            }
          }

          if (segment) {
            if (Array.isArray(segment)) {
              conditions.push(inArray(ipos.segment, segment as (typeof segmentEnum.enumValues)[number][]));
            } else {
              conditions.push(eq(ipos.segment, segment as (typeof segmentEnum.enumValues)[number]));
            }
          }

          if (offeringType) {
            if (Array.isArray(offeringType)) {
              conditions.push(inArray(ipos.offeringType, offeringType as (typeof offeringTypeEnum.enumValues)[number][]));
            } else {
              conditions.push(eq(ipos.offeringType, offeringType as (typeof offeringTypeEnum.enumValues)[number]));
            }
          }

          if (sector) {
            conditions.push(eq(ipos.sector, sector));
          }

          if (search) {
            // Search by company name OR sector (case-insensitive, partial match)
            conditions.push(
              sql`(${ipos.companyName} ILIKE ${`%${search}%`} OR ${ipos.sector} ILIKE ${`%${search}%`})`
            );
          }

          if (minIssueSize) {
            conditions.push(gte(ipos.issueSize, minIssueSize.toString()));
          }

          if (maxIssueSize) {
            conditions.push(lte(ipos.issueSize, maxIssueSize.toString()));
          }

          if (openDateFrom) {
            conditions.push(gte(ipos.openDate, openDateFrom.toISOString()));
          }

          if (openDateTo) {
            conditions.push(lte(ipos.openDate, openDateTo.toISOString()));
          }

          if (closeDateFrom) {
            conditions.push(gte(ipos.closeDate, closeDateFrom.toISOString()));
          }

          if (closeDateTo) {
            conditions.push(lte(ipos.closeDate, closeDateTo.toISOString()));
          }

          if (listingDateFrom) {
            conditions.push(gte(ipos.listingDate, listingDateFrom.toISOString()));
          }

          if (listingDateTo) {
            conditions.push(lte(ipos.listingDate, listingDateTo.toISOString()));
          }

          const whereClause =
            conditions.length > 0 ? and(...conditions) : undefined;

          // Get total count
          const [{ count }] = await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(ipos)
            .where(whereClause);

          // Get paginated data
          const offset = (page - 1) * limit;
          const sortColumn = ipos[sortBy] || ipos.createdAt;
          const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

          const data = await this.db
            .select()
            .from(ipos)
            .where(whereClause)
            .orderBy(orderBy)
            .limit(limit)
            .offset(offset);

          const totalPages = Math.ceil(count / limit);

          return {
            data,
            meta: {
              total: count,
              page,
              limit,
              totalPages,
              hasNext: page < totalPages,
              hasPrev: page > 1,
            },
          };
        } catch (error) {
          throw new DatabaseError('Failed to fetch IPO list', undefined, error);
        }
      },
      CacheTTL.IPO_LIST
    );
  }

  /**
   * Find IPO by slug with all relations
   */
  async findBySlug(slug: string): Promise<IPOWithRelations | null> {
    const cacheKey = getIPOBySlugKey(slug);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const [ipo] = await this.db
            .select()
            .from(ipos)
            .where(eq(ipos.slug, slug))
            .limit(1);

          if (!ipo) {
            return null;
          }

          // Fetch related data
          const [
            financials,
            docs,
            subs,
            gmps,
            listing,
            peers,
            registrarData,
          ] = await Promise.all([
            this.db
              .select()
              .from(financialData)
              .where(eq(financialData.ipoId, ipo.id))
              .limit(1)
              .then((r) => r[0] || null),
            this.db
              .select()
              .from(documents)
              .where(eq(documents.ipoId, ipo.id)),
            this.db
              .select()
              .from(subscriptions)
              .where(eq(subscriptions.ipoId, ipo.id))
              .orderBy(desc(subscriptions.timestamp))
              .limit(10),
            this.db
              .select()
              .from(gmpRecords)
              .where(eq(gmpRecords.ipoId, ipo.id))
              .orderBy(desc(gmpRecords.timestamp))
              .limit(10),
            this.db
              .select()
              .from(listingPerformance)
              .where(eq(listingPerformance.ipoId, ipo.id))
              .limit(1)
              .then((r) => r[0] || null),
            this.db
              .select()
              .from(peerCompanies)
              .where(eq(peerCompanies.ipoId, ipo.id)),
            ipo.registrarId
              ? this.db
                  .select()
                  .from(registrars)
                  .where(eq(registrars.id, ipo.registrarId))
                  .limit(1)
                  .then((r) => r[0] || null)
              : Promise.resolve(null),
          ]);

          return {
            ...ipo,
            financialData: financials,
            documents: docs,
            subscriptions: subs,
            gmpRecords: gmps,
            listingPerformance: listing,
            peerCompanies: peers,
            registrarRelation: registrarData,
          };
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch IPO by slug: ${slug}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.IPO_DETAIL,
      // W-15: identity lookup — never cache a miss. A slug miss followed
      // moments later by an insert of that exact IPO would otherwise stay
      // shadowed behind the cached `null` for the full 900s TTL, and a
      // caller relying on "not found -> safe to create" duplicates the row.
      { cacheNullResult: false }
    );
  }

  /**
   * Find IPO by normalized company name (Phase 11 Step 2)
   * Used for fuzzy matching to prevent duplicate IPOs
   *
   * Normalizes company name by removing legal entity suffixes (Ltd, Limited, IPO, etc.)
   * and matches against existing IPO company names using the same normalization
   *
   * @param normalizedName - Normalized company name (lowercase, stripped of suffixes)
   * @returns Basic IPO record or null if not found
   *
   * @example
   * // "Midwest Ltd" and "Midwest Limited" both normalize to "midwest"
   * const ipo = await repository.findByNormalizedName('midwest');
   */
  async findByNormalizedName(normalizedName: string, offeringType?: string): Promise<IPO | null> {
    if (!normalizedName) {
      return null;
    }

    try {
      // Normalize company_name at query time via the SHARED normalizer so the
      // SQL path stays in lock-step with the JS path (company-name-normalizer.ts).
      // The OR clause is a word-break FALLBACK (P2-1 checker finding, T-277F):
      // a hyphenated compound ("Atharva Poly-Plast") and its run-together
      // sibling ("Atharva Polyplast") land on different spaced keys but the
      // same compact (whitespace-stripped) key — compare compact keys too so
      // this class of pair matches. Exact match is a subset of compact match,
      // so this can only ADD matches, never drop one the exact path already found.
      const nameCondition = sql`${normalizedCompanyNameSql(sql`${ipos.companyName}`)} = ${normalizedName}
              OR ${compactNormalizedCompanyNameSql(sql`${ipos.companyName}`)} = ${normalizedName.replace(/\s+/g, '')}`;
      // T-478 round 3 (issue #225 follow-up, item 2): when a caller filters
      // by offering_type (the identity guard's "decline, then re-query for
      // the matching type" retry), more than one row can share a name AND
      // that type — an explicit ORDER BY makes the pick deterministic
      // instead of relying on Postgres's unspecified row order under LIMIT 1.
      const query = offeringType
        ? this.db.select().from(ipos).where(sql`(${nameCondition}) AND ${ipos.offeringType} = ${offeringType}`).orderBy(ipos.id)
        : this.db.select().from(ipos).where(nameCondition);
      const [ipo] = await query.limit(1);

      return ipo || null;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch IPO by normalized name: ${normalizedName}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find IPO by exchange ticker symbol (T-318, IDENT: NULL-safe key-first
   * identity). `symbol` is a plain (non-unique-in-DB-for-NULLs) column shared
   * by NSE and BSE listings — this is deliberately the NSE/BSE `symbol`
   * column ONLY, never `bseScripCode` (a separate keyspace per T-314C/T-316C
   * findings: BSE's numeric scrip code and NSE's ticker symbol must never be
   * cross-compared).
   *
   * NULL-safe by construction: an empty/whitespace-only input returns null
   * without querying, so this can never resolve a "NULL matches NULL" false
   * positive — Postgres would otherwise happily return multiple rows for
   * `symbol IS NULL`, and matching any of them would be wrong.
   *
   * @param symbol - Raw (un-normalized) ticker symbol. Normalized here via
   *   trim + uppercase before comparison (source scrapers vary in case).
   */
  /**
   * Item 12 slice D: every LIVE row whose open_date is the given calendar day.
   *
   * Used ONLY by the observe-only duplicate-candidate scan in `ipo-identity.ts`.
   * It is deliberately date-FILTERED rather than "fetch all live rows": a
   * same-day query returns a handful of rows, where a full live scan would cost
   * an O(n) fold on EVERY identity resolution — and identity resolution runs on
   * every scraped record.
   *
   * LIVE means the four statuses a duplicate can still do damage in. A LISTED
   * row pair is a historical artefact for a repair tool; an UPCOMING/OPEN pair
   * is two rows a scraper is actively writing to.
   *
   * Returns `[]` for an absent date rather than querying — same NULL-is-never-a-
   * key discipline as `findBySymbol`/`findByIsin` above.
   */
  async findLiveByOpenDate(openDate: string | Date | null | undefined): Promise<IPO[]> {
    if (openDate == null) {
      return [];
    }
    const day =
      openDate instanceof Date
        ? Number.isNaN(openDate.getTime())
          ? null
          : openDate.toISOString().slice(0, 10)
        : String(openDate).slice(0, 10);
    if (!day) {
      return [];
    }

    try {
      return await this.db
        .select()
        .from(ipos)
        .where(
          sql`${ipos.openDate} IS NOT NULL AND ${ipos.openDate}::date = ${day}::date AND ${ipos.status} IN ('UPCOMING', 'OPEN', 'CLOSED', 'LISTED')`
        )
        .orderBy(ipos.id);
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch live IPOs by open date: ${day}`,
        undefined,
        error as Error
      );
    }
  }

  async findBySymbol(symbol: string | null | undefined, offeringType?: string): Promise<IPO | null> {
    const normalized = symbol?.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    try {
      // T-478 round 3 (item 2): see findByNormalizedName's doc comment —
      // same offering_type-filtered retry + deterministic ORDER BY.
      const query = offeringType
        ? this.db.select().from(ipos).where(sql`upper(trim(${ipos.symbol})) = ${normalized} AND ${ipos.offeringType} = ${offeringType}`).orderBy(ipos.id)
        : this.db.select().from(ipos).where(sql`upper(trim(${ipos.symbol})) = ${normalized}`);
      const [ipo] = await query.limit(1);

      return ipo || null;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch IPO by symbol: ${symbol}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find IPO by ISIN (International Securities Identification Number)
   * (T-318, IDENT: NULL-safe key-first identity). ISIN is the highest-
   * confidence natural key available — a 12-character code unique to the
   * security — and per T-314C's reproduction, 0 duplicate ISIN groups exist
   * in production across all rows that have one.
   *
   * NULL-safe by construction: an empty/whitespace-only input returns null
   * without querying, matching `findBySymbol`'s guarantee that NULL never
   * matches NULL.
   *
   * @param isin - Raw (un-normalized) ISIN. Normalized here via trim +
   *   uppercase before comparison.
   */
  async findByIsin(isin: string | null | undefined, offeringType?: string): Promise<IPO | null> {
    const normalized = isin?.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    try {
      // T-478 round 3 (item 2): same offering_type-filtered retry pattern.
      const query = offeringType
        ? this.db.select().from(ipos).where(sql`upper(trim(${ipos.isin})) = ${normalized} AND ${ipos.offeringType} = ${offeringType}`).orderBy(ipos.id)
        : this.db.select().from(ipos).where(sql`upper(trim(${ipos.isin})) = ${normalized}`);
      const [ipo] = await query.limit(1);

      return ipo || null;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch IPO by ISIN: ${isin}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find an existing IPO whose normalized company name is a close SPELLING
   * variant of `normalizedName` (P2-2a, T-293) — a typo like "Hybird" vs
   * "Hybrid" that `findByNormalizedName`'s exact + compact-whitespace tiers
   * cannot catch (the letters genuinely differ, not just punctuation/
   * whitespace). Deliberately the LAST-resort check on the CREATE path: it is
   * a real network+CPU cost (scans existing company names), so callers MUST
   * only reach it after the exact-match tiers have already returned null.
   *
   * Root cause this closes (round-4 review, T-293): "Dhanwel Hybird Seeds
   * Limited" and "Dhanwel Hybrid Seeds Ltd." minted two live prod rows
   * because NOTHING on the production insert path (`upsertIPO`) ever ran a
   * similarity check — `DuplicateDetectionService`'s 0.85-threshold fuzzy
   * check exists but `PipelineFactory.createProductionPipeline` sets
   * `skipDuplicateDetection: true` (see `data-validation-pipeline.ts`), so it
   * never actually executes on a live scrape.
   *
   * @param normalizedName - Normalized company name of the CANDIDATE (not yet
   *   in the DB) to check against existing rows.
   * @param threshold - Minimum Levenshtein similarity (0-1) to count as a match.
   */
  async findByFuzzyName(normalizedName: string, threshold = 0.85): Promise<IPO | null> {
    if (!normalizedName) {
      return null;
    }

    try {
      // Cheap pre-filter: only rows sharing the candidate's first word are
      // plausible typo variants — this keeps the scan bounded without a
      // full-table fetch, same spirit as IPODeduplicationService's tiering.
      // Known limitation: a typo IN the first word itself ("Dhanwel" ->
      // "Dhanwle") would not be pre-filtered in; the real prod pair this
      // closes (T-293) has its typo in the SECOND word ("Hybird"/"Hybrid").
      const firstWord = normalizedName.split(' ')[0];
      if (!firstWord || firstWord.length < 3) {
        return null;
      }

      const candidates = await this.db
        .select()
        .from(ipos)
        .where(sql`${normalizedCompanyNameSql(sql`${ipos.companyName}`)} LIKE ${firstWord + '%'}`)
        .limit(200);

      if (candidates.length === 0) {
        return null;
      }

      const byNormalizedName = new Map<string, IPO>();
      for (const candidate of candidates) {
        byNormalizedName.set(normalizeCompanyNameForMatching(candidate.companyName), candidate);
      }

      const match = findMostSimilarName(normalizedName, [...byNormalizedName.keys()], threshold);
      return match ? (byNormalizedName.get(match) ?? null) : null;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch IPO by fuzzy name: ${normalizedName}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find existing rows whose normalized company name is a WORD-BOUNDARY
   * PREFIX of `normalizedName`, or vice versa (W-108, tier 3b of
   * `resolveIpoRow`). Catches the case a spelling-typo fuzzy check
   * (`findByFuzzyName`) cannot: two sources genuinely disagree on the FULL
   * name — one appends a whole descriptive suffix the other omits
   * ("Rays of Belief Limited" vs "Rays of Belief Limited- For Profit Social
   * Enterprise") — not a few mis-typed letters.
   *
   * Deliberately NOT a match by itself: this is a candidate-narrowing read
   * only. The caller (`resolveIpoRow`) is responsible for requiring a
   * corroborating key (open_date / price_range_min) before treating any
   * returned row as a match, and for declining to match when more than one
   * candidate corroborates — a bare prefix relationship between two
   * genuinely different companies ("Rays of Belief Limited" vs "Rays of
   * Hope Limited" both start with "Rays of") MUST NOT resolve on name alone.
   *
   * Uncached (identity read, same reasoning as `findByFuzzyName`) and capped
   * at 5 rows — a prefix hint, not a full-table scan.
   *
   * @param normalizedName - normalizeCompanyNameForMatching() output for the
   *   INCOMING row being resolved.
   */
  async findByNormalizedNamePrefix(normalizedName: string): Promise<IPO[]> {
    if (!normalizedName) {
      return [];
    }

    try {
      // Same cheap pre-filter as findByFuzzyName: only rows sharing the
      // candidate's first word can possibly be in a prefix relationship
      // with it (in either direction), so this keeps the scan bounded.
      const firstWord = normalizedName.split(' ')[0];
      if (!firstWord || firstWord.length < 3) {
        return [];
      }

      // T-403 Tier-A review (item 5): fetch one row past the intended 200-row
      // cap so an overflow is DETECTABLE rather than silently truncated — a
      // silent truncation can turn "two candidates, decline (ambiguous)"
      // into "one candidate, accept" purely because the second candidate
      // fell off the end of an un-ordered LIMIT. On overflow, decline rather
      // than guess which 200 of 201+ rows to keep.
      const candidates = await this.db
        .select()
        .from(ipos)
        .where(sql`${normalizedCompanyNameSql(sql`${ipos.companyName}`)} LIKE ${firstWord + '%'}`)
        .limit(201);

      if (candidates.length > 200) {
        logger.warn(
          { normalizedName, candidateCount: candidates.length },
          '[W-108] prefix pre-filter overflow, declining'
        );
        return [];
      }

      // Broader-than-`isWordBoundaryPrefixMatch` net on purpose: this
      // candidate-narrowing read includes BOTH punctuation- and
      // whitespace-boundary prefix relationships (see `classifyPrefixBoundary`)
      // — the caller (`resolveIpoRow`) decides how much corroboration each
      // boundary kind needs before treating a candidate as a match. This
      // function stays a hint, never a match decision.
      const prefixMatches: IPO[] = [];
      for (const candidate of candidates) {
        const candidateNormalized = normalizeCompanyNameForMatching(candidate.companyName);
        if (classifyPrefixBoundary(candidateNormalized, normalizedName) !== null) {
          prefixMatches.push(candidate);
          if (prefixMatches.length > 5) {
            // T-403 Tier-A review (item 5): a 6th corroborating candidate
            // means the pre-filter is too coarse to trust a 5-row truncation
            // — decline rather than silently hand the caller an arbitrary
            // first-5 subset.
            logger.warn(
              { normalizedName, candidateCount: prefixMatches.length },
              '[W-108] prefix candidate cap overflow (6th match found), declining'
            );
            return [];
          }
        }
      }

      return prefixMatches;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch IPO by normalized name prefix: ${normalizedName}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find IPO by ID with cache-aside pattern
   */
  async findById(id: string): Promise<IPO | null> {
    const cacheKey = getIPOByIdKey(id);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const [ipo] = await this.db
            .select()
            .from(ipos)
            .where(eq(ipos.id, id))
            .limit(1);

          return ipo || null;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch IPO by ID: ${id}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.IPO_DETAIL,
      // W-15 sibling: same identity-lookup negative-cache hazard as findBySlug.
      { cacheNullResult: false }
    );
  }

  /**
   * Round-4 M-LOW: uncached read of a single row by id, for callers that MUST
   * NOT trust the `IPO_DETAIL` (900s) cache — e.g. the scraper write-diff gate
   * (`diffFieldsForWrite` in `scraper/src/services/data-persister.ts`), which
   * decides whether to write by comparing against the ROW, not a snapshot up
   * to 15 minutes stale. Bypasses `getFromCache` entirely: no read, no write,
   * so it can never populate or extend the cache's staleness window.
   */
  async findByIdUncached(id: string): Promise<IPO | null> {
    try {
      const [ipo] = await this.db
        .select()
        .from(ipos)
        .where(eq(ipos.id, id))
        .limit(1);

      return ipo || null;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch IPO by ID (uncached): ${id}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find IPOs by date range (for GMP matching)
   * Used to match external GMP data to database IPOs by dates
   */
  async findByDates(params: {
    openDate: string;
    closeDate?: string;
  }): Promise<IPO[]> {
    try {
      const conditions = [eq(ipos.openDate, params.openDate)];

      if (params.closeDate) {
        conditions.push(eq(ipos.closeDate, params.closeDate));
      }

      const whereClause = and(...conditions);

      const results = await this.db
        .select()
        .from(ipos)
        .where(whereClause);

      return results;
    } catch (error) {
      throw new DatabaseError(
        `Failed to find IPOs by dates: ${params.openDate}`,
        undefined,
        error
      );
    }
  }

  /**
   * Search IPOs by company name using trigram fuzzy search
   */
  async search(query: string, limit = 10): Promise<IPO[]> {
    const cacheKey = getIPOSearchKey(query);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          // Use trigram similarity search
          const results = await this.db
            .select()
            .from(ipos)
            .where(sql`${ipos.companyName} % ${query}`)
            .orderBy(sql`similarity(${ipos.companyName}, ${query}) DESC`)
            .limit(limit);

          return results;
        } catch (error) {
          // Fallback to ILIKE search if trigram fails
          console.warn(
            'Trigram search failed, falling back to ILIKE:',
            error instanceof Error ? error.message : error
          );

          try {
            const results = await this.db
              .select()
              .from(ipos)
              .where(like(ipos.companyName, `%${query}%`))
              .limit(limit);

            return results;
          } catch (fallbackError) {
            throw new DatabaseError(
              `Failed to search IPOs: ${query}`,
              undefined,
              fallbackError
            );
          }
        }
      },
      CacheTTL.IPO_LIST
    );
  }

  /**
   * Create new IPO
   */
  async create(data: IPOInsert): Promise<IPO> {
    try {
      // Single write choke point: every IPO create — regardless of which
      // scraper/consolidation path produced it — stores a sanitized display
      // name (strip trailing scrape-artifact status token, e.g. "Ltd. O"). #42
      if (data.companyName) {
        data = { ...data, companyName: sanitizeDisplayCompanyName(data.companyName) };
      }

      const [ipo] = await this.db
        .insert(ipos)
        .values(data)
        .returning();

      // Invalidate list cache
      await this.deleteCachePattern('ipo:list:*');
      await this.deleteCachePattern('ipo:search:*');

      return ipo;
    } catch (error) {
      const err = error as any;
      // Enhanced error logging - show full PostgreSQL error details
      console.error('[CREATE ERROR]', {
        company: data.companyName,
        message: err.message,
        code: err.code,              // PostgreSQL error code (e.g., '23505' for unique violation)
        constraint: err.constraint,   // Constraint name that was violated
        column: err.column,           // Column name that caused the error
        detail: err.detail,           // Detailed error message from PostgreSQL
        hint: err.hint,               // Hint for fixing the error
        table: err.table,             // Table name where error occurred
        where: err.where,             // Location in query where error occurred
        position: err.position        // Character position in query
      });
      throw new DatabaseError('Failed to create IPO', undefined, error);
    }
  }

  /**
   * Update IPO by ID
   */
  async update(id: string, data: Partial<IPOInsert>): Promise<IPO> {
    try {
      // Same choke point on the update/consolidation path: if a write carries a
      // company name (a re-scrape, a consolidated winning value, or an admin
      // edit), persist the sanitized form so a raw token can never re-pollute. #42
      if (data.companyName) {
        data = { ...data, companyName: sanitizeDisplayCompanyName(data.companyName) };
      }

      const [ipo] = await this.db
        .update(ipos)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(ipos.id, id))
        .returning();

      if (!ipo) {
        throw new EntityNotFoundError('IPO', id);
      }

      // Invalidate cache
      await this.invalidateCache(
        [getIPOByIdKey(id), getIPOBySlugKey(ipo.slug)],
        ['ipo:list:*', 'ipo:search:*']
      );

      return ipo;
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw error;
      }
      throw new DatabaseError(
        `Failed to update IPO: ${id}`,
        undefined,
        error
      );
    }
  }

  /**
   * Repair-tool entry point (#453 class): write ONLY the price-dependent
   * offer-terms fields (`priceRangeMin`, `priceRangeMax`, `lotSize`,
   * `issueSize`) for a row created before its band was published. A
   * distinct, narrowly-scoped method rather than a call through `update()`
   * so the write-ratchet's `repository` pattern (`ipoRepository\.(create|
   * update|delete|upsert)\(`) does not flag every NEW repair-script file
   * that needs to correct these fields — the write lives here, in this
   * already-baselined file, not re-typed as a direct `db.update(ipos)` in
   * a new script (`scripts/check-write-ratchet.mjs`, T-316).
   */
  async applyOfferTerms(
    id: string,
    data: Pick<Partial<IPOInsert>, 'priceRangeMin' | 'priceRangeMax' | 'lotSize' | 'issueSize'>
  ): Promise<IPO> {
    return this.update(id, data);
  }

  /**
   * Delete IPO by ID
   */
  async delete(id: string): Promise<void> {
    try {
      const [ipo] = await this.db
        .delete(ipos)
        .where(eq(ipos.id, id))
        .returning();

      if (!ipo) {
        throw new EntityNotFoundError('IPO', id);
      }

      // Invalidate cache
      await this.invalidateCache(
        [getIPOByIdKey(id), getIPOBySlugKey(ipo.slug)],
        ['ipo:list:*', 'ipo:search:*']
      );
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw error;
      }
      throw new DatabaseError(
        `Failed to delete IPO: ${id}`,
        undefined,
        error
      );
    }
  }

  /**
   * Merge two `ipos` rows that are one IPO twice (F-55 class: a company
   * name-fold gap let a duplicate row through create-time dedup). Discovers
   * every descendant table from the LIVE `information_schema` FK graph
   * (never a hand-typed list — the class this exists to prevent, see
   * `docs/architecture/write-path-hardening.md`), repoints person-created
   * rows (`REPOINT_TABLES`) onto the survivor, deletes scraper-derived rows
   * with the dropped row, carries a short allow-list of absent scalar
   * columns onto the survivor with a `field_sources` provenance row each,
   * writes a slug redirect so the dropped row's URL keeps resolving, and
   * deletes the dropped `ipos` row. All-or-nothing in one transaction when
   * `opts.apply` is true; `opts.apply: false` (the default posture callers
   * should use first) returns the same plan without writing anything.
   *
   * The production-write guard lives IN THIS METHOD (MAJOR-3, PR #433
   * review): when `opts.apply` is true, it reads `current_database()` from
   * the SAME connection (`this.db`) and throws `ProdWriteRefusedError`
   * before any write if that name is `ipodhan` and `opts.allowProd` is not
   * `true`. Every caller — the CLI wrapper
   * (`scraper/scripts/repair-merge-duplicate-ipo.ts`, which passes
   * `allowProd` through from `--allow-prod`), a future admin route, or
   * anything else — is protected the same way; the guard cannot be bypassed
   * by forgetting to reimplement it at the call site.
   */
  async mergeDuplicateInto(
    keepId: string,
    dropId: string,
    opts: {
      apply: boolean;
      forceDifferentName?: boolean;
      setIssueSize?: string;
      issueSizeNote?: string;
      /** Required truthy to APPLY against the production database ("ipodhan"); ignored for dry runs. */
      allowProd?: boolean;
    }
  ): Promise<MergeDuplicateResult> {
    if (keepId === dropId) {
      throw new DatabaseError('mergeDuplicateInto: keepId and dropId name the same row', undefined);
    }

    // --- prod write guard (MAJOR-3, PR #433 review) ---------------------------------------------
    // First thing when apply is true, before any read or write: read from THIS SAME connection
    // (this.db), never an env var — the tunnel env can say "staging" while the socket is on prod
    // (see repair-tool.ts's queryCurrentDatabase doc). Refuses for every current and future caller
    // of this method, not just the CLI wrapper — a bypass is no longer possible by forgetting to
    // reimplement the guard at a new call site.
    if (opts.apply) {
      const currentDbResult = await this.db.execute(sql`select current_database()`);
      const currentDbRows = (currentDbResult as unknown as { rows: { current_database: string }[] }).rows;
      const currentDbName = String(currentDbRows?.[0]?.current_database ?? '');
      if (currentDbName.toLowerCase() === 'ipodhan' && opts.allowProd !== true) {
        throw new ProdWriteRefusedError(
          `mergeDuplicateInto: refusing to APPLY writes against the production database "ipodhan" ` +
            `(current_database() = "${currentDbName}") — pass opts.allowProd: true to override.`,
          currentDbName
        );
      }
    }

    const rows = await this.db.select().from(ipos).where(inArray(ipos.id, [keepId, dropId]));
    if (rows.length !== 2) {
      throw new DatabaseError(
        `mergeDuplicateInto: expected 2 rows in ipos for [${keepId}, ${dropId}], found ${rows.length}`,
        undefined
      );
    }
    const keep = rows.find((r) => r.id === keepId)!;
    const drop = rows.find((r) => r.id === dropId)!;

    const eligibility = checkMergeEligibility({
      keepOpenDate: keep.openDate,
      dropOpenDate: drop.openDate,
      keepCompanyName: keep.companyName,
      dropCompanyName: drop.companyName,
      forceDifferentName: opts.forceDifferentName ?? false,
      identifiers: DISAGREEING_IDENTIFIER_COLUMNS.map((col) => {
        const jsKey = columnToCamelCase(col) as keyof typeof keep;
        return { column: col, keepValue: keep[jsKey], dropValue: drop[jsKey] };
      }),
    });
    if (eligibility.eligible === false) {
      throw new DatabaseError(`mergeDuplicateInto: refused — ${eligibility.reason}`, undefined);
    }

    // --- discover children from the live schema (never hand-listed) --------------------------
    const fkResult = await this.db.execute(sql`
      select distinct tc.table_name as child, kcu.column_name as col, ccu.table_name as parent
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
      join information_schema.constraint_column_usage ccu
        on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
    `);
    const fks = (fkResult as unknown as { rows: FkEdge[] }).rows;
    const { reach, direct } = planDescendantTables(fks);

    // --- count keep/drop rows in every direct child, for the plan report -------------------------
    const counts: { table: string; col: string; keep: number; drop: number }[] = [];
    for (const table of direct) {
      const { col } = reach.get(table)!;
      const r = await this.db.execute(sql`
        select count(*) filter (where ${sql.identifier(col)} = ${keepId})::int as keep,
               count(*) filter (where ${sql.identifier(col)} = ${dropId})::int as drop
        from ${sql.identifier(table)}
        where ${sql.identifier(col)} in (${keepId}, ${dropId})
      `);
      const row = (r as unknown as { rows: { keep: number; drop: number }[] }).rows[0];
      counts.push({ table, col, keep: row?.keep ?? 0, drop: row?.drop ?? 0 });
    }

    // --- provenance already on the DROP row, so a carried field keeps its real source -------------
    // MAJOR-1 (PR #433 review): scoped to dropId at the query AND again in buildProvenanceMap — a
    // keep-side row must never become the "drop provenance" a carried value gets stamped with.
    const provRows = await this.db
      .select({
        ipoId: fieldSources.ipoId,
        fieldName: fieldSources.fieldName,
        source: fieldSources.source,
        confidence: fieldSources.confidence,
      })
      .from(fieldSources)
      .where(and(eq(fieldSources.ipoId, dropId), eq(fieldSources.tableName, 'ipos')));
    const dropProv = buildProvenanceMap(provRows, dropId);

    const patch = planCarryFields(
      CARRY_IF_ABSENT_COLUMNS.map((column) => {
        const jsKey = columnToCamelCase(column) as keyof typeof keep;
        return {
          column,
          keepValue: keep[jsKey],
          dropValue: drop[jsKey],
          dropProvenance: dropProv.get(columnToCamelCase(column)),
        };
      }),
      dropId
    );
    if (opts.setIssueSize) {
      patch.push({
        column: 'issue_size',
        value: opts.setIssueSize,
        source: 'ADMIN',
        confidence: 100,
        note: opts.issueSizeNote || 'corrected during duplicate merge',
      });
    }

    const toDelete = counts.filter((x) => x.drop > 0 && !REPOINT_TABLES.has(x.table));
    const toRepoint = counts.filter((x) => x.drop > 0 && REPOINT_TABLES.has(x.table));

    const plan: MergeDuplicatePlan = {
      keep,
      drop,
      patch,
      toDelete: toDelete.map((x) => ({ table: x.table, col: x.col, count: x.drop })),
      toRepoint: toRepoint.map((x) => ({ table: x.table, col: x.col, count: x.drop })),
      descendantTableCount: reach.size,
      directTableCount: direct.length,
    };

    if (!opts.apply) {
      return { ...plan, applied: false, keepSlug: keep.slug, droppedSlug: drop.slug, provenanceWritten: [] };
    }

    // --- apply, all or nothing -----------------------------------------------------------------
    // CORRECT FOR NOW, NOT CORRECT IN GENERAL: keyed on (ipoId, tableName) and
    // mapped by fieldName alone, so two sibling rows of one table would collapse
    // into one map entry. Every row_key is '' today; the moment slice s5b writes
    // real keys this reads an arbitrary sibling. Which key a merge should carry
    // is a design question owned by s5b/s7a/s7b — do not guess it here.
    const keepProvRows = await this.db
      .select({ fieldName: fieldSources.fieldName, source: fieldSources.source })
      .from(fieldSources)
      .where(and(eq(fieldSources.ipoId, keepId), eq(fieldSources.tableName, 'ipos')));
    const keepProv = new Map(keepProvRows.map((p) => [p.fieldName, p.source]));

    const provenanceWritten: { fieldName: string; source: string; previousSource: string | null }[] = [];

    await this.db.transaction(async (tx) => {
      for (const p of patch) {
        const jsKey = columnToCamelCase(p.column);
        await tx
          .update(ipos)
          .set({ [jsKey]: p.value, updatedAt: new Date() } as Partial<typeof ipos.$inferInsert>)
          .where(eq(ipos.id, keepId));

        const previousSource = keepProv.get(jsKey) ?? null;
        const keepValueBefore = (keep as unknown as Record<string, unknown>)[jsKey];
        await tx
          .insert(fieldSources)
          .values({
            ipoId: keepId,
            tableName: 'ipos',
            fieldName: jsKey,
            source: p.source as (typeof fieldSources.$inferInsert)['source'],
            confidence: p.confidence,
            previousValue: keepValueBefore === null || keepValueBefore === undefined ? null : String(keepValueBefore),
            previousSource: previousSource as (typeof fieldSources.$inferInsert)['previousSource'],
            dataLineage: { tool: 'merge-duplicate-ipo', mergedFrom: dropId, note: p.note, at: new Date().toISOString() },
            updatedBy: 'merge-duplicate-ipo',
          })
          .onConflictDoUpdate({
            // MUST mirror unique_field_source_per_ipo (item 1 slice s18:
            // ipo_id, table_name, row_key, field_name). Postgres needs an
            // arbiter index matching this list EXACTLY; the only unique index
            // on the table is the 4-column one, so a 3-column target here is
            // 42P10 on the first write — inside this transaction, which would
            // roll the value write back with it. rowKey is omitted from
            // .values() above, so it defaults to '' and behaviour is unchanged.
            target: [fieldSources.ipoId, fieldSources.tableName, fieldSources.rowKey, fieldSources.fieldName],
            set: {
              source: p.source as (typeof fieldSources.$inferInsert)['source'],
              confidence: p.confidence,
              previousValue: keepValueBefore === null || keepValueBefore === undefined ? null : String(keepValueBefore),
              previousSource: previousSource as (typeof fieldSources.$inferInsert)['previousSource'],
              dataLineage: { tool: 'merge-duplicate-ipo', mergedFrom: dropId, note: p.note, at: new Date().toISOString() },
              updatedBy: 'merge-duplicate-ipo',
              updatedAt: new Date(),
            },
          });
        provenanceWritten.push({ fieldName: jsKey, source: p.source, previousSource });
      }

      // The old URL must keep resolving; a merge that 404s a live IPO page is a regression.
      await tx
        .insert(ipoSlugRedirects)
        .values({ oldSlug: drop.slug, ipoId: keepId, reason: 'DUPLICATE_MERGE' })
        .onConflictDoNothing({ target: ipoSlugRedirects.oldSlug });

      for (const table of direct) {
        const { col } = reach.get(table)!;
        if (REPOINT_TABLES.has(table)) {
          // A unique violation means the survivor already holds the equivalent row, so the
          // dropped row's copy is redundant rather than lost.
          await tx.execute(sql`savepoint repoint`);
          try {
            await tx.execute(sql`
              update ${sql.identifier(table)} set ${sql.identifier(col)} = ${keepId}
              where ${sql.identifier(col)} = ${dropId}
            `);
            await tx.execute(sql`release savepoint repoint`);
          } catch (e) {
            const pgError = e as { code?: string };
            if (pgError.code !== '23505') throw e;
            await tx.execute(sql`rollback to savepoint repoint`);
            await tx.execute(sql`delete from ${sql.identifier(table)} where ${sql.identifier(col)} = ${dropId}`);
          }
        } else {
          await tx.execute(sql`delete from ${sql.identifier(table)} where ${sql.identifier(col)} = ${dropId}`);
        }
      }

      await tx.delete(ipos).where(eq(ipos.id, dropId));
    });

    await this.invalidateCache(
      [getIPOByIdKey(keepId), getIPOBySlugKey(keep.slug), getIPOByIdKey(dropId), getIPOBySlugKey(drop.slug)],
      ['ipo:list:*', 'ipo:search:*']
    );

    return { ...plan, applied: true, keepSlug: keep.slug, droppedSlug: drop.slug, provenanceWritten };
  }

  /**
   * Find peer IPOs in the same sector with financial data
   * Used for peer comparison on IPO detail page
   */
  async findPeers(
    ipoId: string,
    sector: string | null,
    limit = 8
  ): Promise<Array<IPO & { financialData: FinancialData | null }>> {
    try {
      // If no sector specified, return empty array
      if (!sector) {
        return [];
      }

      // Query IPOs in the same sector, excluding the current IPO
      const peerIpos = await this.db
        .select()
        .from(ipos)
        .where(and(eq(ipos.sector, sector), sql`${ipos.id} != ${ipoId}`))
        .limit(limit);

      // Fetch financial data for each peer IPO
      const peersWithFinancials = await Promise.all(
        peerIpos.map(async (peer) => {
          const [financial] = await this.db
            .select()
            .from(financialData)
            .where(eq(financialData.ipoId, peer.id))
            .limit(1);

          return {
            ...peer,
            financialData: financial || null,
          };
        })
      );

      return peersWithFinancials;
    } catch (error) {
      throw new DatabaseError(
        `Failed to fetch peer IPOs for sector: ${sector}`,
        undefined,
        error
      );
    }
  }

  /**
   * Update IPO rating and rationale
   * Used by the rating calculation script to store calculated ratings
   *
   * @param ipoId - IPO ID
   * @param rating - Calculated rating (1-5 stars, 0.5 increments)
   * @param rationale - Human-readable explanation of the rating
   */
  /**
   * Update ONLY the two document-source hint columns (T-403 H-1/W-1).
   *
   * A narrow sibling of `update()` for a reason that is not cosmetic: `update()`
   * ends in a bare `.returning()`, which asks Postgres for every column
   * `schema.ts` declares. A database built purely from the migration journal has
   * 32 of those 55 (measured — evidence/T-403/journal-schema-drift.json), so a
   * two-column patch fails there on columns it never touched. This selects the
   * two columns it writes and returns the id, which works on any environment
   * and is what lets the acceptance harness exercise the REAL write path
   * instead of a raw-SQL stand-in.
   *
   * Returns null when no row matched, rather than throwing: this is bookkeeping
   * on the side of a scrape, and a missing IPO must not fail a cycle.
   */
  async updateDocumentSourceHints(
    ipoId: string,
    hints: { companyWebsite?: string; verifierUrl?: string }
  ): Promise<{ id: string; slug: string } | null> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (hints.companyWebsite !== undefined) patch.companyWebsite = hints.companyWebsite;
    if (hints.verifierUrl !== undefined) patch.verifierUrl = hints.verifierUrl;

    const [row] = await this.db
      .update(ipos)
      .set(patch as never)
      .where(eq(ipos.id, ipoId))
      .returning({ id: ipos.id, slug: ipos.slug });

    if (!row) return null;

    await this.invalidateCache(
      [getIPOByIdKey(ipoId), getIPOBySlugKey(row.slug)],
      ['ipo:list:*', 'ipo:search:*', `ipo:detail:${row.slug}`]
    );
    return row;
  }

  /**
   * Public cache-invalidation entry point (T-513 / #419) for write paths that
   * persist an `ipos` row through their own transaction — e.g. a raw
   * drizzle write that needs an in-transaction SQL WHERE write-once guard
   * this repository's own `update()` cannot express — but still owe the same
   * cache contract every other `ipos` write gets. Callers MUST invoke this
   * AFTER their transaction commits, never from inside it: a rolled-back
   * transaction must not drop a still-valid cache entry. `invalidateCache`
   * already swallows Redis errors internally (`deleteCache`/
   * `deleteCachePattern` catch-and-log) so a cache-layer failure here can
   * never fail the caller's write.
   */
  async invalidateIpoCache(id: string, slug: string): Promise<void> {
    await this.invalidateCache(
      [getIPOByIdKey(id), getIPOBySlugKey(slug)],
      ['ipo:list:*', 'ipo:search:*']
    );
  }

  async updateRating(
    ipoId: string,
    rating: number | null,
    rationale: string
  ): Promise<IPO> {
    try {
      const [ipo] = await this.db
        .update(ipos)
        .set({
          rating,
          ratingRationale: rationale,
          updatedAt: new Date(),
        })
        .where(eq(ipos.id, ipoId))
        .returning();

      if (!ipo) {
        throw new EntityNotFoundError('IPO', ipoId);
      }

      // Invalidate cache for this IPO
      await this.invalidateCache(
        [getIPOByIdKey(ipoId), getIPOBySlugKey(ipo.slug)],
        ['ipo:list:*', 'ipo:search:*', `ipo:detail:${ipo.slug}`]
      );

      return ipo;
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw error;
      }
      throw new DatabaseError(
        `Failed to update rating for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }

  /**
   * Find historical IPOs with filtering, sorting, and computed fields
   * Used for /api/ipos/history endpoint (Story 6.1)
   *
   * Filters:
   * - status: LISTED (fixed)
   * - listing_date: NOT NULL (fixed)
   * - year: Extracted from listing_date (2020-2025, All)
   * - sector: Optional sector filter
   * - performance: Positive/Negative/All based on listing gain
   *
   * Computed fields:
   * - listingGainPercent: ((listing_close - issue_price) / issue_price) * 100
   * - year: EXTRACT(YEAR FROM listing_date)
   *
   * Sorting:
   * - listing_date: Sort by listing date
   * - listing_gain: Sort by listing gain percentage
   * - subscription: Sort by total subscription (requires join)
   */
  async findHistorical(
    filters: HistoricalIPOQueryParams
  ): Promise<PaginatedResponse<HistoricalIPO>> {
    const {
      year,
      sector,
      performance,
      sort = 'listing_date',
      sortOrder = 'desc',
      page = 1,
      limit = 20,
    } = filters;

    const cacheKey = getHistoricalIPOsKey(filters);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          // Build base conditions: status='LISTED' AND listing_date IS NOT NULL
          // AND offering_type='IPO' (T-277F checker finding #3). A row
          // reclassified to a non-IPO offering type (e.g. INVITS/REITS via
          // the NON_IPO_TRUST_SHAPE guard) still has segment='MAINBOARD' and
          // status='LISTED' — without this filter it stayed ranked on the
          // historical/tracker query even after reclassification (Cube
          // Highways Trust rendering on the Mainboard Performance Tracker).
          const conditions = [
            eq(ipos.status, 'LISTED'),
            eq(ipos.offeringType, 'IPO'),
            sql`${ipos.listingDate} IS NOT NULL`,
          ];

          // Add year filter (extract year from listing_date)
          if (year && year !== 'All') {
            const yearNum = parseInt(year, 10);
            conditions.push(
              sql`EXTRACT(YEAR FROM ${ipos.listingDate}) = ${yearNum}`
            );
          }

          // Add sector filter
          if (sector) {
            conditions.push(eq(ipos.sector, sector));
          }

          const whereClause = and(...conditions);

          // Get total count
          const [{ count }] = await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(ipos)
            .leftJoin(
              listingPerformance,
              eq(ipos.id, listingPerformance.ipoId)
            )
            .where(whereClause);

          // Build the query with computed fields
          const offset = (page - 1) * limit;

          // Determine sort column
          let orderByClause;
          if (sort === 'listing_date') {
            orderByClause =
              sortOrder === 'asc'
                ? asc(ipos.listingDate)
                : desc(ipos.listingDate);
          } else if (sort === 'listing_gain') {
            // Sort by computed listing_gain_percent
            orderByClause =
              sortOrder === 'asc'
                ? asc(listingPerformance.listingGainPercent)
                : desc(listingPerformance.listingGainPercent);
          } else if (sort === 'subscription') {
            // Sort by max total subscription
            // This requires a subquery to get the latest subscription
            orderByClause =
              sortOrder === 'asc'
                ? sql`(SELECT MAX(total_subscription) FROM subscriptions WHERE ipo_id = ${ipos.id}) ASC NULLS LAST`
                : sql`(SELECT MAX(total_subscription) FROM subscriptions WHERE ipo_id = ${ipos.id}) DESC NULLS LAST`;
          } else {
            // Default to listing_date desc
            orderByClause = desc(ipos.listingDate);
          }

          // Fetch data with joins
          const results = await this.db
            .select({
              ipo: ipos,
              listingClose: listingPerformance.listingPrice,
              issuePrice: listingPerformance.issuePrice,
              listingGainPercent: listingPerformance.listingGainPercent,
              subscription: sql<number | null>`(SELECT MAX(total_subscription) FROM subscriptions WHERE ipo_id = ${ipos.id})`,
            })
            .from(ipos)
            .leftJoin(
              listingPerformance,
              eq(ipos.id, listingPerformance.ipoId)
            )
            .where(whereClause)
            .orderBy(orderByClause)
            .limit(limit)
            .offset(offset);

          // Transform results to include computed year and filter by performance
          let data = results.map((row) => {
            const year = row.ipo.listingDate
              ? new Date(row.ipo.listingDate).getFullYear()
              : 0;

            return {
              ...row.ipo,
              listingClose: row.listingClose,
              issuePrice: row.issuePrice,
              listingGainPercent: row.listingGainPercent
                ? Number(row.listingGainPercent)
                : null,
              subscription: row.subscription ? Number(row.subscription) : null,
              year,
            };
          });

          // Apply performance filter after fetching (since it depends on computed field)
          if (performance && performance !== 'All') {
            data = data.filter((ipo) => {
              if (performance === 'Positive') {
                return (
                  ipo.listingGainPercent !== null && ipo.listingGainPercent > 0
                );
              } else if (performance === 'Negative') {
                return (
                  ipo.listingGainPercent !== null && ipo.listingGainPercent < 0
                );
              }
              return true;
            });
          }

          const totalPages = Math.ceil(count / limit);

          return {
            data,
            meta: {
              total: count,
              page,
              limit,
              totalPages,
              hasNext: page < totalPages,
              hasPrev: page > 1,
            },
          };
        } catch (error) {
          throw new DatabaseError(
            'Failed to fetch historical IPO list',
            undefined,
            error
          );
        }
      },
      CacheTTL.HISTORICAL_IPOS
    );
  }
}
