/**
 * Field Protection Checker
 * Core utility for checking if fields are protected from scraper updates
 *
 * Features:
 * - IPO-level lock check (master lock)
 * - Field-level protection check
 * - Caching with Redis (1h TTL)
 * - Graceful degradation if Redis unavailable
 * - Dependency injection for database and Redis
 */

import { eq, and } from 'drizzle-orm';
import { ipos, fieldProtectionMetadata } from '../db/schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../db/schema';
import type Redis from 'ioredis';

// Cache TTL: 1 hour (protection flags don't change frequently)
const PROTECTION_CACHE_TTL = 3600;

/**
 * Result of protection check for a single field
 */
export interface FieldProtectionStatus {
  isProtected: boolean;
  reason?: 'ipo_locked' | 'field_protected' | 'auto_protected';
  ipoLocked: boolean;
  fieldProtected: boolean;
  autoProtected: boolean;
  lastEditedAt?: Date;
  lastEditedBy?: string;
}

/**
 * Result of filtering protected fields from data
 */
export interface FilterProtectedFieldsResult {
  filtered: Record<string, any>;
  skipped: Record<string, any>;
  allFieldsProtected: boolean;
  ipoLocked: boolean;
}

/**
 * Notification for blocked scraper update
 */
export interface BlockedUpdateNotification {
  ipoId: string;
  tableName: string;
  fieldName?: string;
  scraperName: string;
  reason: 'ipo_locked' | 'field_protected';
  timestamp: Date;
  attemptedValue?: any;
}

/**
 * Notification service interface - implementations provide actual notification logic
 */
export interface NotificationService {
  sendNotification(type: string, data: any): Promise<void>;
}

/**
 * Field Protection Service with dependency injection
 */
export class FieldProtectionService {
  constructor(
    private db: NodePgDatabase<typeof schema>,
    private redis: Redis | null,
    private notificationService?: NotificationService
  ) {}

