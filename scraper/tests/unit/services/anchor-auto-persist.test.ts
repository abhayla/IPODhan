import { describe, it, expect, vi } from 'vitest';

/**
 * W-142 — the anchor route's outcome map and its end-to-end wiring.
 *
 * `classifyAnchorAutoOutcome` is the single place that decides what a human
 * later sees on `documents.extraction_status`, so it is tested as a pure
 * function over BOTH enumerations it reads (the scrape failure kind and the
 * persister's `refusedKind`) — never over prose. The last block drives the real
 * parser -> real persist door -> classifier chain on the live Qualiance (NSE
 * Emerge SME) letter text, so the wiring is proven, not assumed.
 */
import { classifyAnchorAutoOutcome } from '../../../src/services/anchor-auto-persist.js';
import {
  persistAnchorReport,
  type AnchorPersistSummary,
} from '../../../src/services/anchor-persister.js';
import { parseAnchorReport } from '../../../src/scrapers/anchor-report-parser.js';
import {
  pagesAreEmpty,
  ANCHOR_EMPTY_PAGES_REASON,
} from '../../../src/scrapers/anchor-investors-scraper.js';

const summary = (o: Partial<AnchorPersistSummary> = {}): AnchorPersistSummary => ({
  written: 1,
  investorsWritten: 6,
  totals: { shares: 1009000, amountCrore: 12.8143, count: 6 },
  checks: [],
  notCheckable: [],
  refusedReason: null,
  refusedKind: null,
  lowConfidenceNames: [],
  skippedBlankNames: 0,
  applied: true,
  ...o,
});

describe('classifyAnchorAutoOutcome — the outcome map', () => {
  it('a clean persist is COMPLETED-bound', () => {
    expect(classifyAnchorAutoOutcome({ summary: summary() }).kind).toBe('persisted');
  });

  it('the W-81 garbled-name floor is MANUAL_REVIEW and carries the persister reason', () => {
    const out = classifyAnchorAutoOutcome({
      summary: summary({
        refusedReason: 'anchor write refused: 6 of 12 investor names are unreadable (> 30% floor)',
        refusedKind: 'name_quality',
      }),
    });
    expect(out.kind).toBe('manual_review');
    expect(out.reason).toContain('unreadable');
  });

  it('an all-blank name column is MANUAL_REVIEW too — same class, same human', () => {
    const out = classifyAnchorAutoOutcome({
      summary: summary({
        refusedReason: 'all 12 investor rows have a blank name',
        refusedKind: 'blank_names',
      }),
    });
    expect(out.kind).toBe('manual_review');
  });

  it('an arithmetic refusal is retryable FAILED, never MANUAL_REVIEW', () => {
    const out = classifyAnchorAutoOutcome({
      summary: summary({ refusedReason: 'shares x price mismatch', refusedKind: 'arithmetic' }),
    });
    expect(out.kind).toBe('failed');
  });

  it('W-168b: a persister refusal (arithmetic) is DETERMINISTIC — same PDF, same verdict, so the 2nd identical repeat escalates to MANUAL_REVIEW instead of retrying forever', () => {
    const out = classifyAnchorAutoOutcome({
      summary: summary({ refusedReason: 'shares x price mismatch', refusedKind: 'arithmetic' }),
    });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.deterministic).toBe(true);
      expect(out.sourceKind).toBe('arithmetic');
    }
  });

  it('a locked / protected / missing-row refusal is FAILED, not a silent success', () => {
    for (const kind of ['scraper_locked', 'protected_field', 'ipo_missing', 'no_report'] as const) {
      const out = classifyAnchorAutoOutcome({ summary: summary({ refusedReason: 'x', refusedKind: kind }) });
      expect(out.kind).toBe('failed');
    }
  });

  it('W-168b: protected_field is a content verdict (admin protection does not clear on retry) — DETERMINISTIC', () => {
    const out = classifyAnchorAutoOutcome({
      summary: summary({ refusedReason: 'x', refusedKind: 'protected_field' }),
    });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.deterministic).toBe(true);
      expect(out.sourceKind).toBe('protected_field');
    }
  });

  it('W-168b: scraper_locked / ipo_missing / no_report are TRANSIENT — never deterministic, stay retryable forever', () => {
    for (const kind of ['scraper_locked', 'ipo_missing', 'no_report'] as const) {
      const out = classifyAnchorAutoOutcome({ summary: summary({ refusedReason: 'x', refusedKind: kind }) });
      expect(out.kind).toBe('failed');
      if (out.kind === 'failed') {
        expect(out.deterministic).toBeFalsy();
        expect(out.sourceKind).toBe(kind);
      }
    }
  });

  it('a memory-ceiling sidecar takes the W-137 hard-failure path', () => {
    const out = classifyAnchorAutoOutcome({
      failure: { kind: 'hard_failure', reason: 'anchor sidecar memory abort (exit 3)' },
    });
    expect(out.kind).toBe('hard_failure');
  });

  it('W-139 empty pages are MANUAL_REVIEW naming the OCR heuristic', () => {
    const out = classifyAnchorAutoOutcome({ failure: { kind: 'empty_pages', reason: 'ignored' } });
    expect(out.kind).toBe('manual_review');
    expect(out.reason).toContain(ANCHOR_EMPTY_PAGES_REASON);
  });

  it('every other scrape failure is retryable FAILED', () => {
    const kinds = ['no_document', 'unreadable_file', 'sidecar_error', 'parse_failed', 'issue_size_conflict', 'error'] as const;
    for (const kind of kinds) {
      expect(classifyAnchorAutoOutcome({ failure: { kind, reason: 'r' } }).kind).toBe('failed');
    }
  });

  it('a missing summary is FAILED, never a claimed persist', () => {
    expect(classifyAnchorAutoOutcome({}).kind).toBe('failed');
  });
});

