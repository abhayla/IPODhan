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
  type ipoStatusEnum,
  type ipoCategoryEnum,
} from '../db/schema';
import type * as schema from '../db/schema';
import {
  CacheTTL,
  getIPOBySlugKey,
  getIPOByIdKey,
  getIPOListKey,
  getIPOSearchKey,
} from '../cache/cache-keys';
import { EntityNotFoundError, DatabaseError } from '../errors/repository-errors';
import type {
  IPO,
  IPOInsert,
  IPOWithRelations,
  IPOFilters,
  PaginatedResponse,
  IIPORepository,
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
      category,
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

          if (category) {
            if (Array.isArray(category)) {
              conditions.push(inArray(ipos.category, category as (typeof ipoCategoryEnum.enumValues)[number][]));
            } else {
              conditions.push(eq(ipos.category, category as (typeof ipoCategoryEnum.enumValues)[number]));
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
          ]);

          return {
            ...ipo,
            financialData: financials,
            documents: docs,
            subscriptions: subs,
            gmpRecords: gmps,
            listingPerformance: listing,
            peerCompanies: peers,
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

      // Invalidate list cache
      await this.deleteCachePattern('ipo:list:*');
      await this.deleteCachePattern('ipo:search:*');

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
}
