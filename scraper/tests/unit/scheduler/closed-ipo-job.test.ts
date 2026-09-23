/**
 * Item 17 (OD-22): the closed-IPO job.
 *
 * The cases below are the build card's own list, not invented here. They split
 * into two kinds, and the distinction matters for what each one proves:
 *
 *   - SELECTION rules are asserted against `CLOSED_IPO_CANDIDATES_SQL` as text,
 *     because the executed query is a bound `sql` template and a unit test
 *     without a database cannot run it. Each assertion names the clause that
 *     enforces the rule, so a change that drops the clause turns the test red.
 *   - BEHAVIOUR rules drive the real `runClosedIpoJob` with a stub db.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  runClosedIpoJob,
  CLOSED_IPO_CANDIDATES_SQL,
  CLOSED_IPO_JOB_DEFAULT_CAP,
  isClosedIpoJobDue,
} from '../../../src/scheduler/closed-ipo-job.js';

function makeStubDb(rows: Array<{ id: string; closeDate: string; status: string }> = []) {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  const execute = vi.fn().mockResolvedValue({ rows });
  return { db: { insert, execute } as never, insert, values, onConflictDoUpdate, execute };
}

const okResult = { outcome: 'DONE' as const, fieldsWritten: 3, fieldsLeftEmpty: 0 };

describe('CLOSED_IPO_CANDIDATES_SQL — the four selection rules', () => {
  it('(a,c) selects only LISTED and CLOSED — an UPCOMING or OPEN IPO can never match', () => {
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/upper\(i\.status::text\) IN \('LISTED', 'CLOSED'\)/);
    expect(CLOSED_IPO_CANDIDATES_SQL).not.toMatch(/'UPCOMING'|'OPEN'/);
  });

  it('(b) close_date is STRICTLY before today — an IPO that closed TODAY is excluded', () => {
    // `<=` here would pull in an IPO still settling, on the same evening the
    // live path is working it. The strictness is the rule, not a detail.
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/i\.close_date < CURRENT_DATE/);
    expect(CLOSED_IPO_CANDIDATES_SQL).not.toMatch(/close_date <= CURRENT_DATE/);
  });

  it('(d) a DONE outcome is never re-selected — only PARTIAL and FAILED are', () => {
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/r\.outcome IN \('PARTIAL', 'FAILED'\)/);
  });

  it('(e,f) a failed IPO returns only when the version that failed it has changed', () => {
    // IS DISTINCT FROM, not <>: a NULL version on either side must still count
    // as "different", and <> would silently drop those rows.
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/resourced_at_version IS DISTINCT FROM/);
    expect(CLOSED_IPO_CANDIDATES_SQL).not.toMatch(/resourced_at_version <>/);
  });

  it('never-attempted IPOs are included — the LEFT JOIN is what makes the first pass possible', () => {
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/LEFT JOIN closed_ipo_resourcing/);
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/r\.ipo_id IS NULL/);
  });

  it('(g) most-stuck first, with recency only as the tie-break (#873)', () => {
    // The card's rule (g) said "newest-closed first, so the freshest backlog
    // drains before the oldest". The premise was wrong and staging disproved
    // it before the job ever ran: the backlog is not the freshest rows, it is
    // the OLDEST ones, which is why nothing had re-visited them. Recency
    // survives as the tie-break; need decides. See the #873 block below.
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/ORDER BY e\.need DESC, e\."closeDate" DESC/);
    expect(CLOSED_IPO_CANDIDATES_SQL).not.toMatch(/ORDER BY\s+(i\.close_date|e\."closeDate") DESC/);
  });
});

describe('runClosedIpoJob — behaviour', () => {
  it('refuses to start while the data job holds scraper:cycle, and touches nothing', async () => {
    const stub = makeStubDb();
    const resourceIpo = vi.fn();
    const summary = await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => true,
      resourceIpo,
      resourcedAtVersion: 'v1',
    });
    expect(summary.skippedCycleLockHeld).toBe(true);
    expect(summary.attempted).toBe(0);
    // The important half: not merely "returned early" but "did no work".
    expect(resourceIpo).not.toHaveBeenCalled();
    expect(stub.execute).not.toHaveBeenCalled();
    expect(stub.insert).not.toHaveBeenCalled();
  });

  it('caps the run at ten IPOs by default', () => {
    expect(CLOSED_IPO_JOB_DEFAULT_CAP).toBe(10);
  });

  it('records every attempt, including one that threw, with a cause CLASS', async () => {
    const stub = makeStubDb([
      { id: 'ipo-ok', closeDate: '2026-09-01', status: 'LISTED' },
      { id: 'ipo-throws', closeDate: '2026-08-01', status: 'CLOSED' },
    ]);
    const resourceIpo = vi.fn(async (id: string) => {
      if (id === 'ipo-throws') throw new Error('NSE timed out');
      return okResult;
    });

    const summary = await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo,
      resourcedAtVersion: 'v1',
    });

    expect(summary.attempted).toBe(2);
    expect(summary.outcomes.DONE).toBe(1);
    expect(summary.outcomes.FAILED).toBe(1);
    // A throw must not lose the IPO: it is written as FAILED, so the next run
    // at a new version re-selects it rather than the row silently vanishing.
    expect(stub.values).toHaveBeenCalledTimes(2);
    const failedRow = stub.values.mock.calls.map((c) => c[0]).find((v) => v.ipoId === 'ipo-throws');
    expect(failedRow.outcome).toBe('FAILED');
    expect(failedRow.causeClass).toBe('SOURCE_UNREACHABLE');
    expect(failedRow.causeDetail).toMatch(/NSE timed out/);
  });

  it('upserts rather than inserting, so a second attempt updates the same IPO row', async () => {
    const stub = makeStubDb([{ id: 'ipo-1', closeDate: '2026-09-01', status: 'LISTED' }]);
    await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async () => okResult,
      resourcedAtVersion: 'v2',
    });
    expect(stub.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflict = stub.onConflictDoUpdate.mock.calls[0][0];
    expect(conflict.set.resourcedAtVersion).toBe('v2');
  });

  it('reports a run that found nothing distinctly from one that was locked out', async () => {
    const stub = makeStubDb([]);
    const summary = await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async () => okResult,
      resourcedAtVersion: 'v1',
    });
    // Both look like "did nothing" in a log line; they need different answers.
    expect(summary.skippedCycleLockHeld).toBe(false);
    expect(summary.candidatesConsidered).toBe(0);
    expect(summary.attempted).toBe(0);
  });
});

/**
 * The 22:00 IST due-check (build card, "Feature flag" section).
 *
 * Deliberately NOT a fifth entry in `DISCOVERY_SLOTS_IST_MINUTES`: inserting
 * 22:00 there would make the DATA job's own due-check treat 22:00 as one of
 * its slots, which is exactly what OD-19 forbids. This is a separate single
 * boundary, catch-up-safe the same way `isDiscoveryDue` is — a wake that
 * misses 22:00 (process down, long cycle) still fires on the next wake that
 * observes it, rather than waiting a whole day.
 */
