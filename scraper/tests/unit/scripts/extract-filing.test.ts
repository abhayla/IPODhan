import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-430 — WP C-2 filing extractor (`scripts/extract_filing.py`).
 *
 * Two layers, deliberately:
 *
 * 1. FIXTURE tests against the REAL Purple Style Labs documents (RHP + price band
 *    advertisement) as obtained by the T-403 discovery runner. The oracle is
 *    `docs/reviews/fixtures/purple-style-labs-expected.json`, transcribed by hand
 *    from the printed advertisement — NOT from extractor output — so a wrong
 *    extraction fails instead of being blessed. These skip loudly when the PDFs
 *    are not on this machine: they live under the gitignored
 *    `.prospectus-acceptance/`, so CI (which has never fetched them) reports the
 *    skip rather than a false green.
 *
 * 2. NEGATIVE unit tests on the §1 check functions, driven by tiny synthetic page
 *    text through the script's `--texts` seam — no PDFs, always run everywhere.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRAPER_ROOT = path.resolve(__dirname, '../../..');
const REPO_ROOT = path.resolve(SCRAPER_ROOT, '..');
const SCRIPT = 'scripts/extract_filing.py';

const PDF_DIR = path.join(REPO_ROOT, '.prospectus-acceptance', 'psl-1');
const PBA_PDF = path.join(PDF_DIR, 'PRICE_BAND_AD-cebd8036.pdf');
const RHP_PDF = path.join(PDF_DIR, 'DRHP-700fce50.pdf');
const EXPECTED = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'docs/reviews/fixtures/purple-style-labs-expected.json'), 'utf-8'),
);

interface Field {
  value: unknown;
  page: number | null;
  source_doc: string;
  check: { name: string; passed: boolean; detail: string };
}
interface Extraction {
  doc_type: string;
  pages: number;
  extraction_status: 'OK' | 'PARTIAL' | 'NEEDS_OCR';
  unit: string | null;
  fiscal_years: number[];
  fields: Record<string, Field>;
}

