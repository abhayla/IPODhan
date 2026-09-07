/**
 * Stage 5 of the IPO pipeline test ladder (docs/reviews/ipo-pipeline-stage-gap-analysis.md
 * section 6): "Extract - the stored RHP PDF - `extract_financials_pdf.py` - values ==
 * the hand-made oracle; arithmetic checks pass".
 *
 * FIXTURE IN / EXPECTED-OUTPUT-FILE OUT. Inputs are REAL captured page text from two real
 * RHPs (Deepa Jewellers 25-Aug-2026, Ather Energy) copied verbatim out of
 * scraper/tests/fixtures/extractor/. The golden, fixtures/stage-5/expected-extract.json, was
 * transcribed from the two frozen hand-made oracles in this repo BEFORE this file ran
 * (README rule 1). The test drives the REAL scripts/extract_financials_pdf.py through its
 * documented `--texts` seam (README rule 3) - a deleted check in the extractor turns it red.
 *
 * Three arms (README rule 4):
 *   A. golden-vs-oracle parity - node only, ALWAYS runs, this is what CI gates on. It proves
 *      the golden is still the oracle's numbers and has not been quietly regenerated from
 *      extractor output (the after-the-fact acceptance test the T-403 round-2 review rejected).
 *   B. the real extractor on the real captured pages - needs `python` on PATH; skipped, never
 *      failed, when absent (the scraper unit job is node-only; the python-tests job has it).
 *   C. opt-in live arm on a real PDF file, gated on STAGE5_RHP_PDF - the *.pdf files under
 *      pdf-parser-test/ are untracked (git ls-files: 0), so CI can never run this.
 *
 * Relationship to tests/unit/scripts/extract-financials-pdf.test.ts (issue #67): that suite is
 * the extractor's own defect-class regression guard. This is the ladder's STAGE-level harness -
 * one golden file per stage, in the same shape as every other stage, so a stage-5 regression
 * shows up in the ladder run. Extends, does not duplicate.
 */