describe('pagesAreEmpty — the W-139 detector', () => {
  it('is true for no pages and for whitespace-only pages', () => {
    expect(pagesAreEmpty([])).toBe(true);
    expect(pagesAreEmpty(['', '   '])).toBe(true);
  });

  it('is false as soon as one page carries text', () => {
    expect(pagesAreEmpty(['', 'Sub: Public Issue'])).toBe(false);
  });
});

// --------------------------------------------------- real chain, real letter

/**
 * The Qualiance (NSE Emerge, SME) anchor letter in the exact
 * `scripts/anchor_report_text.py` output shape — merged "<price> <amount>"
 * trailing cell included (W-132). The raw letter text this was transcribed
 * from is at `tests/fixtures/sme/qualiance-anchor-letter-text.txt`.
 */
const QUALIANCE_PAGES = [
  [
    'Sub: Public Issue of equity shares of Qualiance International Limited',
    '# 1 | Bharat Venture Opportunities Fund | 2,57,000 | 25.47% | 127 3,26,39,000',
    '# 2 | Carnelian AIF Category I Trust-Scheme 1 | 2,57,000 | 25.47% | 127 3,26,39,000',
    '# 3 | Hem Growth Opportunities Fund | 2,57,000 | 25.47% | 127 3,26,39,000',
    '# 4 | Finavenue Capital Trust - Finavenue Growth Fund | 80,000 | 7.93% | 127 1,01,60,000',
    '# 5 | 360 ONE LVF Treasury Solutions Fund | 79,000 | 7.83% | 127 1,00,33,000',
    '# 6 | Tattvam AIF Trust -Aanjay Ageless AIF Fund | 79,000 | 7.83% | 127 1,00,33,000',
    '#  | TOTAL | 10,09,000 | 100.00% | 12,81,43,000',
    'No Mutual Funds, Life Insurance Companies, or Pension Funds have submitted applications.',
  ].join('\n'),
  ['Sr. No. Name of Scheme No. of Equity Shares % of Anchor Investor Portion Bid price', 'Nil'].join('\n'),
];

