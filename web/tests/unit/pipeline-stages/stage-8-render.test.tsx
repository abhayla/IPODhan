/**
 * Stage 8 of the IPO pipeline test ladder (docs/reviews/ipo-pipeline-stage-gap-analysis.md
 * section 6 row 8): "Render | stage-6 DB | the IPO detail page | financials section rendered,
 * 'Awaiting data' gone".
 *
 * WHY THIS FILE LIVES UNDER web/ AND NOT scraper/tests/unit/pipeline-stages/: stage 8 is the
 * only rung of the ladder that renders React. The scraper's vitest config is a node
 * environment with no JSX pipeline; web's is jsdom + @vitejs/plugin-react. Putting the stage
 * here means it runs in the gate the same way every other stage does - pr-gate.yml already
 * runs `npm run test:unit` in ./web, whose include glob is tests/unit/**\/*.test.{ts,tsx} -
 * rather than needing a second, differently-configured runner. The layout rules
 * (stage-<N>-<slug>.test.tsx + fixtures/stage-<N>/expected-*.json, golden written from the
 * spec first, an offline arm that always runs plus an opt-in live arm) are exactly the ones in
 * scraper/tests/unit/pipeline-stages/README.md.
 *
 * FIXTURE IN / EXPECTED-OUTPUT-FILE OUT. The props are stage 6's golden output carried forward
 * unchanged (the ladder's "a stage is green only when its output feeds the next stage's fixture
 * unchanged"); fixtures/stage-8/expected-render.json is the golden, written from the spec and
 * the component's own documented formatters BEFORE this file ran. The offline arm renders the
 * REAL component - no staging call, no DB. The opt-in live arm (STAGE8_LIVE_URL) does one
 * read-only GET against staging.
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EnhancedFinancialMetricsSection } from '@/components/ipo-detail/EnhancedFinancialMetricsSection';

const WEB_ROOT = resolve(__dirname, '..', '..', '..');
const GOLDEN = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'stage-8', 'expected-render.json'), 'utf8'),
) as {
  input: { source: string; props: { financialData: any } };
  expectedText: {
    heading: string;
    rowLabels: string[];
    values: string[];
    nullPlaceholder: string;
  };
  expectedEmptyState: { case: string; expectedOutcome: string };
  redByDesign: { id: string; claim: string; spec: string; observedToday: string }[];
};

afterEach(() => cleanup());

describe('stage 8 / offline arm - the detail-page financials section on persisted props', () => {
  it('the fixture props really are stage 6 output, in INR crore', () => {
    const stage6 = JSON.parse(
      readFileSync(
        resolve(
          WEB_ROOT,
          '..',
          'scraper/tests/unit/pipeline-stages/fixtures/stage-6/expected-persist.json',
        ),
        'utf8',
      ),
    ).expectedWrite;
    const p = GOLDEN.input.props.financialData;
    for (const field of ['revenueFy2024', 'profitFy2024', 'ebitdaFy2024', 'totalIncomeFy2024']) {
      expect(p[field], field).toBeCloseTo(stage6[field], 6);
    }
  });

  it('renders the section heading and every metric row', () => {
    render(<EnhancedFinancialMetricsSection financialData={GOLDEN.input.props.financialData} />);
    expect(screen.getByText(GOLDEN.expectedText.heading)).toBeTruthy();
    for (const label of GOLDEN.expectedText.rowLabels) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
  });

  it('renders the persisted values with the documented currency format', () => {
    render(<EnhancedFinancialMetricsSection financialData={GOLDEN.input.props.financialData} />);
    for (const value of GOLDEN.expectedText.values) {
      expect(screen.getByText(value), value).toBeTruthy();
    }
  });

  it('a year the persist door never filled shows the placeholder, never a fabricated 0', () => {
    render(<EnhancedFinancialMetricsSection financialData={GOLDEN.input.props.financialData} />);
    const placeholders = screen.getAllByText(GOLDEN.expectedText.nullPlaceholder);
    // FY2022 + FY2023 for four metric rows = 8 cells with no persisted value.
    expect(placeholders.length).toBeGreaterThanOrEqual(8);
    expect(screen.queryByText('₹0.00 Cr')).toBeNull();
  });

  it('with nothing persisted the section renders nothing (the page shows its Awaiting-data notice)', () => {
    const { container } = render(<EnhancedFinancialMetricsSection financialData={null} />);
    expect(container.innerHTML).toBe('');
  });
});

// ---------------------------------------------------------------------------
// RED BY DESIGN - what row 8 asks for and the page does not do.
// ---------------------------------------------------------------------------
describe('stage 8 / RED BY DESIGN', () => {
  test.fails('S8-R1: the fiscal years the document reports are rendered', () => {
    render(<EnhancedFinancialMetricsSection financialData={GOLDEN.input.props.financialData} />);
    // The real Deepa RHP reports FY2026 / FY2025 / FY2024 (stage 5 annualYears).
    expect(screen.queryByText('FY2026')).not.toBeNull();
  });

  test.fails('S8-R2: the IPO detail page mounts this component', () => {
    const page = readFileSync(join(WEB_ROOT, 'app', 'ipos', '[slug]', 'page.tsx'), 'utf8');
    expect(page).toContain('EnhancedFinancialMetricsSection');
  });

  it('the golden names both render gaps with their spec line', () => {
    expect(GOLDEN.redByDesign.map((r) => r.id)).toEqual(['S8-R1', 'S8-R2']);
    for (const r of GOLDEN.redByDesign) {
      expect(r.spec.length).toBeGreaterThan(20);
      expect(r.observedToday.length).toBeGreaterThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// Opt-in live arm: one read-only GET against staging. Never runs in CI.
// ---------------------------------------------------------------------------
const liveUrl = process.env.STAGE8_LIVE_URL;
describe.skipIf(!liveUrl)('stage 8 / live arm - staging detail page, read-only', () => {
  it('the staging page serves HTML and does not show the Awaiting-data notice for financials', async () => {
    const res = await fetch(liveUrl as string, { redirect: 'follow' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.length).toBeGreaterThan(1000);
    expect(html).not.toMatch(/Awaiting data:[^<]*Financials/);
  }, 30_000);
});
