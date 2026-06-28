import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Issue #67 — the deterministic DRHP/RHP financial extractor returned empty
 * metrics on loss-making + mainboard layouts. These tests exercise the pure core
 * (`extract_from_texts`) offline via the script's `--texts` seam on captured page
 * text — no PDF, no network — so each defect class is a regression guard:
 *   1. loss-maker wording ("Loss for the year") + "₹ in million" unit
 *   2. mainboard summary page (title, no data) BEFORE the real P&L data page
 *   3. profitable / "in crores" happy path (must not break)
 *
 * Before the fix, fixture (1) yielded no `profit`/`eps` (the regex matched only
 * "profit"), and fixture (2) returned empty metrics with unit "lakhs" (it broke on
 * the first title match — the summary page — and read its unit).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = 'scripts/extract_financials_pdf.py';

function runExtractor(fixture: string): any {
  const fixturePath = path.join('tests/fixtures/extractor', `${fixture}.json`);
  const res = spawnSync('python', [SCRIPT, '--texts', fixturePath], {
    cwd: SCRAPER_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (res.error) throw res.error;
  const stdout = (res.stdout || '').trim();
  const lastLine = stdout.split('\n').pop() || '{}';
  return JSON.parse(lastLine);
}

describe('extract_financials_pdf — issue #67 regression (offline pure core)', () => {
  let pythonAvailable = true;
  beforeAll(() => {
    const probe = spawnSync('python', ['--version'], { encoding: 'utf-8' });
    pythonAvailable = !probe.error;
  });

  it('REAL Ather RHP P&L page: integer money + 2 interim columns + Note column + garble → oracle match', () => {
    if (!pythonAvailable) return;
    // Captured verbatim from Ather's RHP page 369 (loss-maker, mainboard, "in
    // millions", 9-month interim columns, a Note-No. column, and pdfplumber
    // token garble). Values are cross-checked against the Chittorgarh oracle
    // (₹ crore = millions / 10): Total income 1789.1/1801.8/413.8, PAT
    // -1059.7/-864.5/-344.1, EPS -47, Net worth 545.9/613.7/224.9.
    const out = runExtractor('ather-rhp-real');
    expect(out.unit).toBe('millions');
    expect(out.annualYears).toEqual([2024, 2023, 2022]);
    expect(out.lowConfidence).toBe(false);
    expect(out.metrics.revenue['2024']).toBeCloseTo(17538, 0);
    expect(out.metrics.totalIncome['2024']).toBeCloseTo(17891, 0); // = 1789.1 Cr
    expect(out.metrics.totalIncome['2022']).toBeCloseTo(4138, 0);
    expect(out.metrics.profit['2024']).toBeCloseTo(-10597, 0); // = -1059.7 Cr
    expect(out.metrics.profit['2022']).toBeCloseTo(-3441, 0);
    expect(out.metrics.eps['2024']).toBeCloseTo(-47, 0);
    expect(out.metrics.netWorth['2024']).toBeCloseTo(5459, 0); // = 545.9 Cr
  });

  it('loss-maker + "₹ in million": extracts negative profit/EPS, net worth, correct unit', () => {
    if (!pythonAvailable) return; // python sidecar is a runtime dep; skip if absent
    const out = runExtractor('loss-maker-million');
    expect(out.unit).toBe('millions'); // NOT the SME-default "lakhs"
    expect(out.annualYears).toEqual([2024, 2023, 2022]);
    expect(out.lowConfidence).toBe(false);

    expect(out.metrics.revenue['2024']).toBeCloseTo(17536.92, 2);
    expect(out.metrics.totalIncome['2024']).toBeCloseTo(18909.48, 2);
    // loss-maker: "Loss for the year" must be captured, sign from the parentheses
    expect(out.metrics.profit['2024']).toBeCloseTo(-10596.34, 2);
    expect(out.metrics.profit['2022']).toBeCloseTo(-3444.65, 2);
    expect(out.metrics.eps['2024']).toBeCloseTo(-28.45, 2);
    expect(out.metrics.netWorth['2024']).toBeCloseTo(4083.2, 2);
  });

  it('mainboard summary-page-before-data-page: picks the data page, not the summary', () => {
    if (!pythonAvailable) return;
    const out = runExtractor('mainboard-summary-then-data');
    // summary page 0 is "(₹ in lakhs)" with no anchor row; the data page 5 is
    // "(₹ in million)" — the fix must read the unit from the chosen DATA page.
    expect(out.unit).toBe('millions');
    expect(out.lowConfidence).toBe(false);
    expect(out.metrics.revenue['2024']).toBeCloseTo(45231.0, 2);
    expect(out.metrics.profit['2024']).toBeCloseTo(3210.45, 2); // positive here
    expect(out.metrics.eps['2024']).toBeCloseTo(12.5, 2);
    expect(Object.keys(out.metrics).length).toBeGreaterThanOrEqual(4);
  });

  it('profitable / "in crores": happy path still works (regression guard)', () => {
    if (!pythonAvailable) return;
    const out = runExtractor('profitable-crores');
    expect(out.unit).toBe('crores');
    expect(out.lowConfidence).toBe(false);
    expect(out.metrics.revenue['2024']).toBeCloseTo(1234.56, 2);
    expect(out.metrics.profit['2024']).toBeCloseTo(156.78, 2);
  });

  it('no P&L page: returns empty metrics flagged lowConfidence (consumer must not persist)', () => {
    if (!pythonAvailable) return;
    // a doc with no "Statement of Profit and Loss" page → honest empty, flagged.
    const out = runExtractor('no-pnl');
    expect(out.metricsFound).toBe(0);
    expect(out.lowConfidence).toBe(true);
    expect(out.metrics).toEqual({});
  });
});