describe('isClosedIpoJobDue', () => {
  // 2026-09-21 22:05 IST == 16:35Z the same day.
  const at = (iso: string) => new Date(iso);

  it('is due after 22:00 IST when it has never run', () => {
    expect(isClosedIpoJobDue(at('2026-09-21T16:35:00Z'), null)).toBe(true);
  });

  it('is NOT due before 22:00 IST on a day it already ran for the previous boundary', () => {
    // 2026-09-21 21:00 IST == 15:30Z. Last run was yesterday's 22:00 boundary
    // (2026-09-20 22:00 IST == 16:30Z on the 20th), so the most recent
    // boundary at-or-before now IS that one — already served.
    expect(isClosedIpoJobDue(at('2026-09-21T15:30:00Z'), at('2026-09-20T16:31:00Z'))).toBe(false);
  });

  it('is due again once the next 22:00 boundary passes', () => {
    expect(isClosedIpoJobDue(at('2026-09-21T16:35:00Z'), at('2026-09-20T16:31:00Z'))).toBe(true);
  });

  it('is NOT due twice for the same boundary', () => {
    // Ran at 22:05 IST, asked again at 23:30 IST the same evening.
    expect(isClosedIpoJobDue(at('2026-09-21T18:00:00Z'), at('2026-09-21T16:35:00Z'))).toBe(false);
  });

  it('catches up a missed boundary rather than skipping a day', () => {
    // Last ran two days ago; it is now 03:00 IST (21:30Z prior day) — the most
    // recent boundary is LAST NIGHT's 22:00, which was never served.
    expect(isClosedIpoJobDue(at('2026-09-21T21:30:00Z'), at('2026-09-19T16:35:00Z'))).toBe(true);
  });
});

