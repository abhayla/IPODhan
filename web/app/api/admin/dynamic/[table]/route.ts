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
import { desc, asc, like, and, or, sql, eq } from 'drizzle-orm';
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

    // Remove system fields that shouldn't be set manually
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;

    // Insert record
    const result = await db.insert(table).values(data).returning();

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