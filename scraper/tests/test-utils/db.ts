/**
 * Test Database Utilities
 * Provides helper functions for setting up and cleaning up test database
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@ipodhan/shared/db/schema';
import { assertHelperTargetIsTestDatabase, resolveTestPoolTarget } from '../helpers/db-safety-guard';

let testPool: Pool | null = null;
let testDb: ReturnType<typeof drizzle> | null = null;

/**
 * Get test database connection
 * Creates a new connection pool if one doesn't exist
 */
export async function getTestDb() {
  if (testDb) return testDb;

  // #1364 round 2: the target is resolved by ONE function shared with the global guard
  // (tests/helpers/db-safety-guard.ts), and this helper refuses anything but ipodhan_test itself, before
  // connecting and again by asking the server which database the session landed in. The global guard
  // alone let TEST_DB_NAME=ipodhan_test + a DATABASE_URL naming another database reach that database.
  // Every pool needs `-c timezone=UTC` (ist-timezone rule).
  const target = resolveTestPoolTarget();
  assertHelperTargetIsTestDatabase(target.database);
  const pool = new Pool({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    max: 5,
    options: '-c timezone=UTC',
  });
  try {
    const { rows } = await pool.query('SELECT current_database() AS db');
    assertHelperTargetIsTestDatabase(String(rows[0]?.db), 'getTestDb (connected session)');
  } catch (err) {
    await pool.end().catch(() => undefined);
    throw err;
  }
  testPool = pool;
  testDb = drizzle(testPool, { schema });

  return testDb;
}

/**
 * Clean up test database connection
 * Closes the connection pool
 */
export async function cleanupTestDb(db?: any) {
  if (testPool) {
    await testPool.end();
    testPool = null;
    testDb = null;
  }
}

/**
 * Clear all test data from database
 * Useful for beforeEach/afterEach cleanup
 */
export async function clearTestData(db: any, tables: string[] = []) {
  // Default tables to clear
  const tablesToClear = tables.length > 0 ? tables : [
    'data_conflicts',
    'field_sources',
    'ipos',
  ];

  for (const table of tablesToClear) {
    await db.delete(table).where('1 = 1'); // Delete all rows
  }
}
