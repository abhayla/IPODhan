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
  closedIpoCandidatesQuery,
  CLOSED_IPO_JOB_DEFAULT_CAP,
  CLOSED_IPO_VERSION_MAX_LENGTH,
  closedIpoResourcingVersion,
  isClosedIpoJobDue,
} from '../../../src/scheduler/closed-ipo-job.js';
import { loadFieldManifest } from '../../../src/config/field-manifest-loader.js';
import { fieldManifestFingerprint } from '@ipodhan/shared/utils/field-manifest-fingerprint';
import { PgDialect } from 'drizzle-orm/pg-core';

/** The EXECUTED selection, rendered to text the way node-postgres receives it. */
function renderedSelection() {
  return new PgDialect().sqlToQuery(closedIpoCandidatesQuery('v-now', 10));
}
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();

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

  it('(g) never-walked first (OD-78), then newest closed first -- close_date DESC, per spec §6.1 rules 2-3', () => {
    // `false` sorts before `true`: rows with no closed_ipo_resourcing row lead,
    // so a re-pickable PARTIAL/FAILED never takes a slot a never-walked IPO wants.
    expect(CLOSED_IPO_CANDIDATES_SQL).toMatch(/ORDER BY\s+\(r\.ipo_id IS NOT NULL\),\s+i\.close_date DESC,\s+i\.id/);
    // #873's pending-document ranking is gone: OD-76's walk never reads a
    // document, so that count ranked IPOs by work this job cannot do.
    expect(CLOSED_IPO_CANDIDATES_SQL).not.toMatch(/extraction_status = 'PENDING'/);
  });
});