/**
 * #873 — the ordering, which nothing pinned and which shipped wrong.
 *
 * The first version ordered `close_date DESC` alone: newest closures first.
 * Measured against staging before the job had ever run, that points it away
 * from its own purpose. The eligible population is 343 IPOs; the 74 holding a
 * stuck PENDING PROSPECTUS sit at ranks 156-294 (mean 231), because they are
 * OLD — which is precisely why nothing re-visited them. At ten per night the
 * job reached ZERO of them on night 1, zero by night 10, the first on night 16
 * and the last on night 30.
 *
 * Worse than idle: the job writes a `closed_ipo_resourcing` row for every IPO
 * it attempts and then excludes DONE ones, so those first fifteen nights would
 * CONSUME the slots on IPOs needing nothing, each marked DONE, while the log
 * read `attempted=10 done=10` every night. A green signal over an empty set.
 *
 * So the order is by NEED — count of un-extracted extractable documents —
 * with recency only as the tie-break.
 */
describe('#873: candidates are ordered by stuck-document count, not recency', () => {
  it('orders by the pending extractable-document count before close_date', () => {
    // The count subquery must come FIRST in the ORDER BY. Asserted as an
    // ordered pair rather than two independent matches, because both clauses
    // being present says nothing about which one decides.
    // Review round 1: the need-count is the UNREAD population (anything not
    // COMPLETED / MANUAL_REVIEW / NOT_EXTRACTABLE), computed as `need` and
    // ordered on first within each of the fresh / carried-over groups.
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/NOT IN \('COMPLETED', 'MANUAL_REVIEW', 'NOT_EXTRACTABLE'\)[\s\S]*AS need/);
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/ORDER BY e\.need DESC, e\."closeDate" DESC/);
  });

  it('counts only document types an extractor can actually read', () => {
    // Ordering by ALL pending documents would rank an IPO by the 65 rows whose
    // types have no extractor at all (#869) — work this job cannot do. The
    // count must be restricted to the four extractable types.
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(
      /'PRICE_BAND_AD'\s*,\s*'RHP'\s*,\s*'DRHP'\s*,\s*'PROSPECTUS'/
    );
  });

  it('does not order by close_date alone', () => {
    // The exact shape that shipped: a lone recency sort.
    expect(CLOSED_IPO_CANDIDATES_SQL).not.toMatch(/ORDER BY\s+i\.close_date DESC\s+LIMIT/);
  });
});

// ---------------------------------------------------------------------------
// #717: the job marked IPOs DONE without extracting the document it selected
// them for (staging 2026-09-23: 10 of 10 DONE, fields_written 0, 74 PROSPECTUS
// PENDING before and after).
// ---------------------------------------------------------------------------
import {
  applyPendingDocumentGuard,
  classifyExtractionPass,
  combineClosedIpoOutcomes,
  CLOSED_IPO_EXTRACTABLE_TYPES,
} from '../../../src/scheduler/closed-ipo-job.js';
import { EXTRACTABLE_DOC_TYPES } from '../../../src/services/filing-auto-persist.js';

const emptyPass = {
  ipoId: 'x', considered: 1, extracted: 0, persisted: 0, failed: 0, skipped: [] as string[], spawned: 0,
  skippedBudget: 0, anchorsConsidered: 0, anchorsSpawned: 0, anchorsPersisted: 0, anchorsManualReview: 0,
  anchorsFailed: 0,
};

