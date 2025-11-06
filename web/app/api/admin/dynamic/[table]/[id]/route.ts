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
    const table = getTableFromSchema(tableName);

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

    return NextResponse.json({
      success: true,
      data: result[0],
      message: 'Record retrieved successfully'
    });
  } catch (error) {
    console.error('[Dynamic Admin] Get error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve record'
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
    const table = getTableFromSchema(tableName);

    if (!table) {
      return NextResponse.json(
        { success: false, error: `Table "${tableName}" not found` },
        { status: 404 }
      );
    }

    // Parse request body
    const updates = await request.json();

    // Remove system fields that shouldn't be updated manually
    delete updates.id;
    delete updates.createdAt;

    // Add updatedAt if the table has it
    const columns = getTableColumns(table);
    if (columns.updatedAt) {
      updates.updatedAt = new Date();
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

    // Update the record
    const result = await db
      .update(table)
      .set(updates)
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
    if (tableName === 'fieldProtectionMetadata' || tableName === 'protectedFields') {
      // TODO: Clear cache for field protection
    }

    return NextResponse.json({
      success: true,
      data: result[0],
      message: 'Record updated successfully'
    });
  } catch (error) {
    console.error('[Dynamic Admin] Update error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update record'
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
    const table = getTableFromSchema(tableName);

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
    console.error('[Dynamic Admin] Delete error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete record'
      },
      { status: 500 }
    );
  }
}