function runPython(args: string[]): Extraction {
  const res = spawnSync('python', [SCRIPT, ...args], {
    cwd: SCRAPER_ROOT,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`extract_filing.py exited ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

/** Run the extractor on synthetic page text: [[pageIndex, "text"], ...]. */
function runOnTexts(pages: [number, string][], docType: string): Extraction {
  const dir = mkdtempSync(path.join(tmpdir(), 'extract-filing-'));
  const file = path.join(dir, 'pages.json');
  writeFileSync(file, JSON.stringify(pages), 'utf-8');
  return runPython(['--texts', file, '--doc-type', docType]);
}

let pythonAvailable = true;
beforeAll(() => {
  pythonAvailable = !spawnSync('python', ['--version'], { encoding: 'utf-8' }).error;
});

describe('extract_filing — Purple Style Labs price band advertisement (real PDF)', () => {
  const have = existsSync(PBA_PDF);
  let out: Extraction;

  beforeAll(() => {
    if (!have || !pythonAvailable) return;
    out = runPython([PBA_PDF, '--doc-type', 'PRICE_BAND_AD']);
  });

  it('every fixture field matches the printed advertisement, and every check passed', (ctx) => {
    if (!have || !pythonAvailable) return ctx.skip();

    expect(out.extraction_status).toBe('OK');
    expect(out.unit).toBe(EXPECTED.PRICE_BAND_AD.unit);
    expect(out.fiscal_years).toEqual(EXPECTED.PRICE_BAND_AD.fiscal_years);

    const mismatches: string[] = [];
    for (const [key, expected] of Object.entries(EXPECTED.PRICE_BAND_AD)) {
      const field = out.fields[key];
      if (!field) {
        mismatches.push(`${key}: not emitted`);
        continue;
      }
      if (JSON.stringify(field.value) !== JSON.stringify(expected)) {
        mismatches.push(`${key}: got ${JSON.stringify(field.value)} want ${JSON.stringify(expected)}`);
      }
    }
    expect(mismatches).toEqual([]);

    // Every emitted check must have passed — a failed check means a null value.
    const failed = Object.entries(out.fields)
      .filter(([, f]) => !f.check.passed)
      .map(([k, f]) => `${k}: ${f.check.detail}`);
    expect(failed).toEqual([]);
  });

  it('every extracted field carries a page number and the source document', (ctx) => {
    if (!have || !pythonAvailable) return ctx.skip();
    for (const key of Object.keys(EXPECTED.PRICE_BAND_AD)) {
      const field = out.fields[key];
      expect(field.source_doc, key).toBe(path.basename(PBA_PDF));
      expect(typeof field.page, `${key} page`).toBe('number');
      expect(field.page!, `${key} page`).toBeGreaterThanOrEqual(0);
    }
  });

  it('fields the document cannot yet carry are null WITH a reason, never a value', (ctx) => {
    if (!have || !pythonAvailable) return ctx.skip();
    for (const [key, reason] of Object.entries(EXPECTED._null_with_reason.PRICE_BAND_AD)) {
      const field = out.fields[key];
      expect(field, key).toBeDefined();
      expect(field.value, key).toBeNull();
      expect(field.check.detail, key).toBe(reason);
    }
  });

  it('a field absent from the fixture is not invented (P/E is null, not a number)', (ctx) => {
    if (!have || !pythonAvailable) return ctx.skip();
    expect(Object.keys(EXPECTED.PRICE_BAND_AD)).not.toContain('pe_at_cap');
    expect(out.fields.pe_at_cap.value).toBeNull();
    expect(out.fields.pe_at_cap.check.detail).toBe('not_ascertainable_loss');
  });

  it('W-44: no issuer-specific KPI field exists; concentration KPIs are a generic list', (ctx) => {
    if (!have || !pythonAvailable) return ctx.skip();
    for (const gone of ['top10_brands_pct_fy2026', 'womenswear_pct_fy2026', 'mumbai_gmv_pct_fy2026']) {
      expect(Object.keys(out.fields), gone).not.toContain(gone);
    }
    const kpis = out.fields.concentration_kpis.value as { label: string; value_pct: number }[];
    expect(kpis).toEqual(EXPECTED.PRICE_BAND_AD.concentration_kpis);
    for (const entry of kpis) {
      expect(entry.label).toMatch(/^[a-z0-9_]+$/);
      expect(entry.value_pct).toBeGreaterThan(0);
      expect(entry.value_pct).toBeLessThanOrEqual(100);
    }
  });
});

describe('extract_filing — Purple Style Labs RHP (real PDF)', () => {
  const have = existsSync(RHP_PDF);

  it('reads the fiscal years from the header row and the CIN from the cover', (ctx) => {
    if (!have || !pythonAvailable) return ctx.skip();
    const out = runPython([RHP_PDF, '--doc-type', 'RHP']);
    expect(out.fiscal_years).toEqual(EXPECTED.RHP.fiscal_years);
    expect(out.unit).toBe(EXPECTED.RHP.unit);
    expect(out.fields.cin.value).toBe(EXPECTED.RHP.cin);
    expect(out.fields.cin.check.passed).toBe(true);
    // The RHP's own P&L must agree with the figures the advertisement reprints.
    const pat = out.fields.pat_by_fy.value as Record<string, number> | null;
    if (pat) {
      for (const [fy, expected] of Object.entries(
        EXPECTED.PRICE_BAND_AD.pat_by_fy as Record<string, number>,
      )) {
        expect(pat[fy], `PAT ${fy}`).toBeCloseTo(expected, 1);
      }
    }
    // A ~450-page prospectus: pdfplumber needs minutes, so this test owns a
    // generous budget. It never runs in CI (the PDF is gitignored).
  }, 900_000);
});

describe('extract_filing — check functions reject bad documents (synthetic, offline)', () => {
  it('category rows that do not sum to the printed total FAIL the check', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    // Track record: 30 + 20 + common 19 = 69, but the table prints Total 85.
    const page = [
      'Axis Capital Limited* 30 4',
      'IIFL Capital Services Limited* 20 10',
      'Common Issues 19 5',
      'Total 85 19',
    ].join('\n');
    const out = runOnTexts([[0, page]], 'PRICE_BAND_AD');
    const field = out.fields.brlm_track_record;
    expect(field.check.name).toBe('brlm_rows_reconcile_with_total');
    expect(field.check.passed).toBe(false);
    expect(field.value).toBeNull();
    expect(field.check.detail).toContain('check_failed');
    expect(field.check.detail).toContain('69');
    expect(out.extraction_status).toBe('PARTIAL');
  });

  it('a [•] in a price-dependent cell yields null with reason not_priced_yet', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const page = [
      'INITIAL PUBLIC OFFERING OF UP TO [●] EQUITY SHARES OF FACE VALUE OF `10 EACH FOR CASH',
      'AT A PRICE OF `[●] PER EQUITY SHARE (INCLUDING A SHARE PREMIUM OF `[●] PER EQUITY SHARE)',
    ].join('\n');
    const out = runOnTexts([[0, page]], 'PRICE_BAND_AD');
    expect(out.fields.issue_price.value).toBeNull();
    expect(out.fields.issue_price.check.detail).toBe('not_priced_yet');
    expect(out.fields.issue_price.check.passed).toBe(true); // classified, not failed
  });

  it('a document with no text layer is classified NEEDS_OCR and writes no values', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts([[0, ''], [1, '   \n  ']], 'RHP');
    expect(out.extraction_status).toBe('NEEDS_OCR');
    expect(out.fields).toEqual({});
    expect(out.pages).toBe(2);
  });

  it('a price band whose cap exceeds the regulatory width FAILS, nulling both prices', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const page = 'PRICE BAND: ` 100 TO ` 200 PER EQUITY SHARE OF FACE VALUE OF ` 10 EACH.';
    const out = runOnTexts([[0, page]], 'PRICE_BAND_AD');
    expect(out.fields.price_band_floor.value).toBeNull();
    expect(out.fields.price_band_cap.value).toBeNull();
    expect(out.fields.price_band_cap.check.detail).toContain('1.2x floor');
    expect(out.extraction_status).toBe('PARTIAL');
  });

  // MAJOR-1 (T-430 round 2): a P&L table with no explicit "in <unit>" line anywhere
  // must null EVERY C-group money field with reason unit_unknown — this must FAIL
  // before the fix (the shared module's own detector silently defaults to "lakhs").
  it('a P&L table with no unit line nulls every C-group money field as unit_unknown', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const page = [
      'Restated Consolidated Statement of Profit and Loss',
      '                          March 31, 2026    March 31, 2025    March 31, 2024',
      'Revenue from operations        17,538             15,000             12,000',
      'Total income                   17,900             15,300             12,300',
      'Profit for the year               500                400               300',
    ].join('\n');
    const out = runOnTexts([[0, page]], 'RHP');

    expect(out.fields.unit.value).toBeNull();
    expect(out.fields.unit.check.name).toBe('unit_not_stated');
    expect(out.fields.unit.check.passed).toBe(false);
    expect(out.extraction_status).toBe('PARTIAL');

    for (const key of ['revenue_by_fy', 'total_income_by_fy', 'pat_by_fy']) {
      const field = out.fields[key];
      expect(field.value, key).toBeNull();
      expect(field.check.detail, key).toBe('unit_unknown');
      expect(field.check.passed, key).toBe(true); // classified, not a failed arithmetic check
    }
  });

  // MAJOR-2 mutation proof: the floor-side and cap-side implied pre-issue share
  // counts must independently reproduce the same number. Bumping mcap_cap by 1%
  // (leaving shares/prices untouched) must flip the combined check from green to
  // red — proving the new check function actually exercises live arithmetic and
  // is not a tautology.
  it('mcap consistency FAILS when mcap_cap disagrees with the floor-side implied share count', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const buildPage = (mcapCap: string) => [
      'PRICE BAND : ` 546 TO ` 575 PER EQUITY SHARE OF FACE VALUE OF ` 10 EACH.',
      'Fresh Issue 12,454,212 6,800.00 11,826,086 6,800.00',
      'Post-Issue market capitalisation 44,056.31 ' + mcapCap,
    ].join('\n');

    const ok = runOnTexts([[0, buildPage('46,035.12')]], 'PRICE_BAND_AD');
    expect(ok.fields.market_cap_at_cap.check.name).toBe('market_cap_ordering_and_consistency');
    expect(ok.fields.market_cap_at_cap.check.passed).toBe(true);
    expect(ok.fields.market_cap_at_cap.value).toBe(46035.12);

    // mcap_cap x 1.01 = 46,495.47 — same floor side, only the cap side mutated.
    const mutated = runOnTexts([[0, buildPage('46,495.47')]], 'PRICE_BAND_AD');
    expect(mutated.fields.market_cap_at_cap.check.passed).toBe(false);
    expect(mutated.fields.market_cap_at_cap.value).toBeNull();
    expect(mutated.fields.market_cap_at_floor.value).toBeNull();
    expect(mutated.fields.market_cap_at_cap.check.detail).toContain('implied pre-issue shares');
    expect(mutated.extraction_status).toBe('PARTIAL');
  });
});

