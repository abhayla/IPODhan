/**
 * Registrar Repository
 *
 * Handles database operations for Registrar entities with Redis caching.
 * Story 4.6: Allotment Status Checker
 */

import { eq } from 'drizzle-orm';
import { BaseRepository } from './base-repository';
import { registrars } from '../db/schema';
import type { Registrar } from '../db/types';

export class RegistrarRepository extends BaseRepository {
  private readonly CACHE_TTL = 86400; // 24 hours in seconds

  /**
   * Find registrar by ID
   * Uses Redis cache with 24-hour TTL
   */
  async findById(id: string): Promise<Registrar | null> {
    const cacheKey = `registrar:${id}`;

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
   * Uses Redis cache with 24-hour TTL
   */
  async findByName(name: string): Promise<Registrar | null> {
    const cacheKey = `registrar:name:${name}`;

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
   * Find all registrars
   * @param activeOnly - If true, only return active registrars (default: true)
   */
  async findAll(activeOnly: boolean = true): Promise<Registrar[]> {
    const cacheKey = `registrars:all:${activeOnly ? 'active' : 'all'}`;

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

            return await query;
          },
          { activeOnly }
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
    const keys: string[] = [];
    const patterns: string[] = ['registrars:*'];

    if (id) {
      keys.push(`registrar:${id}`);
      patterns.push(`registrar:name:*`);
    }

    await this.invalidateCache(keys, patterns);
  }
}
