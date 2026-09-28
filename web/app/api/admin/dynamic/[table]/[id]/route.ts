/**
 * Dynamic Admin API - Single Record Operations
 *
 * Handles GET, PATCH, and DELETE operations for individual records.
 *
 * Routes:
 * - GET /api/admin/dynamic/[table]/[id] - Get single record
 * - PATCH /api/admin/dynamic/[table]/[id] - Update record
 * - DELETE /api/admin/dynamic/[table]/[id] - Delete record
 *
 * Part of Week 2 Admin Enhancement (Phase 6)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import * as schema from '@ipodhan/shared/db/schema';
import { eq, getTableColumns } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { validateRecord } from '@/lib/admin/dynamic-validation-rules';
import { logger } from '@/lib/logger';
import { resolveDynamicTable } from '@/lib/admin/dynamic-table-allow-list';
import { getAdminIdentity } from '@/lib/middleware/admin-auth';
import { readAdminFieldVersion } from '@ipodhan/shared/services/admin-field-write';
import { saveAdminFieldValues, adminFieldsSaveResponse } from '@/lib/admin/admin-field-save';
import {
  holdsIpoFieldValues,
  isAdminWritableTable,
  sqlTableName,
  IPO_FIELD_TABLE_REFUSAL,
  SAVE_META_KEYS,
} from '@/lib/admin/ipo-field-tables';

/**
 * Get the table object from schema by name
 */
function getTableFromSchema(tableName: string, mode: 'read' | 'write'): PgTable | null {
  // Explicit allow-list (C1): never `schema[tableName]`; admin/auth tables resolve to null -> 404.
  return resolveDynamicTable(tableName, mode);
}

/**
 * Get primary key column name for a table
 * Uses Drizzle ORM's getTableColumns API for reliable access
 */
function getPrimaryKeyColumn(table: PgTable): string {
  try {
    // Use Drizzle's official API to get columns
    const columns = getTableColumns(table);

    // Find the primary key column
    for (const [columnName, column] of Object.entries(columns)) {
      const columnAny = column as any;
      const config = columnAny.config || columnAny._ || {};

      if (config.primaryKey === true || config.isPrimaryKey === true) {
        return columnName;
      }
    }

    // Default to 'id' if no primary key found
    return 'id';
  } catch (error) {
    console.error('[Dynamic Admin] Error getting primary key:', error);
    return 'id'; // Fallback to default
  }
}