describe('#717: DONE requires the selection signal to be resolved', () => {
  it('a DONE pass with an extractable document still PENDING is PARTIAL with a cause (the staging shape)', async () => {
    const stub = makeStubDb([{ id: 'ipo-1', closeDate: '2026-06-12', status: 'LISTED' }]);
    await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async () => ({ outcome: 'DONE', fieldsWritten: 0, fieldsLeftEmpty: 0 }),
      countUnreadExtractableDocuments: async () => ({ pending: 1, retrying: 0 }),
      resourcedAtVersion: 'v',
    });
    const written = stub.values.mock.calls[0][0];
    expect(written.outcome).toBe('PARTIAL');
    expect(written.causeClass).toBe('DOCUMENT_UNOBTAINABLE');
    expect(written.causeDetail).toMatch(/1 extractable document\(s\) still PENDING/);
  });

  it('DONE stays DONE only when nothing extractable is left PENDING', async () => {
    const stub = makeStubDb([{ id: 'ipo-1', closeDate: '2026-06-12', status: 'LISTED' }]);
    await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async () => ({ outcome: 'DONE', fieldsWritten: 0, fieldsLeftEmpty: 0 }),
      countUnreadExtractableDocuments: async () => ({ pending: 0, retrying: 0 }),
      resourcedAtVersion: 'v',
    });
    expect(stub.values.mock.calls[0][0].outcome).toBe('DONE');
  });

  it('the guard keeps a worker cause and never upgrades a PARTIAL/FAILED', () => {
    expect(applyPendingDocumentGuard({ outcome: 'DONE', causeClass: 'EXTRACTOR_MISSING', fieldsWritten: 0, fieldsLeftEmpty: 0 }, { pending: 2, retrying: 0 }).causeClass)
      .toBe('EXTRACTOR_MISSING');
    expect(applyPendingDocumentGuard({ outcome: 'FAILED', fieldsWritten: 0, fieldsLeftEmpty: 0 }, { pending: 0, retrying: 0 }).outcome).toBe('FAILED');
  });

  it('the worker receives the candidate row (it needs the company and segment to extract)', async () => {
    const stub = makeStubDb([{ id: 'ipo-1', closeDate: '2026-06-12', status: 'LISTED' }]);
    const resourceIpo = vi.fn().mockResolvedValue(okResult);
    await runClosedIpoJob({ db: stub.db, isCycleLockHeld: async () => false, resourceIpo, countUnreadExtractableDocuments: async () => ({ pending: 0, retrying: 0 }), resourcedAtVersion: 'v' });
    expect(resourceIpo.mock.calls[0][1]).toMatchObject({ id: 'ipo-1', status: 'LISTED' });
  });

  it('a transient PARTIAL (SOURCE_UNREACHABLE) is re-picked at the same version; others wait for a version change', () => {
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/OR \(r\.cause_class = 'SOURCE_UNREACHABLE' AND r\.attempts < \$3\)/);
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/r\.outcome IN \('PARTIAL', 'FAILED'\)/);
  });

  it('the guard counts the same four types the extractor handles', () => {
    expect([...CLOSED_IPO_EXTRACTABLE_TYPES].sort()).toEqual([...EXTRACTABLE_DOC_TYPES].map(String).sort());
  });
});

describe('#717: classifyExtractionPass', () => {
  it('extraction not run is PARTIAL with the caller-given cause', () => {
    const r = classifyExtractionPass({ attempted: false, causeClass: 'EXTRACTOR_MISSING', reason: 'flag off' });
    expect(r).toMatchObject({ outcome: 'PARTIAL', causeClass: 'EXTRACTOR_MISSING' });
  });
  it('a failed document is FAILED but TRANSIENT (review round 1 MAJOR-2), PARTIAL when another persisted', () => {
    expect(classifyExtractionPass({ attempted: true, result: { ...emptyPass, failed: 1 } }))
      .toMatchObject({ outcome: 'FAILED', causeClass: 'SOURCE_UNREACHABLE' });
    expect(classifyExtractionPass({ attempted: true, result: { ...emptyPass, failed: 1, persisted: 1 } }).outcome)
      .toBe('PARTIAL');
  });
  it('documents left for the spawn budget are transient PARTIAL', () => {
    expect(classifyExtractionPass({ attempted: true, result: { ...emptyPass, skippedBudget: 1 } }))
      .toMatchObject({ outcome: 'PARTIAL', causeClass: 'SOURCE_UNREACHABLE' });
  });
  it('a clean pass is DONE (still subject to the pending-document guard)', () => {
    expect(classifyExtractionPass({ attempted: true, result: { ...emptyPass, persisted: 1 } }).outcome).toBe('DONE');
  });
  it('combine keeps the worse outcome and its cause', () => {
    expect(combineClosedIpoOutcomes({ outcome: 'DONE' }, { outcome: 'PARTIAL', causeClass: 'WRITE_SKIPPED' }))
      .toMatchObject({ outcome: 'PARTIAL', causeClass: 'WRITE_SKIPPED' });
    expect(combineClosedIpoOutcomes({ outcome: 'FAILED', causeClass: 'VALIDATION_REJECTED' }, { outcome: 'PARTIAL' }).outcome).toBe('FAILED');
  });
});

