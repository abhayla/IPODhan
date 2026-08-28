import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
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
 * RUN: against `ipodhan_test` after replaying the journal from empty, and in CI
 * by the `scraper-document-integration` job in pr-gate.yml, which replays the
 * journal into a fresh `postgres:16` service container before running this file.
 * That job is the reason the replay is checked on every PR rather than whenever
 * someone remembers to trigger it.
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

  // Clean slate for these four ids ONLY — never a wholesale truncate. The
  // query builder is used rather than a raw `= ANY(${ids})`: drizzle expands a
  // JS array in a template as a record tuple, which Postgres refuses to cast to
  // uuid[] (42846).
  const ids = IPOS.map((i) => i.id);
  await db.delete(schema.documentFetchState).where(inArray(schema.documentFetchState.ipoId, ids));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, ids));
  // Raw INSERT naming only the columns a JOURNAL-BUILT database actually has.
  //
  // The journal does NOT build the current schema: a database created purely by
  // `drizzle-kit migrate` gets the OLD `ipos` shape — a NOT NULL `category`
  // (ipo_category enum) and no `offering_type`/`segment` at all, plus 20-odd
  // other columns schema.ts declares and no migration creates. Measured and
  // recorded in evidence/T-403/journal-schema-drift.json. That is pre-existing
  // drift, not a T-403 one (prod was built from dumps plus the _repair/ files),
  // but it is why the typed query builder cannot be used here.
  for (const ipo of IPOS) {
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${ipo.id}::uuid, ${ipo.name}, ${ipo.slug}, 'MAINBOARD', 'OPEN', '2026-08-24', '2026-08-27')
    `);
  }
});

afterAll(async () => {
  if (!pool) return;
  const ids = IPOS.map((i) => i.id);
  const db = drizzle(pool, { schema });
  await db.delete(schema.documentFetchState).where(inArray(schema.documentFetchState.ipoId, ids));
  await db.execute(sql`DELETE FROM documents WHERE ipo_id = ANY(${sql.raw("ARRAY['" + ids.join("','") + "']::uuid[]")})`);
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, ids));
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

  it('W-1: a document round-trips its sha256, and the state row can be joined to it', async () => {
    // The dedup rule (E7/R2 — the same bytes from two exchanges are ONE
    // document) was computed per run and thrown away: nothing persisted the
    // hash, so the rule could not survive a restart and no query could prove
    // two rows were the same filing. This is that column, end to end.
    const db = drizzle(pool!, { schema });
    const sha = 'a'.repeat(64);
    const inserted = await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, file_size, sha256)
      VALUES (${ESDS}::uuid, 'RHP'::document_type, 'T403 RHP', 'https://example.test/t403-rhp.pdf',
              12345, ${sha})
      RETURNING id
    `);
    const documentId = ((inserted as unknown as { rows?: { id: string }[] }).rows ?? [])[0].id;

    const row = await repo!.ensureRow(ESDS, 'RHP');
    await repo!.update(row.id, { state: 'FOUND', documentId, nextRetryAt: null });

    const joined = await db.execute(sql`
      SELECT s.state, d.sha256, d.file_size
        FROM document_fetch_state s JOIN documents d ON d.id = s.document_id
       WHERE s.id = ${row.id}::uuid
    `);
    const read = ((joined as unknown as { rows?: Record<string, unknown>[] }).rows ?? [])[0];
    expect(read.state).toBe('FOUND');
    // char(64) is blank-padded on read in some drivers; the hash must compare
    // equal after trimming, and must be the full digest, not a prefix.
    expect(String(read.sha256).trim()).toBe(sha);

    await db.execute(sql`DELETE FROM documents WHERE id = ${documentId}::uuid`);
  });

  it('W-1/H-1: the two source-hint columns exist on ipos and hold what is written', async () => {
    // `company_website` and `verifier_url` are what make rung 4 and the verifier
    // reachable at all. Before 0035 nothing in the schema held either, so both
    // rungs could only ever record "skipped:no_..." — unreachable code in
    // production, which no unit test could reveal.
    const db = drizzle(pool!, { schema });
    await db.execute(sql`
      UPDATE ipos SET company_website = 'https://skyways-air.in',
                      verifier_url = 'https://www.chittorgarh.com/ipo/x/1/'
       WHERE id = ${SKYWAYS}::uuid
    `);
    const read = await db.execute(sql`
      SELECT company_website, verifier_url FROM ipos WHERE id = ${SKYWAYS}::uuid
    `);
    const got = ((read as unknown as { rows?: Record<string, unknown>[] }).rows ?? [])[0];
    expect(got.company_website).toBe('https://skyways-air.in');
    expect(got.verifier_url).toBe('https://www.chittorgarh.com/ipo/x/1/');
  });

  it('document_fetch_state rows disappear with their IPO (ON DELETE CASCADE)', async () => {
    const db = drizzle(pool!, { schema });
    const id = '00000000-0000-4000-8000-0000000000ff';
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status)
      VALUES (${id}::uuid, 'T403 Cascade Probe Ltd.', 't403-cascade', 'MAINBOARD', 'OPEN')
    `);
    await repo!.ensureRow(id, 'RHP');
    expect(await repo!.listForIpo(id)).toHaveLength(1);

    await db.delete(schema.ipos).where(eq(schema.ipos.id, id));
    expect(await repo!.listForIpo(id)).toHaveLength(0);
  });
});