/**
 * Deepa Jewellers (DEEPA) — W-32/W-33/W-34/W-35.
 *
 * Runs OFFLINE through the `--texts` seam on page text captured once from the
 * two real documents (scraper/tests/fixtures/extractor/deepa-*.json), so unlike
 * the Purple Style Labs blocks above these run everywhere, CI included. The
 * oracle `docs/reviews/fixtures/deepa-jewellers-expected.json` is transcribed by
 * hand from the printed documents, never from extractor output.
 */
const DEEPA = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'docs/reviews/fixtures/deepa-jewellers-expected.json'), 'utf-8'),
);
const DEEPA_AD_PAGES = 'tests/fixtures/extractor/deepa-price-band-ad-pages.json';
const DEEPA_RHP_PAGES = 'tests/fixtures/extractor/deepa-rhp-pages.json';

describe('extract_filing — Deepa Jewellers price band advertisement (captured page text)', () => {
  let out: Extraction;
  beforeAll(() => {
    if (!pythonAvailable) return;
    out = runPython(['--texts', DEEPA_AD_PAGES, '--doc-type', 'PRICE_BAND_AD']);
  });

  it('every oracle field matches the printed advertisement', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const mismatches: string[] = [];
    for (const [key, expected] of Object.entries(DEEPA.PRICE_BAND_AD)) {
      const field = out.fields[key];
      if (!field) {
        mismatches.push(`${key}: not emitted`);
        continue;
      }
      if (JSON.stringify(field.value) !== JSON.stringify(expected)) {
        mismatches.push(`${key}: got ${JSON.stringify(field.value)} want ${JSON.stringify(expected)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('every emitted check passed — no field is written on a failed check', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const failed = Object.entries(out.fields)
      .filter(([, f]) => !f.check.passed)
      .map(([k, f]) => `${k}: ${f.check.detail}`);
    expect(failed).toEqual([]);
    expect(out.extraction_status).toBe('OK');
  });

  it('fields the advertisement does not carry are null WITH a reason', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    for (const [key, reason] of Object.entries(DEEPA._null_with_reason.PRICE_BAND_AD)) {
      const field = out.fields[key];
      expect(field, key).toBeDefined();
      expect(field.value, key).toBeNull();
      expect(field.check.detail, key).toBe(reason);
    }
  });

  it('W-32: no issuer-specific KPI field exists; concentration KPIs are a generic list', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    for (const gone of ['top10_brands_pct_fy2026', 'womenswear_pct_fy2026', 'mumbai_gmv_pct_fy2026']) {
      expect(Object.keys(out.fields), gone).not.toContain(gone);
    }
    const kpis = out.fields.concentration_kpis.value as { label: string; value_pct: number }[];
    expect(kpis.length).toBeGreaterThan(0);
    for (const entry of kpis) {
      expect(entry.label).toMatch(/^[a-z0-9_]+$/);
      expect(entry.value_pct).toBeGreaterThan(0);
      expect(entry.value_pct).toBeLessThanOrEqual(100);
    }
  });

  it('W-74 E5: the lead Syndicate Member and every sub-syndicate broker', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    expect(out.fields.syndicate_members.check.passed).toBe(true);
    expect(out.fields.syndicate_members.value).toEqual(DEEPA.PRICE_BAND_AD.syndicate_members);
  });

  it('W-74 F5: the advertisement carries no litigation notice', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    expect(out.fields.litigation_notices.value).toBeNull();
    expect(out.fields.litigation_notices.check.detail).toBe('section_not_found');
  });
});

/**
 * W-74 — the two sections the price band ad extractor used not to read, driven
 * through the `--texts` seam on VERBATIM snippets. The sub-syndicate snippet is
 * copied character-for-character out of the Deepa advertisement, two-column
 * merge and all: the broker list is the RIGHT column glued to the tail of the
 * left column's prose, and one name ("ICICI Securities Limited") is split
 * across the line break.
 */
describe('extract_filing — W-74 syndicate members and litigation notices', () => {
  const SUB_SYNDICATE_PAGE = [
    'AVAILABILITY OF THE RHP: Investors are advised to refer to the RHP and the "Risk Factors" beginning on page 20 of the RHP before applying in the Offer. A copy of the SUB-SYNDICATE MEMBERS: Anand Rathi Share & Stock Brokers Limited; Axis Capital Ltd.; Asit C. Metha Investment Interrmediates Ltd , Centrum Finverse Ltd.; ICICI',
    'RHP will be made available on the website of SEBI at www.sebi.gov.in and is available on the websites of the BRLMs, Emkay Global Financial Services Limited at Securities Limited; JM Financial Services Ltd; Keynote Capitals Ltd, KJMC Capital Market Services Limited, Kotak Securities Limited; LKP Securities Limited; Motilal Oswal',
    'www.emkayglobal.com and Valmiki Leela Capital Private Limited at www.valmikileela.com and at the website of the Company, Deepa Jewellers Limited at Financial Services Limited; Nuvama Wealth; Prabhudas Lilladher Pvt Ltd, RR Equity Brokers Pvt. Ltd;, Sharekhan Limited; SMC Global Securities Ltd; Yes Securities (India) Ltd.',
    'www.deepajewel.com and the websites of the Stock Exchanges, for BSE Limited at www.bseindia.com and for National Stock Exchange of India Limited at www.nseindia.com. ESCROW COLLECTION BANK(s): ICICI Bank Limited. | REFUND BANK(s): ICICI Bank Limited.',
    'Syndicate Member: Emkay Global Financial Services Limited, Tel.: +91 22 6612 1212, Registered Brokers, SCSBs, Designated RTA Locations and Designated CDP',
  ].join('\n');

  it('reads the lead member and reassembles a name split across the column break', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts([[0, SUB_SYNDICATE_PAGE]], 'PRICE_BAND_AD');
    const members = out.fields.syndicate_members.value as { name: string; role: string }[];
    expect(members[0]).toEqual({
      name: 'Emkay Global Financial Services Limited',
      role: 'SYNDICATE',
    });
    expect(members.filter((m) => m.role === 'SUB_SYNDICATE')).toHaveLength(17);
    // Split as "... Centrum Finverse Ltd.; ICICI" / "... at Securities Limited;".
    expect(members.map((m) => m.name)).toContain('ICICI Securities Limited');
    // The left column's prose must not leak in as a broker name.
    expect(members.every((m) => !m.name.includes('www.'))).toBe(true);
    expect(members.every((m) => !/\bat\b/.test(m.name))).toBe(true);
  });

  it('an advertisement with no syndicate block is null WITH a reason', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts([[0, 'PRICE BAND: ` 100 TO ` 105 PER EQUITY SHARE OF FACE VALUE OF ` 10 EACH']], 'PRICE_BAND_AD');
    expect(out.fields.syndicate_members.value).toBeNull();
    expect(out.fields.syndicate_members.check.detail).toBe('section_not_found');
  });

  it('F5: an IP licence termination notice is read as a litigation notice', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    // A notice sentence is read from ONE printed line: in a two-column
    // advertisement the text layer merges both columns into every line, so
    // joining consecutive lines would splice the neighbouring column's prose
    // into the middle of the summary.
    const page =
      '19. Trademark licence dispute: Our Company has received a legal notice purporting to terminate the trade mark licence agreement under which we operate 12 of our stores.';
    const out = runOnTexts([[0, page]], 'PRICE_BAND_AD');
    const notices = out.fields.litigation_notices.value as { summary: string }[];
    expect(notices).toHaveLength(1);
    expect(notices[0].summary).toContain('received a legal notice purporting to terminate');
    expect(notices[0].summary).toContain('trade mark licence agreement');
    expect(notices.every((n) => n.summary.length <= 500)).toBe(true);
    expect(out.fields.litigation_notices.check.passed).toBe(true);
  });

  it('the bid-period "public notice/ press release" boilerplate is NOT a litigation notice', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const page =
      'Any revision in the Price Band and the revised Bid/Offer Period, if applicable, shall be widely disseminated by notification to the Stock Exchanges, by issuing a public notice/ press release, and also by indicating the change on the respective websites of the BRLMs.';
    const out = runOnTexts([[0, page]], 'PRICE_BAND_AD');
    expect(out.fields.litigation_notices.value).toBeNull();
    expect(out.fields.litigation_notices.check.detail).toBe('section_not_found');
  });
});