// ---------------------------------------------------------------------------
// Review round 1 (PR #912): four MAJOR findings of one class -- the job
// recording progress (DONE, or a permanent verdict) that did not happen.
// ---------------------------------------------------------------------------
import { PgDialect } from 'drizzle-orm/pg-core';
import * as closedIpoJob from '../../../src/scheduler/closed-ipo-job.js';

const dialect = new PgDialect();
function renderedSql(stub: ReturnType<typeof makeStubDb>, call = 0): string {
  return dialect.sqlToQuery(stub.execute.mock.calls[call][0]).sql;
}

describe('review round 1 MAJOR-1: every UNREAD extractable document keeps the IPO open, not only PENDING', () => {
  it('a document FAILED-awaiting-retry (or IN_PROGRESS from a crash) makes a DONE pass PARTIAL and re-pickable', async () => {
    const stub = makeStubDb([{ id: 'ipo-1', closeDate: '2026-06-12', status: 'LISTED' }]);
    await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async () => ({ outcome: 'DONE', fieldsWritten: 0, fieldsLeftEmpty: 0 }),
      countUnreadExtractableDocuments: async () => ({ pending: 0, retrying: 1 }),
      resourcedAtVersion: 'v',
    } as never);
    const written = stub.values.mock.calls[0][0];
    expect(written.outcome).toBe('PARTIAL');
    expect(written.causeClass).toBe('SOURCE_UNREACHABLE');
    expect(written.causeDetail).toMatch(/^transient: 1 extractable document\(s\) awaiting retry/);
  });

  it('the recount query counts every status except COMPLETED, MANUAL_REVIEW and NOT_EXTRACTABLE', async () => {
    const stub = makeStubDb([{ pending: 2, retrying: 1 } as never]);
    const n = await (closedIpoJob as unknown as {
      countUnreadExtractableDocuments: (db: unknown, id: string) => Promise<{ pending: number; retrying: number }>;
    }).countUnreadExtractableDocuments(stub.db, 'ipo-1');
    expect(n).toEqual({ pending: 2, retrying: 1 });
    const q = renderedSql(stub);
    expect(q).toMatch(/NOT IN \('COMPLETED', 'MANUAL_REVIEW', 'NOT_EXTRACTABLE'\)/);
    expect(q).not.toMatch(/extraction_status = 'PENDING'/);
    // FAILED and IN_PROGRESS are split out as `retrying`: they make the pass transient, not permanent.
    expect(q).toMatch(/FILTER \(WHERE d\.extraction_status IN \('FAILED', 'IN_PROGRESS'\)\)::int AS retrying/);
  });

  it('the selection need-count uses the same unread population', () => {
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(
      /COALESCE\(d\.extraction_status, 'PENDING'\) NOT IN \('COMPLETED', 'MANUAL_REVIEW', 'NOT_EXTRACTABLE'\)/
    );
  });
});

