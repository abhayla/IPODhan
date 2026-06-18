import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  extractFinancialsFromDetailHtml,
  extractPeersFromDetailHtml,
  extractObjectivesFromDetailHtml,
} from '../../../src/scrapers/chittorgarh-detail-fields.js';

// Real verbatim sections captured from chittorgarh.com/ipo/modern-diagnostic-ipo/2276/.
const fixture = readFileSync(
  fileURLToPath(new URL('../../fixtures/chittorgarh-modern-diagnostic-detail.html', import.meta.url)),
  'utf8'
);

describe('extractFinancialsFromDetailHtml', () => {
  const fin = extractFinancialsFromDetailHtml(fixture)!;

  it('returns an object for a page with a financials section', () => {
    expect(fin).not.toBeNull();
  });

  it('maps per-FY P&L to the column\'s TRUE fiscal year (no fabricated year labels)', () => {
    // Page columns: 30 Jun 2025 (interim), 31 Mar 2025 (FY2025), 31 Mar 2024 (FY2024), 31 Mar 2023 (FY2023).
    // Only FY2024/FY2023 have schema slots; FY2025 + the interim are correctly dropped.
    expect(fin.totalIncomeFy2024).toBe(68.67);
    expect(fin.totalIncomeFy2023).toBe(56.61);
    expect(fin.profitFy2024).toBe(5.79);
    expect(fin.profitFy2023).toBe(-5.73); // losses are real — negative PAT preserved
    expect(fin.ebitdaFy2024).toBe(11.05);
    expect(fin.ebitdaFy2023).toBe(-0.99);
    // No FY2025 slot, no fabricated mapping
    expect(fin.totalIncomeFy2022).toBeUndefined();
    // No "Revenue from operations" line on this page → revenue stays absent (not faked)
    expect(fin.revenueFy2024).toBeUndefined();
  });

  it('takes the most-recent reported column for balance-sheet snapshots', () => {
    expect(fin.netWorth).toBe(23.72);
    expect(fin.reservesAndSurplus).toBe(12.72);
    expect(fin.totalBorrowing).toBe(30.38);
    expect(fin.totalAssets).toBe(77.86);
  });

  it('extracts KPI ratios', () => {
    expect(fin.roe).toBe(55.21);
    expect(fin.ronw).toBe(43.27);
    expect(fin.debtToEquity).toBe(1.07);
  });

  it('extracts the valuation snapshot (pre/post EPS, P/E, promoter holding, market cap)', () => {
    expect(fin.preIpoEps).toBe(8.15);
    expect(fin.postIpoEps).toBe(7.94);
    expect(fin.eps).toBe(7.94); // post-issue EPS is the listed-share EPS
    expect(fin.peRatio).toBe(11.33); // post-issue P/E
    expect(fin.promoterHoldingPreIssue).toBe(99.99);
    expect(fin.promoterHoldingPostIssue).toBe(72.85);
    expect(fin.marketCap).toBe(135.89);
  });

  it('returns null for a page with no financials', () => {
    expect(extractFinancialsFromDetailHtml('<div>no tables here</div>')).toBeNull();
    expect(extractFinancialsFromDetailHtml('')).toBeNull();
  });

  it('drops domain-implausible values instead of persisting garbage', () => {
    const garbled = `<table id="financialTable"><thead><tr><th>Period Ended</th><th>31 Mar 2024</th></tr></thead>
      <tbody>
        <tr><td>Net Worth</td><td>99999999999</td></tr>
        <tr><td>RoNW</td><td></td></tr>
        <tr><td>Total Income</td><td>-50</td></tr>
      </tbody></table>`;
    const r = extractFinancialsFromDetailHtml(garbled);
    // netWorth out of bound → dropped; total income negative → dropped (revenue/income must be >= 0)
    expect(r?.netWorth).toBeUndefined();
    expect(r?.totalIncomeFy2024).toBeUndefined();
  });
});

describe('extractObjectivesFromDetailHtml', () => {
  it('extracts every object-of-issue line with serial + amount', () => {
    const objs = extractObjectivesFromDetailHtml(fixture);
    expect(objs).toHaveLength(4);
    expect(objs[0]).toEqual({
      sno: 1,
      description: 'Funding capital expenditure for purchase of medical Equipments for diagnostic centre and laboratories',
      amount: 20.69,
    });
    expect(objs[1].amount).toBe(8.0);
    expect(objs[3]).toEqual({ sno: 4, description: 'General Corporate Expenses', amount: 3.33 });
  });

  it('returns [] when there is no objectives table', () => {
    expect(extractObjectivesFromDetailHtml('<div>nothing</div>')).toEqual([]);
    expect(extractObjectivesFromDetailHtml('')).toEqual([]);
  });

  it('leaves an undisclosed amount null, never guessed', () => {
    const html = `<table id="ObjectiveIssue"><tbody>
      <tr><td>1</td><td>General corporate purposes</td><td>[●]</td></tr>
    </tbody></table>`;
    const objs = extractObjectivesFromDetailHtml(html);
    expect(objs).toHaveLength(1);
    expect(objs[0].amount).toBeNull();
  });
});

describe('extractPeersFromDetailHtml', () => {
  const peers = extractPeersFromDetailHtml(fixture);

  it('decodes the RSC-escaped peer table and returns its rows', () => {
    expect(peers.length).toBe(2); // subject row + one listed peer
  });

  it('maps peer metrics by header column', () => {
    const vijaya = peers.find((p) => /vijaya/i.test(p.companyName));
    expect(vijaya).toBeDefined();
    expect(vijaya!.eps).toBe(13.92);
    expect(vijaya!.dilutedEps).toBe(13.92);
    expect(vijaya!.nav).toBe(77.42);
    expect(vijaya!.peRatio).toBe(72.36);
    expect(vijaya!.ronw).toBe(18.07);
  });

  it('omits a blank metric cell (subject row has no P/E)', () => {
    const subject = peers.find((p) => /modern diagnostic/i.test(p.companyName));
    expect(subject).toBeDefined();
    expect(subject!.peRatio).toBeUndefined();
    expect(subject!.ronw).toBe(43.27);
  });

  it('returns [] when there is no peer table', () => {
    expect(extractPeersFromDetailHtml('<div>nothing</div>')).toEqual([]);
    expect(extractPeersFromDetailHtml('')).toEqual([]);
  });
});
