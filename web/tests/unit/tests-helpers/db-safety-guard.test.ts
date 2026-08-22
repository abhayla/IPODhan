import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertNotProductionDatabase } from '../../helpers/db-safety-guard';

// T-265: this guard is what stops integration tests from writing seed rows
// into the production database (root cause of the 39-row registrar leak).

describe('assertNotProductionDatabase', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDatabaseHost = process.env.DATABASE_HOST;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_HOST;
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalDatabaseHost === undefined) {
      delete process.env.DATABASE_HOST;
    } else {
      process.env.DATABASE_HOST = originalDatabaseHost;
    }
  });

  it('throws when DATABASE_URL targets the production database name', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:15432/ipodhan';
    expect(() => assertNotProductionDatabase('caller')).toThrow(/does not look like a test database/);
  });

  it('does not throw when DATABASE_URL targets a "*_test" database', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@103.118.16.189:5432/ipodhan_test';
    expect(() => assertNotProductionDatabase('caller')).not.toThrow();
  });

  it('throws when DATABASE_URL is unset (cannot confirm a safe target)', () => {
    expect(() => assertNotProductionDatabase('caller')).toThrow(/could not determine the target database name/);
  });

  it('accepts a database name ending in "test" without an underscore prefix', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:5432/ipodhantest';
    expect(() => assertNotProductionDatabase('caller')).not.toThrow();
  });
});