describe('review round 1 MAJOR-2: an extractor failure or early return is transient and bounded, never permanent', () => {
  it('a failed document (timeout, crash) is SOURCE_UNREACHABLE (re-pickable), not VALIDATION_REJECTED', () => {
    const r = classifyExtractionPass({ attempted: true, result: { ...emptyPass, failed: 1, skipped: ['PROSPECTUS: timed out'] } });
    expect(r.causeClass).toBe('SOURCE_UNREACHABLE');
    expect(r.causeDetail).toMatch(/^transient: 1 document\(s\) failed/);
  });

  it('the spawn budget already spent before this IPO is reported as not attempted and transient', async () => {
    const pass = await closedIpoJob.extractClosedIpoDocuments(
      { id: 'ipo-1', closeDate: null, status: 'LISTED' },
      {
        spawnBudget: { remaining: 0 },
        anchorSpawnBudget: { remaining: 0 },
        loadDocuments: async () => { throw new Error('must not be reached'); },
        loadStates: async () => [],
      } as never
    );
    expect(pass.attempted).toBe(false);
    expect(classifyExtractionPass(pass)).toMatchObject({ outcome: 'PARTIAL', causeClass: 'SOURCE_UNREACHABLE' });
  });

  it('a throw while loading the documents is reported as not attempted and transient, not as a clean pass', async () => {
    const pass = await closedIpoJob.extractClosedIpoDocuments(
      { id: 'ipo-1', closeDate: null, status: 'LISTED', companyName: 'X Ltd.' },
      {
        loadDocuments: async () => { throw new Error('connection reset'); },
        loadStates: async () => [],
      } as never
    );
    expect(pass.attempted).toBe(false);
    const c = classifyExtractionPass(pass);
    expect(c.causeClass).toBe('SOURCE_UNREACHABLE');
    expect(c.causeDetail).toMatch(/connection reset/);
  });

  it('a transient row is re-picked at the same version only while attempts < the bound (the document cap)', async () => {
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/r\.cause_class = 'SOURCE_UNREACHABLE' AND r\.attempts < \$3/);
    const mod = closedIpoJob as unknown as { CLOSED_IPO_MAX_TRANSIENT_ATTEMPTS: number };
    const { MAX_EXTRACTION_ATTEMPTS } = await import('../../../src/services/filing-auto-persist.js');
    expect(mod.CLOSED_IPO_MAX_TRANSIENT_ATTEMPTS).toBe(MAX_EXTRACTION_ATTEMPTS);
    const stub = makeStubDb([]);
    await runClosedIpoJob({ db: stub.db, isCycleLockHeld: async () => false, resourceIpo: async () => okResult, resourcedAtVersion: 'v', maxTransientAttempts: 7 } as never);
    const q = dialect.sqlToQuery(stub.execute.mock.calls[0][0]);
    expect(q.sql).toMatch(/r\.attempts < \$\d+/);
    expect(q.params).toContain(7);
  });

  it('attempts is counted per version, so a version bump restarts the bound', async () => {
    const stub = makeStubDb([{ id: 'ipo-1', closeDate: '2026-09-01', status: 'LISTED' }]);
    await runClosedIpoJob({ db: stub.db, isCycleLockHeld: async () => false, resourceIpo: async () => okResult, countUnreadExtractableDocuments: async () => ({ pending: 0, retrying: 0 }), resourcedAtVersion: 'v9' } as never);
    const attempts = stub.onConflictDoUpdate.mock.calls[0][0].set.attempts;
    const rendered = dialect.sqlToQuery(attempts);
    expect(rendered.sql).toMatch(/CASE WHEN [\s\S]* = \$\d+\s+THEN [\s\S]* \+ 1 ELSE 1 END/);
    expect(rendered.params).toContain('v9');
  });

  it('a transient extraction half keeps the combined row re-pickable even when the walk half is worse', () => {
    const c = combineClosedIpoOutcomes(
      { outcome: 'PARTIAL', causeClass: 'SOURCE_UNREACHABLE', causeDetail: 'transient: x' },
      { outcome: 'FAILED', causeClass: 'WRITE_SKIPPED', causeDetail: 'db' }
    );
    expect(c).toMatchObject({ outcome: 'FAILED', causeClass: 'SOURCE_UNREACHABLE' });
  });
});

