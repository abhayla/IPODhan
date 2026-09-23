import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readPrintedTotal,
  decideOd74,
  resolveChittorgarhUrl,
  pageFileName,
  parseUrlOverrides,
  fiscalYearOf,
  matchLookupRows,
  TOOL_NAME,
} from '../../../scripts/repair-issue-size-chittorgarh-once-od74.js';
import { decidePageRead, PageStore, sha256Of } from '../../../scripts/lib/od74-page-store.js';
import { classifyZeroAction } from '../../../scripts/lib/od77-issue-size-zeros.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// REAL pages, fetched once from chittorgarh.com on 2026-09-23 (OD-74 core proof).
const FIX = path.resolve(HERE, '../../fixtures/chittorgarh');
const page = (n: string) => readFileSync(path.join(FIX, `chittorgarh-${n}-detail.html`), 'utf8');
// The TRACKED page store: the exact bytes the repair read once (OD-74), hash-pinned.
const STORE_DIR = path.resolve(HERE, '../../../scripts/data/od74-issue-size');
const pinned = (url: string) => new PageStore(STORE_DIR, TOOL_NAME).readPinned(url).text;

describe('readPrintedTotal — the real CHITTORGARH detail page', () => {
  it('reads the precise printed total from paluck (Rs 33.00 cr), cross-checked by the rounded table cell', () => {
    const r = readPrintedTotal(page('paluck-technologies'), 48);
    expect(r).toEqual({ rupees: 330_000_000, precise: 330_000_000, tableRounded: 330_000_000, reason: null, precision: 50_000 });
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

describe('readPrintedTotal — the pinned real pages (CMS, Windlas, Mopshop fixed price)', () => {
  it('CMS Info Systems prints Rs 1,100.00 cr (the BSE-computed 167.93 cr is wrong)', () => {
    expect(readPrintedTotal(pinned('https://www.chittorgarh.com/ipo/cms-info-systems-ipo/1203/'), 216).rupees).toBe(11_000_000_000);
  });
  it('Windlas Biotech prints Rs 401.54 cr', () => {
    expect(readPrintedTotal(pinned('https://www.chittorgarh.com/ipo/windlas-biotech-ipo/1135/'), 460).rupees).toBe(4_015_400_000);
  });
  it('Mopshop, a FIXED-price issue, is read through the same path (Rs 27.26 cr)', () => {
    const r = readPrintedTotal(pinned('https://www.chittorgarh.com/ipo/mopshop-distribution-ipo/2769/'), null);
    expect(r.rupees).toBe(272_600_000);
    expect(r.reason).toBeNull();
  });
});

describe('decideOd74 — OD-73: identical or equal-within-rounding is a no-op', () => {
  it('WRITE when the printed total differs materially from the BSE-computed value', () => {
    expect(decideOd74({ stored: 470_000_000, printed: 4_015_400_000 })).toMatchObject({ status: 'WRITE', write: true });
  });
  it('NOOP_IDENTICAL for the exact same number — never written, never re-stamped', () => {
    expect(decideOd74({ stored: 267_300_000, printed: 267_300_000 })).toMatchObject({ status: 'NOOP_IDENTICAL', write: false });
  });
  it('NOOP_WITHIN_ROUNDING inside half the printed last digit (0.005 cr): the stored exact number is kept', () => {
    expect(decideOd74({ stored: 330_048_000, printed: 330_000_000 })).toMatchObject({ status: 'NOOP_WITHIN_ROUNDING', write: false });
    expect(decideOd74({ stored: 749_250_000, printed: 749_300_000 })).toMatchObject({ status: 'NOOP_WITHIN_ROUNDING', write: false });
  });
  it('one rupee past the printed rounding is a real difference', () => {
    expect(decideOd74({ stored: 330_050_001, printed: 330_000_000 })).toMatchObject({ status: 'WRITE', write: true });
  });
  it('a table-cell-only figure carries whole-crore rounding (0.5 cr)', () => {
    expect(decideOd74({ stored: 507_744_000, printed: 510_000_000, precision: 5_000_000 })).toMatchObject({ write: false });
  });
  it('SKIP (no guess) when nothing was printed', () => {
    expect(decideOd74({ stored: 330_048_000, printed: null })).toMatchObject({ status: 'SKIP', write: false });
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

describe('the one-read guarantee (OD-74) — pinned, hash-verified, prod never fetches', () => {
  it('decidePageRead: pinned -> store; unpinned prod -> REFUSE; unpinned --no-fetch -> REFUSE; else fetch once', () => {
    expect(decidePageRead({ pinned: true, prodMode: true, allowFetch: true }).decision).toBe('READ_PINNED');
    expect(decidePageRead({ pinned: false, prodMode: true, allowFetch: true }).decision).toBe('REFUSE');
    expect(decidePageRead({ pinned: false, prodMode: false, allowFetch: false }).decision).toBe('REFUSE');
    expect(decidePageRead({ pinned: false, prodMode: false, allowFetch: true }).decision).toBe('FETCH');
  });
  it('every tracked page verifies against its pinned sha256', () => {
    const store = new PageStore(STORE_DIR, TOOL_NAME);
    const urls = Object.keys(store.manifest.pages);
    expect(urls.length).toBe(10);
    for (const u of urls) expect(sha256Of(store.readPinned(u).text)).toBe(store.manifest.pages[u].sha256);
  });
  it('a pinned file that is altered or missing is a refusal, never a re-fetch', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od74-unit-'));
    const s = new PageStore(dir, TOOL_NAME);
    const url = 'https://www.chittorgarh.com/ipo/x-ipo/1/';
    const e = s.pinPage(url, '<html>x</html>', 'x-ipo-1.html.gz', new Date('2026-09-23T05:30:00Z'));
    expect(s.readPinned(url).text).toBe('<html>x</html>');
    s.manifest.pages[url] = { ...e, sha256: '0'.repeat(64) };
    expect(() => s.readPinned(url)).toThrow(/fails its hash/);
    fs.rmSync(path.join(dir, e.file));
    expect(() => s.readPinned(url)).toThrow(/pinned file missing/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('pages are stored under the CHITTORGARH page identity, so every database shares the one read', () => {
    expect(pageFileName('https://www.chittorgarh.com/ipo/paluck-technologies-ipo/2702/')).toBe('paluck-technologies-ipo-2702.html.gz');
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

describe('the one lookup for an IPO with no page recorded', () => {
  it('fiscalYearOf follows the Indian April-March year', () => {
    expect(fiscalYearOf('2020-09-30')).toEqual({ year: 2020, range: '2020-21' });
    expect(fiscalYearOf('2026-02-26')).toEqual({ year: 2025, range: '2025-26' });
  });
  it('only an exact normalized-name match resolves; a near name is never taken', () => {
    const rows = [
      { Company: 'AAA Technologies Ltd.', '~urlrewrite_folder_name': 'aaa-technologies-ipo', '~id': 1068 },
      { Company: 'Banganga Papers Ltd.', '~urlrewrite_folder_name': 'banganga-ipo', '~id': 9 },
    ];
    expect(matchLookupRows(rows, 'AAA TECHNOLOGIES LTD')).toBe('https://www.chittorgarh.com/ipo/aaa-technologies-ipo/1068/');
    expect(matchLookupRows(rows, 'BANGANGA PAPER INDUSTRIES LTD')).toBeNull();
  });
});

describe('classifyZeroAction — OD-77 (a stored 0 is never kept as a value)', () => {
  it('TENDER and BUYBACK: the 0 is removed; NOT_APPLICABLE is derived, never stored', () => {
    expect(classifyZeroAction('TENDER')).toBe('REMOVE_NOT_APPLICABLE');
    expect(classifyZeroAction('BUYBACK')).toBe('REMOVE_NOT_APPLICABLE');
  });
  it('OFS, RIGHTS, NCD and IPO: the 0 is a missing value -> NOT_SOURCED', () => {
    for (const t of ['OFS', 'RIGHTS', 'NCD', 'IPO']) expect(classifyZeroAction(t)).toBe('NOT_SOURCED');
  });
});
