// implements: OD-163(b) the one answers-only round, LISTED IPOs inside the 22:00 closed-IPO job (item 42, #1468)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
import { inArray, sql, eq } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout.
import * as schema from '../../../packages/shared/src/db/schema';

/**
 * #1468 round 1 (MAJOR-1, MINOR-1), proven on ipodhan_test against the REAL selection query
 * (`selectClosedIpoCandidates`) and the REAL answers-round store (`buildAnswersRoundStore`).
 *
 * The class: every LISTED IPO whose answers-only round never completed (`answers_round_at IS NULL`),
 * whatever its closed_ipo_resourcing outcome -- 237 of 304 LISTED IPOs on staging are PARTIAL and not
 * re-eligible, and a DONE row is never re-picked (2026-10-02, docs/design/probes/
 * item42-listed-round-backlog.out.json). Before this fix the job never selected them, so they never
 * got the round, and a round cut by the 60 s budget was never resumed.
 *
 * To run: docs/ops/prod-ops-recipes.md §7. DATABASE_URL unset = "no tests", exit 0: read the COUNT.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'item 42: SKIPPED -- DATABASE_URL not set';

const DONE_LISTED = '00000000-0000-4000-8000-000000042101';
const NEVER_WALKED = '00000000-0000-4000-8000-000000042102';
const DUE_REPICK = '00000000-0000-4000-8000-000000042103';
const DONE_CLOSED = '00000000-0000-4000-8000-000000042104';
const STORE_IPO = '00000000-0000-4000-8000-000000042105';
const ALL = [DONE_LISTED, NEVER_WALKED, DUE_REPICK, DONE_CLOSED, STORE_IPO];
const VERSION = 'item42-answers-round-test-version';

describe.skipIf(!DATABASE_URL)(`item 42: answers-only round selection and store (${RUN_LABEL})`, () => {
  let db: ReturnType<typeof drizzle>;
  let job: typeof import('../../src/scheduler/closed-ipo-job.js');
  let round: typeof import('../../src/services/field-plan-answers-round.js');

  async function clean() {
    await db.delete(schema.closedIpoResourcing).where(inArray(schema.closedIpoResourcing.ipoId, ALL));
    await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, ALL));
    await db.delete(schema.ipoFieldPlan).where(inArray(schema.ipoFieldPlan.ipoId, ALL));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, ALL));
  }

  async function seedIpo(id: string, status: 'LISTED' | 'CLOSED', closeDate: string) {
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, segment, listing_exchanges, status, open_date, close_date)
      VALUES (${id}::uuid, ${'Item 42 fixture ' + id.slice(-3)}, ${'item42-answers-round-' + id.slice(-3)}, 'MAINBOARD',
              'MAINBOARD', '["NSE","BSE"]'::jsonb, ${status}, '2025-01-01', ${closeDate})`);
  }

  async function seedResourcing(id: string, outcome: 'DONE' | 'PARTIAL', version: string) {
    await db.execute(sql`
      INSERT INTO closed_ipo_resourcing (ipo_id, first_attempt_at, last_attempt_at, attempts, outcome, cause_class,
                                         fields_written, fields_left_empty, resourced_at_version, status_at_attempt)
      VALUES (${id}::uuid, now(), now(), 1, ${outcome}::closed_ipo_resourcing_outcome,
              ${outcome === 'PARTIAL' ? 'SOURCE_UNREACHABLE' : null}, 1, 0, ${version}, 'LISTED')`);
  }

  const wide = (answersRound: boolean) => job.selectClosedIpoCandidates(db as never, VERSION, 100000, answersRound);

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    // The shared helper refuses anything but ipodhan_test, before connecting and on the live session (#1364, #640).
    db = await getTestDb();
    job = await import('../../src/scheduler/closed-ipo-job.js');
    round = await import('../../src/services/field-plan-answers-round.js');
  });

  beforeEach(async () => {
    if (!DATABASE_URL) return;
    await clean();
    await seedIpo(DONE_LISTED, 'LISTED', '2025-03-10');
    await seedResourcing(DONE_LISTED, 'DONE', VERSION);
    await seedIpo(NEVER_WALKED, 'LISTED', '2025-01-10');
    await seedIpo(DUE_REPICK, 'LISTED', '2025-02-10');
    await seedResourcing(DUE_REPICK, 'PARTIAL', 'an-older-version');
    await seedIpo(DONE_CLOSED, 'CLOSED', '2025-03-11');
    await seedResourcing(DONE_CLOSED, 'DONE', VERSION);
  });

  afterAll(async () => {
    if (!DATABASE_URL) return;
    await clean();
    await cleanupTestDb();
  });

  it('selects a LISTED IPO with a DONE row and answers_round_at NULL, labelled answersOnly, only when answersRound is on', async () => {
    const on = await wide(true);
    const pick = on.find((c) => c.id === DONE_LISTED);
    expect(pick).toBeDefined();
    expect(pick!.answersOnly).toBe(true);
    expect((await wide(false)).some((c) => c.id === DONE_LISTED)).toBe(false);
  });

  it('is the LOWEST priority: after the never-walked IPO and the due re-pick, though it closed most recently', async () => {
    const ids = (await wide(true)).map((c) => c.id);
    const at = (id: string) => ids.indexOf(id);
    expect(at(NEVER_WALKED)).toBeGreaterThanOrEqual(0);
    expect(at(DUE_REPICK)).toBeGreaterThanOrEqual(0);
    expect(at(NEVER_WALKED)).toBeLessThan(at(DONE_LISTED));
    expect(at(DUE_REPICK)).toBeLessThan(at(DONE_LISTED));
    const rows = await wide(true);
    expect(rows.find((c) => c.id === NEVER_WALKED)!.answersOnly).toBe(false);
    expect(rows.find((c) => c.id === DUE_REPICK)!.answersOnly).toBe(false);
  });

  it('inside the cap: with cap 1 and a due re-pick waiting, the answers-only pick never takes the slot', async () => {
    // Every other selectable row in ipodhan_test sorts the same way, so the answers-only fixture
    // can only appear once no due pick remains: it never displaces one.
    const capped = await job.selectClosedIpoCandidates(db as never, VERSION, 1, true);
    expect(capped).toHaveLength(1);
    expect(capped[0].id).not.toBe(DONE_LISTED);
    expect(capped[0].answersOnly).toBe(false);
  });

  it('never selects a CLOSED IPO for the round (LISTED only: CLOSED runs it in the document cycle)', async () => {
    expect((await wide(true)).some((c) => c.id === DONE_CLOSED)).toBe(false);
  });

  it('once the round is stamped the IPO is never selected for it again; a round left unstamped is selected again', async () => {
    const store = round.buildAnswersRoundStore(db as never);
    expect((await wide(true)).some((c) => c.id === DONE_LISTED)).toBe(true);
    expect(await store.markRoundDone(DONE_LISTED)).toBe(true);
    expect((await wide(true)).some((c) => c.id === DONE_LISTED)).toBe(false);
  });

  describe('the REAL answers-round store', () => {
    beforeEach(async () => {
      await seedIpo(STORE_IPO, 'OPEN' as never, '2099-01-01');
      for (const fieldName of ['issue_size', 'lot_size', 'face_value', 'min_investment']) {
        await db.insert(schema.ipoFieldPlan).values({ ipoId: STORE_IPO, tableName: 'ipos', rowKey: '', fieldName, manifestVersion: 1 });
      }
      const row = (fieldName: string, witnesses: unknown, updatedAt: Date) => ({
        ipoId: STORE_IPO,
        tableName: 'ipos',
        rowKey: '',
        fieldName,
        source: 'NSE' as never,
        witnesses: witnesses as never,
        updatedAt,
      });
      await db.insert(schema.fieldSources).values([
        row('issueSize', null, new Date('2026-01-01T00:00:00Z')),
        row('lotSize', [{ source: 'NSE', outcome: 'SUPPLIED', value: 100 }], new Date('2026-06-01T00:00:00Z')),
        row('faceValue', [], new Date('2026-06-01T00:00:00Z')),
      ]);
      // min_investment has a plan row and NO stored value: never a candidate (nothing to witness).
    });

    it('lists stored values with no answers (NULL or empty), matching snake plan rows to camelCase field_sources rows', async () => {
      const store = round.buildAnswersRoundStore(db as never);
      const got = (await store.listUnanswered(STORE_IPO, null)).map((c) => c.fieldName).sort();
      expect(got).toEqual(['face_value', 'issue_size']);
    });

    it('writtenAfter (OD-163(a)): only values whose row was written after the stamp', async () => {
      const store = round.buildAnswersRoundStore(db as never);
      const got = (await store.listUnanswered(STORE_IPO, new Date('2026-03-01T00:00:00Z'))).map((c) => c.fieldName);
      expect(got).toEqual(['face_value']);
    });

    it('markRoundDone stamps once (isNull guard): the second call stamps nothing and keeps the first time', async () => {
      const store = round.buildAnswersRoundStore(db as never);
      expect((await store.readIpo(STORE_IPO))!.answersRoundAt).toBeNull();
      expect(await store.markRoundDone(STORE_IPO)).toBe(true);
      const first = (await store.readIpo(STORE_IPO))!.answersRoundAt;
      expect(first).toBeInstanceOf(Date);
      expect(await store.markRoundDone(STORE_IPO)).toBe(false);
      const [after] = await db.select({ at: schema.ipos.answersRoundAt }).from(schema.ipos).where(eq(schema.ipos.id, STORE_IPO));
      expect(after.at!.getTime()).toBe(first!.getTime());
    });
  });
});
