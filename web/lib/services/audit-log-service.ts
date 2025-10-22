/**
 * Audit Log Service
 *
 * Provides audit logging functionality for admin actions.
 * Follows industry standards for immutable audit trails.
 *
 * Features:
 * - Async logging (non-blocking)
 * - Immutable records (no UPDATE/DELETE operations)
 * - PII anonymization (IP addresses after 90 days)
 * - Failed operation logging
 * - Comprehensive filtering and export
 */

import { getDb } from '@/lib/db';
import { auditLogs } from '@ipodhan/shared/db/schema';
import { desc, and, eq, gte, lte, sql, or } from 'drizzle-orm';
import { NextRequest } from 'next/server';

// ==================== TYPES ====================

export interface AuditLogEntry {
  adminUser: string;
  actionType: string;
  ipoId?: string;
  tableName?: string;
  fieldName?: string;
  oldValue?: any;
  newValue?: any;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success?: boolean;
  errorMessage?: string;
}

export interface AuditLogFilters {
  startDate?: Date;
  endDate?: Date;
  adminUser?: string;
  actionType?: string;
  ipoId?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedAuditLogs {
  logs: any[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ==================== CORE FUNCTIONS ====================

/**
 * Log an audit entry (async, non-blocking)
 *
 * @param entry - Audit log entry data
 * @returns Promise<void> - Fires and forgets (errors logged but not thrown)
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  // Fire and forget - don't block API responses
  setImmediate(async () => {
    try {
      const db = await getDb();

      await db.insert(auditLogs).values({
        adminUser: entry.adminUser,
        actionType: entry.actionType,
        ipoId: entry.ipoId || null,
        tableName: entry.tableName || null,
        fieldName: entry.fieldName || null,
        oldValue: entry.oldValue !== undefined ? String(entry.oldValue) : null,
        newValue: entry.newValue !== undefined ? String(entry.newValue) : null,
        details: entry.details || null,
        ipAddress: entry.ipAddress || null,
        userAgent: entry.userAgent || null,
        success: entry.success ?? true,
        errorMessage: entry.errorMessage || null,
      });

      console.log(
        `[Audit] ${entry.actionType} by ${entry.adminUser}${entry.success === false ? ' (FAILED)' : ''}`
      );
    } catch (error) {
      // Log error but don't throw (audit logging should never break app functionality)
      console.error('[Audit] Failed to log audit entry:', error);
    }
  });
}

/**
 * Get audit logs with filtering and pagination
 *
 * @param filters - Filter criteria
 * @returns Paginated audit logs with IPO company names
 */
export async function getAuditLogs(
  filters: AuditLogFilters = {}
): Promise<PaginatedAuditLogs> {
  const db = await getDb();
  const {
    startDate,
    endDate,
    adminUser,
    actionType,
    ipoId,
    page = 1,
    limit = 50,
  } = filters;

  // Build WHERE conditions
  const conditions = [];

  if (startDate) {
    conditions.push(gte(auditLogs.timestamp, startDate));
  }

  if (endDate) {
    conditions.push(lte(auditLogs.timestamp, endDate));
  }

  if (adminUser) {
    conditions.push(eq(auditLogs.adminUser, adminUser));
  }

  if (actionType) {
    conditions.push(eq(auditLogs.actionType, actionType));
  }

  if (ipoId) {
    conditions.push(eq(auditLogs.ipoId, ipoId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(whereClause);

  const total = countResult[0]?.count || 0;

  // Get paginated results with IPO company name
  const offset = (page - 1) * limit;

  const logs = await db
    .select({
      id: auditLogs.id,
      timestamp: auditLogs.timestamp,
      adminUser: auditLogs.adminUser,
      actionType: auditLogs.actionType,
      ipoId: auditLogs.ipoId,
      tableName: auditLogs.tableName,
      fieldName: auditLogs.fieldName,
      oldValue: auditLogs.oldValue,
      newValue: auditLogs.newValue,
      details: auditLogs.details,
      ipAddress: auditLogs.ipAddress,
      userAgent: auditLogs.userAgent,
      success: auditLogs.success,
      errorMessage: auditLogs.errorMessage,
      createdAt: auditLogs.createdAt,
      // Join with IPOs to get company name
      companyName: sql<string | null>`
        (SELECT company_name FROM ipos WHERE ipos.id = ${auditLogs.ipoId})
      `,
      companySlug: sql<string | null>`
        (SELECT slug FROM ipos WHERE ipos.id = ${auditLogs.ipoId})
      `,
    })
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.timestamp))
    .limit(limit)
    .offset(offset);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

/**
 * Export audit logs as CSV
 *
 * @param filters - Filter criteria
 * @returns CSV string
 */
export async function exportAuditLogsCSV(
  filters: AuditLogFilters = {}
): Promise<string> {
  const db = await getDb();
  const { startDate, endDate, adminUser, actionType, ipoId } = filters;

  // Build WHERE conditions (same as getAuditLogs)
  const conditions = [];

  if (startDate) {
    conditions.push(gte(auditLogs.timestamp, startDate));
  }

  if (endDate) {
    conditions.push(lte(auditLogs.timestamp, endDate));
  }

  if (adminUser) {
    conditions.push(eq(auditLogs.adminUser, adminUser));
  }

  if (actionType) {
    conditions.push(eq(auditLogs.actionType, actionType));
  }

  if (ipoId) {
    conditions.push(eq(auditLogs.ipoId, ipoId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get all matching logs (no pagination for export)
  const logs = await db
    .select({
      id: auditLogs.id,
      timestamp: auditLogs.timestamp,
      adminUser: auditLogs.adminUser,
      actionType: auditLogs.actionType,
      companyName: sql<string | null>`
        (SELECT company_name FROM ipos WHERE ipos.id = ${auditLogs.ipoId})
      `,
      tableName: auditLogs.tableName,
      fieldName: auditLogs.fieldName,
      oldValue: auditLogs.oldValue,
      newValue: auditLogs.newValue,
      ipAddress: auditLogs.ipAddress,
      success: auditLogs.success,
      errorMessage: auditLogs.errorMessage,
    })
    .from(auditLogs)
    .where(whereClause)
    .orderBy(desc(auditLogs.timestamp));

  // Build CSV
  const headers = [
    'ID',
    'Timestamp',
    'Admin User',
    'Action Type',
    'IPO Company',
    'Table',
    'Field',
    'Old Value',
    'New Value',
    'IP Address',
    'Success',
    'Error Message',
  ];

  const rows = logs.map((log) => [
    log.id,
    log.timestamp?.toISOString() || '',
    escapeCSV(log.adminUser),
    escapeCSV(log.actionType),
    escapeCSV(log.companyName || 'N/A'),
    escapeCSV(log.tableName || ''),
    escapeCSV(log.fieldName || ''),
    escapeCSV(log.oldValue || ''),
    escapeCSV(log.newValue || ''),
    log.ipAddress || '',
    log.success ? 'Yes' : 'No',
    escapeCSV(log.errorMessage || ''),
  ]);

  const csv = [
    headers.join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\n');

  return csv;
}

/**
 * Get unique admin users (for filter dropdown)
 */
export async function getAdminUsers(): Promise<string[]> {
  const db = await getDb();

  const result = await db
    .selectDistinct({ adminUser: auditLogs.adminUser })
    .from(auditLogs)
    .orderBy(auditLogs.adminUser);

  return result.map((row) => row.adminUser);
}

/**
 * Get unique action types (for filter dropdown)
 */
export async function getActionTypes(): Promise<string[]> {
  const db = await getDb();

  const result = await db
    .selectDistinct({ actionType: auditLogs.actionType })
    .from(auditLogs)
    .orderBy(auditLogs.actionType);

  return result.map((row) => row.actionType);
}

/**
 * Anonymize old IP addresses (PII compliance - run daily via cron)
 * Anonymizes IP addresses older than 90 days
 */
export async function anonymizeOldIPAddresses(): Promise<number> {
  const db = await getDb();
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const result = await db
    .update(auditLogs)
    .set({ ipAddress: 'ANONYMIZED' })
    .where(
      and(
        lte(auditLogs.timestamp, ninetyDaysAgo),
        sql`${auditLogs.ipAddress} IS NOT NULL`,
        sql`${auditLogs.ipAddress} != 'ANONYMIZED'`
      )
    );

  return result.rowCount || 0;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Escape CSV values to prevent injection and handle special characters
 */
function escapeCSV(value: string | null | undefined): string {
  if (!value) return '';

  const stringValue = String(value);

  // Escape double quotes by doubling them
  const escaped = stringValue.replace(/"/g, '""');

  // Wrap in quotes if contains comma, newline, or quote
  if (
    escaped.includes(',') ||
    escaped.includes('\n') ||
    escaped.includes('"')
  ) {
    return `"${escaped}"`;
  }

  return escaped;
}

/**
 * Extract client IP from request (handles proxies)
 */
export function getClientIP(request: NextRequest): string | undefined {
  // Try X-Forwarded-For first (for proxies/load balancers)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  // Try X-Real-IP
  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  // Fallback to direct connection (may not be available in Next.js)
  return undefined;
}

/**
 * Extract user agent from request
 */
export function getUserAgent(request: NextRequest): string | undefined {
  return request.headers.get('user-agent') || undefined;
}

// ==================== AUDIT ACTION TYPES ====================

export const AuditActionTypes = {
  FIELD_UPDATED: 'Field Updated',
  IPO_LOCKED: 'IPO Locked',
  IPO_UNLOCKED: 'IPO Unlocked',
  PROTECTION_ENABLED: 'Protection Enabled',
  PROTECTION_DISABLED: 'Protection Disabled',
  BULK_PROTECTION: 'Bulk Protection',
  CACHE_CLEARED: 'Cache Cleared',
  GMP_ADDED: 'GMP Added',
  GMP_UPDATED: 'GMP Updated',
  SUBSCRIPTION_UPDATED: 'Subscription Updated',
  LOGIN: 'Admin Login',
  LOGOUT: 'Admin Logout',
  SETTINGS_CHANGED: 'Settings Changed',
  NOTIFICATION_SENT: 'Notification Sent',
} as const;

export type AuditActionType = typeof AuditActionTypes[keyof typeof AuditActionTypes];
