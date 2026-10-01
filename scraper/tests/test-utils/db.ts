/**
 * Test Database Utilities
 * Provides helper functions for setting up and cleaning up test database
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@ipodhan/shared/db/schema';

let testPool: Pool | null = null;
let testDb: ReturnType<typeof drizzle> | null = null;

/**
 * Get test database connection
 * Creates a new connection pool if one doesn't exist
 */
export async function getTestDb() {
  if (testDb) return testDb;

  // Use test database from environment or create a separate test DB
  const testDbConfig = {
    host: process.env.TEST_DB_HOST || process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.TEST_DB_PORT || process.env.DATABASE_PORT || '5432'),
    database: process.env.TEST_DB_NAME || process.env.DATABASE_NAME + '_test' || 'ipodhan_test',
    user: process.env.TEST_DB_USER || process.env.DATABASE_USER || 'postgres',
    password: process.env.TEST_DB_PASSWORD || process.env.DATABASE_PASSWORD || '',
  };

  // #1364: DATABASE_URL (what .env.test and the global prod/staging guard in
  // vitest.integration.setup.ts resolve) wins when set. The discrete-field fallback below names the
  // database DATABASE_NAME + '_test', which does not exist (3D000) under the repo's own .env.test.
  // Every pool needs `-c timezone=UTC` (ist-timezone rule).
  testPool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, options: '-c timezone=UTC' })
    : new Pool({ ...testDbConfig, options: '-c timezone=UTC' });
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
