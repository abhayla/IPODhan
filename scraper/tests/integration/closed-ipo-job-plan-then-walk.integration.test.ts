// implements: OD-76 "plan, then walk" for the 22:00 closed-IPO job (#717)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, count, isNotNull, and, sql, inArray } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { readFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout.
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { fieldManifestFingerprint } from '../../../packages/shared/src/utils/field-manifest-fingerprint';
import type { FieldFetcher, FieldPlanWalkOrchestrator } from '../../src/services/field-plan-walk.js';

/**
 * OD-76, proven on ipodhan_test against the REAL generator, the REAL
 * `ipo_field_plan` repository (its claim SQL included), the REAL walk and the
 * REAL production DOC fetcher (`buildFieldPlanWalkFetchers().DOC`). Only the
 * three NETWORK fetchers (NSE, BSE, CHITTORGARH) are stubbed -- a test must not
 * hit live exchange sites -- and they answer NOT_AVAILABLE_YET, the honest
 * answer for "this source has nothing on it right now".
 *
 * The staging shape this reproduces (2026-09-23): a LISTED IPO with 0 plan
 * rows and one unread (PENDING) RHP. Before OD-76 the job walked it, found
 * nothing due and wrote DONE. Seeded from a REAL document: Anubhav Plast Ltd.
 * is one of the ten IPOs the job wrongly recorded DONE on staging, and its RHP
 * page text is the committed fixture tests/fixtures/anubhav-rhp-financial-pages.json.
 *
 * To run: docs/ops/prod-ops-recipes.md §7 ("Running a scraper integration test
 * against ipodhan_test"). DATABASE_URL unset = "no tests", exit 0: read the COUNT.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'OD-76: SKIPPED -- DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-000000076001';
const DOC_ID = '00000000-0000-4000-8000-000000076002';
const SLUG = 'od76-closed-ipo-plan-then-walk-anubhav-fixture';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANUBHAV_PAGES: Array<[number, string]> = JSON.parse(
  readFileSync(path.join(here, '..', 'fixtures', 'anubhav-rhp-financial-pages.json'), 'utf8')
);

const notYet: FieldFetcher = async () => ({ outcome: 'NOT_AVAILABLE_YET' });

/** Nothing is SUPPLIED in this proof, so a write reaching the orchestrator is itself a defect. */
const refusingOrchestrator: FieldPlanWalkOrchestrator = {
  consolidatedUpsertIPO: async () => {
    throw new Error('no write expected: every source answered NOT_AVAILABLE_YET');
  },
  consolidatedUpsertChildRows: async () => {
    throw new Error('no write expected: every source answered NOT_AVAILABLE_YET');
  },
};