  /**
   * Check if an IPO is locked from all scraper updates
   */
  async isIPOLocked(ipoId: string): Promise<boolean> {
    const cacheKey = `protection:ipo_locked:${ipoId}`;

    // Try cache first if Redis available
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached !== null) {
          return cached === '1';
        }
      } catch (error) {
        console.warn('[FieldProtection] Redis error, falling back to database:', error);
      }
    }

    // Query database
    const result = await this.db
      .select({ scraperLocked: ipos.scraperLocked })
      .from(ipos)
      .where(eq(ipos.id, ipoId))
      .limit(1);

    const isLocked = result[0]?.scraperLocked ?? false;

    // Cache result if Redis available
    if (this.redis) {
      try {
        await this.redis.setex(cacheKey, PROTECTION_CACHE_TTL, isLocked ? '1' : '0');
      } catch (error) {
        // Silent fail - cache is optional
      }
    }

    return isLocked;
  }

  /**
   * Check if a specific field is protected from scraper updates
   */
  async isFieldProtected(
    ipoId: string,
    tableName: string,
    fieldName: string
  ): Promise<FieldProtectionStatus> {
    const cacheKey = `protection:field:${ipoId}:${tableName}:${fieldName}`;

    // Check IPO-level lock first (master lock overrides everything)
    const ipoLocked = await this.isIPOLocked(ipoId);
    if (ipoLocked) {
      return {
        isProtected: true,
        reason: 'ipo_locked',
        ipoLocked: true,
        fieldProtected: false,
        autoProtected: false,
      };
    }

    // Try cache if Redis available
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached !== null) {
          return JSON.parse(cached);
        }
      } catch (error) {
        console.warn('[FieldProtection] Redis error, falling back to database:', error);
      }
    }

    // Query database
    const result = await this.db
      .select()
      .from(fieldProtectionMetadata)
      .where(
        and(
          eq(fieldProtectionMetadata.ipoId, ipoId),
          eq(fieldProtectionMetadata.tableName, tableName),
          eq(fieldProtectionMetadata.fieldName, fieldName)
        )
      )
      .limit(1);

    const record = result[0];
    const status: FieldProtectionStatus = {
      isProtected: record?.isProtected ?? false,
      ipoLocked: false,
      fieldProtected: record?.isProtected ?? false,
      autoProtected: record?.autoProtected ?? false,
      lastEditedAt: record?.manuallyEditedAt ?? undefined,
      lastEditedBy: record?.manuallyEditedBy ?? undefined,
    };

    if (status.isProtected) {
      status.reason = status.autoProtected ? 'auto_protected' : 'field_protected';
    }

    // Cache result if Redis available
    if (this.redis) {
      try {
        await this.redis.setex(cacheKey, PROTECTION_CACHE_TTL, JSON.stringify(status));
      } catch (error) {
        // Silent fail
      }
    }

    return status;
  }

  /**
   * Filter out protected fields from scraper data
   * Returns only fields that are allowed to be updated
   */
  async filterProtectedFields(
    ipoId: string,
    tableName: string,
    data: Record<string, any>,
    scraperName: string
  ): Promise<FilterProtectedFieldsResult> {
    // Check IPO-level lock first
    const ipoLocked = await this.isIPOLocked(ipoId);
    if (ipoLocked) {
      // Log blocked update
      console.log(`[FieldProtection] IPO ${ipoId} is locked, skipping all fields from ${scraperName}`);

      // Store notification about blocked update
      await this.notifyBlockedUpdate({
        ipoId,
        tableName,
        scraperName,
        reason: 'ipo_locked',
        timestamp: new Date(),
        attemptedValue: data,
      });

      return {
        filtered: {},
        skipped: data,
        allFieldsProtected: true,
        ipoLocked: true,
      };
    }

    // Check each field individually
    const filtered: Record<string, any> = {};
    const skipped: Record<string, any> = {};

    for (const [fieldName, value] of Object.entries(data)) {
      const status = await this.isFieldProtected(ipoId, tableName, fieldName);

      if (status.isProtected) {
        skipped[fieldName] = value;

        console.log(
          `[FieldProtection] Field ${tableName}.${fieldName} is protected for IPO ${ipoId}, ` +
          `skipping update from ${scraperName}. Reason: ${status.reason}`
        );

        // Notify about blocked field
        await this.notifyBlockedUpdate({
          ipoId,
          tableName,
          fieldName,
          scraperName,
          reason: 'field_protected',
          timestamp: new Date(),
          attemptedValue: value,
        });
      } else {
        filtered[fieldName] = value;
      }
    }

    if (Object.keys(skipped).length > 0) {
      console.log(
        `[FieldProtection] ${scraperName} scraper: ${Object.keys(skipped).length} fields protected, ` +
        `${Object.keys(filtered).length} fields allowed for IPO ${ipoId} in table ${tableName}`
      );
    }

    return {
      filtered,
      skipped,
      allFieldsProtected: Object.keys(filtered).length === 0,
      ipoLocked: false,
    };
  }

  /**
   * Invalidate cache for IPO or field protection
   */
  async invalidateProtectionCache(
    ipoId: string,
    tableName?: string,
    fieldName?: string
  ): Promise<void> {
    if (!this.redis) {
      return; // No cache to invalidate
    }

    try {
      const keys: string[] = [];

      // IPO-level cache
      keys.push(`protection:ipo_locked:${ipoId}`);

      if (tableName && fieldName) {
        // Specific field cache
        keys.push(`protection:field:${ipoId}:${tableName}:${fieldName}`);
      } else if (tableName) {
        // All fields in table (use pattern delete)
        const pattern = `protection:field:${ipoId}:${tableName}:*`;
        const matchingKeys = await this.redis.keys(pattern);
        keys.push(...matchingKeys);
      } else {
        // All fields for IPO (use pattern delete)
        const pattern = `protection:field:${ipoId}:*`;
        const matchingKeys = await this.redis.keys(pattern);
        keys.push(...matchingKeys);
      }

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error('[FieldProtection] Cache invalidation failed:', error);
      // Non-fatal - protection checks will query DB
    }
  }

  /**
   * Invalidate ALL protection cache entries for an IPO (field-level + the
   * IPO-level lock flag). Belt-and-braces helper for write paths that touch
   * multiple fields/tables in one request (e.g. bulk protection toggles) so a
   * caller cannot forget to clear a table it didn't have the field name for.
   */
  async invalidateProtectionCacheForIpo(ipoId: string): Promise<void> {
    await this.invalidateProtectionCache(ipoId);
  }

  /**
   * Store notification about blocked scraper update in Redis
   * Notifications stored in sorted set (by timestamp) for admin dashboard
   */
  private async notifyBlockedUpdate(
    notification: BlockedUpdateNotification
  ): Promise<void> {
    if (!this.redis) {
      return; // No Redis, skip notification storage
    }

    try {
      const key = 'protection:blocked_updates';
      const score = notification.timestamp.getTime();
      const value = JSON.stringify(notification);

      // Add to sorted set (score = timestamp)
      await this.redis.zadd(key, score, value);

      // Keep only last 1000 notifications (FIFO)
      await this.redis.zremrangebyrank(key, 0, -1001);

      // Set TTL on sorted set (7 days)
      await this.redis.expire(key, 7 * 24 * 3600);

      // Send notification if service available
      if (this.notificationService) {
        // Get company name for notification
        const ipoResult = await this.db
          .select({ companyName: ipos.companyName })
          .from(ipos)
          .where(eq(ipos.id, notification.ipoId))
          .limit(1);

        if (ipoResult.length > 0) {
          await this.notificationService.sendNotification('scraper_update_blocked', {
            ipoId: notification.ipoId,
            companyName: ipoResult[0].companyName,
            scraperName: notification.scraperName,
            tableName: notification.tableName,
            fieldName: notification.fieldName,
            details: `${notification.reason === 'ipo_locked' ? 'IPO is locked' : 'Field is protected'}`,
          }).catch((error) => {
            console.error('[FieldProtection] Failed to send notification:', error);
          });
        }
      }
    } catch (error) {
      console.error('[FieldProtection] Failed to store blocked update notification:', error);
      // Non-fatal - notifications are for admin convenience only
    }
  }

  /**
   * Get recent blocked update notifications (for admin dashboard)
   */
  async getBlockedUpdateNotifications(
    limit: number = 50
  ): Promise<BlockedUpdateNotification[]> {
    if (!this.redis) {
      return []; // No Redis, no notifications
    }

    try {
      // Get most recent notifications (highest scores = most recent timestamps)
      const notifications = await this.redis.zrevrange('protection:blocked_updates', 0, limit - 1);

      return notifications.map((n) => JSON.parse(n));
    } catch (error) {
      console.error('[FieldProtection] Failed to retrieve blocked notifications:', error);
      return [];
    }
  }

  /**
   * Mark a field as manually edited and auto-protect it
   */
  async markFieldAsManuallyEdited(
    ipoId: string,
    tableName: string,
    fieldName: string,
    editedBy: string,
    editNote?: string,
    autoProtect: boolean = true
  ): Promise<void> {
    // Upsert field protection record
    await this.db
      .insert(fieldProtectionMetadata)
      .values({
        ipoId,
        tableName,
        fieldName,
        isProtected: autoProtect,
        autoProtected: autoProtect,
        manuallyEditedAt: new Date(),
        manuallyEditedBy: editedBy,
        editNote,
      })
      .onConflictDoUpdate({
        target: [
          fieldProtectionMetadata.tableName,
          fieldProtectionMetadata.fieldName,
          fieldProtectionMetadata.ipoId,
        ],
        set: {
          isProtected: autoProtect,
          autoProtected: autoProtect,
          manuallyEditedAt: new Date(),
          manuallyEditedBy: editedBy,
          editNote,
          updatedAt: new Date(),
        },
      });

    // Update IPO last_manual_edit_at
    await this.db
      .update(ipos)
      .set({ lastManualEditAt: new Date() })
      .where(eq(ipos.id, ipoId));

    // Invalidate cache
    await this.invalidateProtectionCache(ipoId, tableName, fieldName);
  }
}

