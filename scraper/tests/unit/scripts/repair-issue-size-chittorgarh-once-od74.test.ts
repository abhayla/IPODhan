import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readPrintedTotal,
  decideOd74,
  resolveChittorgarhUrl,
  pageCachePath,
  parseUrlOverrides,
  classifyZeroRow,
  TOOL_NAME,
} from '../../../scripts/repair-issue-size-chittorgarh-once-od74.js';

// REAL pages, fetched once from chittorgarh.com on 2026-09-23 (OD-74 core proof).
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/chittorgarh');
const page = (n: string) => readFileSync(path.join(FIX, `chittorgarh-${n}-detail.html`), 'utf8');

describe('readPrintedTotal — the real CHITTORGARH detail page', () => {
  it('reads the precise printed total from paluck (Rs 33.00 cr), cross-checked by the rounded table cell', () => {
    const r = readPrintedTotal(page('paluck-technologies'), 48);
    expect(r).toEqual({ rupees: 330_000_000, precise: 330_000_000, tableRounded: 330_000_000, reason: null });
  });

  it('reads kwick (Rs 50.77 cr) — the table cell rounds it to 51, the prose keeps the decimals', () => {
    const r = readPrintedTotal(page('kwick-forensic-solutions'), 90);
    expect(r.rupees).toBe(507_700_000);
    expect(r.tableRounded).toBe(510_000_000);
  });

  it('reads horizon (Rs 54.27 cr)', () => {
    expect(readPrintedTotal(page('horizon-reclaim-india'), 103).rupees).toBe(542_700_000);
  });

  it('refuses when the precise prose total and the table total disagree beyond rounding', () => {
    const html = page('horizon-reclaim-india').replace('of ₹54.27 crores', 'of ₹84.27 crores');
    const r = readPrintedTotal(html, 103);
    expect(r.rupees).toBeNull();
    expect(r.reason).toMatch(/disagree/);
  });

  it('refuses an unanchored prose figure when there is no table cell to cross-check it (could be a neighbour IPO)', () => {
    const r = readPrintedTotal('<p>Another company raised funds of ₹99.00 crores last year.</p>', 100);
    expect(r.rupees).toBeNull();
    expect(r.precise).toBe(990_000_000);
    expect(r.reason).toMatch(/not anchored/);
  });

  it('returns a reason, never a value, when the page prints no total', () => {
    const r = readPrintedTotal('<html><body>nothing here</body></html>', 100);
    expect(r.rupees).toBeNull();
    expect(r.reason).toMatch(/no printed total/);
  });
});

describe('decideOd74', () => {
  it('WRITE when the printed total differs materially from the BSE-computed value', () => {
    const d = decideOd74({ stored: 470_000_000, printed: 4_016_000_000 });
    expect(d.status).toBe('WRITE');
  });

  it('CONFIRM when the printed total agrees within its own printed precision (still written, with CHITTORGARH provenance)', () => {
    const d = decideOd74({ stored: 330_048_000, printed: 330_000_000 });
    expect(d.status).toBe('CONFIRM');
    expect(d.write).toBe(true);
  });

  it('SKIP (no guess) when nothing was printed', () => {
    const d = decideOd74({ stored: 330_048_000, printed: null });
    expect(d).toMatchObject({ status: 'SKIP', write: false });
  });
});

describe('resolveChittorgarhUrl — only URLs we already hold, never a guess', () => {
  it('prefers ipos.verifier_url', () => {
    expect(
      resolveChittorgarhUrl({ verifierUrl: 'https://www.chittorgarh.com/ipo/x-ipo/1/', lineageUrls: ['https://www.chittorgarh.com/ipo/y-ipo/2/'] })
    ).toBe('https://www.chittorgarh.com/ipo/x-ipo/1/');
  });
  it('falls back to a chittorgarh /ipo/ URL recorded in field_sources lineage', () => {
    expect(resolveChittorgarhUrl({ verifierUrl: null, lineageUrls: ['https://www.bseindia.com/a', 'https://www.chittorgarh.com/ipo/y-ipo/2/'] })).toBe(
      'https://www.chittorgarh.com/ipo/y-ipo/2/'
    );
  });
  it('returns null when neither exists', () => {
    expect(resolveChittorgarhUrl({ verifierUrl: 'https://example.com/', lineageUrls: [] })).toBeNull();
  });
  it('an explicit --url override wins', () => {
    expect(resolveChittorgarhUrl({ verifierUrl: null, lineageUrls: [], override: 'https://www.chittorgarh.com/ipo/z-ipo/3/' })).toBe(
      'https://www.chittorgarh.com/ipo/z-ipo/3/'
    );
  });
  it('rejects an override that is not a chittorgarh /ipo/ page', () => {
    expect(resolveChittorgarhUrl({ verifierUrl: null, lineageUrls: [], override: 'https://evil.example/ipo/z/3/' })).toBeNull();
  });
});

describe('the one-read guarantee', () => {
  it('the page cache is keyed by the CHITTORGARH page (not a DB id), so staging and prod share the one read', () => {
    expect(pageCachePath('/c', 'https://www.chittorgarh.com/ipo/paluck-technologies-ipo/2702/')).toBe(
      path.join('/c', 'paluck-technologies-ipo-2702.html')
    );
  });
  it('parseUrlOverrides reads slug=url pairs', () => {
    expect(parseUrlOverrides(['--url', 'a=https://www.chittorgarh.com/ipo/a-ipo/1/', '--url', 'b=https://www.chittorgarh.com/ipo/b-ipo/2/'])).toEqual({
      a: 'https://www.chittorgarh.com/ipo/a-ipo/1/',
      b: 'https://www.chittorgarh.com/ipo/b-ipo/2/',
    });
  });
  it('TOOL_NAME is stable (it is the updated_by stamp a re-run keys on)', () => {
    expect(TOOL_NAME).toBe('repair-issue-size-chittorgarh-once-od74');
  });
});

describe('classifyZeroRow — OD-62 mode (a stored 0 is never kept as a value)', () => {
  it('a non-IPO event with issue_size 0 is a class member', () => {
    expect(classifyZeroRow({ offeringType: 'TENDER', issueSize: 0 })).toBe(true);
    expect(classifyZeroRow({ offeringType: 'RIGHTS', issueSize: 0 })).toBe(true);
  });
  it('a real value, or a NULL, is not', () => {
    expect(classifyZeroRow({ offeringType: 'TENDER', issueSize: 10 })).toBe(false);
    expect(classifyZeroRow({ offeringType: 'NCD', issueSize: null })).toBe(false);
  });
  it('an IPO-typed zero is not swept in (reported separately, never re-typed)', () => {
    expect(classifyZeroRow({ offeringType: 'IPO', issueSize: 0 })).toBe(false);
  });
});
