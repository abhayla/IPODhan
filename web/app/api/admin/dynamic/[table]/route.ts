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
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import * as schema from '@ipodhan/shared/db/schema';
import { desc, asc, like, and, or, sql, eq, getTableColumns } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { validateRecord } from '@/lib/admin/dynamic-validation-rules';

/**
 * Get the table object from schema by name
 */
function getTableFromSchema(tableName: string): PgTable | null {
  const table = (schema as any)[tableName];
  if (!table || typeof table !== 'object') {
    return null;
  }
  return table as PgTable;
}

/**
 * POST - Create new record
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  try {
    // Verify admin token
    const authError = await requireAdminAuth();
    if (authError) return authError;

    const { table: tableName } = await params;
    const table = getTableFromSchema(tableName);

    if (!table) {
      return NextResponse.json(
        { success: false, error: `Table "${tableName}" not found` },
        { status: 404 }
      );
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

    // Log the creation
    console.log(`[Dynamic Admin] Created record in ${tableName}:`, result[0]);

    return NextResponse.json({
      success: true,
      data: result[0],
      message: `Record created successfully in ${tableName}`
    });
  } catch (error) {
    console.error('[Dynamic Admin] Create error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create record'
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE - DISABLED for bulk operations
 *
 * Bulk delete is not supported to prevent accidental mass data deletion.
 * Use /api/admin/dynamic/[table]/[id] for single record deletion.
 *
 * This endpoint exists to explicitly reject bulk delete attempts and
 * provide clear error messaging to admins.
 */
export async function DELETE(request: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error: 'Bulk delete is not supported',
      message: 'Delete records individually via /api/admin/dynamic/[table]/[id] to prevent accidental data loss.',
      hint: 'For mass deletions, use a dedicated batch script with proper safeguards.',
    },
    { status: 405 } // Method Not Allowed
  );
}