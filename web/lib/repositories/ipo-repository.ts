/**
 * IPO Repository
 *
 * Handles all data access operations for IPO entities.
 * Implements cache-aside pattern with Redis for optimized performance.
 */

import { eq, and, or, gte, lte, sql, desc, asc, inArray, like } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import Fuse from 'fuse.js';
import { BaseRepository } from './base-repository';
import {
  ipos,
  financialData,
  ipoFinancials,
  ipoDetails,
  documents,
  subscriptions,
  gmpRecords,
  listingPerformance,
  peerCompanies,
  registrars,
  ipoScores,
  anchorInvestors,
  ipoDemandGraph,
  type ipoStatusEnum,
  type segmentEnum,
  type offeringTypeEnum,
} from '../db';
import * as schema from '@ipodhan/shared/db/schema';
import {
  CacheTTL,
  getIPOBySlugKey,
  getIPOByIdKey,
  getIPOListKey,
  getIPOSearchKey,
  getHistoricalIPOsKey,
  getFuzzySearchKey,
} from '../cache/cache-keys';
import { EntityNotFoundError, DatabaseError } from '../errors/repository-errors';
import { logger } from '../logger';
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
      scoreRange,
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

          // Story 4.7: Score range filter
          if (scoreRange && scoreRange !== 'all') {
            const [minScore, maxScore] = scoreRange.split('-').map(Number);
            conditions.push(
              sql`EXISTS (
                SELECT 1 FROM ipo_scores
                WHERE ipo_scores.ipo_id = ${ipos.id}
                AND ipo_scores.total_score >= ${minScore}
                AND ipo_scores.total_score <= ${maxScore}
              )`
            );
          }

          const whereClause =
            conditions.length > 0 ? and(...conditions) : undefined;

          // Get total count
          const [{ count }] = await this.db
            .select({ count: sql<number>`count(*)::int` })
            .from(ipos)
            .where(whereClause);

          // Get paginated data with ipoScore join (Story 4.7)
          const offset = (page - 1) * limit;
          const sortColumn = ipos[sortBy] || ipos.createdAt;
          const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

          const results = await this.db
            .select({
              ipo: ipos,
              ipoScore: ipoScores,
            })
            .from(ipos)
            .leftJoin(ipoScores, eq(ipos.id, ipoScores.ipoId))
            .where(whereClause)
            .orderBy(orderBy)
            .limit(limit)
            .offset(offset);

          // Transform results to include ipoScore as a property
          const data = results.map(row => ({
            ...row.ipo,
            ipoScore: row.ipoScore || null,
          }));

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

          // Fetch related data (Story 4.7: added ipoScore, Story 4.10: added ipoFinancials, Story 4.11: added ipoDetails, Story 11.10: added anchorInvestor, Phase 3B: added demandGraph)
          const [
            financials,
            enhancedFinancials,
            details,
            docs,
            subs,
            gmps,
            listing,
            peers,
            registrarData,
            ipoScore,
            anchorInvestor,
            demandGraph,
          ] = await Promise.all([
            this.db
              .select()
              .from(financialData)
              .where(eq(financialData.ipoId, ipo.id))
              .limit(1)
              .then((r) => r[0] || null),
            this.db
              .select()
              .from(ipoFinancials)
              .where(eq(ipoFinancials.ipoId, ipo.id))
              .limit(1)
              .then((r) => r[0] || null),
            this.db
              .select()
              .from(ipoDetails)
              .where(eq(ipoDetails.ipoId, ipo.id))
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
            this.db
              .select()
              .from(ipoScores)
              .where(eq(ipoScores.ipoId, ipo.id))
              .limit(1)
              .then((r) => r[0] || null),
            this.db
              .select()
              .from(anchorInvestors)
              .where(eq(anchorInvestors.ipoId, ipo.id))
              .limit(1)
              .then((r) => r[0] || null),
            this.db
              .select()
              .from(ipoDemandGraph)
              .where(eq(ipoDemandGraph.ipoId, ipo.id))
              .orderBy(asc(ipoDemandGraph.exchange), asc(ipoDemandGraph.pricePoint)),
          ]);

          return {
            ...ipo,
            financialData: financials,
            ipoFinancials: enhancedFinancials, // Story 4.10
            ipoDetails: details, // Story 4.11
            documents: docs,
            subscriptions: subs,
            gmpRecords: gmps,
            listingPerformance: listing,
            peerCompanies: peers,
            registrarRelation: registrarData,
            ipoScore: ipoScore, // Story 4.7
            anchorInvestor: anchorInvestor, // Story 11.10
            ipoDemandGraph: demandGraph, // Phase 3B: DemandGraph component
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
      const [ipo] = await this.db
        .insert(ipos)
        .values(data)
        .returning();

      // Invalidate list cache (including listings cache for new LISTED IPOs)
      await this.deleteCachePattern('ipo:list:*');
      await this.deleteCachePattern('ipo:search:*');
      await this.deleteCachePattern('ipo:listings:*');

      return ipo;
    } catch (error) {
      throw new DatabaseError('Failed to create IPO', undefined, error);
    }
  }

  /**
   * Update IPO by ID
   */
  async update(id: string, data: Partial<IPOInsert>): Promise<IPO> {
    try {
      const [ipo] = await this.db
        .update(ipos)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(ipos.id, id))
        .returning();

      if (!ipo) {
        throw new EntityNotFoundError('IPO', id);
      }

      // Invalidate cache (including listings cache for LISTED IPOs)
      await this.invalidateCache(
        [getIPOByIdKey(id), getIPOBySlugKey(ipo.slug)],
        ['ipo:list:*', 'ipo:search:*', 'ipo:listings:*']
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

      // Invalidate cache (including listings cache for LISTED IPOs)
      await this.invalidateCache(
        [getIPOByIdKey(id), getIPOBySlugKey(ipo.slug)],
        ['ipo:list:*', 'ipo:search:*', 'ipo:listings:*']
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
   * Find all IPOs with ipoDetails for calendar view
   * Story 4.12: Extended timeline dates need ipoDetails relation
   * Performance: Added date range filtering to avoid fetching all IPOs
   *
   * @param filters - Category, year, and optional date range filters
   * @returns All IPOs with ipoDetails (no pagination)
   */
  async findAllWithDetails(filters: {
    category: string[];
    year?: number;
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<Array<IPO & { ipoDetails: typeof ipoDetails.$inferSelect | null }>> {
    try {
      // Build where conditions
      const conditions = [];

      if (filters.category && filters.category.length > 0) {
        // Map old category to segment
        const segments = filters.category.filter(c => c === 'MAINBOARD' || c === 'SME');
        if (segments.length > 0) {
          conditions.push(inArray(ipos.segment, segments as (typeof segmentEnum.enumValues)[number][]));
        }
      }

      if (filters.year) {
        // Filter by year based on openDate
        conditions.push(
          sql`EXTRACT(YEAR FROM ${ipos.openDate}) = ${filters.year}`
        );
      }

      // Performance optimization: Filter by date range
      // Only include IPOs where ANY of the 7 date fields fall within the target month
      if (filters.dateFrom && filters.dateTo) {
        const dateRangeConditions = [
          and(gte(ipos.openDate, filters.dateFrom.toISOString()), lte(ipos.openDate, filters.dateTo.toISOString())),
          and(gte(ipos.closeDate, filters.dateFrom.toISOString()), lte(ipos.closeDate, filters.dateTo.toISOString())),
          and(gte(ipos.allotmentDate, filters.dateFrom.toISOString()), lte(ipos.allotmentDate, filters.dateTo.toISOString())),
          and(gte(ipos.listingDate, filters.dateFrom.toISOString()), lte(ipos.listingDate, filters.dateTo.toISOString())),
          and(gte(ipoDetails.basisOfAllotmentDate, filters.dateFrom.toISOString()), lte(ipoDetails.basisOfAllotmentDate, filters.dateTo.toISOString())),
          and(gte(ipoDetails.initiationOfRefundsDate, filters.dateFrom.toISOString()), lte(ipoDetails.initiationOfRefundsDate, filters.dateTo.toISOString())),
          and(gte(ipoDetails.creditOfSharesDate, filters.dateFrom.toISOString()), lte(ipoDetails.creditOfSharesDate, filters.dateTo.toISOString())),
        ];
        conditions.push(or(...dateRangeConditions));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // Fetch IPOs with ipoDetails relation
      const results = await this.db
        .select({
          ipo: ipos,
          ipoDetails: ipoDetails,
        })
        .from(ipos)
        .leftJoin(ipoDetails, eq(ipos.id, ipoDetails.ipoId))
        .where(whereClause)
        .orderBy(asc(ipos.openDate));

      // Transform results to include ipoDetails as property
      return results.map(row => ({
        ...row.ipo,
        ipoDetails: row.ipoDetails || null,
      }));
    } catch (error) {
      throw new DatabaseError(
        'Failed to fetch IPOs with details for calendar',
        undefined,
        error
      );
    }
  }

  /**
   * Count IPOs with optional filters
   * Used for getting total count without fetching all data
   *
   * @param filters - Optional filters (same as findAll)
   * @returns Total count of IPOs matching the filters
   */
  async count(filters: Partial<IPOFilters> = {}): Promise<number> {
    try {
      const {
        status,
        segment,
        offeringType,
        sector,
        search,
        scoreRange,
        minIssueSize,
        maxIssueSize,
        openDateFrom,
        openDateTo,
        closeDateFrom,
        closeDateTo,
        listingDateFrom,
        listingDateTo,
      } = filters;

      // Build where conditions (same logic as findAll)
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

      // Score range filter
      if (scoreRange && scoreRange !== 'all') {
        const [minScore, maxScore] = scoreRange.split('-').map(Number);
        conditions.push(
          sql`EXISTS (
            SELECT 1 FROM ipo_scores
            WHERE ipo_scores.ipo_id = ${ipos.id}
            AND ipo_scores.total_score >= ${minScore}
            AND ipo_scores.total_score <= ${maxScore}
          )`
        );
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      // Get total count
      const [{ count }] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(ipos)
        .where(whereClause);

      return count;
    } catch (error) {
      throw new DatabaseError('Failed to count IPOs', undefined, error);
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
      search,
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
          // Build base conditions: status='LISTED' AND listing_date IS NOT NULL AND listing_date < CURRENT_DATE
          const conditions = [
            eq(ipos.status, 'LISTED'),
            sql`${ipos.listingDate} IS NOT NULL`,
            sql`${ipos.listingDate} < CURRENT_DATE`, // Only past listings, not future dates
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

          // Add search filter (case-insensitive company name search)
          if (search && search.trim()) {
            conditions.push(
              sql`${ipos.companyName} ILIKE ${`%${search.trim()}%`}`
            );
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

  /**
   * Find IPO by slug with fallback to fuzzy matching
   * ISS-027: Provides better UX when exact slug match fails
   *
   * @param slug - IPO slug to search for
   * @param options - Search options
   * @returns IPO with relations if found, null otherwise
   */
  async findBySlugWithFallback(
    slug: string,
    options: {
      enableFuzzy?: boolean;
      similarityThreshold?: number;
    } = {}
  ): Promise<IPOWithRelations | null> {
    const {
      enableFuzzy = true,
      similarityThreshold = 0.6,
    } = options;

    // Try exact match first (uses cache)
    const exactMatch = await this.findBySlug(slug);
    if (exactMatch) {
      return exactMatch;
    }

    // If exact match fails and fuzzy is disabled, return null
    if (!enableFuzzy) {
      return null;
    }

    logger.info({ slug }, '[IPO Repository] Exact slug match failed, trying fuzzy match');

    // Convert slug to search term (remove -ipo suffix and replace hyphens)
    const searchTerm = slug
      .replace(/-ipo$/i, '')
      .replace(/-/g, ' ')
      .toLowerCase();

    // Fetch all IPOs for fuzzy matching (minimal fields)
    const allIPOs = await this.executeQuery(
      'findAllForFuzzyMatch',
      async () => {
        return await this.db.select({
          id: ipos.id,
          companyName: ipos.companyName,
          slug: ipos.slug,
        }).from(ipos);
      }
    );

    // Configure Fuse.js for fuzzy matching
    const fuse = new Fuse(allIPOs, {
      keys: [
        { name: 'companyName', weight: 0.7 },
        { name: 'slug', weight: 0.3 },
      ],
      threshold: 1 - similarityThreshold, // Fuse uses 0 (exact) to 1 (no match)
      includeScore: true,
    });

    const results = fuse.search(searchTerm);

    if (results.length === 0) {
      logger.warn({ slug, searchTerm }, '[IPO Repository] No fuzzy matches found');
      return null;
    }

    const bestMatch = results[0];

    logger.info(
      {
        slug,
        matchedSlug: bestMatch.item.slug,
        companyName: bestMatch.item.companyName,
        score: bestMatch.score,
        similarity: Math.round((1 - (bestMatch.score || 0)) * 100),
      },
      '[IPO Repository] Fuzzy match found'
    );

    // Fetch full IPO details for best match (uses cache)
    return await this.findBySlug(bestMatch.item.slug);
  }

  /**
   * Search IPOs by company name using fuzzy matching
   * ISS-027: Returns multiple suggestions with similarity scores
   *
   * @param query - Search query
   * @param options - Search options
   * @returns Array of matching IPOs with similarity scores
   */
  async searchByName(
    query: string,
    options: {
      limit?: number;
      threshold?: number;
    } = {}
  ): Promise<Array<{ ipo: IPO; score: number; similarity: number }>> {
    const { limit = 10, threshold = 0.4 } = options;

    const cacheKey = getFuzzySearchKey(query, limit, threshold);

    return this.getFromCache(
      cacheKey,
      async () => {
        // Fetch all IPOs
        const allIPOs = await this.executeQuery(
          'searchByName',
          async () => {
            return await this.db.select().from(ipos);
          }
        );

        // Configure Fuse.js
        const fuse = new Fuse(allIPOs, {
          keys: [
            { name: 'companyName', weight: 0.7 },
            { name: 'slug', weight: 0.3 },
          ],
          threshold: 1 - threshold,
          includeScore: true,
        });

        const results = fuse.search(query);

        return results
          .slice(0, limit)
          .map(result => ({
            ipo: result.item,
            score: result.score || 0,
            similarity: Math.round((1 - (result.score || 0)) * 100),
          }));
      },
      CacheTTL.IPO_LIST // 5 minutes
    );
  }

  /**
   * Save demand graph data for an IPO
   * Stores price-wise cumulative demand data from NSE/BSE
   */
  async saveDemandGraph(
    ipoId: string,
    demandData: Array<{
      pricePoint: number | null;
      isCutOff: boolean;
      cumulativeQuantity: number;
      exchange: 'NSE' | 'BSE' | 'BOTH';
      timestamp: string;
    }>
  ): Promise<void> {
    try {
      // Delete existing data for this IPO (keeping only latest snapshot)
      await this.db
        .delete(ipoDemandGraph)
        .where(eq(ipoDemandGraph.ipoId, ipoId));

      // Prepare records for insertion
      const records = demandData.map(entry => ({
        ipoId,
        timestamp: new Date(entry.timestamp),
        pricePoint: entry.pricePoint?.toString() || null,
        isCutOff: entry.isCutOff,
        cumulativeQuantity: entry.cumulativeQuantity,
        exchange: entry.exchange as (typeof schema.exchangeEnum.enumValues)[number],
      }));

      // Insert new data
      if (records.length > 0) {
        await this.db.insert(ipoDemandGraph).values(records);
      }

      // Invalidate related caches
      await this.deleteCache([
        `demand:graph:${ipoId}:all`,
        `demand:graph:${ipoId}:NSE`,
        `demand:graph:${ipoId}:BSE`,
        `demand:graph:${ipoId}:BOTH`,
      ]);

      logger.info({
        ipoId,
        recordCount: records.length,
      }, 'Demand graph data saved successfully');
    } catch (error) {
      throw new DatabaseError(
        `Failed to save demand graph for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }

  /**
   * Fetch demand graph data for an IPO
   * Returns price-wise cumulative demand for charting
   */
  async getDemandGraph(
    ipoId: string,
    exchange?: 'NSE' | 'BSE' | 'BOTH'
  ): Promise<Array<{
    id: string;
    ipoId: string;
    timestamp: Date;
    pricePoint: string | null;
    isCutOff: boolean;
    cumulativeQuantity: number;
    exchange: 'NSE' | 'BSE' | 'BOTH';
  }>> {
    const cacheKey = `demand:graph:${ipoId}:${exchange || 'all'}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const conditions = [eq(ipoDemandGraph.ipoId, ipoId)];

          if (exchange) {
            conditions.push(eq(ipoDemandGraph.exchange, exchange));
          }

          const results = await this.db
            .select()
            .from(ipoDemandGraph)
            .where(and(...conditions))
            .orderBy(
              asc(ipoDemandGraph.exchange),
              asc(ipoDemandGraph.pricePoint)
            );

          return results;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch demand graph for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.SUBSCRIPTION_LATEST // 3 minutes for real-time data
    );
  }

  /**
   * Get latest demand graph snapshot for an IPO
   * Returns the most recent demand data
   */
  async getLatestDemandSnapshot(ipoId: string): Promise<{
    timestamp: Date;
    totalCutOffBids: number;
    pricePoints: number;
  } | null> {
    const cacheKey = `demand:snapshot:${ipoId}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          // Get the latest timestamp
          const latestResult = await this.db
            .select({
              timestamp: sql<Date>`MAX(${ipoDemandGraph.timestamp})`,
            })
            .from(ipoDemandGraph)
            .where(eq(ipoDemandGraph.ipoId, ipoId));

          if (!latestResult[0]?.timestamp) {
            return null;
          }

          const latestTimestamp = latestResult[0].timestamp;

          // Get stats for latest snapshot
          const stats = await this.db
            .select({
              totalCutOffBids: sql<number>`SUM(CASE WHEN ${ipoDemandGraph.isCutOff} = true THEN ${ipoDemandGraph.cumulativeQuantity} ELSE 0 END)`,
              pricePoints: sql<number>`COUNT(DISTINCT ${ipoDemandGraph.pricePoint})`,
            })
            .from(ipoDemandGraph)
            .where(
              and(
                eq(ipoDemandGraph.ipoId, ipoId),
                eq(ipoDemandGraph.timestamp, latestTimestamp)
              )
            );

          return {
            timestamp: latestTimestamp,
            totalCutOffBids: Number(stats[0]?.totalCutOffBids || 0),
            pricePoints: Number(stats[0]?.pricePoints || 0),
          };
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch demand snapshot for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.SUBSCRIPTION_LATEST // 3 minutes
    );
  }

  /**
   * Check if demand graph data exists for an IPO
   */
  async hasDemandGraphData(ipoId: string): Promise<boolean> {
    const cacheKey = `demand:exists:${ipoId}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const result = await this.db
            .select({ count: sql<number>`COUNT(*)` })
            .from(ipoDemandGraph)
            .where(eq(ipoDemandGraph.ipoId, ipoId));

          return Number(result[0]?.count || 0) > 0;
        } catch (error) {
          logger.error({ ipoId, error }, 'Failed to check demand graph existence');
          return false;
        }
      },
      CacheTTL.IPO_DETAIL // 15 minutes
    );
  }

  /**
   * Find IPO listings with comprehensive performance data
   * Used for /mainboard-ipo-listings, /sme-ipo-listings pages
   *
   * @param filters - Category, year, pagination, and sorting filters
   * @returns Paginated IPO listings with subscription, GMP, and listing performance data
   */
  async findListings(filters: {
    category?: 'MAINBOARD' | 'SME' | 'FPO' | 'ALL';
    year?: string;
    page?: number;
    limit?: number;
    sortBy?: 'listingDate' | 'listingDayGain' | 'currentGain' | 'issueSize' | 'companyName';
    sortOrder?: 'asc' | 'desc';
  }): Promise<{
    data: Array<{
      id: string;
      companyName: string;
      slug: string;
      segment: string | null;
      offeringType: string | null;
      openDate: string | null;
      closeDate: string | null;
      listingDate: string | null;
      issuePrice: number | null;
      issueSize: number | null;
      lotSize: number | null;
      allotmentDate: string | null;
      subscriptionOverall: number | null;
      subscriptionQIB: number | null;
      subscriptionNII: number | null;
      subscriptionRetail: number | null;
      gmp: number | null;
      listingDayClosePrice: number | null;
      listingDayGainPercent: number | null;
      currentPriceBSE: number | null;
      currentPriceNSE: number | null;
      currentGainPercent: number | null;
      marketCap: number | null;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      hasMore: boolean;
    };
    stats: {
      totalIPOs: number;
      avgListingGain: number | null;
      totalGainers: number;
      totalLosers: number;
    };
  }> {
    const {
      category,
      year,
      page = 1,
      limit = 50,
      sortBy = 'listingDate',
      sortOrder = 'desc',
    } = filters;

    const cacheKey = `ipo:listings:${category || 'ALL'}:${year || 'ALL'}:${page}:${limit}:${sortBy}:${sortOrder}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          // Build where conditions
          const whereConditions = [];

          // Filter by category - map to segment OR offeringType based on category
          if (category && category !== 'ALL') {
            if (category === 'MAINBOARD' || category === 'SME') {
              // MAINBOARD and SME are segments - filter by segment AND offeringType=IPO
              whereConditions.push(eq(ipos.segment, category));
              whereConditions.push(eq(ipos.offeringType, 'IPO'));
            } else {
              // FPO, RIGHTS, NCD are offering types - filter by offeringType
              whereConditions.push(eq(ipos.offeringType, category as (typeof offeringTypeEnum.enumValues)[number]));
            }
          }

          // Filter by year
          if (year) {
            const yearNum = parseInt(year, 10);
            whereConditions.push(
              sql`EXTRACT(YEAR FROM ${ipos.listingDate}) = ${yearNum}`
            );
          }

          // Only include listed IPOs
          whereConditions.push(eq(ipos.status, 'LISTED'));

          // Combine conditions
          const whereClause =
            whereConditions.length > 0 ? and(...whereConditions) : undefined;

          // Determine sort order
          const sortOrderFn = sortOrder === 'asc' ? asc : desc;
          let orderByClause;

          switch (sortBy) {
            case 'listingDate':
              orderByClause = sortOrderFn(ipos.listingDate);
              break;
            case 'listingDayGain':
              orderByClause = sortOrderFn(listingPerformance.listingGainPercent);
              break;
            case 'currentGain':
              orderByClause = sortOrderFn(listingPerformance.currentGainPercent);
              break;
            case 'issueSize':
              orderByClause = sortOrderFn(ipos.issueSize);
              break;
            case 'companyName':
              orderByClause = sortOrderFn(ipos.companyName);
              break;
            default:
              orderByClause = desc(ipos.listingDate);
          }

          // Calculate pagination
          const offset = (page - 1) * limit;

          // Fetch total count
          const countResult = await this.db
            .select({ count: sql<number>`count(*)` })
            .from(ipos)
            .where(whereClause);

          const total = Number(countResult[0]?.count || 0);

          // Fetch IPO listings with related data
          const ipoListings = await this.db
            .select({
              // IPO fields
              id: ipos.id,
              companyName: ipos.companyName,
              slug: ipos.slug,
              segment: ipos.segment,
              offeringType: ipos.offeringType,
              openDate: ipos.openDate,
              closeDate: ipos.closeDate,
              listingDate: ipos.listingDate,
              issuePrice: ipos.priceRangeMax,
              issueSize: ipos.issueSize,
              lotSize: ipos.lotSize,
              allotmentDate: ipos.allotmentDate,

              // Listing performance fields
              listingPrice: listingPerformance.listingPrice,
              listingGainPercent: listingPerformance.listingGainPercent,
              currentPrice: listingPerformance.currentPrice,
              currentPriceBSE: listingPerformance.currentPriceBSE,
              currentPriceNSE: listingPerformance.currentPriceNSE,
              currentGainPercent: listingPerformance.currentGainPercent,
            })
            .from(ipos)
            .leftJoin(listingPerformance, eq(ipos.id, listingPerformance.ipoId))
            .where(whereClause)
            .orderBy(orderByClause)
            .limit(limit)
            .offset(offset);

          // Fetch subscription and GMP data for these IPOs
          const ipoIds = ipoListings.map((ipo) => ipo.id);

          let subscriptionData: any[] = [];
          let gmpData: any[] = [];

          if (ipoIds.length > 0) {
            // Fetch latest subscription data for each IPO
            subscriptionData = await this.db
              .select({
                ipoId: subscriptions.ipoId,
                totalSubscription: subscriptions.totalSubscription,
                qibSubscription: subscriptions.qibSubscription,
                niiSubscription: subscriptions.niiSubscription,
                retailSubscription: subscriptions.retailSubscription,
              })
              .from(subscriptions)
              .where(inArray(subscriptions.ipoId, ipoIds))
              .orderBy(desc(subscriptions.timestamp));

            // Fetch latest GMP data for each IPO
            gmpData = await this.db
              .select({
                ipoId: gmpRecords.ipoId,
                gmp: gmpRecords.gmp,
              })
              .from(gmpRecords)
              .where(inArray(gmpRecords.ipoId, ipoIds))
              .orderBy(desc(gmpRecords.timestamp));
          }

          // Create maps for quick lookup
          const subscriptionMap = new Map();
          subscriptionData.forEach((sub) => {
            if (!subscriptionMap.has(sub.ipoId)) {
              subscriptionMap.set(sub.ipoId, sub);
            }
          });

          const gmpMap = new Map();
          gmpData.forEach((gmp) => {
            if (!gmpMap.has(gmp.ipoId)) {
              gmpMap.set(gmp.ipoId, gmp);
            }
          });

          // Combine data
          const data = ipoListings.map((ipo) => {
            const subscription = subscriptionMap.get(ipo.id);
            const gmpRecord = gmpMap.get(ipo.id);

            return {
              id: ipo.id,
              companyName: ipo.companyName,
              slug: ipo.slug,
              segment: ipo.segment,
              offeringType: ipo.offeringType,
              openDate: ipo.openDate,
              closeDate: ipo.closeDate,
              listingDate: ipo.listingDate,
              issuePrice: ipo.issuePrice ? Number(ipo.issuePrice) : null,
              issueSize: ipo.issueSize ? Number(ipo.issueSize) : null,
              lotSize: ipo.lotSize,
              allotmentDate: ipo.allotmentDate,

              // Subscription data
              subscriptionOverall: subscription?.totalSubscription
                ? Number(subscription.totalSubscription)
                : null,
              subscriptionQIB: subscription?.qibSubscription
                ? Number(subscription.qibSubscription)
                : null,
              subscriptionNII: subscription?.niiSubscription
                ? Number(subscription.niiSubscription)
                : null,
              subscriptionRetail: subscription?.retailSubscription
                ? Number(subscription.retailSubscription)
                : null,

              // GMP data — use ?? so a real GMP of 0 (flat grey market) is kept,
              // not collapsed to null/'-' by ||  (C2/G16)
              gmp: gmpRecord?.gmp ?? null,

              // Listing performance
              listingDayClosePrice: ipo.listingPrice || null,
              listingDayGainPercent: ipo.listingGainPercent
                ? Number(ipo.listingGainPercent)
                : null,
              currentPriceBSE: ipo.currentPriceBSE || null,
              currentPriceNSE: ipo.currentPriceNSE || null,
              currentGainPercent: ipo.currentGainPercent
                ? Number(ipo.currentGainPercent)
                : null,
              // Calculate market cap estimate: issueSize * (currentPrice / issuePrice)
              marketCap:
                ipo.issueSize &&
                ipo.issuePrice &&
                (ipo.currentPriceBSE || ipo.currentPriceNSE)
                  ? Number(ipo.issueSize) *
                    ((ipo.currentPriceBSE || ipo.currentPriceNSE!) /
                      Number(ipo.issuePrice))
                  : null,
            };
          });

          // Calculate stats
          const avgListingGain =
            data.length > 0
              ? data.reduce(
                  (sum, ipo) => sum + (ipo.listingDayGainPercent || 0),
                  0
                ) / data.length
              : null;

          const totalGainers = data.filter(
            (ipo) => (ipo.listingDayGainPercent || 0) > 0
          ).length;
          const totalLosers = data.filter(
            (ipo) => (ipo.listingDayGainPercent || 0) < 0
          ).length;

          return {
            data,
            pagination: {
              page,
              limit,
              total,
              hasMore: offset + data.length < total,
            },
            stats: {
              totalIPOs: total,
              avgListingGain,
              totalGainers,
              totalLosers,
            },
          };
        } catch (error) {
          throw new DatabaseError(
            'Failed to fetch IPO listings',
            undefined,
            error
          );
        }
      },
      CacheTTL.IPO_LISTINGS // 5 minutes - matches page ISR revalidation
    );
  }
}