describe.skipIf(!DATABASE_URL)(`OD-76: closed-IPO job plans, then walks (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;
  let redis: Redis | null = null;
  let db: ReturnType<typeof drizzle>;
  let mod: typeof import('../../src/scheduler/closed-ipo-job.js');
  let plant: typeof import('../../src/services/field-plan-planting.js');
  let walkMod: typeof import('../../src/services/field-plan-walk.js');
  let settle: typeof import('../../src/scheduler/closed-ipo-plan-settlement.js');
  let docFetcher: FieldFetcher;

  async function clean() {
    await db.delete(schema.closedIpoResourcing).where(eq(schema.closedIpoResourcing.ipoId, IPO_ID));
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.documents).where(eq(schema.documents.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
    if (redis) {
      const keys = await redis.keys(`*${IPO_ID}*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  }

  async function seedListedIpoWithPendingRhp() {
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, segment, listing_exchanges, status, open_date, close_date)
      VALUES (${IPO_ID}::uuid, 'OD-76 Fixture (Anubhav Plast RHP) Ltd.', ${SLUG}, 'SME', 'SME', '["BSE"]'::jsonb,
              'LISTED', '2026-03-24', '2026-03-26')`);
    await db.execute(sql`
      INSERT INTO documents (id, ipo_id, type, title, url, extraction_status)
      VALUES (${DOC_ID}::uuid, ${IPO_ID}::uuid, 'RHP', 'Anubhav Plast Ltd. RHP', 'fixture://anubhav-rhp', 'PENDING')`);
    for (const [page, text] of ANUBHAV_PAGES.slice(0, 3)) {
      await db.insert(schema.documentPages).values({ documentId: DOC_ID, pageNumber: page, text });
    }
  }

  function liveDeps(planRepo: IpoFieldPlanRepository, manifest?: Parameters<typeof plant.plantFieldPlanForIpo>[1]['manifest']) {
    return {
      countPlanRows: async (id: string) => {
        const [row] = await db.select({ n: count() }).from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, id));
        return Number(row?.n ?? 0);
      },
      plantPlan: async (id: string) => {
        const [ipo] = await db
          .select({ id: schema.ipos.id, segment: schema.ipos.segment, listingExchanges: schema.ipos.listingExchanges })
          .from(schema.ipos)
          .where(eq(schema.ipos.id, id));
        return plant.plantFieldPlanForIpo(
          { id: ipo.id, segment: ipo.segment as 'MAINBOARD' | 'SME', listingExchanges: ipo.listingExchanges },
          { fieldPlanRepository: planRepo as never, manifest }
        );
      },
      // Round 4 M-2: the SAME settlement read production wires (closed-ipo-plan-settlement.ts), not a copy.
      readPlanSettlement: (id: string) => settle.readPlanSettlement(db as never, id),
      walk: (id: string) =>
        walkMod.walkFieldPlanForIPO(
          id,
          {
            fieldPlanRepository: planRepo as never,
            orchestrator: refusingOrchestrator,
            sourceFetchers: { DOC: docFetcher, NSE: notYet, BSE: notYet, CHITTORGARH: notYet },
            ipoRepository: new IPORepository(db as never, redis as never) as never,
          },
          { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 }
        ),
    };
  }

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const { rows } = await pool.query('select current_database()');
    if (rows[0].current_database !== 'ipodhan_test') {
      throw new Error(`Refusing to run: connected to '${rows[0].current_database}', not 'ipodhan_test'.`);
    }
    db = drizzle(pool, { schema });
    redis = new Redis(REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
    await redis.connect();
    mod = await import('../../src/scheduler/closed-ipo-job.js');
    plant = await import('../../src/services/field-plan-planting.js');
    walkMod = await import('../../src/services/field-plan-walk.js');
    settle = await import('../../src/scheduler/closed-ipo-plan-settlement.js');
    const { buildFieldPlanWalkFetchers } = await import('../../src/services/field-plan-walk-deps.js');
    docFetcher = buildFieldPlanWalkFetchers(redis as never).DOC;
    await clean();
  }, 60000);

  afterAll(async () => {
    if (!pool) return;
    await clean();
    await pool.end();
    if (redis) await redis.quit();
  }, 60000);

  beforeEach(async () => {
    if (pool) await clean();
  });

  it('a LISTED IPO with 0 plan rows and a PENDING RHP: plan planted, every row walked, outcome decided by the walk -- never the empty-walk DONE', async () => {
    await seedListedIpoWithPendingRhp();
    const planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    const [before] = await db.select({ n: count() }).from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    expect(Number(before.n)).toBe(0);

    const r = await mod.resourceClosedIpo(IPO_ID, liveDeps(planRepo));

    const [planned] = await db.select({ n: count() }).from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    const [walked] = await db
      .select({ n: count() })
      .from(schema.ipoFieldPlan)
      .where(and(eq(schema.ipoFieldPlan.ipoId, IPO_ID), isNotNull(schema.ipoFieldPlan.lastAttemptAt)));
    const [notYetRows] = await db
      .select({ n: count() })
      .from(schema.ipoFieldPlan)
      .where(and(eq(schema.ipoFieldPlan.ipoId, IPO_ID), eq(schema.ipoFieldPlan.state, 'NOT_AVAILABLE_YET')));
    // eslint-disable-next-line no-console
    console.log(
      `OD-76 PROOF: plan rows 0 -> ${planned.n}; rows walked (last_attempt_at set) ${walked.n}; ` +
        `NOT_AVAILABLE_YET ${notYetRows.n}; outcome ${r.outcome}; written ${r.fieldsWritten}; left empty ${r.fieldsLeftEmpty}`
    );

    expect(Number(planned.n)).toBeGreaterThan(0);
    expect(Number(walked.n)).toBe(Number(planned.n));
    expect(r.fieldsLeftEmpty).toBe(Number(planned.n));
    // Measured 2026-09-23 on the REAL manifest: 185 rows NOT_AVAILABLE_YET and 4
    // anchor_investors rows CHECK_FAILED ("no documentType in manifest for this
    // field", transient). So the walk's own counters make it PARTIAL -- the
    // outcome is the walk's verdict, not the pre-OD-76 "nothing due -> DONE".
    expect(r.outcome).toBe('PARTIAL');
    expect(r.causeClass).toBe('SOURCE_UNREACHABLE');
    expect(r.causeDetail).toMatch(/failed transiently/);
    expect(r.causeDetail).not.toMatch(/asked nothing/);
    // The walk's DOC step was consulted and, the RHP being unread, said "not yet" --
    // it answers from provenance, never by re-reading the bytes (OD-33).
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, DOC_ID));
    expect(doc.extractionStatus).toBe('PENDING');
  });

  it('an IPO whose plan generation yields 0 rows ends FAILED with a cause, never DONE, and writes no plan', async () => {
    await seedListedIpoWithPendingRhp();
    const planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    const { loadFieldManifest } = await import('../../src/config/field-manifest-loader.js');
    const empty = { ...loadFieldManifest(), fields: {} };

    const r = await mod.resourceClosedIpo(IPO_ID, liveDeps(planRepo, empty as never));

    const [planned] = await db.select({ n: count() }).from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    // eslint-disable-next-line no-console
    console.log(`OD-76 PROOF (0-row plan): outcome ${r.outcome} cause ${r.causeClass}; plan rows ${planned.n}`);
    expect(r.outcome).toBe('FAILED');
    expect(r.causeClass).toBe('EXTRACTOR_MISSING');
    expect(Number(planned.n)).toBe(0);
  });

  it('repair tool: reopens a DONE row that was never walked, leaves a walked DONE row alone (the SQL, on the real schema)', async () => {
    await seedListedIpoWithPendingRhp();
    const { reopenFalseDoneRows, REPAIR_MARKER } = await import('../../scripts/repair-closed-ipo-false-done.js');
    const seedDone = () =>
      db.execute(sql`
        INSERT INTO closed_ipo_resourcing (ipo_id, first_attempt_at, last_attempt_at, attempts, outcome, fields_written, fields_left_empty, resourced_at_version)
        VALUES (${IPO_ID}::uuid, now(), now(), 1, 'DONE', 0, 0, 'closed-ipo-job@2026-09-21')
        ON CONFLICT (ipo_id) DO UPDATE SET outcome = 'DONE', cause_class = NULL, cause_detail = NULL,
          resourced_at_version = 'closed-ipo-job@2026-09-21'`);

    // (1) The staging shape: DONE, 0 plan rows, an unread RHP -> reopened.
    await seedDone();
    expect(await reopenFalseDoneRows(db as never, [IPO_ID])).toBe(1);
    const [reopened] = await db.select().from(schema.closedIpoResourcing).where(eq(schema.closedIpoResourcing.ipoId, IPO_ID));
    expect(reopened.outcome).toBe('PARTIAL');
    expect(reopened.resourcedAtVersion.startsWith(REPAIR_MARKER)).toBe(true);

    // (2) OD-79: the same IPO walked (plan planted, every row asked) but its rows are
    // still open (NOT_AVAILABLE_YET / CHECK_FAILED) -> a DONE row is STILL false; reopened.
    const planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    await mod.resourceClosedIpo(IPO_ID, liveDeps(planRepo));
    await seedDone();
    expect(await reopenFalseDoneRows(db as never, [IPO_ID])).toBe(1);
    const [walkedOpen] = await db.select().from(schema.closedIpoResourcing).where(eq(schema.closedIpoResourcing.ipoId, IPO_ID));
    expect(walkedOpen.causeClass).toBe('FIELDS_PENDING');

    // (2b) walked AND every row settled -> a TRUE DONE; left alone.
    await db.execute(sql`UPDATE ipo_field_plan SET state = 'NOT_PRINTED' WHERE ipo_id = ${IPO_ID}::uuid`);
    await seedDone();
    expect(await reopenFalseDoneRows(db as never, [IPO_ID])).toBe(0);
  });

  it('repair tool (MINOR-4): reopens a never-walked DONE even when every document is read; leaves a never-asked DONE whose plan is all settled', async () => {
    await seedListedIpoWithPendingRhp();
    await db.execute(sql`UPDATE documents SET extraction_status = 'COMPLETED' WHERE id = ${DOC_ID}::uuid`);
    const { reopenFalseDoneRows } = await import('../../scripts/repair-closed-ipo-false-done.js');
    const seedDone = () =>
      db.execute(sql`
        INSERT INTO closed_ipo_resourcing (ipo_id, first_attempt_at, last_attempt_at, attempts, outcome, fields_written, fields_left_empty, resourced_at_version)
        VALUES (${IPO_ID}::uuid, now(), now(), 1, 'DONE', 0, 0, 'closed-ipo-job@2026-09-21')
        ON CONFLICT (ipo_id) DO UPDATE SET outcome = 'DONE', cause_class = NULL, cause_detail = NULL,
          resourced_at_version = 'closed-ipo-job@2026-09-21'`);

    // (3) 0 plan rows, nothing unread: still a false DONE (never DONE with no plan).
    await seedDone();
    expect(await reopenFalseDoneRows(db as never, [IPO_ID])).toBe(1);

    // (4) a plan exists, never asked, but EVERY row is settled: a TRUE DONE (OD-73); left alone.
    const planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    await liveDeps(planRepo).plantPlan(IPO_ID);
    await db.execute(sql`UPDATE ipo_field_plan SET state = 'NOT_PRINTED' WHERE ipo_id = ${IPO_ID}::uuid`);
    await seedDone();
    expect(await reopenFalseDoneRows(db as never, [IPO_ID])).toBe(0);
  });

  it('(OD-78, NEW-1) a PARTIAL/FAILED IPO is NOT re-picked after a non-rank manifest edit, IS re-picked after a rank or capable change; DONE never is', async () => {
    await seedListedIpoWithPendingRhp();
    const { loadFieldManifest } = await import('../../src/config/field-manifest-loader.js');
    const { EXTRACTOR_VERSION } = await import('../../src/services/filing-auto-persist.js');
    type F = Record<string, { rank: Record<string, string[]>; capability: Record<string, { capable: boolean; reason: string }> }>;
    const fresh = () => structuredClone(loadFieldManifest().fields) as unknown as F;
    const version = (fields: F) =>
      mod.closedIpoResourcingVersion({ ranksHash: fieldManifestFingerprint(fields), extractorVersion: EXTRACTOR_VERSION });
    const vNow = version(fresh());
    const reasonEdited = fresh();
    const k0 = Object.keys(reasonEdited)[0];
    const s0 = Object.keys(reasonEdited[k0].capability)[0];
    reasonEdited[k0].capability[s0].reason = 'reworded in review; same meaning';
    const vReason = version(reasonEdited);
    const capFlipped = fresh();
    capFlipped[k0].capability[s0].capable = !capFlipped[k0].capability[s0].capable;
    const vCap = version(capFlipped);
    const rankEdited = fresh();
    const kR = Object.keys(rankEdited).find((k) => Object.values(rankEdited[k].rank).some((l) => l.length >= 2))!;
    const tR = Object.keys(rankEdited[kR].rank).find((t) => rankEdited[kR].rank[t].length >= 2)!;
    rankEdited[kR].rank[tR] = [...rankEdited[kR].rank[tR]].reverse();
    const vRank = version(rankEdited);
    expect(vReason).toBe(vNow);
    expect(vCap).not.toBe(vNow);
    expect(vRank).not.toBe(vNow);

    const picked = async (v: string) =>
      (await mod.selectClosedIpoCandidates(db as never, v, 100000)).some((c) => c.id === IPO_ID);
    const setRow = (outcome: string) =>
      db.execute(sql`
        INSERT INTO closed_ipo_resourcing (ipo_id, first_attempt_at, last_attempt_at, attempts, outcome, cause_class, fields_written, fields_left_empty, resourced_at_version)
        VALUES (${IPO_ID}::uuid, now(), now(), 1, ${outcome}::closed_ipo_resourcing_outcome,
                CASE WHEN ${outcome} = 'DONE' THEN NULL ELSE 'SOURCE_UNREACHABLE'::closed_ipo_resourcing_cause_class END, 0, 0, ${vNow})
        ON CONFLICT (ipo_id) DO UPDATE SET outcome = EXCLUDED.outcome, cause_class = EXCLUDED.cause_class,
          resourced_at_version = EXCLUDED.resourced_at_version`);

    expect(await picked(vNow)).toBe(true); // never attempted: eligible
    const seen: string[] = [];
    for (const outcome of ['PARTIAL', 'FAILED']) {
      await setRow(outcome);
      const r = { same: await picked(vNow), reason: await picked(vReason), cap: await picked(vCap), rank: await picked(vRank) };
      seen.push(`${outcome}: same ${r.same}, reason-edit ${r.reason}, capable-flip ${r.cap}, rank-edit ${r.rank}`);
      expect(r).toEqual({ same: false, reason: false, cap: true, rank: true });
    }
    await setRow('DONE');
    const done = { same: await picked(vNow), cap: await picked(vCap), rank: await picked(vRank) };
    seen.push(`DONE: same ${done.same}, capable-flip ${done.cap}, rank-edit ${done.rank}`);
    expect(done).toEqual({ same: false, cap: false, rank: false });
    // eslint-disable-next-line no-console
    console.log(`OD-78 (a,c) PROOF: vNow=${vNow} vReason=${vReason} vCap=${vCap} vRank=${vRank}; ${seen.join('; ')}`);
  });

  it('(OD-78, b) 12 never-walked + 5 PARTIAL: a night of 10 picks never-walked only; PARTIAL come after, and only once the ranks change', async () => {
    const ids = (n: number, base: number) =>
      Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-0000000${String(base + i).padStart(5, '0')}`);
    const neverWalked = ids(12, 78100);
    const partial = ids(5, 78200);
    const all = [...neverWalked, ...partial];
    const cleanup = async () => {
      await db.delete(schema.closedIpoResourcing).where(inArray(schema.closedIpoResourcing.ipoId, all));
      await db.delete(schema.ipos).where(inArray(schema.ipos.id, all));
    };
    await cleanup();
    try {
      // PARTIAL rows closed MORE recently than the never-walked ones: close_date DESC alone would put them first.
      for (const [i, id] of neverWalked.entries()) {
        await db.execute(sql`INSERT INTO ipos (id, company_name, slug, category, segment, listing_exchanges, status, open_date, close_date)
          VALUES (${id}::uuid, ${`OD-78 never-walked ${i}`}, ${`od78-never-walked-${i}`}, 'SME', 'SME', '["BSE"]'::jsonb, 'LISTED',
                  CURRENT_DATE - 9, CURRENT_DATE - 2)`);
      }
      for (const [i, id] of partial.entries()) {
        await db.execute(sql`INSERT INTO ipos (id, company_name, slug, category, segment, listing_exchanges, status, open_date, close_date)
          VALUES (${id}::uuid, ${`OD-78 partial ${i}`}, ${`od78-partial-${i}`}, 'SME', 'SME', '["BSE"]'::jsonb, 'LISTED',
                  CURRENT_DATE - 8, CURRENT_DATE - 1)`);
        await db.execute(sql`INSERT INTO closed_ipo_resourcing (ipo_id, first_attempt_at, last_attempt_at, attempts, outcome, cause_class, fields_written, fields_left_empty, resourced_at_version)
          VALUES (${id}::uuid, now(), now(), 1, 'PARTIAL', 'SOURCE_UNREACHABLE', 0, 4, 'od78-ranks-A')`);
      }
      const foreign = (await db.execute(sql`SELECT count(*)::int AS n FROM ipos i LEFT JOIN closed_ipo_resourcing r ON r.ipo_id = i.id
            WHERE upper(i.status::text) IN ('LISTED','CLOSED') AND i.close_date >= CURRENT_DATE - 2 AND i.close_date < CURRENT_DATE
              AND r.ipo_id IS NULL AND NOT (i.id = ANY(${sql.param(neverWalked)}::uuid[]))`)) as unknown as { rows: Array<{ n: number }> };
      const foreignNever = Number(foreign.rows[0].n);
      const report: string[] = [];
      for (const v of ['od78-ranks-A', 'od78-ranks-B']) {
        const night = await mod.selectClosedIpoCandidates(db as never, v, 10);
        const nightIds = night.map((c) => c.id);
        const partialPicked = nightIds.filter((id) => partial.includes(id)).length;
        const oursNever = nightIds.filter((id) => neverWalked.includes(id)).length;
        report.push(`version ${v}: night of ${night.length} -> ${oursNever} of our never-walked, ${partialPicked} PARTIAL`);
        expect(night.length).toBe(10);
        expect(partialPicked).toBe(0);
        if (foreignNever === 0) expect(oursNever).toBe(10);
      }
      // (c) same ranks: PARTIAL never selected at all; ranks changed: every PARTIAL selected, after every never-walked.
      const wide = async (v: string) => (await mod.selectClosedIpoCandidates(db as never, v, 100000)).map((c) => c.id);
      const sameRanks = await wide('od78-ranks-A');
      const newRanks = await wide('od78-ranks-B');
      expect(partial.filter((id) => sameRanks.includes(id))).toEqual([]);
      expect(partial.every((id) => newRanks.includes(id))).toBe(true);
      const firstPartialIdx = Math.min(...partial.map((id) => newRanks.indexOf(id)));
      const neverIdx = newRanks.map((id, i) => [id, i] as const).filter(([id]) => neverWalked.includes(id)).map(([, i]) => i);
      expect(Math.max(...neverIdx)).toBeLessThan(firstPartialIdx);
      report.push(`same ranks: ${partial.filter((id) => sameRanks.includes(id)).length}/5 PARTIAL eligible; new ranks: 5/5 eligible, first at #${firstPartialIdx + 1} after all ${neverIdx.length} never-walked`);
      // eslint-disable-next-line no-console
      console.log(`OD-78 (b,c) PROOF: foreign never-walked in window=${foreignNever}; ${report.join('; ')}`);
    } finally {
      await cleanup();
    }
  });

  it('(OD-73, MAJOR-1) the walk asked nothing: DONE when every plan row is settled, PARTIAL when a row is still open', async () => {
    await seedListedIpoWithPendingRhp();
    const planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    const d = liveDeps(planRepo);
    await d.plantPlan(IPO_ID);
    await db.execute(sql`UPDATE ipo_field_plan SET state = 'NOT_PRINTED', attempts = 1, last_attempt_at = now(), next_due_at = NULL
                          WHERE ipo_id = ${IPO_ID}::uuid`);

    const settled = await mod.resourceClosedIpo(IPO_ID, d);

    await db.execute(sql`UPDATE ipo_field_plan SET state = 'NOT_AVAILABLE_YET', next_due_at = now() + interval '1 day'
                          WHERE id = (SELECT id FROM ipo_field_plan WHERE ipo_id = ${IPO_ID}::uuid ORDER BY table_name, field_name LIMIT 1)`);
    const open = await mod.resourceClosedIpo(IPO_ID, d);
    // eslint-disable-next-line no-console
    console.log(
      `OD-73 PROOF: all settled -> ${settled.outcome}; one row open -> ${open.outcome}/${open.causeClass} (${open.causeDetail})`
    );
    expect(settled.outcome).toBe('DONE');
    expect(open.outcome).toBe('PARTIAL');
    expect(open.causeDetail).toMatch(/asked nothing, but 1 plan row\(s\) are not settled/);
  });

  it('(OD-79, OD-80) the review-round-3 probe: 5 asked (3 answered, 2 not yet), 30 not due, 5 CHECK_FAILED in backoff -> PARTIAL / FIELDS_PENDING, accepted by the DB; all settled -> DONE', async () => {
    await seedListedIpoWithPendingRhp();
    const planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    const base = liveDeps(planRepo);
    await base.plantPlan(IPO_ID);
    // Every row settled, then 40 rows re-opened in the probe's exact shape.
    await db.execute(sql`UPDATE ipo_field_plan SET state = 'NOT_PRINTED', attempts = 1, last_attempt_at = now(), next_due_at = NULL
                          WHERE ipo_id = ${IPO_ID}::uuid`);
    // The 5 asked rows are singleton `ipos` text fields, so an "answer" is a plain write
    // through the orchestrator; the other 35 are any other rows.
    const askedRows = (
      await db.execute(sql`SELECT id, field_name FROM ipo_field_plan
                            WHERE ipo_id = ${IPO_ID}::uuid AND table_name = 'ipos'
                              AND field_name IN ('registrar', 'sector', 'company_description', 'company_website', 'objectives',
                                                 'cin', 'isin', 'symbol')
                            ORDER BY field_name LIMIT 5`)
    ).rows as Array<{ id: string; field_name: string }>;
    const rest = (
      await db.execute(sql`SELECT id, field_name FROM ipo_field_plan
                            WHERE ipo_id = ${IPO_ID}::uuid AND NOT (id = ANY(${sql.param(askedRows.map((r) => r.id))}::uuid[]))
                            ORDER BY table_name, field_name, row_key LIMIT 35`)
    ).rows as Array<{ id: string; field_name: string }>;
    const ids = [...askedRows, ...rest];
    expect(askedRows.map((r) => r.field_name)).toHaveLength(5);
    expect(ids.length).toBe(40);
    const asked = ids.slice(0, 5);
    const setState = (rows: typeof ids, state: string, due: 'now' | 'later') =>
      // CHECK_FAILED backs off by SLOT (re-claimed only once last_attempt_at is before the
      // current slot boundary), so "in backoff" = asked in this slot: last_attempt_at = now().
      db.execute(sql`UPDATE ipo_field_plan SET state = ${state}::field_plan_state,
                            last_attempt_at = ${state === 'CHECK_FAILED' ? sql`now()` : null},
                            next_due_at = ${due === 'now' ? null : sql`now() + interval '1 day'`}
                      WHERE id = ANY(${sql.param(rows.map((r) => r.id))}::uuid[])`);
    await setState(asked, 'PENDING', 'now');
    await setState(ids.slice(5, 35), 'PENDING', 'later');
    await setState(ids.slice(35, 40), 'CHECK_FAILED', 'later');
    // "Answered": the first 3 asked fields are SUPPLIED by every source and the write is
    // accepted; the other 2 come back NOT_AVAILABLE_YET.
    const answered = new Set(asked.slice(0, 3).map((r) => r.field_name));
    const byField: FieldFetcher = async (_i, _t, _k, field) =>
      answered.has(field) ? { outcome: 'SUPPLIED', value: `od79 ${field}` } : { outcome: 'NOT_AVAILABLE_YET' };
    const acceptingOrchestrator: FieldPlanWalkOrchestrator = {
      consolidatedUpsertIPO: async (scraped: Record<string, unknown>, source: unknown, _c?: number, _p?: unknown, onlyFields?: string[]) => ({
        ipoId: IPO_ID,
        isNew: false,
        locked: true,
        skipped: false,
        consolidation: {
          fieldResults: (onlyFields ?? []).map((f) => ({ fieldName: f, finalValue: scraped[f], chosenSource: source, hadConflict: false })),
        },
      }),
      consolidatedUpsertChildRows: refusingOrchestrator.consolidatedUpsertChildRows,
    };
    const d = {
      ...base,
      walk: (id: string) =>
        walkMod.walkFieldPlanForIPO(
          id,
          {
            fieldPlanRepository: planRepo as never,
            orchestrator: acceptingOrchestrator,
            sourceFetchers: { DOC: byField, NSE: byField, BSE: byField, CHITTORGARH: byField },
            ipoRepository: new IPORepository(db as never, redis as never) as never,
          },
          { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 }
        ),
    };

    const r = await mod.resourceClosedIpo(IPO_ID, d);
    const open = await base.readPlanSettlement(IPO_ID);
    // The job's own writer path: the ledger row must be ACCEPTED with the new enum value.
    await db.execute(sql`
      INSERT INTO closed_ipo_resourcing (ipo_id, first_attempt_at, last_attempt_at, attempts, outcome, cause_class, cause_detail,
                                         fields_written, fields_left_empty, resourced_at_version)
      VALUES (${IPO_ID}::uuid, now(), now(), 1, ${r.outcome}::closed_ipo_resourcing_outcome,
              ${r.causeClass ?? null}::closed_ipo_resourcing_cause_class, ${r.causeDetail ?? null},
              ${r.fieldsWritten}, ${r.fieldsLeftEmpty}, 'od79-probe')`);
    const [row] = await db.select().from(schema.closedIpoResourcing).where(eq(schema.closedIpoResourcing.ipoId, IPO_ID));
    // eslint-disable-next-line no-console
    console.log(`OD-79 PROOF: open after walk ${JSON.stringify(open)}; outcome ${r.outcome}/${r.causeClass} (${r.causeDetail}); stored ${row.outcome}/${row.causeClass}`);
    expect(open.unsettledByState).toEqual({ PENDING: 30, NOT_AVAILABLE_YET: 2, CHECK_FAILED: 5 });
    expect(open.unsettled).toBe(37);
    expect(open.stored).toBeGreaterThan(37);
    expect(r.fieldsWritten).toBe(3);
    expect(r.outcome).toBe('PARTIAL');
    expect(r.causeClass).toBe('FIELDS_PENDING');
    expect(r.causeDetail).toMatch(/the walk asked 5 field\(s\), but 37 plan row\(s\) are not settled \(PENDING 30, NOT_AVAILABLE_YET 2, CHECK_FAILED 5\)/);
    expect(row.outcome).toBe('PARTIAL');
    expect(row.causeClass).toBe('FIELDS_PENDING');

    // (b) every plan row settled -> DONE, whether or not anything was asked.
    await db.execute(sql`UPDATE ipo_field_plan SET state = 'NOT_PRINTED', next_due_at = NULL WHERE ipo_id = ${IPO_ID}::uuid`);
    const done = await mod.resourceClosedIpo(IPO_ID, d);
    expect(done.outcome).toBe('DONE');
  });

  it('(round 4 M-1) the generator REPORTS rows but none are stored: never DONE -- the DB, not the report, decides', async () => {
    await seedListedIpoWithPendingRhp();
    const planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    const d = {
      ...liveDeps(planRepo),
      // The reviewer's probe: a repository that reports 12 rows and stores none.
      plantPlan: async () => ({ rowsGenerated: 12, inserted: 12, updated: 0 }),
    };
    const r = await mod.resourceClosedIpo(IPO_ID, d);
    const stored = await settle.readPlanSettlement(db as never, IPO_ID);
    // eslint-disable-next-line no-console
    console.log(`M-1 PROOF: stored ${stored.stored}; outcome ${r.outcome}/${r.causeClass} (${r.causeDetail})`);
    expect(stored.stored).toBe(0);
    expect(r.outcome).not.toBe('DONE');
    expect(r.outcome).toBe('FAILED');
    expect(r.causeClass).toBe('WRITE_SKIPPED');
  });

  it('(round 4 M-2) the shared settlement read: stored + unsettled by NOT IN the terminal list, on the real schema', async () => {
    await seedListedIpoWithPendingRhp();
    const planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    await liveDeps(planRepo).plantPlan(IPO_ID);
    await db.execute(sql`UPDATE ipo_field_plan SET state = 'SUPPLIED' WHERE ipo_id = ${IPO_ID}::uuid`);
    const all = await settle.readPlanSettlement(db as never, IPO_ID);
    await db.execute(sql`UPDATE ipo_field_plan SET state = 'CHECK_FAILED'
                          WHERE id = (SELECT id FROM ipo_field_plan WHERE ipo_id = ${IPO_ID}::uuid ORDER BY id LIMIT 1)`);
    const one = await settle.readPlanSettlement(db as never, IPO_ID);
    // eslint-disable-next-line no-console
    console.log(`M-2 PROOF: all SUPPLIED -> ${JSON.stringify(all)}; one CHECK_FAILED -> ${JSON.stringify(one)}`);
    expect(all.stored).toBeGreaterThan(0);
    expect(all.unsettled).toBe(0);
    expect(one).toEqual({ stored: all.stored, unsettled: 1, unsettledByState: { CHECK_FAILED: 1 } });
  });

  it('(OD-81, #932) a PARTIAL / FIELDS_PENDING IPO is re-picked only on an event: recorded stage change (legacy NULL: listing_date), a new document, or a ranks change; never-walked first', async () => {
    const id = (n: number) => `00000000-0000-4000-8000-0000000${String(81000 + n).padStart(5, '0')}`;
    const IDS = {
      neverWalked: id(1),
      noEvent: id(2), // LISTED well before the last attempt, no new document
      listedAfter: id(3), // event (1): listing_date on the IST day of the last attempt
      closedStill: id(4), // CLOSED with a listing_date ahead: not a stage change yet
      newDoc: id(5), // event (2): a document first seen after the last attempt
      oldDoc: id(6), // a document first seen BEFORE the last attempt: not an event
      otherCause: id(7), // PARTIAL / SOURCE_UNREACHABLE with a stage change: OD-78 only
      // #932: rows WITH a recorded status_at_attempt. (1..7 above carry NULL = the legacy rule.)
      recFlipLate: id(8), // case (a): attempted while CLOSED, listed 5 days BEFORE that attempt -> picked
      recFlipNoDate: id(9), // case (b): attempted while CLOSED, LISTED now, listing_date NULL -> picked
      recSameListed: id(10), // recorded LISTED, still LISTED, listing_date = attempt day -> NOT picked
      recSameClosed: id(11), // recorded CLOSED, still CLOSED -> NOT picked
    };
    const all = Object.values(IDS);
    const cleanup = async () => {
      await db.delete(schema.documentFetchState).where(inArray(schema.documentFetchState.ipoId, all));
      await db.delete(schema.closedIpoResourcing).where(inArray(schema.closedIpoResourcing.ipoId, all));
      await db.delete(schema.ipos).where(inArray(schema.ipos.id, all));
    };
    await cleanup();
    try {
      const seed = async (ipoId: string, status: string, listing: ReturnType<typeof sql> | null) => {
        await db.execute(sql`INSERT INTO ipos (id, company_name, slug, category, segment, listing_exchanges, status, open_date, close_date, listing_date)
          VALUES (${ipoId}::uuid, ${`OD-81 ${ipoId}`}, ${`od81-${ipoId}`}, 'SME', 'SME', '["BSE"]'::jsonb, ${status}::ipo_status,
                  CURRENT_DATE - 12, CURRENT_DATE - 10, ${listing ?? sql`NULL`})`);
      };
      // L = the IST date of the last attempt (one day ago).
      const L = sql`((now() - interval '1 day') AT TIME ZONE 'Asia/Kolkata')::date`;
      await seed(IDS.neverWalked, 'LISTED', sql`CURRENT_DATE - 30`);
      await seed(IDS.noEvent, 'LISTED', sql`${L} - 2`);
      await seed(IDS.listedAfter, 'LISTED', L);
      await seed(IDS.closedStill, 'CLOSED', sql`${L} + 5`);
      await seed(IDS.newDoc, 'LISTED', sql`${L} - 2`);
      await seed(IDS.oldDoc, 'LISTED', sql`${L} - 2`);
      await seed(IDS.otherCause, 'LISTED', L);
      await seed(IDS.recFlipLate, 'LISTED', sql`${L} - 5`);
      await seed(IDS.recFlipNoDate, 'LISTED', null);
      await seed(IDS.recSameListed, 'LISTED', L);
      await seed(IDS.recSameClosed, 'CLOSED', sql`${L} + 5`);

      const { loadFieldManifest } = await import('../../src/config/field-manifest-loader.js');
      const { EXTRACTOR_VERSION } = await import('../../src/services/filing-auto-persist.js');
      const vNow = mod.closedIpoResourcingVersion({
        ranksHash: fieldManifestFingerprint(loadFieldManifest().fields),
        extractorVersion: EXTRACTOR_VERSION,
      });
      for (const ipoId of [IDS.noEvent, IDS.listedAfter, IDS.closedStill, IDS.newDoc, IDS.oldDoc, IDS.otherCause]) {
        const cause = ipoId === IDS.otherCause ? 'SOURCE_UNREACHABLE' : 'FIELDS_PENDING';
        await db.execute(sql`INSERT INTO closed_ipo_resourcing (ipo_id, first_attempt_at, last_attempt_at, attempts, outcome, cause_class,
                                             fields_written, fields_left_empty, resourced_at_version)
          VALUES (${ipoId}::uuid, now() - interval '1 day', now() - interval '1 day', 1, 'PARTIAL',
                  ${cause}::closed_ipo_resourcing_cause_class, 0, 5, ${vNow})`);
      }
      const recorded: Array<[string, string]> = [
        [IDS.recFlipLate, 'CLOSED'],
        [IDS.recFlipNoDate, 'CLOSED'],
        [IDS.recSameListed, 'LISTED'],
        [IDS.recSameClosed, 'CLOSED'],
      ];
      for (const [ipoId, statusAtAttempt] of recorded) {
        await db.execute(sql`INSERT INTO closed_ipo_resourcing (ipo_id, first_attempt_at, last_attempt_at, attempts, outcome, cause_class,
                                             fields_written, fields_left_empty, resourced_at_version, status_at_attempt)
          VALUES (${ipoId}::uuid, now() - interval '1 day', now() - interval '1 day', 1, 'PARTIAL',
                  'FIELDS_PENDING'::closed_ipo_resourcing_cause_class, 0, 5, ${vNow}, ${statusAtAttempt})`);
      }
      // first_seen_at is a naive UTC column: write the UTC wall-clock explicitly.
      await db.execute(sql`INSERT INTO document_fetch_state (ipo_id, doc_type, first_seen_at)
        VALUES (${IDS.newDoc}::uuid, 'PROSPECTUS', (now() AT TIME ZONE 'UTC')),
               (${IDS.oldDoc}::uuid, 'PROSPECTUS', ((now() - interval '3 days') AT TIME ZONE 'UTC'))`);

      const picked = async (v: string, cap = 100000) =>
        (await mod.selectClosedIpoCandidates(db as never, v, cap)).map((c) => c.id).filter((x) => all.includes(x));
      const sameRanks = await picked(vNow);
      const ranksChanged = await picked('od81-other-ranks');
      const nameOf = (x: string) => Object.entries(IDS).find(([, v]) => v === x)?.[0];
      // eslint-disable-next-line no-console
      console.log(
        `OD-81 PROOF: same ranks -> [${sameRanks.map(nameOf).join(', ')}]; ranks changed -> [${ranksChanged.map(nameOf).join(', ')}]`
      );
      // listedAfter: legacy NULL row, re-picked by the listing_date fallback (#932 legacy rule).
      // recFlipLate / recFlipNoDate: #932 cases (a) and (b), missed by the listing_date inference.
      // recSameListed: the inference WOULD pick it (listing_date = attempt day); the recorded status says no change.
      expect(new Set(sameRanks)).toEqual(
        new Set([IDS.neverWalked, IDS.listedAfter, IDS.newDoc, IDS.recFlipLate, IDS.recFlipNoDate])
      );
      // Never-walked leads, even though it closed on the same day as the others.
      expect(sameRanks[0]).toBe(IDS.neverWalked);
      expect(new Set(ranksChanged)).toEqual(new Set(all));
    } finally {
      await cleanup();
    }
  });

  it('(F-31, MAJOR-3 + round 2) the snapshot names its database and slot, carries child-table current values, and refuses the wrong target', async () => {
    await seedListedIpoWithPendingRhp();
    await db.execute(sql`INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, previous_value, previous_source)
                          VALUES (${IPO_ID}::uuid, 'ipos', '', 'issueSize', 'CHITTORGARH', '19.2', 'BSE')`);
    await db.execute(sql`INSERT INTO ipo_details (ipo_id, data_source) VALUES (${IPO_ID}::uuid, 'NSE')`);
    await db.execute(sql`INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, previous_value, previous_source)
                          VALUES (${IPO_ID}::uuid, 'ipo_details', '', 'issueType', 'NSE', NULL, NULL)`);
    const snap = await import('../../src/scheduler/closed-ipo-snapshot.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'f31-'));
    const prevSlot = process.env.DEPLOY_SLOT;
    process.env.DEPLOY_SLOT = 'test';
    let written: { path: string; rows: number };
    try {
      written = await snap.writeFieldSourcesSnapshot(db as never, [IPO_ID], { dir });
    } finally {
      if (prevSlot === undefined) delete process.env.DEPLOY_SLOT;
      else process.env.DEPLOY_SLOT = prevSlot;
    }
    const back = snap.readFieldSourcesSnapshot(written.path, { database: 'ipodhan_test', deploySlot: 'test' });
    let refused = '';
    try {
      snap.readFieldSourcesSnapshot(written.path, { database: 'ipodhan', deploySlot: 'prod' });
    } catch (e) {
      refused = e instanceof Error ? e.message : String(e);
    }
    // eslint-disable-next-line no-console
    console.log(
      `F-31 PROOF: ${path.basename(written.path)} db=${back.database} slot=${back.deploySlot} rows=${written.rows} ` +
        `childTables=${Object.keys(back.childRows).join(',')} ipo_details=${back.childRows.ipo_details?.length}; wrong target -> "${refused}"`
    );
    expect(path.basename(written.path)).toMatch(/^field-sources-test-ipodhan_test-/);
    expect(back.database).toBe('ipodhan_test');
    expect(back.deploySlot).toBe('test');
    expect(written.rows).toBe(2);
    expect(back.ipoIds).toEqual([IPO_ID]);
    expect(back.fieldSources.find((r) => r.field_name === 'issueSize')).toMatchObject({ previous_value: '19.2', previous_source: 'BSE' });
    expect(back.ipos[0]).toMatchObject({ id: IPO_ID });
    expect(back.childRows.ipo_details).toHaveLength(1);
    expect(back.childRows.ipo_details[0]).toMatchObject({ ipo_id: IPO_ID });
    expect(back.childRows.ipos).toBeUndefined();
    expect(refused).toMatch(/refus/i);
    expect(refused).toMatch(/ipodhan_test/);
  });
});
