/**
 * Dynamic Admin API - List Records
 *
 * GET /api/admin/dynamic/[table]/list - List all records with pagination, search, and sorting
 *
 * Part of Week 2 Admin Enhancement (Phase 6)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import * as schema from '@ipodhan/shared/db/schema';
import { desc, asc, like, and, or, sql, getTableColumns } from 'drizzle-orm';
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
 * GET - List records with pagination and filtering
 */
export async function GET(
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

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || '';
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    // Calculate offset
    const offset = (page - 1) * limit;

    // Build query
    let query = db.select().from(table);

    // Apply search filter if provided
    if (search) {
      // Search in string columns using Drizzle's getTableColumns API
      const columns = getTableColumns(table);
      const searchableColumns = Object.entries(columns)
        .filter(([_, column]: [string, any]) => {
          const dataType = (column as any).dataType || '';
          return dataType === 'varchar' || dataType === 'text';
        })
        .map(([key, _]) => key);

      if (searchableColumns.length > 0) {
        const searchConditions = searchableColumns.map(columnName => {
          const column = (table as any)[columnName];
          return like(column, `%${search}%`);
        });

        query = query.where(or(...searchConditions) as any) as any;
      }
    }

    // Apply sorting
    const sortColumn = (table as any)[sortBy];
    if (sortColumn) {
      query = query.orderBy(sortOrder === 'desc' ? desc(sortColumn) : asc(sortColumn)) as any;
    }

    // Apply pagination
    query = query.limit(limit).offset(offset) as any;

    // Execute query
    const records = await query;

    // Get total count
    const countQuery = db.select({ count: sql`count(*)::int` }).from(table);
    if (search) {
      // Apply same search filter for count
      const columns = getTableColumns(table);
      const searchableColumns = Object.entries(columns)
        .filter(([_, column]: [string, any]) => {
          const dataType = (column as any).dataType || '';
          return dataType === 'varchar' || dataType === 'text';
        })
        .map(([key, _]) => key);

      if (searchableColumns.length > 0) {
        const searchConditions = searchableColumns.map(columnName => {
          const column = (table as any)[columnName];
          return like(column, `%${search}%`);
        });

        (countQuery as any).where(or(...searchConditions));
      }
    }

    const [{ count }] = await countQuery as any;
    const total = count || 0;

    // Calculate pagination info
    const totalPages = Math.ceil(total / limit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    return NextResponse.json({
      success: true,
      data: {
        records,
        total,
        page,
        limit,
        totalPages,
        hasNext,
        hasPrev
      },
      message: `Found ${records.length} records`
    });
  } catch (error) {
    console.error('[Dynamic Admin] List error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list records'
      },
      { status: 500 }
    );
  }
}