describe('extract_filing — Deepa Jewellers RHP (captured page text)', () => {
  let out: Extraction;
  beforeAll(() => {
    if (!pythonAvailable) return;
    out = runPython(['--texts', DEEPA_RHP_PAGES, '--doc-type', 'RHP']);
  });

  it('W-33/W-35: the restated P&L reads exactly what the prospectus prints, in millions', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    expect(out.unit).toBe(DEEPA.RHP.unit);
    expect(out.fiscal_years).toEqual(DEEPA.RHP.fiscal_years);
    // net_worth_by_fy is asserted only in the live full-PDF run: the net-worth
    // row sits on an annexure page outside the four pages captured here.
    for (const key of ['revenue_by_fy', 'total_income_by_fy', 'pat_by_fy', 'eps_basic_by_fy',
      'ebitda_by_fy', 'cin', 'rhp_filing_date']) {
      expect(out.fields[key].value, key).toEqual((DEEPA.RHP as Record<string, unknown>)[key]);
      expect(out.fields[key].check.passed, key).toBe(true);
    }
  });

  it('the advertisement and the prospectus agree on every shared figure', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const ad = runPython(['--texts', DEEPA_AD_PAGES, '--doc-type', 'PRICE_BAND_AD']);
    for (const key of ['revenue_by_fy', 'pat_by_fy', 'ebitda_by_fy', 'eps_basic_by_fy']) {
      expect(ad.fields[key].value, key).toEqual(out.fields[key].value);
    }
  });

  it('the named plausibility checks all ran and passed', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const names = Object.keys(out.fields).filter((k) => k.startsWith('financial_plausibility_'));
    expect(names).toEqual(expect.arrayContaining([
      'financial_plausibility_pat_not_above_revenue',
      'financial_plausibility_ebitda_at_least_pat',
      'financial_plausibility_yoy_ratio_within_bounds',
      'financial_plausibility_unit_stated_near_table',
    ]));
    for (const n of names) expect(out.fields[n].check.passed, n).toBe(true);
  });

  it('E5: the objects of the offer are read from the RHP with the printed amounts', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const field = out.fields.objects_of_offer;
    expect(field.value).toEqual(DEEPA.RHP.objects_of_offer);
    expect(field.page).toBe(104);
    expect(field.check.name).toBe('objects_sum_vs_fresh_issue');
    // The general-corporate-purposes row is [•] at RHP stage, so the check
    // asserts the bound that IS verifiable, and says so.
    expect(field.check.passed).toBe(true);
    expect(field.check.detail).toContain('2150.00');
    expect(field.check.detail).toContain('2500.00');
    expect(field.check.detail).toContain('not verifiable');
  });

  it('E8: every numbered risk factor is counted, with its first-sentence heading', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const count = out.fields.risk_factor_count;
    expect(count.value).toBe(DEEPA.RHP.risk_factor_count);
    expect(count.check.passed).toBe(true);
    expect(count.page).toBe(DEEPA.RHP.risk_factor_first_page);

    const risks = out.fields.risk_factors.value as { n: number; heading: string }[];
    expect(risks).toHaveLength(DEEPA.RHP.risk_factor_count as number);
    expect(risks.map((r) => r.n)).toEqual(
      risks.map((_r, i) => i + 1), // strictly sequential — no nested list is counted
    );
    expect(risks[0].heading).toContain(DEEPA.RHP.risk_factor_first_heading);
    expect(risks[risks.length - 1].heading).toBe(DEEPA.RHP.risk_factor_last_heading);
    for (const r of risks) {
      expect(r.heading.length, `heading ${r.n}`).toBeGreaterThan(0);
      // ipo_risk_factors.heading is varchar(500) — W-80.
      expect(r.heading.length, `heading ${r.n}`).toBeLessThanOrEqual(500);
    }
  });

  it('W-80: a real DEEPA heading past the old 200-char cap is not truncated mid-word', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const risks = out.fields.risk_factors.value as { n: number; heading: string }[];
    // The item-4 inventory heading is 245 chars — comfortably past the old
    // limit=200 default that used to cut it to "...revenue from opera". It has
    // a first sentence under the new 480-char limit, so it must come through
    // verbatim and complete, ending on the actual sentence terminator.
    const inventoryHeading = risks.find((r) => r.n === 4)!.heading;
    expect(inventoryHeading).toBe(
      'Our inventories as of Fiscal 2026, Fiscal 2025 and Fiscal 2024 were ₹ 873.62 million, ' +
        '₹827.87 million and ₹722.56 million representing 4.53%, 5.93%, and 7.05% as a percentage of ' +
        'our revenue from operations for the indicated periods respectively.',
    );
    expect(inventoryHeading.length).toBe(245);
    expect(inventoryHeading.endsWith('respectively.')).toBe(true);
  });
});

