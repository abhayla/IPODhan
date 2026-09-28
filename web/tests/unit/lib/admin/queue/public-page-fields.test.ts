/**
 * Drift guard for OD-136 group 1: every field listed as "shown by the public IPO page" must still be
 * read by web/app/ipos/[slug]/page.tsx or a component it imports. A field the page stops rendering
 * turns this red instead of silently ranking as group 1.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PUBLIC_PAGE_FIELDS, isPublicPageField } from '@/lib/admin/queue/public-page-fields';

const WEB = path.resolve(__dirname, '../../../../..');
const PAGE = path.join(WEB, 'app/ipos/[slug]/page.tsx');

function pageSources(): string {
  const page = readFileSync(PAGE, 'utf8');
  const imports = [...page.matchAll(/@\/(components\/[A-Za-z/-]+)/g)].map((m) => m[1]);
  const files = new Set<string>();
  for (const imp of imports) {
    for (const f of [`${imp}.tsx`, `${imp}/index.tsx`]) {
      const abs = path.join(WEB, f);
      if (existsSync(abs)) files.add(abs);
    }
  }
  expect(files.size).toBeGreaterThan(20);
  return [page, ...[...files].map((f) => readFileSync(f, 'utf8'))].join('\n');
}

describe('PUBLIC_PAGE_FIELDS', () => {
  const src = pageSources();

  it('lists only fields the public IPO page still reads', () => {
    const missing: string[] = [];
    for (const [table, fields] of Object.entries(PUBLIC_PAGE_FIELDS)) {
      for (const f of fields) {
        const re = new RegExp(`\\.${f}\\b|\\b${f}\\??:|'${f}'|"${f}"`);
        if (!re.test(src)) missing.push(`${table}.${f}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('answers per table and handles a row-table hold key', () => {
    expect(isPublicPageField('ipos', 'priceRangeMax')).toBe(true);
    expect(isPublicPageField('ipos', 'companyWebsite')).toBe(false);
    expect(isPublicPageField('peer_companies:abc', 'peRatio')).toBe(true);
    expect(isPublicPageField('no_such_table', 'x')).toBe(false);
  });
});

/**
 * A4 review item 4: the drift guard above was one-way (a listed field the page stops rendering
 * turns red) but a field the page STARTS rendering, never added here, silently ranked group 2
 * instead of group 1 — undercounting how many fields OD-136 must treat as public-facing. This
 * checks the other direction: for every page.tsx variable known to hold one table's row(s) (the
 * table page.tsx itself names, e.g. `financialData` for `financial_data`, `peerCompanies` for
 * `peer_companies` — "the page data gives the table"), every `.field` access on it must already be
 * in PUBLIC_PAGE_FIELDS for that table, or be a known non-field access (a JS Array/Object method,
 * or a bookkeeping/relation key that is never itself a rendered value).
 */
describe('PUBLIC_PAGE_FIELDS (two-way): the page never shows an untracked field', () => {
  // page.tsx ONLY, not the imported components: the accessor -> table map below is read off
  // page.tsx's own destructuring/Promise.all bindings, and a component's unrelated local variable
  // of the same name (e.g. a `documents` prop inside some other component) would false-positive.
  const src = readFileSync(PAGE, 'utf8');

  // The one-row-per-IPO variable each destructured/loaded in page.tsx is bound to, and the table
  // it comes from — read directly off the destructuring/Promise.all block in page.tsx, not guessed.
  const ACCESSOR_TABLE: Record<string, string> = {
    ipo: 'ipos',
    ipoDetails: 'ipo_details',
    financialData: 'financial_data',
    anchorInvestor: 'anchor_investors',
    listingPerformance: 'listing_performance',
    documents: 'documents',
    peerCompanies: 'peer_companies',
    registrarRelation: 'registrars',
    valuationRows: 'ipo_valuation',
    promoterRows: 'promoters',
    acquisitionRangeRows: 'promoter_acquisition_ranges',
    intermediaryRows: 'ipo_intermediaries',
    riskFactorRows: 'ipo_risk_factors',
    financialStatementRows: 'financial_statements',
    brlmTrackRecordRows: 'brlm_track_record',
  };

  // Array/Object methods a `.field`-shaped regex cannot tell apart from a real column name
  // (`peerCompanies.length`, `valuationRows.find(...)`), plus per-table non-field accesses:
  // `ipo.id`/`ipo.slug` are identity, not a shown value; `ipo.registrarRelation` is the nested
  // relation object itself, not a scalar (its OWN fields are checked via the `registrarRelation`
  // accessor above).
  const NOT_A_FIELD: Record<string, readonly string[]> = {
    '*': ['length', 'find', 'map', 'flatMap', 'filter', 'some', 'every', 'reduce', 'forEach', 'slice', 'join', 'includes'],
    ipos: ['id', 'slug', 'registrarRelation'],
  };
  const isKnownNonField = (table: string, field: string) =>
    NOT_A_FIELD['*'].includes(field) || (NOT_A_FIELD[table] ?? []).includes(field);

  it('every `<tableVar>.field` access in page.tsx is a tracked group-1 field', () => {
    const extra: string[] = [];
    for (const [accessor, table] of Object.entries(ACCESSOR_TABLE)) {
      const re = new RegExp(`\\b${accessor}\\??\\.([a-zA-Z][a-zA-Z0-9]*)`, 'g');
      const fields = new Set<string>();
      for (const m of src.matchAll(re)) fields.add(m[1]);
      for (const f of fields) {
        if (isKnownNonField(table, f)) continue;
        if (!(PUBLIC_PAGE_FIELDS[table] ?? []).includes(f)) extra.push(`${table}.${f}`);
      }
    }
    expect(extra).toEqual([]);
  });
});
