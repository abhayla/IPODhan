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
import { EntityNotFoundError, DatabaseError } from '../errors/repository-errors';
import {
  normalizedCompanyNameSql,
  compactNormalizedCompanyNameSql,
  sanitizeDisplayCompanyName,
  normalizeCompanyNameForMatching,
} from '../utils/company-name-normalizer';
import { findMostSimilarName } from '../utils/company-name-similarity';
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
      CacheTTL.IPO_DETAIL
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
  async findByNormalizedName(normalizedName: string): Promise<IPO | null> {
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
      const [ipo] = await this.db
        .select()
        .from(ipos)
        .where(
          sql`${normalizedCompanyNameSql(sql`${ipos.companyName}`)} = ${normalizedName}
              OR ${compactNormalizedCompanyNameSql(sql`${ipos.companyName}`)} = ${normalizedName.replace(/\s+/g, '')}`
        )
        .limit(1);

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
  async findBySymbol(symbol: string | null | undefined): Promise<IPO | null> {
    const normalized = symbol?.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    try {
      const [ipo] = await this.db
        .select()
        .from(ipos)
        .where(sql`upper(trim(${ipos.symbol})) = ${normalized}`)
        .limit(1);

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
  async findByIsin(isin: string | null | undefined): Promise<IPO | null> {
    const normalized = isin?.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    try {
      const [ipo] = await this.db
        .select()
        .from(ipos)
        .where(sql`upper(trim(${ipos.isin})) = ${normalized}`)
        .limit(1);

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
      CacheTTL.IPO_DETAIL
    );
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
