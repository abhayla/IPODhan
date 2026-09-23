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
      countUnsettledPlanRows: async (id: string) => {
        const rows = await db
          .select({ state: schema.ipoFieldPlan.state, n: count() })
          .from(schema.ipoFieldPlan)
          .where(
            and(
              eq(schema.ipoFieldPlan.ipoId, id),
              inArray(schema.ipoFieldPlan.state, ['PENDING', 'NOT_AVAILABLE_YET', 'CHECK_FAILED'])
            )
          )
          .groupBy(schema.ipoFieldPlan.state);
        return Object.fromEntries(rows.map((r) => [r.state, Number(r.n)]));
      },
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

    // (2) The same IPO once genuinely walked (plan planted, rows asked) -> a DONE row is TRUE; left alone.
    const planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    await mod.resourceClosedIpo(IPO_ID, liveDeps(planRepo));
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

  it('(§6.2, MAJOR-1) a PARTIAL/FAILED IPO is not re-picked at the running version, IS re-picked once the MANIFEST changes; DONE never is', async () => {
    await seedListedIpoWithPendingRhp();
    const { loadFieldManifest } = await import('../../src/config/field-manifest-loader.js');
    const { EXTRACTOR_VERSION } = await import('../../src/services/filing-auto-persist.js');
    const m = loadFieldManifest();
    const version = (fields: unknown) =>
      mod.closedIpoResourcingVersion({
        manifestVersion: m.version,
        manifestFieldsHash: mod.manifestFieldsHash(fields),
        extractorVersion: EXTRACTOR_VERSION,
      });
    const vNow = version(m.fields);
    const firstKey = Object.keys(m.fields)[0];
    const vNext = version({ ...m.fields, [firstKey]: { ...(m.fields as Record<string, object>)[firstKey], _rankEdit: 1 } });
    expect(vNext).not.toBe(vNow);

    const picked = async (v: string) =>
      (await mod.selectClosedIpoCandidates(db as never, v, 100000)).some((c) => c.id === IPO_ID);
    const setRow = (outcome: string) =>
      db.execute(sql`
        INSERT INTO closed_ipo_resourcing (ipo_id, first_attempt_at, last_attempt_at, attempts, outcome, cause_class, fields_written, fields_left_empty, resourced_at_version)
        VALUES (${IPO_ID}::uuid, now(), now(), 1, ${outcome}::closed_ipo_resourcing_outcome,
                CASE WHEN ${outcome} = 'DONE' THEN NULL ELSE 'DOCUMENT_UNOBTAINABLE'::closed_ipo_resourcing_cause_class END, 0, 0, ${vNow})
        ON CONFLICT (ipo_id) DO UPDATE SET outcome = EXCLUDED.outcome, cause_class = EXCLUDED.cause_class,
          resourced_at_version = EXCLUDED.resourced_at_version`);

    expect(await picked(vNow)).toBe(true); // never attempted: eligible
    const seen: string[] = [];
    for (const outcome of ['PARTIAL', 'FAILED']) {
      await setRow(outcome);
      const same = await picked(vNow);
      const next = await picked(vNext);
      seen.push(`${outcome}: same-version ${same}, new-manifest ${next}`);
      expect(same).toBe(false);
      expect(next).toBe(true);
    }
    await setRow('DONE');
    const doneSame = await picked(vNow);
    const doneNext = await picked(vNext);
    seen.push(`DONE: same-version ${doneSame}, new-manifest ${doneNext}`);
    expect(doneSame).toBe(false);
    expect(doneNext).toBe(false);
    // eslint-disable-next-line no-console
    console.log(`MAJOR-1 PROOF: vNow=${vNow} vNext=${vNext}; ${seen.join('; ')}`);
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

  it('(F-31, MAJOR-3) the field_sources snapshot for the selected IPOs is written and reads back', async () => {
    await seedListedIpoWithPendingRhp();
    await db.execute(sql`INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, previous_value, previous_source)
                          VALUES (${IPO_ID}::uuid, 'ipos', '', 'issueSize', 'CHITTORGARH', '19.2', 'BSE')`);
    const snap = await import('../../src/scheduler/closed-ipo-snapshot.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'f31-'));
    const written = await snap.writeFieldSourcesSnapshot(db as never, [IPO_ID], { dir });
    const back = snap.readFieldSourcesSnapshot(written.path);
    // eslint-disable-next-line no-console
    console.log(`F-31 PROOF: ${written.path} rows=${written.rows} readBack=${back.fieldSources.length} ipos=${back.ipos.length}`);
    expect(written.rows).toBe(1);
    expect(back.ipoIds).toEqual([IPO_ID]);
    expect(back.fieldSources[0]).toMatchObject({ field_name: 'issueSize', previous_value: '19.2', previous_source: 'BSE' });
    expect(back.ipos[0]).toMatchObject({ id: IPO_ID });
  });
});
