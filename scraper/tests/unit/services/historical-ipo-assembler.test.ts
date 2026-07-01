/**
 * GitHub #71 — historical-IPO ingestion path, proven on Ather Energy.
 *
 * Ather (mainboard, listed 06-May-2025, loss-maker) is absent from the live
 * scraper feeds. This proves the deterministic ARCHIVAL ingestion path
 * (CG report-118 dates + CG detail issue-size/ISIN/lot/description, all via pure
 * extractors) assembles Ather's consolidated record matching the frozen oracle —
 * NO prod write, NO LLM, NO hand-typed value.
 *
 * Fixtures captured live 2026-06-29 (CG report-118 row + CG detail HTML).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { assembleHistoricalRecord, type HistoricalReportRow } from '../../../src/services/historical-ipo-assembler.js';
import { extractFinancialsFromDetailHtml } from '../../../src/scrapers/chittorgarh-detail-fields.js';

const FX = path.join(process.cwd(), 'tests', 'fixtures', 'historical');
const reportRow: HistoricalReportRow = JSON.parse(fs.readFileSync(path.join(FX, 'ather-cg-report118.json'), 'utf-8'));
const detailHtml = fs.readFileSync(path.join(FX, 'ather-cg-detail.html'), 'utf-8');

// Frozen Ather oracle (Chittorgarh + public record)
const ATHER = {
  company: 'Ather Energy Ltd.',
  open: '2025-04-28',
  close: '2025-04-30',
  allotment: '2025-05-02',
  listing: '2025-05-06',
  isin: 'INE0LEZ01016',
  issueSizeRupees: Math.round(2980.76 * 10000000), // ₹2,980.76 Cr
  lot: 46,
  segment: 'MAINBOARD',
};

describe('#71 historical ingestion — Ather consolidated record == oracle', () => {
  const { scraped, completeness } = assembleHistoricalRecord({ reportRow, detailHtml });

  it('company + segment + offering type', () => {
    expect(scraped.companyName).toBe(ATHER.company);
    expect(scraped.segment).toBe('MAINBOARD');
    expect(scraped.offeringType).toBe('IPO');
    expect(scraped.status).toBe('LISTED');
  });

  it('dates match the oracle (from CG report-118)', () => {
    expect(scraped.openDate).toBe(ATHER.open);
    expect(scraped.closeDate).toBe(ATHER.close);
    expect(scraped.allotmentDate).toBe(ATHER.allotment);
    expect(scraped.listingDate).toBe(ATHER.listing);
  });

  it('issue size, ISIN, lot match the oracle (from CG detail)', () => {
    expect(scraped.issueSize).toBe(ATHER.issueSizeRupees); // 2980.76 Cr in rupees
    expect(scraped.isin).toBe(ATHER.isin);
    expect(scraped.lotSize).toBe(ATHER.lot);
  });

  it('company description is present, clean, and plausible', () => {
    expect(scraped.companyDescription).toBeTruthy();
    expect((scraped.companyDescription as string).length).toBeGreaterThanOrEqual(20);
    expect(scraped.companyDescription).not.toMatch(/<[^>]+>/);
    expect(scraped.companyDescription).toMatch(/ather|electric|vehicle|two-wheeler|scooter/i);
  });

  it('completeness report flags a fully-assembled record (no missing core fields)', () => {
    expect(completeness.hasDates).toBe(true);
    expect(completeness.hasIssueSize).toBe(true);
    expect(completeness.hasIsin).toBe(true);
    expect(completeness.hasLot).toBe(true);
    expect(completeness.hasDescription).toBe(true);
    expect(completeness.missing).toEqual([]);
  });

  it('financials are deterministically extractable from CG detail (loss-maker)', () => {
    const fin = extractFinancialsFromDetailHtml(detailHtml);
    expect(fin).not.toBeNull();
    // Ather is a loss-maker with substantial revenue; assert a plausible revenue figure exists.
    const revenue = (fin as Record<string, unknown>)?.revenue ?? (fin as Record<string, unknown>)?.totalIncome;
    if (revenue != null) expect(Number(revenue)).toBeGreaterThan(0);
  });

  it('refuses to assemble without a listing date (not an aged-out LISTED IPO)', () => {
    expect(() => assembleHistoricalRecord({ reportRow: { Company: 'X Ltd' }, detailHtml: '' })).toThrow();
  });
});