import { describe, it, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SCRAPER_ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURES = join(__dirname, 'fixtures', 'stage-5');
const SCRIPT = 'scripts/extract_financials_pdf.py';

type Case = {
  input: Record<string, string>;
  /** metric name -> why the real extractor does not produce it today (see README rule 1). */
  redByDesign?: Record<string, string>;
  expected: {
    unit: string;
    annualYears: number[];
    lowConfidence: boolean;
    metrics: Record<string, Record<string, number>>;
  };
};
const GOLDEN = JSON.parse(readFileSync(join(FIXTURES, 'expected-extract.json'), 'utf8')) as {
  _spec: string;
  _input: string;
  cases: Record<string, Case>;
  tolerancePct: number;
};

const pythonAvailable = !spawnSync('python', ['--version'], { encoding: 'utf-8' }).error;

function runExtractorOnTexts(fixture: string): any {
  const res = spawnSync('python', [SCRIPT, '--texts', join(FIXTURES, fixture)], {
    cwd: SCRAPER_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (res.error) throw res.error;
  const lastLine = (res.stdout || '').trim().split('\n').pop() || '{}';
  return JSON.parse(lastLine);
}

function closeEnough(actual: number, expected: number, tolerancePct: number): boolean {
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) <= Math.abs(expected) * (tolerancePct / 100);
}

// ---------------------------------------------------------------------------
// Arm A - always on. The golden must still BE the oracle.
// ---------------------------------------------------------------------------
describe('stage 5 / arm A - the golden is the hand-made oracle, not extractor output', () => {
  it('deepa-rhp golden == docs/reviews/fixtures/deepa-jewellers-expected.json#RHP', () => {
    const oracle = JSON.parse(
      readFileSync(
        resolve(SCRAPER_ROOT, '..', 'docs', 'reviews', 'fixtures', 'deepa-jewellers-expected.json'),
        'utf8',
      ),
    ).RHP;
    const g = GOLDEN.cases['deepa-rhp'].expected;
    expect(g.unit).toBe(oracle.unit);
    expect(g.annualYears).toEqual(oracle.fiscal_years);
    expect(g.metrics.revenue).toEqual(oracle.revenue_by_fy);
    expect(g.metrics.totalIncome).toEqual(oracle.total_income_by_fy);
    expect(g.metrics.profit).toEqual(oracle.pat_by_fy);
    expect(g.metrics.eps).toEqual(oracle.eps_basic_by_fy);
    expect(g.metrics.netWorth).toEqual(oracle.net_worth_by_fy);
  });

  it('ather-rhp golden == tests/integration/oracle/ather-energy.json (crore x10 = million)', () => {
    const oracle = JSON.parse(
      readFileSync(join(SCRAPER_ROOT, 'tests/integration/oracle/ather-energy.json'), 'utf8'),
    );
    const g = GOLDEN.cases['ather-rhp'].expected;
    for (const fy of ['2024', '2023', '2022']) {
      const o = oracle.financialsByFY_Cr[fy];
      expect(closeEnough(g.metrics.totalIncome[fy], o.totalIncome * 10, 1)).toBe(true);
      expect(closeEnough(g.metrics.profit[fy], o.pat * 10, 1)).toBe(true);
      expect(closeEnough(g.metrics.netWorth[fy], o.netWorth * 10, 1)).toBe(true);
    }
    expect(g.metrics.eps['2024']).toBe(oracle.ratios.epsBasic);
  });

  it('every declared input fixture exists on disk and is a real captured page list', () => {
    for (const [name, c] of Object.entries(GOLDEN.cases)) {
      const p = join(FIXTURES, c.input.fixture);
      expect(existsSync(p), `${name}: ${c.input.fixture}`).toBe(true);
      const pages = JSON.parse(readFileSync(p, 'utf8'));
      expect(Array.isArray(pages)).toBe(true);
      expect(pages.length).toBeGreaterThan(0);
      expect(typeof pages[0][1]).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// Arm B - the real extractor against the golden.
// ---------------------------------------------------------------------------
describe.skipIf(!pythonAvailable)('stage 5 / arm B - real extractor vs the golden', () => {
  for (const [name, c] of Object.entries(GOLDEN.cases)) {
    it(`${name}: ${c.input.document}`, () => {
      const out = runExtractorOnTexts(c.input.fixture);
      expect(out.unit).toBe(c.expected.unit);
      expect(out.annualYears).toEqual(c.expected.annualYears);
      expect(out.lowConfidence).toBe(c.expected.lowConfidence);
      for (const [metric, byFy] of Object.entries(c.expected.metrics)) {
        if (c.redByDesign?.[metric]) continue; // asserted separately, below
        for (const [fy, want] of Object.entries(byFy)) {
          const got = out.metrics?.[metric]?.[fy];
          expect(typeof got, `${metric}[${fy}] missing`).toBe('number');
          expect(
            closeEnough(got, want, GOLDEN.tolerancePct),
            `${metric}[${fy}] = ${got}, golden ${want}`,
          ).toBe(true);
        }
      }
    });
  }

  // RED BY DESIGN: metrics the golden's oracle has and the real extractor does not produce.
  // `test.fails` inverts the verdict, so these report green while broken and turn RED the day
  // the extractor learns the metric - the signal to delete the `.fails` and keep the assertion.
  for (const [name, c] of Object.entries(GOLDEN.cases)) {
    for (const [metric, why] of Object.entries(c.redByDesign ?? {})) {
      test.fails(`RED BY DESIGN ${name}/${metric}: ${why.slice(0, 90)}...`, () => {
        const out = runExtractorOnTexts(c.input.fixture);
        for (const [fy, want] of Object.entries(c.expected.metrics[metric] ?? {})) {
          expect(typeof out.metrics?.[metric]?.[fy], `${metric}[${fy}]`).toBe('number');
          expect(closeEnough(out.metrics[metric][fy], want, GOLDEN.tolerancePct)).toBe(true);
        }
      });
    }
  }

  it('arithmetic plausibility (ladder E9): PAT never exceeds revenue in any extracted year', () => {
    for (const c of Object.values(GOLDEN.cases)) {
      const out = runExtractorOnTexts(c.input.fixture);
      for (const [fy, pat] of Object.entries(out.metrics?.profit ?? {})) {
        const rev = out.metrics?.revenue?.[fy] ?? out.metrics?.totalIncome?.[fy];
        if (typeof rev === 'number' && typeof pat === 'number') {
          expect(pat, `${c.input.fixture} FY${fy}`).toBeLessThanOrEqual(rev);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Arm C - opt-in live arm on a real PDF file. Never runs in CI.
// ---------------------------------------------------------------------------
const livePdf = process.env.STAGE5_RHP_PDF;
describe.skipIf(!livePdf || !pythonAvailable)('stage 5 / arm C - live, real PDF on disk', () => {
  it('the real PDF path emits the same shape as the --texts seam', () => {
    const res = spawnSync('python', [SCRIPT, livePdf as string], {
      cwd: SCRAPER_ROOT,
      encoding: 'utf-8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      timeout: 240_000,
    });
    const out = JSON.parse((res.stdout || '').trim().split('\n').pop() || '{}');
    expect(out).toHaveProperty('unit');
    expect(out).toHaveProperty('metrics');
    expect(Array.isArray(out.annualYears)).toBe(true);
  });
});
