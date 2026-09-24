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
  ipoMergeLog,
  auditLogs,
  ipoSourceKeys,
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
import { EntityNotFoundError, DatabaseError, ProdWriteRefusedError, IdentityHeldForReviewError } from '../errors/repository-errors';
import { strictIdentityCompanyName } from '../utils/identity-decoration';
import { normalizeCin } from '../utils/cin';
import { logger } from '../logger';
import {
  normalizeSourceKeyRefs,
  recordSourceKeys,
  activeNseIssueSymbol,
  supersedeOlderKeysOnRelaunchMerge,
  type SourceKeyRef,
  type SourceKeyBoundVia,
} from './ipo-source-keys';
import { noteSourceKeyBind } from './source-key-lineage';

/** audit_logs.action_type of an OD-68 hold; read by the nightly `i_identity_held` check. */
export const IDENTITY_HELD_ACTION = 'IDENTITY_HELD_FOR_REVIEW';
import {
  normalizedCompanyNameSql,
  compactNormalizedCompanyNameSql,
  sanitizeDisplayCompanyName,
  normalizeCompanyNameForMatching,
} from '../utils/company-name-normalizer';
import { findMostSimilarName } from '../utils/company-name-similarity';
import {
  checkMergeEligibility,
  assessRelaunch,
  relaunchException,
  buildCarryFieldInputs,
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
  /** What the apply transaction actually did per child table, from RETURNING (empty on a dry run). */
  childOutcome: MergeChildOutcome[];
}

/** One child table's outcome inside a merge, taken from the rows the statements RETURNED. */
export interface MergeChildOutcome {
  table: string;
  col: string;
  kind: 'repoint' | 'delete';
  /** Ids of person-created rows moved onto the survivor. */
  repointedIds: string[];
  /** Person-created rows removed because the survivor already held their twin under a unique key. */
  deletedOnConflictCount: number;
  /** Those rows whole, as to_jsonb text. */
  deletedOnConflictRows: string[];
  /** Scraper-derived rows deleted (count only). */
  deletedCount: number;
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
   * Every row carrying this CIN (OD-34 step 1, §2.3.3.2). A list, not one row:
   * a CIN names the COMPANY, so its IPO, a later OFS or rights issue, and a
   * refiled offering all share it — `resolveIpoRow` decides which one is the
   * incoming offering. NULL-safe like `findByIsin`: an absent input returns []
   * without querying, so NULL never matches NULL.
   */
  /**
   * OD-85 write rule for a record that BOUND to an existing row: its keys are written in one
   * transaction (a key already on another row, or a concurrent writer, rolls the whole set back).
   */
  async bindSourceKeys(
    ipoId: string,
    refs: SourceKeyRef[] | null | undefined,
    opts: { boundVia: SourceKeyBoundVia; boundBy: string }
  ): Promise<Awaited<ReturnType<typeof recordSourceKeys>> | null> {
    const keys = normalizeSourceKeyRefs(refs ?? []);
    if (keys.length === 0) return null;
    const res = await this.db.transaction((tx) => recordSourceKeys(tx, ipoId, keys, opts));
    noteSourceKeyBind(ipoId, [...res.insertedIds, ...res.keptIds]);
    return res;
  }

  /** OD-85: the handle `resolveIpoRow` reads `ipo_source_keys` through. */
  sourceKeyDb(): NodePgDatabase<typeof schema> {
    return this.db;
  }

