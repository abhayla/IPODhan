/**
 * Audit Log Repository
 *
 * Provides functions for logging admin actions to the audit_logs table.
 * Supports both individual actions and bulk operations.
 *
 * Part of Flaw #3 Fix - Critical Admin Security Enhancement
 * Created: 2025-11-07
 */

import { db } from '@/lib/db';
import { auditLogs } from '@ipodhan/shared/db/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * Parameters for logging a bulk operation
 */
export interface LogBulkOperationParams {
  adminUser: string;
  actionType: 'BULK_DELETE' | 'BULK_UPDATE';
  tableName: string;
  recordCount: number;
  affectedIds: string[];
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
  details?: Record<string, any>;
}

/**
 * Parameters for logging a single admin action
 */
export interface LogAdminActionParams {
  adminUser: string;
  actionType: string;
  tableName?: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  ipoId?: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
  details?: Record<string, any>;
}

/**
 * Log a bulk operation to the audit trail
 *
 * @param params - Bulk operation parameters
 * @returns Created audit log record
 *
 * @example
 * ```typescript
 * await logBulkOperation({
 *   adminUser: 'admin@example.com',
 *   actionType: 'BULK_DELETE',
 *   tableName: 'gmpRecords',
 *   recordCount: 10,
 *   affectedIds: ['id1', 'id2', ...],
 *   success: true,
 * });
 * ```
 */
export async function logBulkOperation(params: LogBulkOperationParams) {
  try {
    const result = await db
      .insert(auditLogs)
      .values({
        timestamp: new Date(),
        adminUser: params.adminUser,
        actionType: params.actionType,
        tableName: params.tableName,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        details: {
          recordCount: params.recordCount,
          affectedIds: params.affectedIds,
          success: params.success,
          errorMessage: params.errorMessage,
          ...params.details,
        },
      })
      .returning();

    console.log(`[Audit Log] Logged bulk operation: ${params.actionType} on ${params.tableName} (${params.recordCount} records)`);

    return result[0];
  } catch (error) {
    console.error('[Audit Log] Failed to log bulk operation:', error);
    // Don't throw - audit logging failure shouldn't break the operation
    return null;
  }
}

/**
 * Log a single admin action to the audit trail
 *
 * @param params - Admin action parameters
 * @returns Created audit log record
 *
 * @example
 * ```typescript
 * await logAdminAction({
 *   adminUser: 'admin@example.com',
 *   actionType: 'FIELD_UPDATE',
 *   tableName: 'ipos',
 *   fieldName: 'listingPrice',
 *   oldValue: '100',
 *   newValue: '120',
 *   ipoId: 'ipo-id',
 *   success: true,
 * });
 * ```
 */
export async function logAdminAction(params: LogAdminActionParams) {
  try {
    const result = await db
      .insert(auditLogs)
      .values({
        timestamp: new Date(),
        adminUser: params.adminUser,
        actionType: params.actionType,
        tableName: params.tableName,
        fieldName: params.fieldName,
        oldValue: params.oldValue,
        newValue: params.newValue,
        ipoId: params.ipoId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        details: params.details ? {
          success: params.success,
          errorMessage: params.errorMessage,
          ...params.details,
        } : null,
      })
      .returning();

    console.log(`[Audit Log] Logged admin action: ${params.actionType} by ${params.adminUser}`);

    return result[0];
  } catch (error) {
    console.error('[Audit Log] Failed to log admin action:', error);
    // Don't throw - audit logging failure shouldn't break the operation
    return null;
  }
}

/**
 * Log a validation failure to the audit trail
 *
 * Useful for tracking attempted invalid data submissions
 *
 * @param params - Validation failure parameters
 */
export async function logValidationFailure(params: {
  adminUser: string;
  tableName: string;
  validationErrors: Record<string, string>;
  attemptedData: Record<string, any>;
  ipAddress?: string;
}) {
  return logAdminAction({
    adminUser: params.adminUser,
    actionType: 'VALIDATION_FAILURE',
    tableName: params.tableName,
    success: false,
    ipAddress: params.ipAddress,
    details: {
      validationErrors: params.validationErrors,
      attemptedData: params.attemptedData,
    },
  });
}

/**
 * Get recent audit logs for a specific admin user
 *
 * @param adminUser - Admin user email/identifier
 * @param limit - Number of logs to retrieve (default: 50)
 * @returns Recent audit log entries
 */
export async function getRecentAuditLogs(adminUser: string, limit: number = 50) {
  try {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.adminUser, adminUser))
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit);

    return logs;
  } catch (error) {
    console.error('[Audit Log] Failed to retrieve audit logs:', error);
    return [];
  }
}

/**
 * Get audit logs for a specific IPO
 *
 * @param ipoId - IPO ID
 * @param limit - Number of logs to retrieve (default: 100)
 * @returns Audit log entries for the IPO
 */
export async function getIPOAuditLogs(ipoId: string, limit: number = 100) {
  try {
    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.ipoId, ipoId))
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit);

    return logs;
  } catch (error) {
    console.error('[Audit Log] Failed to retrieve IPO audit logs:', error);
    return [];
  }
}
