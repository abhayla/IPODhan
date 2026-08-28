import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { DocumentFetchStateRepository } from '@ipodhan/shared/repositories/document-fetch-state-repository';

/**
 * T-403 M8 — the ONLY tests that exercise the Postgres side of the state machine.
 *
 * Everything else in T-403 runs against `InMemoryDocumentFetchStateStore`, which
 * deliberately mirrors these semantics but cannot prove them: the
 * `(ipo_id, doc_type)` unique constraint, the `ON CONFLICT DO UPDATE` upsert that
 * makes two overlapping cycles safe (R7), the `findDue` predicate, and the
 * survivor re-point (R8) are all SQL, and SQL is only verified by running it.
 *
 * SKIPS CLEANLY when no database is configured — with a reason naming the task,
 * so a skipped run is never mistaken for a passing one.
 *
 * To run:
 *   1. A Postgres database whose role can CREATE in `public` (the schema must be
 *      present; `cd web && npx drizzle-kit push` against an EPHEMERAL test DB).
 *   2. `DATABASE_URL=postgresql://user:pass@host:port/db npx vitest run \
 *        -c vitest.integration.config.ts tests/integration/document-fetch-state-repository.integration.test.ts`
 *
 * NOT RUN as of 2026-08-28: the only credentials this task is permitted to use
 * (`ipodhan_app` against `ipodhan_test`) are refused DDL —
 * `permission denied for schema public` — so the schema cannot be created and
 * `drizzle-kit migrate` cannot create its `drizzle` bookkeeping schema either
 * (`permission denied for database ipodhan_test`). Granting
 * `CREATE ON SCHEMA public` (and on the database) to that role, or supplying a
 * role that already has it, makes this file run unchanged.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'T-403: DATABASE_URL not set';

// Four IPO rows, seeded fresh — no dump is restored.
const IPOS = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'T403 Skyways Air Services Ltd.', slug: 't403-skyways' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'T403 Madhur Knit Crafts Ltd.', slug: 't403-madhurknit' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'T403 ESDS Software Solution Limited', slug: 't403-esds' },
  { id: '00000000-0000-4000-8000-000000000004', name: 'T403 Deepa Jewellers Ltd.', slug: 't403-deepa' },
];

let pool: Pool | null = null;
let repo: DocumentFetchStateRepository | null = null;

/** A Redis-shaped no-op: this repository is deliberately uncached. */
const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
  const db = drizzle(pool, { schema });
  repo = new DocumentFetchStateRepository(db as never, noRedis);

  // Clean slate for these four ids only — never a wholesale truncate.
  const ids = IPOS.map((i) => i.id);
  await db.execute(sql`DELETE FROM document_fetch_state WHERE ipo_id = ANY(${ids}::uuid[])`);
  await db.execute(sql`DELETE FROM ipos WHERE id = ANY(${ids}::uuid[])`);
  for (const ipo of IPOS) {
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, offering_type, status, open_date, close_date)
      VALUES (${ipo.id}::uuid, ${ipo.name}, ${ipo.slug}, 'IPO', 'OPEN', '2026-08-24', '2026-08-27')
    `);
  }
});

afterAll(async () => {
  if (!pool) return;
  const ids = IPOS.map((i) => i.id);
  const db = drizzle(pool, { schema });
  await db.execute(sql`DELETE FROM document_fetch_state WHERE ipo_id = ANY(${ids}::uuid[])`);
  await db.execute(sql`DELETE FROM ipos WHERE id = ANY(${ids}::uuid[])`);
  await pool.end();
});

describe.skipIf(!DATABASE_URL)(`DocumentFetchStateRepository against real Postgres (${SKIP_REASON})`, () => {
  const [SKYWAYS, MADHUR, ESDS, DEEPA] = IPOS.map((i) => i.id);

  it('ensureRow creates once and is idempotent on the (ipo_id, doc_type) unique key', async () => {
    const first = await repo!.ensureRow(SKYWAYS, 'RHP');
    const second = await repo!.ensureRow(SKYWAYS, 'RHP');

    expect(second.id).toBe(first.id);
    expect(second.state).toBe('WANTED');
    expect((await repo!.listForIpo(SKYWAYS)).filter((r) => r.docType === 'RHP')).toHaveLength(1);
  });

  it('ensureRow survives CONCURRENT calls — two overlapping cycles (R7)', async () => {
    // A read-then-insert would race here and one caller would die on the unique
    // constraint. ON CONFLICT DO UPDATE is what makes this safe.
    const results = await Promise.all([
      repo!.ensureRow(MADHUR, 'PROSPECTUS'),
      repo!.ensureRow(MADHUR, 'PROSPECTUS'),
      repo!.ensureRow(MADHUR, 'PROSPECTUS'),
    ]);
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
  });

  it('update writes the patch and bumps updated_at', async () => {
    const row = await repo!.ensureRow(SKYWAYS, 'CORRIGENDUM');
    const next = new Date(Date.now() + 30 * 60_000);
    const updated = await repo!.update(row.id, {
      state: 'NOT_YET_FILED',
      nextRetryAt: next,
      attempts: 3,
      lastAttempt: [{ source: 'BSE', http: 200, ms: 812, outcome: 'no_link' }],
    });

    expect(updated.state).toBe('NOT_YET_FILED');
    expect(updated.attempts).toBe(3);
    expect(updated.nextRetryAt?.toISOString().slice(0, 16)).toBe(next.toISOString().slice(0, 16));
    // jsonb round-trips as a real array, not a string.
    expect(Array.isArray(updated.lastAttempt)).toBe(true);
    expect(updated.lastAttempt?.[0].outcome).toBe('no_link');
  });

  it('findDue returns open rows whose retry time has passed, and excludes closed ones', async () => {
    const past = await repo!.ensureRow(ESDS, 'RHP');
    await repo!.update(past.id, {
      state: 'BLOCKED_ALL',
      nextRetryAt: new Date(Date.now() - 60_000),
    });

    const future = await repo!.ensureRow(ESDS, 'PRICE_BAND_AD');
    await repo!.update(future.id, {
      state: 'NOT_YET_FILED',
      nextRetryAt: new Date(Date.now() + 60 * 60_000),
    });

    const closed = await repo!.ensureRow(ESDS, 'DRHP');
    await repo!.update(closed.id, { state: 'NOT_APPLICABLE', nextRetryAt: null });

    const due = await repo!.findDue(new Date());
    const dueIds = due.map((r) => r.id);

    expect(dueIds).toContain(past.id);
    expect(dueIds).not.toContain(future.id);
    expect(dueIds).not.toContain(closed.id);
  });

  it('findDue treats a NULL next_retry_at as due now (a freshly created row)', async () => {
    const fresh = await repo!.ensureRow(DEEPA, 'DRHP');
    expect(fresh.nextRetryAt).toBeNull();
    expect((await repo!.findDue(new Date())).map((r) => r.id)).toContain(fresh.id);
  });

  it('markSuperseded flips only the named types, and returns the count', async () => {
    await repo!.ensureRow(SKYWAYS, 'ADDENDUM');
    await repo!.ensureRow(SKYWAYS, 'PRICE_BAND_AD');

    const n = await repo!.markSuperseded(SKYWAYS, ['ADDENDUM', 'PRICE_BAND_AD']);
    expect(n).toBe(2);

    const rows = await repo!.listForIpo(SKYWAYS);
    expect(rows.find((r) => r.docType === 'ADDENDUM')!.state).toBe('SUPERSEDED');
    expect(rows.find((r) => r.docType === 'PRICE_BAND_AD')!.state).toBe('SUPERSEDED');
    // The RHP row is untouched.
    expect(rows.find((r) => r.docType === 'RHP')!.state).not.toBe('SUPERSEDED');

    expect(await repo!.markSuperseded(SKYWAYS, [])).toBe(0);
  });

  it('repointToSurvivor moves rows to the surviving IPO without breaking the unique key (R8)', async () => {
    // Deepa has DRHP; give it an RHP too. Skyways (the survivor) already has an
    // RHP, so only the DRHP may move — moving both would violate the unique key.
    await repo!.ensureRow(DEEPA, 'RHP');

    const moved = await repo!.repointToSurvivor(DEEPA, SKYWAYS);

    expect(moved).toBe(1);
    const survivorTypes = (await repo!.listForIpo(SKYWAYS)).map((r) => r.docType);
    expect(survivorTypes).toContain('DRHP');
    // The colliding row stayed behind rather than blowing up the constraint.
    const leftBehind = (await repo!.listForIpo(DEEPA)).map((r) => r.docType);
    expect(leftBehind).toEqual(['RHP']);
  });

  it('document_fetch_state rows disappear with their IPO (ON DELETE CASCADE)', async () => {
    const db = drizzle(pool!, { schema });
    const id = '00000000-0000-4000-8000-0000000000ff';
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, offering_type, status)
      VALUES (${id}::uuid, 'T403 Cascade Probe Ltd.', 't403-cascade', 'IPO', 'OPEN')
    `);
    await repo!.ensureRow(id, 'RHP');
    expect(await repo!.listForIpo(id)).toHaveLength(1);

    await db.execute(sql`DELETE FROM ipos WHERE id = ${id}::uuid`);
    expect(await repo!.listForIpo(id)).toHaveLength(0);
  });
});
