/**
 * Dynamic Admin API - Create and List Records
 *
 * Handles POST (create) and GET (list) operations for any table.
 * Part of the self-extending admin system.
 *
 * Routes:
 * - POST /api/admin/dynamic/[table] - Create new record
 * - GET /api/admin/dynamic/[table]/list - List all records with pagination
 *
 * Part of Week 2 Admin Enhancement (Phase 6)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAdminAuth, type AdminAuthContext } from '@/lib/middleware/admin-auth';
import * as schema from '@ipodhan/shared/db/schema';
import { desc, asc, like, and, or, sql, eq, getTableColumns } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { validateRecord } from '@/lib/admin/dynamic-validation-rules';
import { logger } from '@/lib/logger';
import { auditAdminWrite } from '@/lib/admin/admin-write-audit';
import { AuditActionTypes } from '@/lib/services/audit-log-service';
import { resolveDynamicTable } from '@/lib/admin/dynamic-table-allow-list';
import { holdsIpoFieldValues, IPO_FIELD_TABLE_REFUSAL } from '@/lib/admin/ipo-field-tables';

/**
 * Get the table object from schema by name
 */
function getTableFromSchema(tableName: string, mode: 'read' | 'write'): PgTable | null {
  // Explicit allow-list (C1): never `schema[tableName]`; admin/auth tables resolve to null -> 404.
  return resolveDynamicTable(tableName, mode);
}

/**
 * POST - Create new record
 */
export const POST = withAdminAuth(async (request: NextRequest, adminContext: AdminAuthContext, { params }: { params: Promise<{ table: string }> }) => {
  try {

    const { table: tableName } = await params;
    const table = getTableFromSchema(tableName, 'write');

    if (!table) {
      return NextResponse.json(
        { success: false, error: `Table "${tableName}" not found` },
        { status: 404 }
      );
    }

    // §9.2 items 3, 11 (F-170): IPO field values are never written by a direct row write.
    if (holdsIpoFieldValues(table)) {
      return NextResponse.json({ success: false, error: 'USE_FIELD_EDITOR', reason: IPO_FIELD_TABLE_REFUSAL }, { status: 400 });
    }

    // Parse request body
    const data = await request.json();

    // Convert snake_case keys to camelCase (Drizzle expects JS property names, not DB column names)
    const camelCaseData: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      // Convert snake_case to camelCase: company_name → companyName
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      camelCaseData[camelKey] = value;
    }

    // Remove system fields that shouldn't be set manually
    delete camelCaseData.id;
    delete camelCaseData.createdAt;
    delete camelCaseData.updatedAt;

    // Set dataSource to MANUAL for new records created by admin
    const columns = getTableColumns(table);
    if (columns.dataSource) {
      camelCaseData.dataSource = 'MANUAL';
      console.log(`[Dynamic Admin] Setting dataSource to MANUAL for new record`);
    }

    // Validate data using business rules
    const validationResult = validateRecord(tableName, camelCaseData);

    if (!validationResult.valid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          validationErrors: validationResult.errors,
          validationWarnings: validationResult.warnings,
        },
        { status: 400 }
      );
    }

    // Log warnings (non-blocking) if present
    if (validationResult.warnings && Object.keys(validationResult.warnings).length > 0) {
      console.warn('[Dynamic Admin] Validation warnings:', validationResult.warnings);
    }

    // Insert record
    const result = await db.insert(table).values(camelCaseData).returning();

    if (!result || result.length === 0) {
      throw new Error('Failed to create record');
    }

    // OD-104/OD-113: the creating admin is recorded (name + account id).
    const created = result[0] as Record<string, unknown>;
    await auditAdminWrite(adminContext, request, {
      actionType: AuditActionTypes.FIELD_UPDATED,
      action: 'ROW_CREATED',
      entryPoint: 'api/admin/dynamic/[table] POST',
      tableName,
      fieldName: '*',
      newValue: created.id !== undefined ? String(created.id) : undefined,
    });
    console.log(`[Dynamic Admin] Created record in ${tableName}:`, created.id);

    return NextResponse.json({
      success: true,
      data: result[0],
      message: `Record created successfully in ${tableName}`
    });
  } catch (error) {
    // Real error detail (can include SQL/constraint text from a raw dynamic-table
    // write) logged server-side only - never in the public response body (T-330 P2-5).
    logger.error(
      { route: '/api/admin/dynamic/[table]', error: error instanceof Error ? error.message : String(error) },
      '[Dynamic Admin] Create error'
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create record'
      },
      { status: 500 }
    );
  }
});

/**
 * DELETE - DISABLED for bulk operations
 *
 * Bulk delete is not supported to prevent accidental mass data deletion.
 * Use /api/admin/dynamic/[table]/[id] for single record deletion.
 *
 * This endpoint exists to explicitly reject bulk delete attempts and
 * provide clear error messaging to admins.
 */
export const DELETE = withAdminAuth(async (request: NextRequest, _adminContext: AdminAuthContext) => {


  return NextResponse.json(
    {
      success: false,
      error: 'Bulk delete is not supported',
      message: 'Delete records individually via /api/admin/dynamic/[table]/[id] to prevent accidental data loss.',
      hint: 'For mass deletions, use a dedicated batch script with proper safeguards.',
    },
    { status: 405 } // Method Not Allowed
  );
});
