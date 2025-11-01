/**
 * Field Protection Checker - Web Application Wrapper
 *
 * This file provides backward compatibility for the web application
 * by wrapping the shared field protection service with web-specific dependencies.
 */

import { getDb } from '../db';
import { getRedisClient } from '../cache/redis-client';
import { sendNotification } from '../services/notification-service';
import {
  createFieldProtectionService,
  type FieldProtectionStatus,
  type FilterProtectedFieldsResult,
  type BlockedUpdateNotification,
  type NotificationService,
  FieldProtectionService
} from '@ipodhan/shared/admin/field-protection-checker';

// Re-export types for backward compatibility
export type { FieldProtectionStatus, FilterProtectedFieldsResult, BlockedUpdateNotification };

// Create notification service adapter for web
class WebNotificationService implements NotificationService {
  async sendNotification(type: string, data: any): Promise<void> {
    return sendNotification(type as any, data);
  }
}

// Singleton service instance for web
let serviceInstance: FieldProtectionService | null = null;

/**
 * Get or create the field protection service instance
 */
async function getService(): Promise<FieldProtectionService> {
  if (!serviceInstance) {
    const db = await getDb();
    const redis = getRedisClient();
    const notificationService = new WebNotificationService();
    serviceInstance = createFieldProtectionService(db, redis, notificationService);
  }
  return serviceInstance;
}

/**
 * Check if an IPO is locked from all scraper updates
 */
export async function isIPOLocked(ipoId: string): Promise<boolean> {
  const service = await getService();
  return service.isIPOLocked(ipoId);
}

/**
 * Check if a specific field is protected from scraper updates
 */
export async function isFieldProtected(
  ipoId: string,
  tableName: string,
  fieldName: string
): Promise<FieldProtectionStatus> {
  const service = await getService();
  return service.isFieldProtected(ipoId, tableName, fieldName);
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
  const service = await getService();
  return service.filterProtectedFields(ipoId, tableName, data, scraperName);
}

/**
 * Invalidate cache for IPO or field protection
 */
export async function invalidateProtectionCache(
  ipoId: string,
  tableName?: string,
  fieldName?: string
): Promise<void> {
  const service = await getService();
  return service.invalidateProtectionCache(ipoId, tableName, fieldName);
}

/**
 * Get recent blocked update notifications (for admin dashboard)
 */
export async function getBlockedUpdateNotifications(
  limit: number = 50
): Promise<BlockedUpdateNotification[]> {
  const service = await getService();
  return service.getBlockedUpdateNotifications(limit);
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
  const service = await getService();
  return service.markFieldAsManuallyEdited(
    ipoId,
    tableName,
    fieldName,
    editedBy,
    editNote,
    autoProtect
  );
}