describe('extract_filing — W-80 risk-factor heading truncation (synthetic, offline)', () => {
  // risk_factor_count/risk_factors both gate on a minimum-20 check (check_min_count)
  // that nulls the field on failure — pad every case with 19 trivial filler
  // items ahead of the item under test so the field actually carries a value.
  const FILLER = Array.from({ length: 19 }, (_v, i) => `${i + 1}. Filler risk number ${i + 1} exists.`);

  it('a heading with a first sentence under 480 chars comes through exactly as that sentence', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const sentence = 'This is a short risk heading sentence that ends cleanly.';
    const page = [
      'RISK FACTORS',
      ...FILLER,
      `20. ${sentence} More trailing prose that must never appear in the heading.`,
    ].join('\n');
    const out = runOnTexts([[0, page]], 'RHP');
    const risks = out.fields.risk_factors.value as { n: number; heading: string }[];
    expect(risks.find((r) => r.n === 20)!.heading).toBe(sentence);
  });

  it('a heading with NO sentence terminator within 480 chars is cut at the last word boundary, never mid-word or mid-number, with an ellipsis appended', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    // Build a >480-char run-on with no '.', '?' or '!' anywhere, made of words
    // and a multi-digit number token, so a mid-token cut would be detectable.
    const words = [];
    let len = 0;
    let i = 0;
    while (len < 500) {
      const tok = i % 5 === 0 ? '123456789012' : 'word';
      words.push(tok);
      len += tok.length + 1;
      i++;
    }
    const body = words.join(' ');
    const page = ['RISK FACTORS', ...FILLER, `20. ${body}`].join('\n');
    const out = runOnTexts([[0, page]], 'RHP');
    const risks = out.fields.risk_factors.value as { n: number; heading: string }[];
    const heading = risks.find((r) => r.n === 20)!.heading;

    expect(heading.length).toBeLessThanOrEqual(481); // limit(480) + 1 ellipsis char
    expect(heading.endsWith('…')).toBe(true); // ellipsis marks the cut
    const withoutEllipsis = heading.slice(0, -1);
    // Every token before the ellipsis must be a COMPLETE token from the source
    // (never a partial word, never a partial number) — no cut inside a token.
    for (const tok of withoutEllipsis.split(' ')) {
      if (tok === '') continue;
      expect(['word', '123456789012'], `token "${tok}" must be a whole token`).toContain(tok);
    }
    expect(body.startsWith(withoutEllipsis)).toBe(true);
  });
});