describe('review round 1 MAJOR-4: carried-over IPOs cannot starve newly closed ones', () => {
  const fresh = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `new-${i}`, closeDate: null, status: 'LISTED', isRepick: false }));
  const carried = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `old-${i}`, closeDate: null, status: 'LISTED', isRepick: true }));
  const allocate = () => (closedIpoJob as unknown as {
    allocateClosedIpoSlots: (rows: unknown[], cap: number, repick?: number) => Array<{ id: string }>;
  }).allocateClosedIpoSlots;

  it('with both backlogs full, carry-overs take at most 3 of 10 and new IPOs come first', () => {
    const out = allocate()([...carried(10), ...fresh(10)], 10);
    expect(out.map((r) => r.id)).toEqual([...fresh(7).map((r) => r.id), ...carried(3).map((r) => r.id)]);
    expect((closedIpoJob as unknown as { CLOSED_IPO_JOB_REPICK_SLOTS: number }).CLOSED_IPO_JOB_REPICK_SLOTS).toBe(3);
  });

  it('slots the new IPOs leave unused go back to carry-overs', () => {
    const out = allocate()([...carried(10), ...fresh(2)], 10);
    expect(out.length).toBe(10);
    expect(out.slice(0, 2).map((r) => r.id)).toEqual(['new-0', 'new-1']);
  });

  it('runClosedIpoJob attempts new IPOs before carry-overs, within the cap', async () => {
    const stub = makeStubDb([...carried(10), ...fresh(10)] as never);
    const order: string[] = [];
    await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async (id: string) => { order.push(id); return okResult; },
      countUnreadExtractableDocuments: async () => ({ pending: 0, retrying: 0 }),
      resourcedAtVersion: 'v',
    } as never);
    expect(order.length).toBe(10);
    expect(order.filter((id) => id.startsWith('old-')).length).toBe(3);
    expect(order[0]).toBe('new-0');
  });
});

// ---- Review round 2 (PR #912) ---------------------------------------------
// CLASS rule: an IPO's final outcome is permanent ONLY if every unread
// extractable document is itself permanently unobtainable. Any unread document
// that can still be retried makes the outcome re-pickable, whatever the walk said.
describe('review round 2 MAJOR: a permanent walk cause never masks a document waiting to retry', () => {
  it('reviewer probe (regression): clean extraction + walk DOCUMENT_UNOBTAINABLE + 1 retrying doc -> re-pickable', () => {
    const ext = classifyExtractionPass({
      attempted: true,
      result: { failed: 0, persisted: 0, skippedBudget: 0, skipped: ['doc backing off'] } as never,
    });
    const walk = { outcome: 'PARTIAL' as const, causeClass: 'DOCUMENT_UNOBTAINABLE' as const, causeDetail: 'x' };
    const c = combineClosedIpoOutcomes(ext, walk);
    const g = applyPendingDocumentGuard({ ...c, fieldsWritten: 0, fieldsLeftEmpty: 3 }, { pending: 0, retrying: 1 });
    expect(g.outcome).toBe('PARTIAL');
    expect(g.causeClass).toBe('SOURCE_UNREACHABLE');
    expect(g.causeDetail).toMatch(/^transient: 1 extractable document\(s\) awaiting retry/);
    expect(g.causeDetail).toMatch(/DOCUMENT_UNOBTAINABLE/); // the walk's cause is kept, not dropped
  });

  for (const permanent of ['DOCUMENT_UNOBTAINABLE', 'VALIDATION_REJECTED', 'WRITE_SKIPPED'] as const) {
    for (const outcome of ['PARTIAL', 'FAILED'] as const) {
      it(`${outcome}/${permanent} with a retrying document keeps its outcome but becomes re-pickable`, () => {
        const g = applyPendingDocumentGuard(
          { outcome, causeClass: permanent, causeDetail: 'walk said so', fieldsWritten: 0, fieldsLeftEmpty: 0 },
          { pending: 0, retrying: 2 }
        );
        expect(g.outcome).toBe(outcome);
        expect(g.causeClass).toBe('SOURCE_UNREACHABLE');
      });
    }
  }

  it('EXTRACTOR_MISSING (extraction switched off) stands: no document is retriable by this job', () => {
    const r = { outcome: 'PARTIAL' as const, causeClass: 'EXTRACTOR_MISSING' as const, fieldsWritten: 0, fieldsLeftEmpty: 0 };
    expect(applyPendingDocumentGuard(r, { pending: 0, retrying: 1 })).toEqual(r);
  });

  it('a permanent cause stands when every unread document is itself unobtainable (PENDING only, nothing retrying)', () => {
    const r = { outcome: 'PARTIAL' as const, causeClass: 'DOCUMENT_UNOBTAINABLE' as const, fieldsWritten: 0, fieldsLeftEmpty: 0 };
    expect(applyPendingDocumentGuard(r, { pending: 2, retrying: 0 })).toEqual(r);
  });

  it('runClosedIpoJob writes the re-pickable class for the probe shape', async () => {
    const stub = makeStubDb([{ id: 'ipo-1', closeDate: '2026-06-12', status: 'LISTED' }]);
    await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async () => ({ outcome: 'FAILED', causeClass: 'WRITE_SKIPPED', causeDetail: 'db', fieldsWritten: 0, fieldsLeftEmpty: 0 }),
      countUnreadExtractableDocuments: async () => ({ pending: 0, retrying: 1 }),
      resourcedAtVersion: 'v',
    });
    expect(stub.values.mock.calls[0][0]).toMatchObject({ outcome: 'FAILED', causeClass: 'SOURCE_UNREACHABLE' });
  });
});

