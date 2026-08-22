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
import {
  checkCrossSourceDisagreements,
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

  it('classifies exactly priceRangeMin, priceRangeMax, openDate, closeDate as HIGH-value', () => {
    expect([...HIGH_VALUE_FIELDS].sort()).toEqual(
      ['closeDate', 'openDate', 'priceRangeMax', 'priceRangeMin'].sort()
    );
    expect(HIGH_VALUE_FIELDS.has('gmpPrice')).toBe(false);
    expect(HIGH_VALUE_FIELDS.has('gmpPercentage')).toBe(false);
  });
});