describe('extract_filing — objects/risk-factor edge cases (synthetic, offline)', () => {
  it('E5: a fully-priced objects table whose amounts miss the fresh issue FAILS', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const page = [
      'OBJECTS OF THE OFFER',
      'Gross Proceeds of the Fresh Issue 1,000.00',
      'Utilisation of Net Proceeds',
      '(in  million)',
      'Sr. No. Particulars Estimated Amount',
      '1. Funding working capital 400.00',
      '2. General corporate purposes 100.00',
      'Means of finance',
    ].join('\n');
    const out = runOnTexts([[0, page]], 'RHP');
    const field = out.fields.objects_of_offer;
    expect(field.value).toBeNull();
    expect(field.check.passed).toBe(false);
    expect(field.check.detail).toContain('500.00');
    expect(field.check.detail).toContain('1000.00');
  });

  it('E8: only strictly sequential numbers count — a nested list is not a risk factor', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const heading = ['SECTION II - RISK FACTORS', 'INTERNAL RISK FACTORS'];
    const items = Array.from({ length: 21 }, (_v, i) => `${i + 1}. Risk number ${i + 1} exists. More prose follows.`);
    // A nested enumeration inside item 21 and a wrapped line number, neither a risk factor.
    const noise = ['1. Form CHG-1 for creation of charges;', '2. Form ADT-1 for auditors;', '192. Further, in addition to the above'];
    const out = runOnTexts([
      [0, [...heading, ...items, ...noise].join('\n')],
      [1, 'SECTION III - INTRODUCTION\n22. This number is past the end of the chapter.'],
    ], 'RHP');
    expect(out.fields.risk_factor_count.value).toBe(21);
    const risks = out.fields.risk_factors.value as { n: number; heading: string }[];
    expect(risks[0].heading).toBe('Risk number 1 exists.');
    expect(risks[20].heading).toBe('Risk number 21 exists.');
  });
});