  async findByCin(cin: string | null | undefined): Promise<IPO[]> {
    const normalized = normalizeCin(cin);
    if (!normalized) {
      return [];
    }
    try {
      return await this.db
        .select()
        .from(ipos)
        .where(sql`upper(trim(${ipos.cin})) = ${normalized}`)
        .orderBy(ipos.id);
    } catch (error) {
      throw new DatabaseError(`Failed to fetch IPOs by CIN: ${cin}`, undefined, error as Error);
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
   * OD-68 hold-for-review, at the shared repository's create door (every
   * scraper and script create; the admin route uses web's own repository and
   * is NOT held - it is the human path).
   *
   * A create is only reached when `resolveIpoRow` bound nothing. The record is
   * HELD (no row created) only when a live row is plausibly the same offering
   * AND carries a KNOWN fact that contradicts the incoming record
   * (PR #910 review round 1, MAJOR-3):
   *   - same STRICT identity fold (decoration stripped, only corporate-form
   *     words dropped: "Laxmi India Finance" is not "Laxmi Finance"),
   *   - same segment and same offering type (an SME and a mainboard issue, or
   *     an IPO and an OFS, are two offerings - OD-70),
   *   - not WITHDRAWN, and open dates not more than 180 days apart when both
   *     are known (beyond that it is a new offering - OD-35 / OD-71),
   *   - and its open date or price band is KNOWN on both sides and DIFFERS.
   * Nothing known that differs: the record is created normally (OD-68 as
   * corrected); a same-fold pair with nothing contradicting is left to the
   * nightly `i_same_ipo_two_rows` sweep.
   *
   * A hold is DURABLE and READ BY A HUMAN (MAJOR-2, signal-ownership.md R3):
   * one audit_logs row per held record per candidate per day (action_type
   * IDENTITY_HELD_FOR_REVIEW, on /admin/audit), and the nightly check
   * `i_identity_held` lists every held record no row has since absorbed.
   */
  private async holdIfIdentityUnbound(data: IPOInsert): Promise<void> {
    const fold = strictIdentityCompanyName(data.companyName ?? '');
    if (!fold || !data.segment) return;
    const offeringType = data.offeringType ?? 'IPO';
    const rows = await this.db
      .select({
        id: ipos.id,
        slug: ipos.slug,
        companyName: ipos.companyName,
        openDate: ipos.openDate,
        priceRangeMin: ipos.priceRangeMin,
        status: ipos.status,
        cin: ipos.cin,
      })
      .from(ipos)
      .where(sql`${ipos.offeringType} = ${offeringType} AND ${ipos.segment} = ${data.segment} AND ${ipos.status} <> 'WITHDRAWN'`);
    const toDay = (v: unknown): string | null =>
      v == null || v === '' ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    const toPrice = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const incomingDay = toDay(data.openDate);
    const incomingPrice = toPrice(data.priceRangeMin);
    const WINDOW_DAYS = 180;
    const incomingCin = normalizeCin(data.cin ?? null);
    const candidates = rows.filter((row) => {
      if (strictIdentityCompanyName(row.companyName) !== fold) return false;
      // OD-69: a known CIN that differs proves another company - nothing to hold for.
      const rowCin = normalizeCin(row.cin ?? null);
      if (incomingCin && rowCin && incomingCin !== rowCin) return false;
      const rowDay = toDay(row.openDate);
      if (incomingDay && rowDay && Math.abs(Date.parse(incomingDay) - Date.parse(rowDay)) / 86_400_000 > WINDOW_DAYS) {
        return false;
      }
      const dateDiffers = incomingDay != null && rowDay != null && incomingDay !== rowDay;
      const rowPrice = toPrice(row.priceRangeMin);
      const bandDiffers = incomingPrice != null && rowPrice != null && incomingPrice !== rowPrice;
      return dateDiffers || bandDiffers;
    });
    if (candidates.length === 0) return;
    const incoming = {
      companyName: data.companyName ?? '',
      slug: data.slug ?? '',
      openDate: incomingDay,
      priceRangeMin: data.priceRangeMin ?? null,
    };
    const candidateView = candidates.map((c) => ({
      id: c.id, slug: c.slug, companyName: c.companyName, openDate: c.openDate, priceRangeMin: c.priceRangeMin, status: c.status,
    }));
    logger.warn(
      { incoming, identityFold: fold, candidates: candidateView },
      'identity_held_for_review: no identifier bound this record and a same-name live row has a differing known open date or price band - NOT created (OD-68)'
    );
    await this.recordIdentityHold(incoming, fold, candidateView);
    throw new IdentityHeldForReviewError(
      `IPORepository.create: "${incoming.companyName}" held for review (OD-68) - its identity fold "${fold}" matches ` +
        candidates.map((c) => `${c.slug} (open ${String(c.openDate ?? 'unknown')}, band ${String(c.priceRangeMin ?? 'unknown')})`).join(', ') +
        ' whose known open date or price band differs; no row created',
      incoming,
      candidateView.map((c) => ({ ...c }))
    );
  }

  /**
   * The durable half of a hold: one audit_logs row per (incoming slug, first
   * candidate) per day, so a record re-scraped every cycle does not flood the
   * log. A failure here never turns a hold into a create - the caller throws
   * regardless - and is logged at error level.
   */
  private async recordIdentityHold(
    incoming: { companyName: string; slug: string; openDate: string | null; priceRangeMin: unknown },
    fold: string,
    candidates: { id: string; slug: string; companyName: string; openDate: unknown; priceRangeMin: unknown; status: unknown }[]
  ): Promise<void> {
    try {
      const existing = await this.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(sql`${auditLogs.actionType} = ${IDENTITY_HELD_ACTION} AND ${auditLogs.newValue} = ${incoming.slug} AND ${auditLogs.ipoId} = ${candidates[0].id} AND ${auditLogs.timestamp} > now() - interval '1 day'`)
        .limit(1);
      if (existing.length > 0) return;
      await this.db.insert(auditLogs).values({
        adminUser: 'SYSTEM',
        actionType: IDENTITY_HELD_ACTION,
        ipoId: candidates[0].id,
        tableName: 'ipos',
        fieldName: 'identity',
        oldValue: candidates.map((c) => c.slug).join(','),
        newValue: incoming.slug,
        details: { rule: 'OD-68', identityFold: fold, incoming, candidates },
        success: false,
        errorMessage: `held for review: "${incoming.companyName}" matches ${candidates.map((c) => c.slug).join(', ')} with a differing known open date or price band`,
      });
    } catch (error) {
      logger.error(
        { incoming, error: error instanceof Error ? error.message : String(error) },
        'identity_held_for_review: could not write the audit_logs record - the hold stands but the nightly i_identity_held check will not see it'
      );
    }
  }

  /**
   * Create new IPO.
   *
   * `options.identityHoldOverride` (MAJOR-2): a human read the hold and decided
   * the record IS a separate offering. It skips the OD-68 hold and records the
   * decision (who, why) in audit_logs as IDENTITY_HOLD_OVERRIDDEN. A scraper
   * never passes it.
   */
  async create(
    data: IPOInsert,
    options?: { identityHoldOverride?: { by: string; reason: string }; sourceKeys?: SourceKeyRef[] | null; boundBy?: string }
  ): Promise<IPO> {
    // #860: an IPO's segment decides which manifest ranks its fields get
    // (`ipoTypeKey` needs it), so an IPO created without one has every ranked
    // source chosen for a GUESSED type -- and `pull_plan_rank` cannot see
    // that, because the policy it checks against was picked using the same
    // guess. Measured on staging: 10 genuine IPOs in that state, one of them
    // OPEN and being walked now with 190 guessed plan rows.
    //
    // Scoped to offering_type = 'IPO' deliberately. Of the 41 null-segment
    // rows, 31 are OFS, TENDER, NCD, RIGHTS, BUYBACK or INVITS, where
    // "MAINBOARD vs SME" does not apply and null is the honest value. A
    // wider guard would reject 31 correct rows to fix 10 wrong ones.
    if (data.offeringType === 'IPO' && !data.segment) {
      throw new Error(
        `IPORepository.create: an IPO (offeringType=IPO) may not be created without a segment — ` +
        `"${data.companyName ?? data.slug ?? 'unknown'}" had segment=${data.segment ?? 'undefined'}. ` +
        'The segment decides which manifest ranks its fields get; without it every rank is resolved for a guessed type. See #860.'
      );
    }
    if (options?.identityHoldOverride) {
      const { by, reason } = options.identityHoldOverride;
      if (!by?.trim() || !reason?.trim()) {
        throw new Error('IPORepository.create: identityHoldOverride needs a non-empty `by` and `reason` (OD-68)');
      }
      logger.warn({ companyName: data.companyName, slug: data.slug, by, reason }, 'identity hold OVERRIDDEN by a human - creating the row (OD-68)');
      await this.db.insert(auditLogs).values({
        adminUser: by,
        actionType: 'IDENTITY_HOLD_OVERRIDDEN',
        tableName: 'ipos',
        fieldName: 'identity',
        newValue: data.slug ?? null,
        details: { rule: 'OD-68', companyName: data.companyName, reason },
      });
    } else {
      await this.holdIfIdentityUnbound(data);
    }
    try {

      // Single write choke point: every IPO create — regardless of which
      // scraper/consolidation path produced it — stores a sanitized display
      // name (strip trailing scrape-artifact status token, e.g. "Ltd. O"). #42
      if (data.companyName) {
        data = { ...data, companyName: sanitizeDisplayCompanyName(data.companyName) };
      }

      // OD-85 write rule: the record's source keys are written in the SAME transaction as the row
      // create. A concurrent create of the same record loses on the keys' unique index, and its row
      // insert rolls back with it — so two concurrent creates leave one row.
      const keys = normalizeSourceKeyRefs(options?.sourceKeys ?? []);
      const ipo = keys.length === 0
        ? (await this.db.insert(ipos).values(data).returning())[0]
        : await this.db.transaction(async (tx) => {
            const [created] = await tx.insert(ipos).values(data).returning();
            const rec = await recordSourceKeys(tx, created.id, keys, { boundVia: 'CREATE', boundBy: options?.boundBy ?? 'unknown' });
            noteSourceKeyBind(created.id, rec.insertedIds);
            return created;
          });

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
      // F-145 class (OD-85): with an ACTIVE NSE_ISSUE key, `symbol` is that key's symbol — never
      // the value of whichever record was read last (IC Electricals ICEL/ICELCO flip).
      if (data.symbol !== undefined) {
        const keySymbol = await activeNseIssueSymbol(this.db, id);
        if (keySymbol && keySymbol !== data.symbol) {
          logger.info({ ipoId: id, incoming: data.symbol, active: keySymbol }, '[OD-85] ipos.symbol follows the ACTIVE NSE_ISSUE key');
          data = { ...data, symbol: keySymbol };
        }
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
   * Repair-tool entry point (lane C item 2 slice 6 — face-value-as-band
   * class): write ONLY `faceValue`. A sibling of `applyOfferTerms` rather
   * than folding `faceValue` into it, because the two are sourced from
   * DIFFERENT signals in the repair tool that calls them (the offer terms
   * from report 82's Issue Price; the face value from the detail page) and
   * a caller correcting one must never be tempted to pass a stale/undefined
   * value for the other through a shared, wider parameter shape. Same
   * write-ratchet rationale as `applyOfferTerms`: this method is the
   * already-baselined write path a new repair script routes through,
   * instead of a direct `db.update(ipos)`.
   */
  async applyFaceValue(id: string, faceValue: number): Promise<IPO> {
    return this.update(id, { faceValue });
  }

  /**
   * Repair-tool entry point (OD-74 item 14 / OD-77): write ONLY `issueSize`. A fresh repair write
   * stamps `updatedAt` now (through `update()`); the tool's `--undo` passes `restoreUpdatedAt` to put
   * the row back to its exact before-image. Same write-ratchet rationale as `applyOfferTerms`: the
   * write lives in this already-baselined file, never re-typed as a direct `db.update(ipos)` in a
   * new script (`scripts/check-write-ratchet.mjs`, T-316).
   */
  async applyIssueSizeRepair(id: string, issueSize: string | null, restoreUpdatedAt?: string): Promise<IPO> {
    if (restoreUpdatedAt === undefined) return this.update(id, { issueSize });
    const [ipo] = await this.db
      .update(ipos)
      .set({ issueSize, updatedAt: sql`${restoreUpdatedAt}::timestamp` })
      .where(eq(ipos.id, id))
      .returning();
    if (!ipo) throw new EntityNotFoundError('IPO', id);
    await this.invalidateCache([getIPOByIdKey(id), getIPOBySlugKey(ipo.slug)], ['ipo:list:*', 'ipo:search:*']);
    return ipo;
  }

  /**
   * Repair-tool entry point (item 12, OD-68 — decorated-slug cleanup): rename
   * `ipos.slug` and write its `ipo_slug_redirects` row (old -> new) in ONE
   * transaction, guarded on the row still holding `oldSlug` (never on `id`
   * alone — a concurrent write could have changed the slug since the caller
   * read it; returns 'raced' rather than clobbering it). Same write-ratchet
   * rationale as `applyOfferTerms`/`applyFaceValue`/`applyIssueSizeRepair`:
   * the write lives here, in this already-baselined file, not re-typed as a
   * direct `db.update(ipos)` transaction in a new script
   * (`scripts/check-write-ratchet.mjs`, T-316). The caller (the repair
   * script) still owns the shadow guard (refusing when `oldSlug` is
   * currently live on a DIFFERENT row) — that is a read, not a write, and
   * belongs to the tool's own collision policy.
   */
  async renameSlugWithRedirect(
    id: string,
    oldSlug: string,
    newSlug: string,
    reason: string
  ): Promise<'written' | 'raced'> {
    const result = await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(ipos)
        .set({ slug: newSlug, updatedAt: new Date() })
        .where(and(eq(ipos.id, id), eq(ipos.slug, oldSlug)))
        .returning({ id: ipos.id });
      if (updated.length === 0) return 'raced' as const;
      await tx
        .insert(ipoSlugRedirects)
        .values({ oldSlug, ipoId: id, reason })
        .onConflictDoNothing({ target: ipoSlugRedirects.oldSlug });
      return 'written' as const;
    });
    if (result === 'written') {
      await this.invalidateCache(
        [getIPOByIdKey(id), getIPOBySlugKey(oldSlug), getIPOBySlugKey(newSlug)],
        ['ipo:list:*', 'ipo:search:*', `ipo:detail:${oldSlug}`, `ipo:detail:${newSlug}`]
      );
    }
    return result;
  }

  /**
   * Item 9 corrigendum accept (OD-90): write ONE `ipos` column from inside the caller's OWN
   * transaction. `acceptCorrigendumSuggestion`
   * (packages/shared/src/services/corrigendum-suggestions.ts) claims the `data_conflicts` row,
   * writes this value, and records `field_sources` provenance all in one transaction — the claim
   * and the write must never be split across two commits. Static, and taking the transaction
   * handle directly, because the caller already holds a `tx`; wrapping it in an IPORepository
   * instance bound to `this.db` would either write outside that transaction or force a nested
   * transaction. Same write-ratchet rationale as `applyOfferTerms`/`renameSlugWithRedirect`: the
   * write lives here, in this already-baselined file, never re-typed as a direct
   * `db.update(ipos)` in a new call site (`scripts/check-write-ratchet.mjs`, T-316).
   */
  static async applyAdminCorrigendumValue(
    tx: NodePgDatabase<typeof schema>,
    id: string,
    fieldName: string,
    value: string
  ): Promise<void> {
    await tx
      .update(ipos)
      .set({ [fieldName]: value, lastManualEditAt: new Date() } as never)
      .where(eq(ipos.id, id));
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
      /**
       * Item 19 / #807: who ran this merge, recorded verbatim in `ipo_merge_log.merged_by`.
       * The tool or operator name comes from the CALLER and is never inferred here — a log
       * that guesses its own author is worse than one that says "unknown".
       */
      mergedBy?: string;
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

    // OD-86: the relaunch exception reads both rows' source keys (shares, band, postponed flag).
    const pairKeys = await this.db.select().from(ipoSourceKeys).where(inArray(ipoSourceKeys.ipoId, [keepId, dropId]));
    const relaunch = assessRelaunch(
      keep,
      drop,
      pairKeys.filter((k) => k.ipoId === keepId),
      pairKeys.filter((k) => k.ipoId === dropId)
    );
    const eligibility = checkMergeEligibility({
      relaunch,
      keepOpenDate: keep.openDate,
      dropOpenDate: drop.openDate,
      keepCompanyName: keep.companyName,
      dropCompanyName: drop.companyName,
      forceDifferentName: opts.forceDifferentName ?? false,
      identifiers: DISAGREEING_IDENTIFIER_COLUMNS.map((col) => {
        const jsKey = columnToCamelCase(col) as keyof typeof keep;
        return { column: col, keepValue: keep[jsKey], dropValue: drop[jsKey] };
      }),
      keepIssueSize: keep.issueSize,
      dropIssueSize: drop.issueSize,
      // Acknowledged ONLY when the operator passed BOTH flags — a bare --set-issue-size with no
      // --issue-size-note is not source-backed and must not silently bypass the disagreement check.
      issueSizeCorrectionAcknowledged: Boolean(opts.setIssueSize) && Boolean(opts.issueSizeNote),
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

    const patch = planCarryFields(buildCarryFieldInputs(keep, drop, dropProv), dropId);
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
      return { ...plan, applied: false, keepSlug: keep.slug, droppedSlug: drop.slug, provenanceWritten: [], childOutcome: [] };
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

    const childOutcome: MergeChildOutcome[] = [];

    await this.db.transaction(async (tx) => {
      // --- #900 / #807 findings 4-5: lock BOTH rows first and snapshot them whole ----------------
      // One statement, ordered by id, so two merges touching the same pair lock in the same order
      // and cannot deadlock. `to_jsonb(i.*)` carries every column the LIVE table has — not the
      // list schema.ts declares, which ipodhan_staging already exceeds by six columns — and is
      // read as TEXT so numerics keep their exact scale (JSON.parse would turn 10.00 into 10).
      // The text is written back into jsonb server-side below, never through a JS object.
      const lockedResult = await tx.execute(sql`
        select i.id::text as id, to_jsonb(i.*)::text as row
        from ipos i
        where i.id in (${keepId}, ${dropId})
        order by i.id
        for update
      `);
      const locked = (lockedResult as unknown as { rows: { id: string; row: string }[] }).rows ?? [];
      const keepRowText = locked.find((r) => r.id === keepId)?.row;
      const dropRowText = locked.find((r) => r.id === dropId)?.row;
      if (!keepRowText || !dropRowText) {
        // Something deleted one of the pair between planning and now. Merging against a row that
        // is no longer there would log a snapshot of nothing; abort and let the operator re-plan.
        throw new DatabaseError(
          `mergeDuplicateInto: ${!keepRowText ? 'keep' : 'drop'} row vanished before the merge transaction locked it — re-run the plan`,
          undefined
        );
      }

      // The patch was planned from an UNLOCKED read of the survivor. A carry-if-absent value is
      // only correct while the survivor's column is still absent; if a concurrent writer filled it
      // in the meantime, applying the stale patch would overwrite that write. Refuse instead.
      const keepLocked = JSON.parse(keepRowText) as Record<string, unknown>;
      const raced = patch.filter(
        (p) => p.source !== 'ADMIN' && keepLocked[p.column] !== null && keepLocked[p.column] !== undefined
      );
      if (raced.length > 0) {
        throw new DatabaseError(
          `mergeDuplicateInto: the survivor's ${raced.map((p) => p.column).join(', ')} was written after the plan was made — re-run the plan`,
          undefined
        );
      }

      // Both IPOs' provenance, whole, BEFORE the child loop below deletes the dropped side's
      // field_sources rows (field_sources is a scraper-derived child, not a REPOINT table). Spec
      // §2.3.3.3: the log holds "every field value and every provenance row".
      const fsResult = await tx.execute(sql`
        select fs.ipo_id::text as ipo_id, to_jsonb(fs.*)::text as row
        from field_sources fs
        where fs.ipo_id in (${keepId}, ${dropId})
        order by fs.ipo_id, fs.table_name, fs.field_name, fs.id
      `);
      const fsRows = (fsResult as unknown as { rows: { ipo_id: string; row: string }[] }).rows ?? [];
      const keepFieldSources = fsRows.filter((r) => r.ipo_id === keepId).map((r) => r.row);
      const dropFieldSources = fsRows.filter((r) => r.ipo_id === dropId).map((r) => r.row);

      // --- child tables FIRST: repoint person-created data, delete scraper-derived data --------
      // Must run before the `ipos` row for dropId is deleted below: most FKs into `ipos` are
      // ON DELETE CASCADE (schema.ts), so deleting the dropped `ipos` row before this loop would
      // let Postgres cascade-delete REPOINT_TABLES rows too (user_watchlist, ipo_reviews, ...) —
      // exactly the person-created data this loop exists to save by repointing, not deleting.
      for (const table of direct) {
        const { col } = reach.get(table)!;
        if (REPOINT_TABLES.has(table)) {
          // #900: never table-wide. The old code ran one table-wide UPDATE and, on ANY unique
          // violation, deleted EVERY dropped-side row of the table — so one user watching both
          // IPOs cost every other watcher their watch. Now a dropped row is deleted only when the
          // survivor already holds its twin under a unique key that includes the IPO column;
          // every other row is repointed. Both steps RETURN the rows they touched, and those rows
          // — not a pre-transaction count — are what the log records.
          const conflict = await this.buildRepointConflictPredicate(tx, table, col, keepId);
          let deletedOnConflict: string[] = [];
          if (conflict) {
            const delResult = await tx.execute(sql`
              delete from ${sql.identifier(table)} d
              where d.${sql.identifier(col)} = ${dropId} and (${conflict})
              returning to_jsonb(d.*)::text as row
            `);
            deletedOnConflict = ((delResult as unknown as { rows: { row: string }[] }).rows ?? []).map((r) => r.row);
          }
          // No savepoint and no 23505 fallback: if a unique violation still happens here, the
          // predicate above missed a key, and the only safe answer is to abort the whole merge.
          const updResult = await tx.execute(sql`
            update ${sql.identifier(table)} d set ${sql.identifier(col)} = ${keepId}
            where d.${sql.identifier(col)} = ${dropId}
            returning to_jsonb(d.*) ->> 'id' as id
          `);
          const repointedIds = ((updResult as unknown as { rows: { id: string | null }[] }).rows ?? []).map(
            (r) => r.id
          );
          if (repointedIds.some((id) => id === null || id === undefined)) {
            throw new DatabaseError(
              `mergeDuplicateInto: ${table} has no id column, so its repointed rows cannot be logged — refusing`,
              undefined
            );
          }
          if (repointedIds.length > 0 || deletedOnConflict.length > 0) {
            childOutcome.push({
              table,
              col,
              kind: 'repoint',
              repointedIds: repointedIds as string[],
              deletedOnConflictCount: deletedOnConflict.length,
              deletedOnConflictRows: deletedOnConflict,
              deletedCount: 0,
            });
          }
        } else {
          const delResult = await tx.execute(sql`
            with d as (
              delete from ${sql.identifier(table)} where ${sql.identifier(col)} = ${dropId} returning 1
            )
            select count(*)::int as n from d
          `);
          const n = Number((delResult as unknown as { rows: { n: number }[] }).rows?.[0]?.n ?? 0);
          if (n > 0) {
            childOutcome.push({
              table,
              col,
              kind: 'delete',
              repointedIds: [],
              deletedOnConflictCount: 0,
              deletedOnConflictRows: [],
              deletedCount: n,
            });
          }
        }
      }

      // Item 19 / #807: the merge log, written INSIDE this transaction and BEFORE the delete
      // below. After the delete there is nothing left to snapshot; outside the transaction, a
      // log written before it can record a merge that then rolls back, and one written after
      // can miss a merge that crashed halfway.
      //
      // Layout (no migration — the 0051 jsonb columns carry it):
      //   drop_row               the dropped ipos row, to_jsonb, every live column (snake_case);
      //                          restorable with jsonb_populate_record(null::ipos, drop_row)
      //   survivor_patch         { format: 2, patch, keepRowBefore, fieldSourcesBefore: { keep, drop } }
      //   repointed_child_counts [{ table, col, count, repointedIds, deletedOnConflictCount,
      //                             deletedOnConflictRows }]   person-created rows
      //   deleted_child_counts   [{ table, col, count }]      scraper-derived rows, count only
      // Row snapshots are spliced in as JSON TEXT and parsed by Postgres, so a numeric's scale
      // and a timestamp's text survive exactly.
      const rawArray = (texts: string[]) => `[${texts.join(',')}]`;
      const survivorPatchJson =
        `{"format":2,"patch":${JSON.stringify(patch)},"keepRowBefore":${keepRowText},` +
        `"fieldSourcesBefore":{"keep":${rawArray(keepFieldSources)},"drop":${rawArray(dropFieldSources)}}}`;
      const repointedJson = rawArray(
        childOutcome
          .filter((c) => c.kind === 'repoint')
          .map(
            (c) =>
              `{"table":${JSON.stringify(c.table)},"col":${JSON.stringify(c.col)},` +
              `"count":${c.repointedIds.length},"repointedIds":${JSON.stringify(c.repointedIds)},` +
              `"deletedOnConflictCount":${c.deletedOnConflictCount},` +
              `"deletedOnConflictRows":${rawArray(c.deletedOnConflictRows)}}`
          )
      );
      const deletedJson = JSON.stringify(
        childOutcome
          .filter((c) => c.kind === 'delete')
          .map((c) => ({ table: c.table, col: c.col, count: c.deletedCount }))
      );

      await tx.insert(ipoMergeLog).values({
        keepIpoId: keepId,
        keepSlug: keep.slug,
        dropIpoId: dropId,
        dropSlug: drop.slug,
        dropRow: sql`${dropRowText}::jsonb` as unknown as Record<string, unknown>,
        survivorPatch: sql`${survivorPatchJson}::jsonb` as unknown as Record<string, unknown>,
        deletedChildCounts: sql`${deletedJson}::jsonb` as unknown as Record<string, unknown>,
        repointedChildCounts: sql`${repointedJson}::jsonb` as unknown as Record<string, unknown>,
        mergedBy: opts.mergedBy || 'unknown',
      });

      // DEFECT 2 (2026-09-16 staging dedupe): the dropped `ipos` row is deleted here — after
      // child-table repoint/delete above, but BEFORE any carried-column UPDATE on the survivor
      // below. A carried value (e.g. symbol) can be identical to a value the dropped row still
      // holds; writing the survivor's UPDATE first, while the dropped row still exists, makes
      // both rows hold that value at once — which any unique-constrained column the dropped row
      // still carries (checked against schema.ts: currently only `slug`, which is never a
      // carried column; any future addition to CARRY_IF_ABSENT_COLUMNS that is also
      // unique-constrained would hit this) cannot survive, crashing the whole transaction
      // (icelectricals, 2026-09-16: symbol='ICELCO' observed on both rows mid-transaction).
      // Deleting the dropped row first means the carried value only ever exists on the survivor.
      await tx.delete(ipos).where(eq(ipos.id, dropId));

      // OD-86 + OD-83: a relaunch merge leaves the survivor with both records' keys; the older
      // row's key of each source the newer row also carries is SUPERSEDED here, in the same
      // transaction, so one source never holds two ACTIVE keys on one row.
      if (relaunchException(relaunch)) {
        const keepDay = String(keep.openDate ?? '').slice(0, 10);
        const dropDay = String(drop.openDate ?? '').slice(0, 10);
        const olderId = keepDay && dropDay ? (keepDay < dropDay ? keepId : dropDay < keepDay ? dropId : null) : null;
        if (olderId) {
          const newerId = olderId === keepId ? dropId : keepId;
          await supersedeOlderKeysOnRelaunchMerge(
            tx,
            pairKeys.filter((k) => k.ipoId === olderId),
            pairKeys.filter((k) => k.ipoId === newerId),
            `merge of ${drop.slug} into ${keep.slug}`
          );
        }
      }

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
      // Child-table repoint/delete and the dropped `ipos` row delete both already ran above
      // (DEFECT 2 fix) — before this patch loop, so a unique-constrained carried value never has
      // to coexist on both rows.
    });

    await this.invalidateCache(
      [getIPOByIdKey(keepId), getIPOBySlugKey(keep.slug), getIPOByIdKey(dropId), getIPOBySlugKey(drop.slug)],
      ['ipo:list:*', 'ipo:search:*']
    );

    return { ...plan, applied: true, keepSlug: keep.slug, droppedSlug: drop.slug, provenanceWritten, childOutcome };
  }

  /**
   * #900: the SQL condition, over a dropped-side row aliased `d`, that is true exactly when moving
   * `d` onto the survivor would violate a unique key — i.e. the survivor already holds a row with
   * the same values in every OTHER column of a unique key that includes the IPO column.
   *
   * Read from the live catalog (pg_index), never hand-listed: `user_watchlist`'s
   * UNIQUE (user_id, ipo_id) exists on production but not in schema.ts, which is precisely how a
   * hand-kept list would miss it. Mirrors Postgres's own NULL rule: under the default NULLS
   * DISTINCT, a NULL never conflicts, so plain `=` is exact; under NULLS NOT DISTINCT it uses
   * IS NOT DISTINCT FROM. Returns null when no such key exists (nothing can conflict).
   *
   * A unique index with an expression or a WHERE clause on a REPOINT table is refused rather than
   * approximated: guessing its conflict rule wrong either deletes a row that should have moved or
   * aborts every merge, and neither should happen silently.
   */
  private async buildRepointConflictPredicate(
    tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
    table: string,
    col: string,
    keepId: string
  ): Promise<ReturnType<typeof sql> | null> {
    const idxResult = await tx.execute(sql`
      select i.indexrelid::regclass::text as name,
             (i.indexprs is not null or i.indpred is not null) as complex,
             coalesce(i.indnullsnotdistinct, false) as nulls_not_distinct,
             array(
               select a.attname::text
               from unnest(i.indkey) with ordinality as k(attnum, ord)
               join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
               order by k.ord
             ) as cols
      from pg_index i
      where i.indrelid = to_regclass(${`public.${table}`}) and i.indisunique
    `);
    const indexes =
      (
        idxResult as unknown as {
          rows: { name: string; complex: boolean; nulls_not_distinct: boolean; cols: string[] | string }[];
        }
      ).rows ?? [];

    const clauses: ReturnType<typeof sql>[] = [];
    for (const idx of indexes) {
      // node-postgres returns name[] as a JS array; a text[] literal is tolerated defensively.
      const cols = Array.isArray(idx.cols) ? idx.cols : String(idx.cols).replace(/^{|}$/g, '').split(',').filter(Boolean);
      if (idx.complex) {
        throw new DatabaseError(
          `mergeDuplicateInto: ${table} has unique index ${idx.name} with an expression or predicate — ` +
            `the merge cannot tell which rows would conflict, refusing`,
          undefined
        );
      }
      if (!cols.includes(col)) continue;
      const others = cols.filter((c) => c !== col);
      const match = others.map((c) =>
        idx.nulls_not_distinct
          ? sql`s.${sql.identifier(c)} is not distinct from d.${sql.identifier(c)}`
          : sql`s.${sql.identifier(c)} = d.${sql.identifier(c)}`
      );
      const where = [sql`s.${sql.identifier(col)} = ${keepId}`, ...match];
      clauses.push(sql`exists (select 1 from ${sql.identifier(table)} s where ${sql.join(where, sql` and `)})`);
    }
    return clauses.length === 0 ? null : sql.join(clauses, sql` or `);
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
