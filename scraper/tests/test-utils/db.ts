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

const SANCTIONED_TEST_DATABASE = 'ipodhan_test';

/** Database name of a postgres URL, or null when it cannot be parsed. Never echoes the URL. */
export function databaseNameOfUrl(connectionString: string): string | null {
  try {
    const name = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''));
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Pool for a test that is handed a DATABASE_URL; UTC session like the shared pool.
 * Refuses, before connecting, any database other than exactly `ipodhan_test`. The error never
 * carries the URL. The caller owns the pool, must end() it, and should call
 * assertConnectedToTestDatabase(pool) before its first write.
 */
export function createTestPoolFromUrl(connectionString: string, max = 4): Pool {
  const name = databaseNameOfUrl(connectionString);
  if (name !== SANCTIONED_TEST_DATABASE) {
    throw new Error(`Refusing to build a test pool: database must be exactly ${SANCTIONED_TEST_DATABASE}`);
  }
  return new Pool({ connectionString, max, options: '-c timezone=UTC' });
}

/** Post-connect check: the server itself reports `ipodhan_test`. */
export async function assertConnectedToTestDatabase(pool: Pick<Pool, 'query'>): Promise<void> {
  const cur = (await pool.query('SELECT current_database() AS d')).rows[0]?.d as string | undefined;
  if (cur !== SANCTIONED_TEST_DATABASE) {
    throw new Error(`Refusing to run: connected database is ${cur}, expected ${SANCTIONED_TEST_DATABASE}`);
  }
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