/**
 * T-434 — the SCANNED (BSE) copy of the same Deepa Jewellers advertisement, whose
 * text comes from OCR. The strings below are the OCR output VERBATIM: the offer
 * table loses the leading digit of `1,990.52` and splits `11,848,340`, and the
 * comma after the bid-open day is read as a `1`. Each case pins the behaviour
 * that keeps a mangled cell from being published as a value.
 */
describe('extract_filing — OCR-mangled price band advertisement (synthetic, offline)', () => {
  const OCR_OFFER_SENTENCE =
    'MILLION ("OFFER"). THE OFFER COMPRISES OF A FRESH ISSUE OF UP TO O EQUITY SHARES ' +
    'AGGREGATING UP TO ?2,500.00 MILLION CTHE "FRESH ISSUE") AND AN OFFER FOR SALE OF UP TO ' +
    '11 848340 EQUITY SHARES AGGREGATING UP TO [] MILLION (THE "OFFER FOR SALE").';
  const OCR_PRICE_BAND =
    'PRICE BAND: ` 168 TO ` 177 PER EQUITY SHARE OF FACE VALUE OF ` 2 EACH.';

  function ocrPage(extra: string[]): [number, string][] {
    return [[0, [OCR_PRICE_BAND, OCR_OFFER_SENTENCE, ...extra].join('\n')]];
  }

  it('a fresh-issue row whose cells OCR inconsistently falls back to the offer sentence', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts(ocrPage([
      'Fresh Issue 1 14.880952 2,500.00 14 1 24,293 2,500.00',
      'Offer for Sales 11,848,340 1,990.52 11,848,340 2,097.16',
    ]), 'PRICE_BAND_AD');
    const f = out.fields.fresh_issue_amount;
    expect(f.value).toBe(2500.0);
    expect(f.check.name).toBe('prose_fallback');
    expect((f as unknown as { source_text?: string }).source_text).toBe('prose');
  });

  it('an OFS share count split by OCR is rejoined from the offer sentence', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts(ocrPage([
      'Fresh Issue 14,880,952 2,500.00 14,124,293 2,500.00',
      'Offer for Sales ,990.52 1 848,340 2,097.16',
    ]), 'PRICE_BAND_AD');
    const f = out.fields.ofs_shares;
    expect(f.value).toBe(11848340);
    expect(f.check.name).toBe('prose_fallback');
  });

  it('a stray "1" in the OFS amount cell is NULLED, never emitted as the offer size', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts(ocrPage([
      'Fresh Issue 14,880,952 2,500.00 14,124,293 2,500.00',
      'Offer for Sales ,990.52 1 848,340 2,097.16',
    ]), 'PRICE_BAND_AD');
    for (const key of ['ofs_amount', 'ofs_amount_at_cap']) {
      const f = out.fields[key];
      expect(f.value).toBeNull();
      expect(f.check.name).toBe('ofs_shares_x_price_equals_amount');
      expect(f.check.detail).toContain('check_failed');
    }
  });

  it('an offer table whose amount cannot be arithmetic-checked emits no amount at all', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts([[0, [OCR_PRICE_BAND, 'Offer for Sales 1'].join('\n')]],
      'PRICE_BAND_AD');
    expect(out.fields.ofs_amount.value).toBeNull();
    expect(out.fields.ofs_amount.check.detail)
      .toBe('offer_for_sale_amount_not_arithmetic_checkable');
  });

  it('a comma OCR-read as a digit still yields the bid-open date', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts(ocrPage([
      'ANCHOR INVESTOR BID/ OFFER PERIOD OPENS AND CLOSES ON Monday. August 31, 2026',
      'BI D/OFFER BID/OFFER OPENS ON: TUESDAY, SEPTEMBER 01 1 2026',
      'BID/OFFER CLOSES ON: THURSDAY, SEPTEMBER 03, 2026',
    ]), 'PRICE_BAND_AD');
    expect(out.fields.open_date.value).toBe('2026-09-01');
    expect(out.fields.close_date.value).toBe('2026-09-03');
    expect(out.fields.anchor_bid_date.value).toBe('2026-08-31');
  });

  it('an OCR-repaired date that breaks the timetable order is nulled with its own reason', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const out = runOnTexts(ocrPage([
      'ANCHOR INVESTOR BID/ OFFER PERIOD OPENS AND CLOSES ON Monday. August 31, 2026',
      'BI D/OFFER BID/OFFER OPENS ON: TUESDAY, SEPTEMBER 09 1 2026',
      'BID/OFFER CLOSES ON: THURSDAY, SEPTEMBER 03, 2026',
    ]), 'PRICE_BAND_AD');
    expect(out.fields.open_date.value).toBeNull();
    expect(out.fields.open_date.check.detail).toBe('date_order_after_ocr_repair');
    expect(out.fields.close_date.value).toBe('2026-09-03');
  });
});