describe('review round 2 MINOR-1: attempts advance only when a document read was attempted', () => {
  const run = async (documentReadAttempted: boolean | undefined, unread = { pending: 0, retrying: 1 }) => {
    const stub = makeStubDb([{ id: 'ipo-1', closeDate: '2026-06-12', status: 'LISTED' }]);
    await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async () => ({ outcome: 'DONE', fieldsWritten: 0, fieldsLeftEmpty: 0, documentReadAttempted }),
      countUnreadExtractableDocuments: async () => unread,
      resourcedAtVersion: 'v',
    } as never);
    return {
      inserted: stub.values.mock.calls[0][0].attempts,
      onConflict: dialect.sqlToQuery(stub.onConflictDoUpdate.mock.calls[0][0].set.attempts).sql,
    };
  };

  it('a night the document only backed off (no read attempted) does not spend an attempt', async () => {
    const r = await run(false);
    expect(r.inserted).toBe(0);
    expect(r.onConflict).not.toMatch(/\+ 1/);
  });

  it('a night a document read WAS attempted spends one', async () => {
    const r = await run(true);
    expect(r.inserted).toBe(1);
    expect(r.onConflict).toMatch(/\+ 1/);
  });

  it('with nothing unread to wait for, the attempt always counts (a pure source failure stays bounded)', async () => {
    const r = await run(false, { pending: 0, retrying: 0 });
    expect(r.inserted).toBe(1);
  });

  it('classifyExtractionPass reports whether a document read was attempted', () => {
    const base = { failed: 0, persisted: 0, skippedBudget: 0, skipped: [], spawned: 0, extracted: 0, anchorsSpawned: 0 };
    expect(classifyExtractionPass({ attempted: true, result: { ...base, skipped: ['backing off'] } as never }).documentReadAttempted).toBe(false);
    expect(classifyExtractionPass({ attempted: true, result: { ...base, spawned: 1, extracted: 1 } as never }).documentReadAttempted).toBe(true);
    expect(classifyExtractionPass({ attempted: true, result: { ...base, failed: 1 } as never }).documentReadAttempted).toBe(true);
    expect(classifyExtractionPass({ attempted: false, causeClass: 'SOURCE_UNREACHABLE', reason: 'lock' }).documentReadAttempted).toBe(false);
  });
});

describe('review round 2 MINOR-2: the run report separates a transient document retry from a source that is down', () => {
  it('labels SOURCE_UNREACHABLE by its transient: detail', () => {
    expect(closedIpoJob.closedIpoCauseLabel('SOURCE_UNREACHABLE', 'transient: 1 document(s) failed')).toBe('SOURCE_UNREACHABLE/transient');
    expect(closedIpoJob.closedIpoCauseLabel('SOURCE_UNREACHABLE', 'ECONNRESET')).toBe('SOURCE_UNREACHABLE');
    expect(closedIpoJob.closedIpoCauseLabel(undefined, undefined)).toBe('none');
  });

  it('the run summary counts outcomes per cause label', async () => {
    const stub = makeStubDb([
      { id: 'a', closeDate: '2026-06-12', status: 'LISTED' },
      { id: 'b', closeDate: '2026-06-12', status: 'LISTED' },
    ]);
    const summary = await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async (id: string) => {
        if (id === 'b') throw new Error('ECONNRESET');
        return { outcome: 'DONE' as const, fieldsWritten: 0, fieldsLeftEmpty: 0 };
      },
      countUnreadExtractableDocuments: async () => ({ pending: 0, retrying: 1 }),
      resourcedAtVersion: 'v',
    });
    expect(summary.causes).toEqual({ 'SOURCE_UNREACHABLE/transient': 1, SOURCE_UNREACHABLE: 1 });
  });
});