/**
 * Factory function to create field protection service
 * Used by scrapers and web application
 */
export function createFieldProtectionService(
  db: NodePgDatabase<typeof schema>,
  redis: Redis | null,
  notificationService?: NotificationService
): FieldProtectionService {
  return new FieldProtectionService(db, redis, notificationService);
}

/**
 * Legacy function exports for backward compatibility
 * These create a singleton service instance per call
 */
export async function isIPOLocked(
  ipoId: string,
  db: NodePgDatabase<typeof schema>,
  redis: Redis | null
): Promise<boolean> {
  const service = new FieldProtectionService(db, redis);
  return service.isIPOLocked(ipoId);
}

export async function isFieldProtected(
  ipoId: string,
  tableName: string,
  fieldName: string,
  db: NodePgDatabase<typeof schema>,
  redis: Redis | null
): Promise<FieldProtectionStatus> {
  const service = new FieldProtectionService(db, redis);
  return service.isFieldProtected(ipoId, tableName, fieldName);
}

export async function filterProtectedFields(
  ipoId: string,
  tableName: string,
  data: Record<string, any>,
  scraperName: string,
  db: NodePgDatabase<typeof schema>,
  redis: Redis | null
): Promise<FilterProtectedFieldsResult> {
  const service = new FieldProtectionService(db, redis);
  return service.filterProtectedFields(ipoId, tableName, data, scraperName);
}

export async function invalidateProtectionCacheForIpo(
  ipoId: string,
  db: NodePgDatabase<typeof schema>,
  redis: Redis | null
): Promise<void> {
  const service = new FieldProtectionService(db, redis);
  return service.invalidateProtectionCacheForIpo(ipoId);
}
