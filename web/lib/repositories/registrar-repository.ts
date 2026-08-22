/**
 * Registrar Repository
 *
 * Handles database operations for Registrar entities with Redis caching.
 * Story 4.6: Allotment Status Checker
 * Story 5.3: Registrar Directory - Added search functionality
 */

import { eq, or, ilike, asc } from 'drizzle-orm';
import { BaseRepository } from './base-repository';
import { registrars } from '../db';
import type { Registrar } from '../db/types';
import {
  getRegistrarByIdKey,
  getRegistrarByNameKey,
  getRegistrarAllKey,
  getRegistrarSearchKey,
  getRegistrarInvalidationKeys,
} from '../cache/cache-keys';

export class RegistrarRepository extends BaseRepository {
  private readonly CACHE_TTL = 604800; // 7 days in seconds (as per Story 5.3 requirements)

  /**
   * Find registrar by ID
   * Uses Redis cache with 7-day TTL
   */
  async findById(id: string): Promise<Registrar | null> {
    const cacheKey = getRegistrarByIdKey(id);

    return this.getFromCache(
      cacheKey,
      async () => {
        return this.executeQuery(
          'findRegistrarById',
          async () => {
            const result = await this.db
              .select()
              .from(registrars)
              .where(eq(registrars.id, id))
              .limit(1);

            return result[0] || null;
          },
          { id }
        );
      },
      this.CACHE_TTL
    );
  }

  /**
   * Find registrar by name
   * Uses Redis cache with 7-day TTL
   */
  async findByName(name: string): Promise<Registrar | null> {
    const cacheKey = getRegistrarByNameKey(name);

    return this.getFromCache(
      cacheKey,
      async () => {
        return this.executeQuery(
          'findRegistrarByName',
          async () => {
            const result = await this.db
              .select()
              .from(registrars)
              .where(eq(registrars.name, name))
              .limit(1);

            return result[0] || null;
          },
          { name }
        );
      },
      this.CACHE_TTL
    );
  }

  /**
   * Find all registrars ordered alphabetically
   * @param activeOnly - If true, only return active registrars (default: true)
   * Uses Redis cache with 7-day TTL
   */
  async findAll(activeOnly: boolean = true): Promise<Registrar[]> {
    const cacheKey = getRegistrarAllKey(activeOnly);

    return this.getFromCache(
      cacheKey,
      async () => {
        return this.executeQuery(
          'findAllRegistrars',
          async () => {
            let query = this.db.select().from(registrars);

            if (activeOnly) {
              query = query.where(eq(registrars.active, true)) as typeof query;
            }

            // Order alphabetically by name (Story 5.3 requirement)
            return await query.orderBy(asc(registrars.name));
          },
          { activeOnly }
        );
      },
      this.CACHE_TTL
    );
  }

  /**
   * Search registrars by name (fuzzy search)
   * @param query - Search query string
   * @param activeOnly - If true, only search active registrars (default: true)
   * Uses Redis cache with 7-day TTL
   * Story 5.3: Registrar Directory
   */
  async search(query: string, activeOnly: boolean = true): Promise<Registrar[]> {
    if (!query || query.trim() === '') {
      return this.findAll(activeOnly);
    }

    const normalizedQuery = query.trim();
    const cacheKey = getRegistrarSearchKey(normalizedQuery, activeOnly);

    return this.getFromCache(
      cacheKey,
      async () => {
        return this.executeQuery(
          'searchRegistrars',
          async () => {
            const searchPattern = `%${normalizedQuery}%`;

            const nameCondition = or(
              ilike(registrars.name, searchPattern),
              ilike(registrars.shortName, searchPattern)
            );

            let query = this.db.select().from(registrars);

            if (activeOnly) {
              // Combine both active filter and name search
              query = query.where(eq(registrars.active, true)) as typeof query;
              query = query.where(nameCondition) as typeof query;
            } else {
              query = query.where(nameCondition) as typeof query;
            }

            return await query.orderBy(asc(registrars.name));
          },
          { query: normalizedQuery, activeOnly }
        );
      },
      this.CACHE_TTL
    );
  }

  /**
   * Invalidate all registrar caches
   * Called when registrar data is updated
   */
  async invalidateRegistrarCache(id?: string): Promise<void> {
    const keys: string[] = id ? [getRegistrarByIdKey(id)] : [];
    const patterns = getRegistrarInvalidationKeys(id).filter((k) => k !== keys[0]);
    await this.invalidateCache(keys, patterns);
  }
}
