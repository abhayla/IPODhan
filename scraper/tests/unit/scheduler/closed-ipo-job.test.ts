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

  it('(g) newest-closed first, so the freshest backlog drains before the oldest', () => {
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/ORDER BY i\.close_date DESC/);
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
