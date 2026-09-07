/**
 * Stage 6 of the IPO pipeline test ladder (docs/reviews/ipo-pipeline-stage-gap-analysis.md
 * section 6 row 6): "Persist extracted data | stage-5 JSON | `createFinancialData` etc. through
 * `upsertIPO` precedence | rows in `financial_data`/`peer_companies`; `field_sources` = RHP".
 * That row's "Exists today?" cell says **NO** - the functions exist, the precedence and the
 * confidence do not.
 *
 * FIXTURE IN / EXPECTED-OUTPUT-FILE OUT. The fixture is stage 5's REAL output for the real
 * Deepa Jewellers RHP (fixtures/stage-6/stage-5-output-deepa.json, byte-for-byte what
 * extract_financials_pdf.py printed for fixtures/stage-5/deepa-rhp-pages.json - the ladder's
 * "a stage is green only when its output feeds the next stage's fixture unchanged"). The
 * golden, fixtures/stage-6/expected-persist.json, was written from the spec BEFORE this file
 * ran (README rule 1).
 *
 * This is a TEST HARNESS, not the implementation: issue #258 says "Out of scope: building
 * stage 6 persistence-precedence logic itself". Everything the spec requires and the code does
 * not do is written here as a `test.fails` case carrying its spec reference, so the gap is
 * RED-BY-DESIGN and visible in the ladder run instead of invisible. `test.fails` inverts the
 * verdict: the case is reported as passing while the product is still broken, and turns RED
 * the day someone implements it - which is the signal to delete the `.fails` and keep the test.
 *
 * No DB and no network: the real `createFinancialData` is driven against a recording fake
 * repository, so what the production door actually hands to `upsert` is the thing under test.
 */
import { describe, it, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFinancialData } from '../../../src/services/data-persister';
import type { FinancialDataRepository } from '@ipodhan/shared/repositories/financial-data-repository';
import type { ScrapedFinancialData } from '../../../src/scrapers/financial-data-scraper';
import { scraperSourceEnum } from '@ipodhan/shared/db/schema';

const FIXTURES = join(__dirname, 'fixtures', 'stage-6');
const GOLDEN = JSON.parse(readFileSync(join(FIXTURES, 'expected-persist.json'), 'utf8'));
const STAGE5 = JSON.parse(readFileSync(join(FIXTURES, 'stage-5-output-deepa.json'), 'utf8')) as {
  unit: string;
  annualYears: number[];
  metrics: Record<string, Record<string, number>>;
};

const IPO_ID: string = GOLDEN.input.ipoId;

/** Recording fake: the only thing stage 6 is allowed to touch. */
function recordingRepository() {
  const upserts: any[] = [];
  const repo = {
    upsert: async (row: any) => {
      upserts.push(row);
      return { id: 'financial-data-row-1' };
    },
    findByIPO: async () => null,
  };
  return { repo: repo as unknown as FinancialDataRepository, upserts };
}

/** Spec mapping, INR million -> INR crore, only the years the schema has columns for. */
function stage5ToScraped(): ScrapedFinancialData {
  const cr = (v: number | undefined) => (typeof v === 'number' ? v / 10 : undefined);
  const m = STAGE5.metrics;
  const latest = String(STAGE5.annualYears[0]);
  return {
    ipoId: IPO_ID,
    revenueFy2024: cr(m.revenue?.['2024']),
    profitFy2024: cr(m.profit?.['2024']),
    ebitdaFy2024: cr(m.ebitda?.['2024']),
    totalIncomeFy2024: cr(m.totalIncome?.['2024']),
    eps: m.eps?.[latest],
  } as ScrapedFinancialData;
}

describe('stage 6 / the stage-5 output really is stage 5 output', () => {
  it('the fixture carries the real Deepa RHP numbers in millions for FY2026/2025/2024', () => {
    expect(STAGE5.unit).toBe('millions');
    expect(STAGE5.annualYears).toEqual(GOLDEN.input.annualYears);
    expect(STAGE5.metrics.revenue['2024']).toBeCloseTo(10245.68, 2);
  });
});

describe('stage 6 / what the sanctioned door writes today', () => {
  it('createFinancialData hands exactly one financial_data row to the repository, in crore', async () => {
    const { repo, upserts } = recordingRepository();
    const id = await createFinancialData(repo, stage5ToScraped());
    expect(id).toBe('financial-data-row-1');
    expect(upserts).toHaveLength(1);
    const w = GOLDEN.expectedWrite;
    const got = upserts[0];
    expect(got.ipoId).toBe(w.ipoId);
    for (const field of ['revenueFy2024', 'profitFy2024', 'ebitdaFy2024', 'totalIncomeFy2024', 'eps']) {
      expect(Number(got[field]), field).toBeCloseTo(w[field], 3);
    }
  });
});

// ---------------------------------------------------------------------------
// RED BY DESIGN - the spec's stage-6 requirements the code does not meet.
// Each case names its golden id and the spec line it comes from.
// ---------------------------------------------------------------------------
describe('stage 6 / RED BY DESIGN - unimplemented spec (issue #258 out of scope)', () => {
  test.fails('S6-R1: the persist door writes field_sources rows for what it wrote', () => {
    // Read the real production function's body: a field_sources write has to be reachable
    // from createFinancialData for row 6's "field_sources = RHP" to be satisfiable at all.
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'src', 'services', 'data-persister.ts'),
      'utf8',
    );
    const start = src.indexOf('export async function createFinancialData');
    const body = src.slice(start, src.indexOf('\nexport async function', start + 1));
    expect(start, 'createFinancialData not found').toBeGreaterThan(-1);
    expect(body).toMatch(/fieldSource|FieldSources|trackFieldUpdate/i);
  });

  test.fails('S6-R2: scraper_source can express an RHP-sourced field', () => {
    expect(scraperSourceEnum.enumValues as readonly string[]).toContain('RHP');
  });

  test.fails('S6-R3: an ADMIN value survives a lower-precedence RHP write', async () => {
    const adminValue = '999.99';
    const upserts: any[] = [];
    const repo = {
      // The row already in the DB, written by ADMIN.
      findByIPO: async () => ({ ipoId: IPO_ID, revenueFy2024: adminValue }),
      upsert: async (row: any) => {
        upserts.push(row);
        return { id: 'financial-data-row-1' };
      },
    } as unknown as FinancialDataRepository;
    await createFinancialData(repo, stage5ToScraped());
    expect(upserts[0].revenueFy2024).toBe(adminValue);
  });

  test.fails('S6-R4: the fiscal years the document reports can be persisted', async () => {
    const { repo, upserts } = recordingRepository();
    await createFinancialData(repo, stage5ToScraped());
    const written = JSON.stringify(upserts[0]);
    for (const fy of STAGE5.annualYears) {
      expect(written, `FY${fy} has no home in financial_data`).toContain(`Fy${fy}`);
    }
  });

  it('the golden lists every red-by-design case above, with its spec line', () => {
    const ids = GOLDEN.redByDesign.map((r: any) => r.id);
    expect(ids).toEqual(['S6-R1', 'S6-R2', 'S6-R3', 'S6-R4']);
    for (const r of GOLDEN.redByDesign) {
      expect(r.spec.length).toBeGreaterThan(20);
      expect(r.observedToday.length).toBeGreaterThan(20);
    }
  });
});