const CRORE = 10_000_000;

function anchorDataFromPages(pages: string[]) {
  const parsed = parseAnchorReport(pages);
  if (!parsed.ok) throw new Error((parsed as { ok: false; reason: string }).reason);
  const report = (parsed as { ok: true; value: Record<string, never> }).value as never as {
    rows: { name: string; shares: number; amountRupees: number; percentOfAnchorPortion: number }[];
    totalShares: number;
    totalAmountRupees: number;
    letterDate: Date | null;
    printedTotalShares: number | null;
    printedTotalAmountRupees: number | null;
    printedCount: number | null;
    percentageCheckPassed: boolean;
    sharesTimesPriceCheckPassed: boolean;
  };
  // The sidecar page text transcribed here starts at the table, so it carries
  // no letterhead date; the real scraper reads one and derives both lock-in
  // dates from it (SEBI: +30d / +90d). Supplied here so the persister's
  // required_dates_present gate sees the production shape.
  const bidDate = report.letterDate ?? new Date('2026-09-03T00:00:00Z');
  const plus = (days: number) => new Date(bidDate.getTime() + days * 86_400_000);
  return {
    bidDate,
    totalSharesOffered: report.totalShares,
    totalAmountRaised: report.totalAmountRupees / CRORE,
    anchorInvestorsCount: report.rows.length,
    lockIn50PercentDate: plus(30),
    lockInRemainingDate: plus(90),
    printedTotalShares: report.printedTotalShares,
    printedTotalAmountRaised:
      report.printedTotalAmountRupees === null ? null : report.printedTotalAmountRupees / CRORE,
    printedCount: report.printedCount,
    percentageCheckPassed: report.percentageCheckPassed,
    sharesTimesPriceCheckPassed: report.sharesTimesPriceCheckPassed,
    investorList: report.rows.map((r) => ({
      name: r.name,
      type: 'Unknown',
      shares: r.shares,
      amount: r.amountRupees / CRORE,
      percentOfIssue: r.percentOfAnchorPortion,
    })),
  };
}

function persisterDeps(scraped: unknown) {
  return {
    scrapeAnchorReport: vi.fn(async () => scraped),
    anchorInvestorRepository: {},
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: 'ipo-1',
        companyName: 'Qualiance International Limited',
        scraperLocked: false,
      })),
    },
    persist: vi.fn(async () => undefined),
  } as never;
}

describe('the real chain on the real SME letter — parse -> persist door -> outcome', () => {
  it('the Qualiance anchor letter reaches the persist door and classifies as persisted', async () => {
    const data = anchorDataFromPages(QUALIANCE_PAGES);
    expect(data.anchorInvestorsCount).toBe(6);

    const result = await persistAnchorReport(
      'ipo-1',
      { companyName: 'Qualiance International Limited', apply: true },
      persisterDeps(data)
    );
    expect(result.refusedReason).toBeNull();
    expect(result.investorsWritten).toBe(6);
    expect(classifyAnchorAutoOutcome({ summary: result }).kind).toBe('persisted');
  });

  it('the same letter with its name column destroyed is refused by the floor and routed to MANUAL_REVIEW', async () => {
    const data = anchorDataFromPages(QUALIANCE_PAGES);
    const garbled = ['M OTI LA', '0 1', 'B', 'X 2'];
    data.investorList.slice(0, 4).forEach((row, i) => {
      row.name = garbled[i];
    });

    const result = await persistAnchorReport(
      'ipo-1',
      { companyName: 'Qualiance International Limited', apply: true },
      persisterDeps(data)
    );
    expect(result.refusedKind).toBe('name_quality');
    const outcome = classifyAnchorAutoOutcome({ summary: result });
    expect(outcome.kind).toBe('manual_review');
    expect(outcome.reason).toContain('unreadable');
  });
});
