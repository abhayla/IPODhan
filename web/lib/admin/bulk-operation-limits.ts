/**
 * Bulk Operation Safety Limits
 *
 * Prevents accidental mass data corruption in Dynamic Admin.
 * Enforces limits on bulk delete/update operations and forbids
 * bulk deletion of critical financial data tables.
 *
 * Part of Flaw #3 Fix - Critical Admin Security Enhancement
 * Created: 2025-11-07
 */

export const BULK_OPERATION_LIMITS = {
  // Maximum records that can be deleted in single operation
  MAX_BULK_DELETE: 10,

  // Maximum records that can be updated in single operation
  MAX_BULK_UPDATE: 50,

  // Tables that are NEVER allowed bulk delete
  // These contain critical financial data that must be deleted individually
  BULK_DELETE_FORBIDDEN: [
    'ipos',                 // Core IPO records
    'financialData',        // Financial metrics
    'listingPerformance',   // Historical performance data
    'auditLogs',           // Audit trail (immutable)
  ],

  // Require confirmation for operations affecting > this many records
  CONFIRMATION_THRESHOLD: 5,
};

/**
 * Validation result for bulk operations
 */
export interface BulkOperationValidationResult {
  allowed: boolean;
  error?: string;
  requiresConfirmation: boolean;
}

/**
 * Validates bulk operation safety
 *
 * @param operation - Type of operation (delete or update)
 * @param tableName - Name of the table being operated on
 * @param recordCount - Number of records affected
 * @returns Validation result with allowed status and optional error message
 *
 * @example
 * ```typescript
 * const result = validateBulkOperation('delete', 'ipos', 15);
 * if (!result.allowed) {
 *   return NextResponse.json({ error: result.error }, { status: 403 });
 * }
 * ```
 */
export function validateBulkOperation(
  operation: 'delete' | 'update',
  tableName: string,
  recordCount: number
): BulkOperationValidationResult {
  // Check if table forbids bulk delete
  if (operation === 'delete' && BULK_OPERATION_LIMITS.BULK_DELETE_FORBIDDEN.includes(tableName)) {
    return {
      allowed: false,
      error: `Bulk delete is forbidden for ${tableName} table. Delete records one at a time to prevent accidental data loss.`,
      requiresConfirmation: false,
    };
  }

  // Check count limits
  const limit = operation === 'delete'
    ? BULK_OPERATION_LIMITS.MAX_BULK_DELETE
    : BULK_OPERATION_LIMITS.MAX_BULK_UPDATE;

  if (recordCount > limit) {
    return {
      allowed: false,
      error: `Bulk ${operation} limited to ${limit} records. You attempted to ${operation} ${recordCount} records. Please reduce the number of records or use a batch script.`,
      requiresConfirmation: false,
    };
  }

  // Check if confirmation required
  const requiresConfirmation = recordCount > BULK_OPERATION_LIMITS.CONFIRMATION_THRESHOLD;

  return {
    allowed: true,
    requiresConfirmation,
  };
}

/**
 * Check if a table allows bulk delete operations
 *
 * @param tableName - Name of the table to check
 * @returns True if bulk delete is allowed, false otherwise
 */
export function isBulkDeleteAllowed(tableName: string): boolean {
  return !BULK_OPERATION_LIMITS.BULK_DELETE_FORBIDDEN.includes(tableName);
}

/**
 * Get the maximum allowed records for a bulk operation
 *
 * @param operation - Type of operation
 * @returns Maximum number of records allowed
 */
export function getMaxBulkOperationLimit(operation: 'delete' | 'update'): number {
  return operation === 'delete'
    ? BULK_OPERATION_LIMITS.MAX_BULK_DELETE
    : BULK_OPERATION_LIMITS.MAX_BULK_UPDATE;
}
