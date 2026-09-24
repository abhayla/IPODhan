import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { DataConflictsRepository } from '@ipodhan/shared/repositories/data-conflicts-repository';
import {
  recordCorrigendumSuggestions,
  acceptCorrigendumSuggestion,
  dismissCorrigendumSuggestion,
  CORRIGENDUM_ACCEPTED,
  CORRIGENDUM_DISMISSED,
  type CorrigendumPage,
} from '@ipodhan/shared/services/corrigendum-suggestions';
// @ts-expect-error -- plain .mjs module with no type declarations
import { behaviourConflictPredicate } from '../../../scripts/lib/conflict-reasons.mjs';

/**
 * Item 9 (OD-90, spec section 2.5.5 as amended): a stored corrigendum becomes an admin SUGGESTION
 * in the conflicts queue; ACCEPT writes an ADMIN value and closes it; DISMISS writes nothing; the
 * same document twice creates no duplicate; the source-vs-source conflict paths never touch it.
 * Input is the REAL reader output of the Rays of Belief intimation letter
 * (tests/fixtures/corrigendum/rays-of-belief-intimation.pages.json).
 *
 * To run (docs/ops/prod-ops-recipes.md section 7):
 *   DATABASE_URL=postgresql://ipodhan_app:$PW@localhost:15432/ipodhan_test REDIS_URL=redis://localhost:6379/15 \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/corrigendum-suggestions.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const IPO_A = '00000000-0000-4000-8000-00000000c9a1';
const IPO_B = '00000000-0000-4000-8000-00000000c9b1';
const DOC_A = '00000000-0000-4000-8000-00000000c9a2';
const DOC_B = '00000000-0000-4000-8000-00000000c9b2';
const DOC_C = '00000000-0000-4000-8000-00000000c9c2';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGES: CorrigendumPage[] = JSON.parse(
  readFileSync(path.join(here, '..', 'fixtures', 'corrigendum', 'rays-of-belief-intimation.pages.json'), 'utf8')
).pages;

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>>;
const noRedis = { get: async () => null, set: async () => 'OK', del: async () => 0, keys: async () => [] } as never;

async function cleanup() {
  const ids = [IPO_A, IPO_B];
  await db.delete(schema.dataConflicts).where(inArray(schema.dataConflicts.ipoId, ids));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, ids));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, ids));
  await db.delete(schema.documents).where(inArray(schema.documents.ipoId, ids));
  await db.delete(schema.ipoDetails).where(inArray(schema.ipoDetails.ipoId, ids));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, ids));
}

async function seed(ipoId: string, docId: string, slug: string) {
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
    VALUES (${ipoId}::uuid, 'Rays of Belief Limited (item 9 test)', ${slug}, 'SME', 'UPCOMING', '2026-08-26', '2026-08-28')
  `);
  await db.insert(schema.ipoDetails).values({ ipoId, designatedExchange: 'BSE', dataSource: 'MANUAL' } as never);
  await db.insert(schema.fieldSources).values({
    ipoId, tableName: 'ipo_details', rowKey: '', fieldName: 'designatedExchange', source: 'DRHP', confidence: 90,
  } as never);
  await db.insert(schema.documents).values({
    id: docId, ipoId, type: 'CORRIGENDUM', title: 'Corrigendum NSE intimation letter', url: `https://example.invalid/${docId}.pdf`,
    sha256: 'e'.repeat(64),
  } as never);
}

const suggestionsFor = (ipoId: string) =>
  db.select().from(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, ipoId));
const designated = async (ipoId: string) =>
  (await db.select({ v: schema.ipoDetails.designatedExchange }).from(schema.ipoDetails).where(eq(schema.ipoDetails.ipoId, ipoId)))[0]?.v;
const provenance = async (ipoId: string) =>
  (await db.select().from(schema.fieldSources).where(and(eq(schema.fieldSources.ipoId, ipoId), eq(schema.fieldSources.fieldName, 'designatedExchange'))))[0];

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  db = drizzle(pool, { schema });
  await cleanup();
  await seed(IPO_A, DOC_A, 'item9-rays-a');
  await seed(IPO_B, DOC_B, 'item9-rays-b');
});

afterAll(async () => {
  if (!pool) return;
  await cleanup();
  await pool.end();
});

describe.skipIf(!DATABASE_URL)('item 9 (OD-90) — corrigendum suggestions in the admin conflicts queue', () => {
  it('records one suggestion row with the exact columns and writes no field', async () => {
    const r = await recordCorrigendumSuggestions(db as never, { ipoId: IPO_A, documentId: DOC_A, pages: PAGES });
    expect(r).toMatchObject({ parsed: 1, inserted: 1, duplicates: 0 });

    const rows = await suggestionsFor(IPO_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tableName: 'ipo_details',
      rowKey: '',
      fieldName: 'designatedExchange',
      source1: 'DRHP',
      value1: 'BSE',
      source2: 'DRHP',
      value2: 'NSE',
      severity: 'WARNING',
      documentId: DOC_A,
      resolvedAt: null,
    });
    expect(rows[0].evidence).toMatchObject({
      origin: 'CORRIGENDUM',
      page: 1,
      ocr: false,
      storedSource: 'DRHP',
      exchangeOwned: false,
      quote: 'The Designated Stock Exchange as mentioned across the RHP should be read as “NSE” instead of “BSE”',
    });
    expect(rows[0].suggestionKey).toMatch(/^[0-9a-f]{64}$/);
    expect(await designated(IPO_A)).toBe('BSE');
  });

  it('the same document read twice creates no duplicate', async () => {
    const r = await recordCorrigendumSuggestions(db as never, { ipoId: IPO_A, documentId: DOC_A, pages: PAGES });
    expect(r).toMatchObject({ parsed: 1, inserted: 0, duplicates: 1 });
    expect(await suggestionsFor(IPO_A)).toHaveLength(1);
  });

  it('the source-vs-source paths never refresh or auto-close a suggestion', async () => {
    const repo = new DataConflictsRepository(db as never, noRedis);
    expect(await repo.autoResolveConverged(IPO_A, 'ipo_details', '', 'designatedExchange')).toBe(0);
    await repo.upsertConflict({
      ipoId: IPO_A, tableName: 'ipo_details', fieldName: 'designatedExchange',
      source1: 'NSE', value1: 'BSE', source2: 'BSE', value2: 'BSE', severity: 'INFO',
    } as never);
    const rows = await suggestionsFor(IPO_A);
    const suggestion = rows.find((x) => x.documentId === DOC_A)!;
    expect(suggestion).toMatchObject({ value2: 'NSE', resolvedAt: null });
    await db.delete(schema.dataConflicts).where(and(eq(schema.dataConflicts.ipoId, IPO_A), sql`${schema.dataConflicts.documentId} is null`));
  });

  it('the .mjs scripts predicate (nightly floor, ratchet, admin-queue size) excludes an open suggestion', async () => {
    const res = await db.execute(sql.raw(
      `SELECT count(*)::int AS n FROM data_conflicts WHERE ipo_id = '${IPO_A}' AND resolved_at IS NULL AND ${behaviourConflictPredicate()}`
    ));
    const all = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM data_conflicts WHERE ipo_id = '${IPO_A}' AND resolved_at IS NULL`));
    expect((all.rows[0] as { n: number }).n).toBe(1);
    expect((res.rows[0] as { n: number }).n).toBe(0);
  });

  it('ACCEPT writes the proposed value as an ADMIN value (provenance + protection) and closes the suggestion', async () => {
    const [row] = await suggestionsFor(IPO_A);
    const out = await acceptCorrigendumSuggestion(db as never, row.id, 'item9-test-admin');
    expect(out).toMatchObject({ ok: true, fieldName: 'designatedExchange', appliedValue: 'NSE' });

    expect(await designated(IPO_A)).toBe('NSE');
    const prov = await provenance(IPO_A);
    expect(prov).toMatchObject({ source: 'ADMIN', confidence: 100, previousValue: 'BSE' });
    const [prot] = await db.select().from(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO_A));
    expect(prot).toMatchObject({ tableName: 'ipo_details', fieldName: 'designatedExchange', isProtected: true, manuallyEditedBy: 'item9-test-admin' });
    const [closed] = await suggestionsFor(IPO_A);
    expect(closed).toMatchObject({ resolvedSource: 'ADMIN', resolutionReason: CORRIGENDUM_ACCEPTED, resolvedBy: 'item9-test-admin' });
    expect(closed.resolvedAt).not.toBeNull();
  });

  it('DISMISS closes the suggestion and writes nothing else', async () => {
    await recordCorrigendumSuggestions(db as never, { ipoId: IPO_B, documentId: DOC_B, pages: PAGES });
    const [row] = await suggestionsFor(IPO_B);
    const out = await dismissCorrigendumSuggestion(db as never, row.id, 'item9-test-admin');
    expect(out.ok).toBe(true);

    expect(await designated(IPO_B)).toBe('BSE');
    expect(await provenance(IPO_B)).toMatchObject({ source: 'DRHP', confidence: 90 });
    expect(await db.select().from(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO_B))).toHaveLength(0);
    const [closed] = await suggestionsFor(IPO_B);
    expect(closed).toMatchObject({ resolvedSource: 'DRHP', resolutionReason: CORRIGENDUM_DISMISSED });
    expect(closed.resolvedAt).not.toBeNull();
  });

  // PR #989 review MINOR 5: two concurrent accepts of the SAME suggestion — exactly one writes.
  it('two concurrent ACCEPTs of one suggestion: exactly one succeeds, and provenance keeps previousSource', async () => {
    await db.insert(schema.documents).values({
      id: DOC_C, ipoId: IPO_B, type: 'CORRIGENDUM', title: 'Corrigendum (second read)', url: `https://example.invalid/${DOC_C}.pdf`,
      sha256: 'f'.repeat(64),
    } as never);
    await recordCorrigendumSuggestions(db as never, { ipoId: IPO_B, documentId: DOC_C, pages: PAGES });
    const open = (await suggestionsFor(IPO_B)).find((x) => x.documentId === DOC_C && x.resolvedAt === null)!;
    const [a, b] = await Promise.all([
      acceptCorrigendumSuggestion(db as never, open.id, 'item9-admin-a'),
      acceptCorrigendumSuggestion(db as never, open.id, 'item9-admin-b'),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const [closed] = (await suggestionsFor(IPO_B)).filter((x) => x.documentId === DOC_C);
    expect(closed.resolvedBy).toBe(a.ok ? 'item9-admin-a' : 'item9-admin-b');
    expect(await provenance(IPO_B)).toMatchObject({ source: 'ADMIN', previousSource: 'DRHP' });
  });
});
