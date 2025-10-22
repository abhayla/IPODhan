/**
 * Field Protection Checker
 * Core utility for checking if fields are protected from scraper updates
 *
 * Features:
 * - IPO-level lock check (master lock)
 * - Field-level protection check
 * - Caching with Redis (1h TTL)
 * - Graceful degradation if Redis unavailable
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '../db';
import { getRedisClient } from '../cache/redis-client';
import { ipos, fieldProtectionMetadata } from '@ipodhan/shared/db/schema';
import type { Redis } from 'ioredis';
import { sendNotification } from '../services/notification-service';

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
 * Check if an IPO is locked from all scraper updates
 */
export async function isIPOLocked(ipoId: string): Promise<boolean> {
  const redis = getRedisClient();
  const cacheKey = `protection:ipo_locked:${ipoId}`;

  try {
    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return cached === '1';
    }
  } catch (error) {
    console.warn('[FieldProtection] Redis unavailable, querying database');
  }

  // Query database
  const db = await getDb();
  const result = await db
    .select({ scraperLocked: ipos.scraperLocked })
    .from(ipos)
    .where(eq(ipos.id, ipoId))
    .limit(1);

  const isLocked = result[0]?.scraperLocked ?? false;

  // Cache result
  try {
    await redis.setex(cacheKey, PROTECTION_CACHE_TTL, isLocked ? '1' : '0');
  } catch (error) {
    // Silent fail - cache is optional
  }

  return isLocked;
}

/**
 * Check if a specific field is protected from scraper updates
 */
export async function isFieldProtected(
  ipoId: string,
  tableName: string,
  fieldName: string
): Promise<FieldProtectionStatus> {
  const redis = getRedisClient();
  const cacheKey = `protection:field:${ipoId}:${tableName}:${fieldName}`;

  // Check IPO-level lock first (master lock overrides everything)
  const ipoLocked = await isIPOLocked(ipoId);
  if (ipoLocked) {
    return {
      isProtected: true,
      reason: 'ipo_locked',
      ipoLocked: true,
      fieldProtected: false,
      autoProtected: false,
    };
  }

  try {
    // Try cache
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.warn('[FieldProtection] Redis unavailable, querying database');
  }

  // Query database
  const db = await getDb();
  const result = await db
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

  // Cache result
  try {
    await redis.setex(cacheKey, PROTECTION_CACHE_TTL, JSON.stringify(status));
  } catch (error) {
    // Silent fail
  }

  return status;
}

/**
 * Filter out protected fields from scraper data
 * Returns only fields that are allowed to be updated
 */
export async function filterProtectedFields(
  ipoId: string,
  tableName: string,
  data: Record<string, any>,
  scraperName: string
): Promise<FilterProtectedFieldsResult> {
  // Check IPO-level lock first
  const ipoLocked = await isIPOLocked(ipoId);
  if (ipoLocked) {
    // Store notification about blocked update
    await notifyBlockedUpdate({
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
    const status = await isFieldProtected(ipoId, tableName, fieldName);

    if (status.isProtected) {
      skipped[fieldName] = value;

      // Notify about blocked field
      await notifyBlockedUpdate({
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
export async function invalidateProtectionCache(
  ipoId: string,
  tableName?: string,
  fieldName?: string
): Promise<void> {
  const redis = getRedisClient();

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
      const matchingKeys = await redis.keys(pattern);
      keys.push(...matchingKeys);
    } else {
      // All fields for IPO (use pattern delete)
      const pattern = `protection:field:${ipoId}:*`;
      const matchingKeys = await redis.keys(pattern);
      keys.push(...matchingKeys);
    }

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error('[FieldProtection] Cache invalidation failed:', error);
    // Non-fatal - protection checks will query DB
  }
}

/**
 * Store notification about blocked scraper update in Redis
 * Notifications stored in sorted set (by timestamp) for admin dashboard
 */
async function notifyBlockedUpdate(
  notification: BlockedUpdateNotification
): Promise<void> {
  const redis = getRedisClient();

  try {
    const key = 'protection:blocked_updates';
    const score = notification.timestamp.getTime();
    const value = JSON.stringify(notification);

    // Add to sorted set (score = timestamp)
    await redis.zadd(key, score, value);

    // Keep only last 1000 notifications (FIFO)
    await redis.zremrangebyrank(key, 0, -1001);

    // Set TTL on sorted set (7 days)
    await redis.expire(key, 7 * 24 * 3600);

    // Send notification to admin (email/Telegram)
    const db = await getDb();
    const ipoResult = await db
      .select({ companyName: ipos.companyName })
      .from(ipos)
      .where(eq(ipos.id, notification.ipoId))
      .limit(1);

    if (ipoResult.length > 0) {
      sendNotification('scraper_update_blocked', {
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
  } catch (error) {
    console.error('[FieldProtection] Failed to store blocked update notification:', error);
    // Non-fatal - notifications are for admin convenience only
  }
}

/**
 * Get recent blocked update notifications (for admin dashboard)
 */
export async function getBlockedUpdateNotifications(
  limit: number = 50
): Promise<BlockedUpdateNotification[]> {
  const redis = getRedisClient();

  try {
    // Get most recent notifications (highest scores = most recent timestamps)
    const notifications = await redis.zrevrange('protection:blocked_updates', 0, limit - 1);

    return notifications.map((n) => JSON.parse(n));
  } catch (error) {
    console.error('[FieldProtection] Failed to retrieve blocked notifications:', error);
    return [];
  }
}

/**
 * Mark a field as manually edited and auto-protect it
 */
export async function markFieldAsManuallyEdited(
  ipoId: string,
  tableName: string,
  fieldName: string,
  editedBy: string,
  editNote?: string,
  autoProtect: boolean = true
): Promise<void> {
  const db = await getDb();

  // Upsert field protection record
  await db
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
  await db
    .update(ipos)
    .set({ lastManualEditAt: new Date() })
    .where(eq(ipos.id, ipoId));

  // Invalidate cache
  await invalidateProtectionCache(ipoId, tableName, fieldName);
}
