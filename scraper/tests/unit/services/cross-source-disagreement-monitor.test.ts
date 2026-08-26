/**
 * T-195: cross-source-disagreement-monitor.ts tests.
 *
 * Pre-fix, there was no reporting layer over the existing `data_conflicts`
 * rows (written by `data-consolidation-service.ts`) for OPEN IPOs -- an
 * admin had to know to go look. `checkCrossSourceDisagreements` (which does
 * not exist pre-fix) closes that: it queries unresolved conflicts for OPEN
 * IPOs restricted to price band / dates / GMP, and pages P1 for a HIGH-value
 * field (price band or dates) or a single aggregated P2 for GMP. These tests
 * fail against a codebase with no such module, and prove the empty-data path
 * (zero OPEN IPOs, or zero conflict rows) never alerts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  checkCrossSourceDisagreements,
  buildDisagreementActionBody,
  COMPARED_FIELDS,
  HIGH_VALUE_FIELDS,
} from '../../../src/services/cross-source-disagreement-monitor.js';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  process.env.NOTIFIER_URL = 'http://127.0.0.1:3300';
  process.env.NOTIFIER_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  delete process.env.NOTIFIER_URL;
  delete process.env.NOTIFIER_KEY;
});

/** Minimal chainable mock matching `db.select(...).from(...).where(...)` usage in the monitor. */
function makeDb(openIpoRows: Array<{ id: string; companyName: string }>, conflictRows: any[]) {
  const select = vi.fn();
  select
    .mockReturnValueOnce({
      from: () => ({
        where: () => Promise.resolve(openIpoRows),
      }),
    })
    .mockReturnValueOnce({
      from: () => ({
        where: () => Promise.resolve(conflictRows),
      }),
    });
  return { select } as any;
}