/**
 * GET - Retrieve single record
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ table: string; id: string }> }
) {
  try {
    // Verify admin token
    const authError = await requireAdminAuth();
    if (authError) return authError;

    const { table: tableName, id } = await params;
    const table = getTableFromSchema(tableName, 'read');

    if (!table) {
      return NextResponse.json(
        { success: false, error: `Table "${tableName}" not found` },
        { status: 404 }
      );
    }

    // Get primary key column
    const primaryKey = getPrimaryKeyColumn(table);
    const primaryKeyColumn = (table as any)[primaryKey];

    if (!primaryKeyColumn) {
      return NextResponse.json(
        { success: false, error: `Primary key column "${primaryKey}" not found` },
        { status: 500 }
      );
    }

    // Query for the record
    const result = await db
      .select()
      .from(table)
      .where(eq(primaryKeyColumn, id))
      .limit(1);

    if (!result || result.length === 0) {
      return NextResponse.json(
        { success: false, error: `Record not found` },
        { status: 404 }
      );
    }

    // Convert camelCase keys to snake_case for form compatibility
    // (Form expects snake_case field names from schema introspector)
    const record = result[0];
    const snakeCaseRecord: Record<string, any> = {};
    for (const [key, value] of Object.entries(record)) {
      // Convert camelCase to snake_case: companyName → company_name
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      snakeCaseRecord[snakeKey] = value;
    }

    // §9.2 item 20: the editor saves each field with the token it loaded here.
    let versions: Record<string, string> | undefined;
    if (isAdminWritableTable(table)) {
      const sqlName = sqlTableName(table);
      const ipoId = String(sqlName === 'ipos' ? (record as any).id : (record as any).ipoId);
      versions = {};
      for (const field of Object.keys(getTableColumns(table))) {
        const v = await readAdminFieldVersion(db as never, ipoId, sqlName, field);
        if (v) versions[field] = v.version;
      }
    }

    return NextResponse.json({
      success: true,
      data: snakeCaseRecord,
      versions,
      message: 'Record retrieved successfully'
    });
  } catch (error) {
    logger.error(
      { route: '/api/admin/dynamic/[table]/[id]', error: error instanceof Error ? error.message : String(error) },
      '[Dynamic Admin] Get error'
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve record'
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update record
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ table: string; id: string }> }
) {
  try {
    // Verify admin token
    const authError = await requireAdminAuth();
    if (authError) return authError;

    const { table: tableName, id } = await params;
    const table = getTableFromSchema(tableName, 'write');

    if (!table) {
      return NextResponse.json(
        { success: false, error: `Table "${tableName}" not found` },
        { status: 404 }
      );
    }

    // §9.2 items 3, 11, 20 (F-170): a one-row-per-IPO table saves each CHANGED field through the ONE
    // admin write with the token the editor loaded (GET returns them as `versions`); any other
    // table holding IPO data is refused. Only non-IPO reference tables take the direct path below.
    if (isAdminWritableTable(table)) {
      const body = (await request.json()) as Record<string, unknown>;
      const camel: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) camel[key.replace(/_([a-z])/g, (_, l) => l.toUpperCase())] = value;
      const meta = { versions: camel.versions, sourceNote: camel.sourceNote, overrideReason: camel.overrideReason };
      for (const k of [...SAVE_META_KEYS, 'id', 'ipoId', 'createdAt', 'updatedAt', 'dataSource']) delete camel[k];
      const sqlName = sqlTableName(table);
      const pk = (table as any)[getPrimaryKeyColumn(table)];
      const [row] = (await db.select().from(table).where(eq(pk, id)).limit(1)) as Array<Record<string, unknown>>;
      if (!row) return NextResponse.json({ success: false, error: 'Record not found' }, { status: 404 });
      const ipoId = sqlName === 'ipos' ? String(row.id) : String(row.ipoId);
      const outcome = await saveAdminFieldValues({
        ipoId,
        tableName: sqlName,
        values: camel,
        versions: meta.versions as Record<string, string | undefined> | undefined,
        sourceNote: typeof meta.sourceNote === 'string' ? meta.sourceNote : undefined,
        overrideReason: typeof meta.overrideReason === 'string' ? meta.overrideReason : undefined,
        actor: { name: getAdminIdentity(request), adminId: null },
        entryPoint: 'api/admin/dynamic/[table]/[id]',
        ipAddress: request.headers.get('x-forwarded-for'),
        userAgent: request.headers.get('user-agent'),
      });
      return adminFieldsSaveResponse(outcome);
    }
    if (holdsIpoFieldValues(table)) {
      return NextResponse.json({ success: false, error: 'USE_FIELD_EDITOR', reason: IPO_FIELD_TABLE_REFUSAL }, { status: 400 });
    }

    // Parse request body
    const updates = await request.json();

    // Convert snake_case keys to camelCase (Drizzle expects JS property names, not DB column names)
    const camelCaseUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      // Convert snake_case to camelCase: company_name → companyName
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      camelCaseUpdates[camelKey] = value;
    }

    // Remove system fields that shouldn't be updated manually
    delete camelCaseUpdates.id;
    delete camelCaseUpdates.createdAt;

    // Add updatedAt if the table has it
    const columns = getTableColumns(table);
    if (columns.updatedAt) {
      camelCaseUpdates.updatedAt = new Date();
    }

    // Add dataSource = MANUAL for tables that support it
    if (columns.dataSource) {
      // Only set to MANUAL if admin is actually changing data fields
      // (not just system fields like updatedAt)
      const isDataEdit = Object.keys(camelCaseUpdates).some(
        key => !['updatedAt', 'createdAt', 'id'].includes(key)
      );

      if (isDataEdit) {
        camelCaseUpdates.dataSource = 'MANUAL';
        console.log(`[Dynamic Admin] Setting dataSource to MANUAL for admin edit`);
      }
    }

    // Get primary key column
    const primaryKey = getPrimaryKeyColumn(table);
    const primaryKeyColumn = (table as any)[primaryKey];

    if (!primaryKeyColumn) {
      return NextResponse.json(
        { success: false, error: `Primary key column "${primaryKey}" not found` },
        { status: 500 }
      );
    }

    // Fetch existing record for cross-field validation
    const existingRecordResult = await db
      .select()
      .from(table)
      .where(eq(primaryKeyColumn, id))
      .limit(1);

    const existingRecord = existingRecordResult[0] || {};

    // Validate updates using business rules
    // Merge existing record with updates for cross-field validation
    const validationResult = validateRecord(tableName, {
      ...existingRecord,
      ...camelCaseUpdates,
    });

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

    // Update the record
    const result = await db
      .update(table)
      .set(camelCaseUpdates)
      .where(eq(primaryKeyColumn, id))
      .returning();

    if (!result || result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Record not found or update failed' },
        { status: 404 }
      );
    }

    // Log the update
    console.log(`[Dynamic Admin] Updated record in ${tableName}:`, id);

    // If this is a field protection update, clear related caches
    if (tableName === 'fieldProtectionMetadata') {
      // TODO: Clear cache for field protection
    }

    return NextResponse.json({
      success: true,
      data: result[0],
      message: 'Record updated successfully'
    });
  } catch (error) {
    logger.error(
      { route: '/api/admin/dynamic/[table]/[id]', error: error instanceof Error ? error.message : String(error) },
      '[Dynamic Admin] Update error'
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update record'
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete record
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ table: string; id: string }> }
) {
  try {
    // Verify admin token
    const authError = await requireAdminAuth();
    if (authError) return authError;

    const { table: tableName, id } = await params;
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

    // Get primary key column
    const primaryKey = getPrimaryKeyColumn(table);
    const primaryKeyColumn = (table as any)[primaryKey];

    if (!primaryKeyColumn) {
      return NextResponse.json(
        { success: false, error: `Primary key column "${primaryKey}" not found` },
        { status: 500 }
      );
    }

    // Delete the record
    const result = await db
      .delete(table)
      .where(eq(primaryKeyColumn, id))
      .returning();

    if (!result || result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Record not found' },
        { status: 404 }
      );
    }

    // Log the deletion
    console.log(`[Dynamic Admin] Deleted record from ${tableName}:`, id);

    return NextResponse.json({
      success: true,
      message: 'Record deleted successfully',
      data: result[0]
    });
  } catch (error) {
    logger.error(
      { route: '/api/admin/dynamic/[table]/[id]', error: error instanceof Error ? error.message : String(error) },
      '[Dynamic Admin] Delete error'
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete record'
      },
      { status: 500 }
    );
  }
}