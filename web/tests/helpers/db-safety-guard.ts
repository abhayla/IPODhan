/**
 * Integration-test DB safety guard.
 *
 * T-265 root cause: several integration test suites write real INSERT/DELETE
 * operations through the SAME `db` client the whole app uses (wired to
 * DATABASE_URL), instead of a dedicated test database. When DATABASE_URL
 * pointed at the production `ipodhan` database (e.g. a locally SSH-tunneled
 * .env.local), running these suites leaked seed rows straight into prod --
 * 39 orphaned "Alpha Registrar Services Ltd" / "Beta Registrar Technologies"
 * / "Gamma Corporate Services" rows, discovered live on ipodhan.com.
 *
 * Call this at the top of any integration-test `beforeAll` that inserts or
 * deletes rows, before the first write. It throws instead of running when
 * the resolved database name doesn't look like a test database.
 */
export function assertNotProductionDatabase(callerLabel: string): void {
  const url = process.env.DATABASE_URL || process.env.DATABASE_HOST || '';
  const dbNameMatch = url.match(/\/([^/?]+)(\?|$)/);
  const dbName = dbNameMatch?.[1] ?? '';

  if (!dbName) {
    throw new Error(
      `${callerLabel}: could not determine the target database name from DATABASE_URL. ` +
        'Refusing to run seed/cleanup writes without a confirmed non-production target.'
    );
  }

  if (!/(_test|test_|test$)/i.test(dbName)) {
    throw new Error(
      `${callerLabel}: DATABASE_URL targets database "${dbName}", which does not look like a test ` +
        'database (expected a name containing "_test"). Refusing to insert/delete rows against what ' +
        'looks like production. Point DATABASE_URL (or TEST_DATABASE_URL, once wired) at a "*_test" ' +
        'database before running integration tests. See T-265: this exact gap previously leaked 39 ' +
        'fake registrar rows into the live "ipodhan" database.'
    );
  }
}