describe('checkCrossSourceDisagreements', () => {
  it('returns an empty report and never alerts when there are zero OPEN IPOs (cold-start / empty DB)', async () => {
    const db = makeDb([], []);

    const report = await checkCrossSourceDisagreements(db, new Date());

    expect(report).toEqual({ openIpoCount: 0, disagreements: [], highValueCount: 0, otherCount: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an empty disagreements list and never alerts when OPEN IPOs exist but have no unresolved conflicts', async () => {
    const db = makeDb([{ id: 'ipo-1', companyName: 'Acme Ltd' }], []);

    const report = await checkCrossSourceDisagreements(db, new Date());

    expect(report.openIpoCount).toBe(1);
    expect(report.disagreements).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fires one P1 notifyOwner per HIGH-value field disagreement (price band / dates)', async () => {
    const db = makeDb(
      [{ id: 'ipo-1', companyName: 'Acme Ltd' }],
      [
        {
          ipoId: 'ipo-1',
          fieldName: 'priceRangeMin',
          source1: 'NSE',
          value1: '100',
          source2: 'BSE',
          value2: '105',
        },
      ]
    );

    const report = await checkCrossSourceDisagreements(db, new Date('2026-08-18T12:00:00Z'));

    expect(report.highValueCount).toBe(1);
    expect(report.disagreements[0].severity).toBe('P1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3300/notify');
    const body = JSON.parse(init.body);
    expect(body.severity).toBe('P1');
    expect(body.title).toContain('Acme Ltd');
    expect(body.title).toContain('priceRangeMin');
  });

  it('aggregates GMP (non-HIGH-value) disagreements into a single P2 notifyOwner call', async () => {
    const db = makeDb(
      [
        { id: 'ipo-1', companyName: 'Acme Ltd' },
        { id: 'ipo-2', companyName: 'Beta Ltd' },
      ],
      [
        { ipoId: 'ipo-1', fieldName: 'gmpPrice', source1: 'INVESTORGAIN_GMP', value1: '50', source2: 'CHITTORGARH', value2: '65' },
        { ipoId: 'ipo-2', fieldName: 'gmpPercentage', source1: 'INVESTORGAIN_GMP', value1: '10', source2: 'CHITTORGARH', value2: '18' },
      ]
    );

    const report = await checkCrossSourceDisagreements(db, new Date());

    expect(report.otherCount).toBe(2);
    expect(report.highValueCount).toBe(0);
    // ONE aggregated call for both GMP conflicts, not two separate pages.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.severity).toBe('P2');
    expect(body.body).toContain('Acme Ltd');
    expect(body.body).toContain('Beta Ltd');
  });

  // T-276: the filter keys MUST be the names consolidation actually writes into
  // data_conflicts.field_name. They were snake_case (`price_band_min`, ...),
  // which matched zero rows, so the price-band alert was dead on arrival.
  it('uses only camelCase field keys — a snake_case key matches nothing in data_conflicts', () => {
    for (const f of COMPARED_FIELDS) {
      expect(f, `${f} is snake_case; consolidation writes camelCase keys`).not.toMatch(/_/);
    }
    for (const f of HIGH_VALUE_FIELDS) {
      expect(f, `${f} is snake_case; consolidation writes camelCase keys`).not.toMatch(/_/);
    }
  });

  // T-328 DoD item 5: the P1 alert body must state what the system DID
  // (held / tie-broke), not just the raw disagreeing values — that was the
  // pre-HOLD behaviour the reviewer flagged as "detection decoupled from
  // correction" (an alert saying 'wrong value published' with no mention
  // that the write path already held/corrected it).
  it('fires the P1 body reading resolutionReason/resolvedSource from the conflict row', async () => {
    const db = makeDb(
      [{ id: 'ipo-lumino', companyName: 'Lumino Industries Ltd' }],
      [
        {
          ipoId: 'ipo-lumino',
          fieldName: 'openDate',
          source1: 'NSE',
          value1: '2026-08-26',
          source2: 'CHITTORGARH',
          value2: '2026-08-27',
          resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
          resolvedSource: 'NSE',
        },
      ]
    );

    await checkCrossSourceDisagreements(db, new Date('2026-08-26T00:01:00Z'));

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.body).toContain('HELD');
    expect(body.body).toContain('2026-08-26');
    expect(body.body).not.toMatch(/^NSE="2026-08-26" vs CHITTORGARH="2026-08-27"/);
  });

  it('fires the P1 body stating TIE-BROKEN when resolutionReason is the T-327 interim rule', async () => {
    const db = makeDb(
      [{ id: 'ipo-annu', companyName: 'Annu Photovoltaic Ltd' }],
      [
        {
          ipoId: 'ipo-annu',
          fieldName: 'closeDate',
          source1: 'NSE',
          value1: '2026-08-28',
          source2: 'CHITTORGARH',
          value2: '2026-08-27',
          resolutionReason: 'TZ_SIGNATURE_TIEBREAK_PREFER_NON_NSE',
          resolvedSource: 'CHITTORGARH',
        },
      ]
    );

    await checkCrossSourceDisagreements(db, new Date('2026-08-26T00:01:00Z'));

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.body).toContain('TIE-BROKEN');
    expect(body.body).toContain('CHITTORGARH');
    expect(body.body).toContain('2026-08-27');
  });

  it('falls back to the raw-values description when no resolutionReason is recorded', () => {
    const body = buildDisagreementActionBody({
      ipoId: 'ipo-1',
      companyName: 'Acme Ltd',
      fieldName: 'priceRangeMin',
      source1: 'NSE',
      value1: '100',
      source2: 'BSE',
      value2: '105',
      severity: 'P1',
      resolutionReason: null,
      resolvedSource: null,
    });

    expect(body).toContain('NSE="100"');
    expect(body).toContain('BSE="105"');
    expect(body).not.toMatch(/HELD|TIE-BROKEN/);
  });

  it('classifies exactly priceRangeMin, priceRangeMax, openDate, closeDate as HIGH-value', () => {
    expect([...HIGH_VALUE_FIELDS].sort()).toEqual(
      ['closeDate', 'openDate', 'priceRangeMax', 'priceRangeMin'].sort()
    );
    expect(HIGH_VALUE_FIELDS.has('gmpPrice')).toBe(false);
    expect(HIGH_VALUE_FIELDS.has('gmpPercentage')).toBe(false);
  });

  // T-286 (P1-2 defense-in-depth): the conflict query MUST exclude rows where
  // source1 === source2 -- a same-source refresh is not a cross-source
  // disagreement. Rendered via drizzle's own PgDialect so this asserts the
  // ACTUAL SQL the `.where()` call builds, not just that some `ne` import
  // exists somewhere in the file.
  it('the data_conflicts query excludes source1 = source2 rows (SQL contains source1 <> source2)', async () => {
    let capturedCondition: unknown;
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: () => ({ where: () => Promise.resolve([{ id: 'ipo-1', companyName: 'Acme Ltd' }]) }),
        })
        .mockReturnValueOnce({
          from: () => ({
            where: (condition: unknown) => {
              capturedCondition = condition;
              return Promise.resolve([]);
            },
          }),
        }),
    } as any;

    await checkCrossSourceDisagreements(db, new Date());

    expect(capturedCondition).toBeDefined();
    const dialect = new PgDialect();
    const { sql } = dialect.sqlToQuery(capturedCondition as any);
    expect(sql).toContain('"data_conflicts"."source1" <> "data_conflicts"."source2"');
  });
});