describe('extract_filing — business_description column-splice guard (synthetic, offline)', () => {
  it('a spliced-in ALL-CAPS neighbouring column is cut, keeping only the prose sentence', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const spliced =
      'Our Company processes and supplies 22K hallmarked gold jewellery, including plain ' +
      'and precious-stone studded ornaments, through an outsourced manufacturing model. ' +
      'THE EQUITY SHARES OF THE COMPANY WILL GET LISTED ON THE MAIN BOARDS OF BSE AND NSE. ' +
      'BSE SHALL BE THE DESIGNATED STOCK EXCHANGE. QIB PORTION: NOT MORE THAN 50%.';
    const out = runOnTexts([[0, spliced]], 'PRICE_BAND_AD');
    const f = out.fields.business_description;
    expect(f.value).toBe(
      'Our Company processes and supplies 22K hallmarked gold jewellery, including plain ' +
      'and precious-stone studded ornaments, through an outsourced manufacturing model.',
    );
  });

  it('a clean two-sentence description is left unchanged', (ctx) => {
    if (!pythonAvailable) return ctx.skip();
    const clean =
      'Our Company designs and manufactures furniture products, including wooden furniture ' +
      'and home decor items. We also provide interior design consultancy services to retail ' +
      'and corporate clients.';
    const out = runOnTexts([[0, clean]], 'PRICE_BAND_AD');
    const f = out.fields.business_description;
    expect(f.value).toBe(clean);
  });
});