// OD-81 (owner 2026-09-23): a FIELDS_PENDING IPO is re-picked only on an event.
// Asserted on the EXECUTED template (rendered), so removing a clause from the
// query that runs turns these red; the integration test proves each on ipodhan_test.
describe('closedIpoCandidatesQuery — OD-81 FIELDS_PENDING events', () => {
  it('the executed query IS the readable constant (only the placeholders differ), and binds version + cap', () => {
    const q = renderedSelection();
    expect(norm(q.sql)).toBe(norm(CLOSED_IPO_CANDIDATES_SQL));
    expect(q.params).toEqual(['v-now', 10]);
  });

  it('event (1) stage change (#932): the FORWARD step recorded CLOSED -> LISTED now', () => {
    expect(norm(renderedSelection().sql)).toContain(
      norm(`(upper(r.status_at_attempt) = 'CLOSED' AND upper(i.status::text) = 'LISTED')`)
    );
  });

  it('event (1) never fires on a backward flip or "any difference" (#932 round 1: LISTED -> CLOSED is not a stage change)', () => {
    const t = norm(renderedSelection().sql);
    expect(t).not.toMatch(/IS DISTINCT FROM upper\(r\.status_at_attempt\)/);
    expect(t).not.toMatch(/status_at_attempt\) = 'LISTED'/);
  });

  it('event (1) legacy rule (#932): a row with NO recorded status (attempted before 0063) falls back to the listing_date inference', () => {
    expect(norm(renderedSelection().sql)).toContain(
      norm(
        `(r.status_at_attempt IS NULL AND upper(i.status::text) = 'LISTED' AND i.listing_date >= (r.last_attempt_at AT TIME ZONE 'Asia/Kolkata')::date)`
      )
    );
  });

  it('event (1) never infers from listing_date once a status is recorded (#932 case a/b)', () => {
    // The only listing_date comparison left is the one guarded by `status_at_attempt IS NULL`.
    const t = norm(renderedSelection().sql);
    expect(t.match(/i\.listing_date/g)).toHaveLength(1);
    expect(t).toMatch(/r\.status_at_attempt IS NULL AND upper\(i\.status::text\) = 'LISTED' AND i\.listing_date/);
  });

  it('event (2) new document: a document_fetch_state row first seen after the last attempt (naive UTC column read AT TIME ZONE UTC)', () => {
    expect(norm(renderedSelection().sql)).toContain(
      norm(`EXISTS ( SELECT 1 FROM document_fetch_state d WHERE d.ipo_id = i.id AND (d.first_seen_at AT TIME ZONE 'UTC') > r.last_attempt_at )`)
    );
  });

  it('event (3) rankings change keeps OD-78: every PARTIAL/FAILED row re-opens on a new version', () => {
    expect(norm(renderedSelection().sql)).toContain(
      norm(`OR (r.outcome IN ('PARTIAL', 'FAILED') AND r.resourced_at_version IS DISTINCT FROM $1)`)
    );
  });

  it('events (1)/(2) apply ONLY to PARTIAL / FIELDS_PENDING -- no other cause, no timer', () => {
    const t = norm(renderedSelection().sql);
    expect(t).toContain(norm(`OR ( r.outcome = 'PARTIAL' AND r.cause_class = 'FIELDS_PENDING' AND (`));
    expect(t).not.toMatch(/now\(\)|interval/i);
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
      snapshotFieldSources: async () => ({ path: 'snap.json', rows: 0 }),
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
      snapshotFieldSources: async () => ({ path: 'snap.json', rows: 0 }),
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
      snapshotFieldSources: async () => ({ path: 'snap.json', rows: 0 }),
    });
    expect(stub.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflict = stub.onConflictDoUpdate.mock.calls[0][0];
    expect(conflict.set.resourcedAtVersion).toBe('v2');
  });

  it('(#932) records the status the IPO had when it was selected, on insert AND on update, including an attempt that threw', async () => {
    const stub = makeStubDb([
      { id: 'ipo-closed', closeDate: '2026-09-01', status: 'CLOSED' },
      { id: 'ipo-listed', closeDate: '2026-08-01', status: 'LISTED' },
    ]);
    await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async (id: string) => {
        if (id === 'ipo-listed') throw new Error('BSE timed out');
        return okResult;
      },
      resourcedAtVersion: 'v1',
      snapshotFieldSources: async () => ({ path: 'snap.json', rows: 0 }),
    });
    const inserted = Object.fromEntries(stub.values.mock.calls.map((c) => [c[0].ipoId, c[0].statusAtAttempt]));
    expect(inserted).toEqual({ 'ipo-closed': 'CLOSED', 'ipo-listed': 'LISTED' });
    const updated = stub.onConflictDoUpdate.mock.calls.map((c) => c[0].set.statusAtAttempt);
    expect(updated).toEqual(['CLOSED', 'LISTED']);
  });

  it('reports a run that found nothing distinctly from one that was locked out', async () => {
    const stub = makeStubDb([]);
    const summary = await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async () => okResult,
      resourcedAtVersion: 'v1',
      snapshotFieldSources: async () => ({ path: 'snap.json', rows: 0 }),
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
 * §6.2 (review round 1 MAJOR-1): resourced_at_version is the extractor/manifest
 * version, derived -- never a hand-bumped job constant.
 */
describe('closedIpoResourcingVersion', () => {
  const base = { ranksHash: 'a'.repeat(64), extractorVersion: 'extract_filing.py@2026-09-03' };

  it('changes when the source-rankings fingerprint changes', () => {
    expect(closedIpoResourcingVersion({ ...base, ranksHash: 'b'.repeat(64) })).not.toBe(closedIpoResourcingVersion(base));
  });

  it('changes when the extractor version changes (§6.2 "extractor/manifest version")', () => {
    expect(closedIpoResourcingVersion({ ...base, extractorVersion: 'extract_filing.py@2026-10-01' })).not.toBe(
      closedIpoResourcingVersion(base)
    );
  });

  it('is stable for the same inputs, and fits the repair marker inside varchar(50)', () => {
    expect(closedIpoResourcingVersion(base)).toBe(closedIpoResourcingVersion({ ...base }));
    expect(closedIpoResourcingVersion(base).length).toBeLessThanOrEqual(CLOSED_IPO_VERSION_MAX_LENGTH);
    expect(
      closedIpoResourcingVersion({ ...base, extractorVersion: 'x'.repeat(80) }).length
    ).toBeLessThanOrEqual(CLOSED_IPO_VERSION_MAX_LENGTH);
  });
});

/**
 * OD-78 (review round 2 NEW-1): the version that re-opens PARTIAL/FAILED rows is
 * the ranks-and-capability fingerprint -- the rank lists and capable flags, NOT
 * any manifest edit. Driven on the REAL manifest.
 */
describe('resourcing fingerprint = fieldManifestFingerprint (OD-78, OD-82)', () => {
  type F = Record<string, { rank: Record<string, string[]>; capability: Record<string, { capable: boolean; reason: string }> } & Record<string, unknown>>;
  const real = () => structuredClone(loadFieldManifest().fields) as unknown as F;
  const firstKey = (f: F) => Object.keys(f)[0];
  const firstSource = (f: F) => Object.keys(f[firstKey(f)].capability)[0];

  it('is deterministic on the real manifest', () => {
    expect(fieldManifestFingerprint(real())).toBe(fieldManifestFingerprint(real()));
  });

  it('does NOT change when only a capability reason text changes', () => {
    const f = real();
    const h = fieldManifestFingerprint(f);
    f[firstKey(f)].capability[firstSource(f)].reason = 'reworded, same meaning';
    expect(fieldManifestFingerprint(f)).toBe(h);
  });

  it('does NOT change for other non-rank edits (unit, class, notes, an added key) or key order', () => {
    const f = real();
    const h = fieldManifestFingerprint(f);
    const k = firstKey(f);
    (f[k] as Record<string, unknown>).unit = 'keep';
    (f[k] as Record<string, unknown>)._note = 'annotation';
    const reordered = Object.fromEntries(Object.entries(f).reverse()) as F;
    expect(fieldManifestFingerprint(reordered)).toBe(h);
  });

  it('DOES change when a rank list changes order', () => {
    const f = real();
    const k = Object.keys(f).find((key) => Object.values(f[key].rank).some((l) => l.length >= 2))!;
    const t = Object.keys(f[k].rank).find((type) => f[k].rank[type].length >= 2)!;
    const h = fieldManifestFingerprint(f);
    f[k].rank[t] = [...f[k].rank[t]].reverse();
    expect(fieldManifestFingerprint(f)).not.toBe(h);
  });

  it('DOES change when a capable flag flips', () => {
    const f = real();
    const h = fieldManifestFingerprint(f);
    const cap = f[firstKey(f)].capability[firstSource(f)];
    cap.capable = !cap.capable;
    expect(fieldManifestFingerprint(f)).not.toBe(h);
  });

  it("OD-82: DOES change the resourcing version when ONLY a DOC field's documentType changes", () => {
    const f = real() as unknown as Record<string, F[string] & { documentType?: string }>;
    const k = Object.keys(f).find((key) => typeof f[key].documentType === 'string');
    expect(k).toBeTruthy();
    const version = () =>
      closedIpoResourcingVersion({ ranksHash: fieldManifestFingerprint(f), extractorVersion: 'extract_filing.py@test' });
    const before = version();
    f[k!].documentType = f[k!].documentType === 'PROSPECTUS' ? 'RHP' : 'PROSPECTUS';
    expect(version()).not.toBe(before);
  });
});

/**
 * F-31 (§6.4, review round 1 MAJOR-3): the field_sources snapshot is taken
 * BEFORE the first closed IPO is walked, and a failed snapshot walks nothing.
 */
describe('runClosedIpoJob — F-31 snapshot', () => {
  const rows = [
    { id: 'ipo-a', closeDate: '2026-09-20', status: 'LISTED' },
    { id: 'ipo-b', closeDate: '2026-09-10', status: 'LISTED' },
  ];

  it('snapshots the selected IPOs before the first resourceIpo call', async () => {
    const stub = makeStubDb(rows);
    const order: string[] = [];
    const summary = await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async (id) => {
        order.push(`walk:${id}`);
        return okResult;
      },
      resourcedAtVersion: 'v1',
      snapshotFieldSources: async (ids) => {
        order.push(`snapshot:${ids.join(',')}`);
        return { path: '/tmp/snap.json', rows: 7 };
      },
    });
    expect(order).toEqual(['snapshot:ipo-a,ipo-b', 'walk:ipo-a', 'walk:ipo-b']);
    expect(summary.snapshot).toEqual({ path: '/tmp/snap.json', rows: 7 });
  });

  it('a failed snapshot walks NO IPO and writes no ledger row', async () => {
    const stub = makeStubDb(rows);
    const resourceIpo = vi.fn(async () => okResult);
    await expect(
      runClosedIpoJob({
        db: stub.db,
        isCycleLockHeld: async () => false,
        resourceIpo,
        resourcedAtVersion: 'v1',
        snapshotFieldSources: async () => {
          throw new Error('EACCES');
        },
      })
    ).rejects.toThrow(/F-31.*no IPO walked.*EACCES/);
    expect(resourceIpo).not.toHaveBeenCalled();
    expect(stub.insert).not.toHaveBeenCalled();
  });

  it('takes no snapshot when nothing was selected', async () => {
    const stub = makeStubDb([]);
    const snapshotFieldSources = vi.fn();
    await runClosedIpoJob({
      db: stub.db,
      isCycleLockHeld: async () => false,
      resourceIpo: async () => okResult,
      resourcedAtVersion: 'v1',
      snapshotFieldSources,
    });
    expect(snapshotFieldSources).not.toHaveBeenCalled();
  });
});
