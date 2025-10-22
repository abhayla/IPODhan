/**
 * Audit Helpers for Admin Routes
 *
 * Simplified helpers to add audit logging to admin API routes
 */

import { NextRequest } from 'next/server';
import { logAudit, AuditActionTypes, getClientIP, getUserAgent } from '@/lib/services/audit-log-service';

/**
 * Log successful admin action
 */
export function logAdminAction(
  request: NextRequest,
  adminName: string,
  actionType: string,
  data: {
    ipoId?: string;
    tableName?: string;
    fieldName?: string;
    oldValue?: any;
    newValue?: any;
    details?: Record<string, any>;
  } = {}
) {
  logAudit({
    adminUser: adminName,
    actionType,
    ipoId: data.ipoId,
    tableName: data.tableName,
    fieldName: data.fieldName,
    oldValue: data.oldValue,
    newValue: data.newValue,
    details: data.details,
    ipAddress: getClientIP(request),
    userAgent: getUserAgent(request),
    success: true,
  });
}

/**
 * Log failed admin action
 */
export function logAdminError(
  request: NextRequest,
  adminName: string,
  actionType: string,
  error: Error | string,
  data: {
    ipoId?: string;
    tableName?: string;
    fieldName?: string;
    oldValue?: any;
    newValue?: any;
  } = {}
) {
  logAudit({
    adminUser: adminName,
    actionType,
    ipoId: data.ipoId,
    tableName: data.tableName,
    fieldName: data.fieldName,
    oldValue: data.oldValue,
    newValue: data.newValue,
    ipAddress: getClientIP(request),
    userAgent: getUserAgent(request),
    success: false,
    errorMessage: error instanceof Error ? error.message : error,
  });
}

// Export action types for convenience
export { AuditActionTypes };
