/**
 * One attributed audit_logs row per admin write that is NOT an IPO field write (spec §9.2 item 6;
 * OD-104, OD-113; Tier A round 2 M2). IPO field values go through the ONE admin field write, which
 * records its own history; every other admin write (a dynamic-table row, an anchor investor, a bulk
 * conflict auto-resolve) records the admin's name AND account id here, taken from withAdminAuth's
 * context, never from a request header.
 */
import type { NextRequest } from 'next/server';
import type { AdminAuthContext } from '@/lib/middleware/admin-auth';
import { logAudit, type AuditLogEntry } from '@/lib/services/audit-log-service';

export interface AdminWriteAuditArgs {
  actionType: string;
  /** What the admin did, e.g. 'ROW_CREATED', 'ROW_DELETED', 'CONFLICTS_AUTO_RESOLVED'. */
  action: string;
  entryPoint: string;
  ipoId?: string;
  tableName?: string;
  fieldName?: string;
  oldValue?: unknown;
  newValue?: unknown;
  details?: Record<string, unknown>;
  success?: boolean;
}

export function adminWriteAuditEntry(
  adminContext: Pick<AdminAuthContext, 'adminId' | 'adminName'>,
  request: Pick<NextRequest, 'headers'>,
  args: AdminWriteAuditArgs
): AuditLogEntry {
  return {
    adminUser: adminContext.adminName,
    actionType: args.actionType,
    ipoId: args.ipoId,
    tableName: args.tableName,
    fieldName: args.fieldName,
    oldValue: args.oldValue,
    newValue: args.newValue,
    details: { ...args.details, action: args.action, adminId: adminContext.adminId, entryPoint: args.entryPoint },
    ipAddress: request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? undefined,
    userAgent: request.headers.get('user-agent') ?? undefined,
    success: args.success ?? true,
  };
}

export async function auditAdminWrite(
  adminContext: Pick<AdminAuthContext, 'adminId' | 'adminName'>,
  request: Pick<NextRequest, 'headers'>,
  args: AdminWriteAuditArgs
): Promise<void> {
  await logAudit(adminWriteAuditEntry(adminContext, request, args));
}
