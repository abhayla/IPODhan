/**
 * The IPO page editor's rules (spec §9.2 items 5, 7, 12, 13; §9.3; OD-105, OD-108, OD-109, OD-121).
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ADMIN_SETTING_FIELDS,
  AWAITING_PHASE_B,
  DERIVED_FIELDS,
  EDITOR_TABLES,
  editorCatalogCounts,
  editorFieldCatalog,
  editorModeFor,
  ipoTypeKey,
} from '@/lib/admin/ipo-editor-fields';
import { buildWitnesses } from '@/lib/admin/ipo-editor-data';
import { previewCroreInput, previewPlainInput } from '@/lib/admin/editor-value-units';
import { formatIssueSizeCrores } from '@/lib/utils';
import { adminProvenanceFor } from '@/lib/repositories/ipo-field-plan-repository';

describe('item 7 / OD-105: which fields are editable, by §1 class', () => {
  it('D and T-except-status get the panel; X/W/M and status do not; C is derived; I only the two settings', () => {
    expect(editorModeFor('D', 'ipos.company_name')).toBe('panel');
    expect(editorModeFor('T', 'ipos.open_date')).toBe('panel');
    expect(editorModeFor('T', 'ipos.status')).toBe('readonly');
    for (const c of ['X', 'W', 'M'] as const) expect(editorModeFor(c, 'listing_performance.current_price')).toBe('readonly');
    expect(editorModeFor('C', 'ipos.slug')).toBe('derived');
    expect(editorModeFor('I', 'ipos.scraper_locked')).toBe('setting');
    expect(editorModeFor('I', 'ipos.rating_override')).toBe('setting');
    expect(editorModeFor('I', 'ipos.last_scraped_at')).toBe('readonly');
  });

  it('no Phase-B fields remain read-only after items 26 and 18 (#1275): identifiers (item 26) and type/segment/venue (item 18) are both editable now', () => {
    expect(Object.keys(AWAITING_PHASE_B)).toEqual([]);
    const cat = editorFieldCatalog('MAINBOARD');
    for (const key of ['ipos.cin', 'ipos.isin', 'ipos.symbol', 'ipos.offering_type', 'ipos.segment', 'ipos.listing_exchanges']) {
      const f = cat.find((x) => x.key === key);
      expect(f, key).toBeDefined();
      expect(f!.mode).not.toBe('readonly');
    }
  });

  it('item 18 / §2.8: offering type, segment and listing exchanges are editable and flagged to rebuild the plan', () => {
    const cat = editorFieldCatalog('MAINBOARD');
    for (const key of ['ipos.offering_type', 'ipos.segment', 'ipos.listing_exchanges']) {
      const f = cat.find((x) => x.key === key)!;
      expect(f, key).toBeDefined();
      expect(f.mode).not.toBe('readonly');
      expect(f.planRebuild).toBe(true);
    }
    expect(cat.filter((f) => f.planRebuild).map((f) => f.key).sort()).toEqual(['ipos.listing_exchanges', 'ipos.offering_type', 'ipos.segment']);
  });

  it('panel fields list the Appendix A ranks for the IPO type, at most three', () => {
    const issue = editorFieldCatalog('MAINBOARD').find((f) => f.key === 'ipos.issue_size')!;
    expect(issue.sources).toEqual(['DOC', 'CHITTORGARH']);
    const open = editorFieldCatalog('SME_BSE').find((f) => f.key === 'ipos.open_date')!;
    expect(open.sources).toEqual(['BSE', 'CHITTORGARH']);
    expect(open.e1).toBe(true);
    expect(editorFieldCatalog('MAINBOARD').every((f) => f.sources.length <= 3)).toBe(true);
  });

  it('SME listing on NSE is SME_NSE, other SME is SME_BSE, the rest MAINBOARD', () => {
    expect(ipoTypeKey({ segment: 'SME', listingExchanges: ['NSE'] })).toBe('SME_NSE');
    expect(ipoTypeKey({ segment: 'SME', listingExchanges: null })).toBe('SME_BSE');
    expect(ipoTypeKey({ segment: 'MAINBOARD' })).toBe('MAINBOARD');
  });

  it('the C, I and D/T/M lists match the spec table for the editor tables (drift guard)', async () => {
    const specPath = path.resolve(__dirname, '../../../../../docs/design/field-source-resolution.spec.mjs');
    const spec = await import(pathToFileURL(specPath).href);
    const inTables = (spec.F as Array<{ t: string; c: string; cls: string }>).filter((f) =>
      (EDITOR_TABLES as readonly string[]).includes(f.t)
    );
    const specC = inTables.filter((f) => f.cls === 'C').map((f) => `${f.t}.${f.c}`).sort();
    expect(Object.keys(DERIVED_FIELDS).sort()).toEqual(specC);
    const specI = new Set(inTables.filter((f) => f.cls === 'I').map((f) => `${f.t}.${f.c}`));
    for (const k of ADMIN_SETTING_FIELDS) expect(specI.has(k), k).toBe(true);
    const specDTM = inTables.filter((f) => ['D', 'T', 'M'].includes(f.cls)).map((f) => `${f.t}.${f.c}`).sort();
    const catalog = editorFieldCatalog('MAINBOARD')
      .filter((f) => ['D', 'T', 'M'].includes(f.fieldClass))
      .map((f) => f.key)
      .sort();
    expect(catalog).toEqual(specDTM);
  });

  it('counts per class and mode (the report numbers)', () => {
    const counts = editorCatalogCounts('MAINBOARD');
    expect(counts['C:derived']).toBe(8);
    expect(counts['I:setting']).toBe(2);
    expect(counts['T:readonly']).toBe(1);
    expect(counts['M:readonly']).toBe(4);
  });
});

describe('§9.3 / OD-103 / OD-137: each ranked source with its answer', () => {
  it('value, abstained and never asked; the current source marked; pick label = stored label', () => {
    const w = buildWitnesses({
      ranks: ['DOC', 'NSE', 'BSE'],
      witnesses: [
        { source: 'RHP', docType: 'RHP', value: '100', at: '2026-09-16 08:30:00', outcome: 'SUPPLIED' },
        { source: 'NSE', value: null, at: '2026-09-16 08:30:00', outcome: 'NOT_PRINTED', cause: 'not_printed' },
      ],
      planAnswers: null,
      fsSource: 'RHP',
      fsAt: '2026-09-16 08:30:00',
      currentValue: '100',
    });
    expect(w.map((x) => x.status)).toEqual(['value', 'abstained', 'never_asked']);
    expect(w[0]).toMatchObject({ pickLabel: 'RHP', current: true, value: '100' });
    expect(w[1]).toMatchObject({ pickLabel: null, cause: 'not_printed', current: false });
  });

  it('a failed source carries its cause; an empty field reads the plan answers (OD-137)', () => {
    const w = buildWitnesses({
      ranks: ['NSE', 'BSE'],
      witnesses: null,
      planAnswers: [
        { source: 'NSE', value: null, at: 'x', outcome: 'FAILED', cause: 'http_503' },
        { source: 'BSE', value: '2026-10-06', at: 'x', outcome: 'SUPPLIED' },
      ],
      fsSource: null,
      fsAt: null,
      currentValue: null,
    });
    expect(w[0]).toMatchObject({ status: 'failed', cause: 'http_503' });
    expect(w[1]).toMatchObject({ status: 'value', pickLabel: 'BSE' });
  });

  it('a pre-witness row supplies the stored value for its own source', () => {
    const w = buildWitnesses({ ranks: ['DOC', 'BSE'], witnesses: null, planAnswers: null, fsSource: 'BSE', fsAt: 't', currentValue: '7' });
    expect(w[1]).toMatchObject({ status: 'value', value: '7', pickLabel: 'BSE', current: true });
    expect(w[0].status).toBe('never_asked');
  });
});

describe('item 12 / OD-108: typed in the reader unit, previewed with the page formatter', () => {
  it('875 crore stores Rs 8,75,00,00,000 and shows what the page shows', () => {
    const p = previewCroreInput('875');
    expect(p.stored).toBe('8750000000');
    expect(p.text).toBe(`stores Rs 8,75,00,00,000, shows ${formatIssueSizeCrores(8750000000)}`);
  });
  it('commas and decimals parse; garbage and zero do not', () => {
    expect(previewCroreInput('1,234.5').stored).toBe('12345000000');
    expect(previewCroreInput('abc').ok).toBe(false);
    expect(previewCroreInput('0').ok).toBe(false);
    expect(previewPlainInput('  ').ok).toBe(false);
  });
});

describe('item 13 / OD-109: the reader line of an admin value', () => {
  it('a pick names the source and its read date', () => {
    const p = adminProvenanceFor({
      tableName: 'ipos',
      fieldName: 'issueSize',
      lineage: { mode: 'pick', sourceLabel: 'RHP', readDate: '2026-09-16 08:30:00', by: 'Someone' },
      updatedAt: '2026-09-28 19:50:58',
    });
    expect(p).toMatchObject({ key: 'ipos.issue_size', chosenSource: 'RHP' });
    expect((p as { confirmedAt: Date }).confirmedAt.toISOString()).toBe('2026-09-16T08:30:00.000Z');
  });
  it('a typed value is ADMIN with the save date, never the admin name', () => {
    const p = adminProvenanceFor({
      tableName: 'ipos',
      fieldName: 'lotSize',
      lineage: { mode: 'typed', sourceNote: 'RHP p.3', by: 'Someone' },
      updatedAt: '2026-09-28 19:50:58',
    });
    expect(p).toMatchObject({ key: 'ipos.lot_size', chosenSource: 'ADMIN' });
    expect(JSON.stringify(p)).not.toContain('Someone');
  });
  it('an admin-empty value (OD-121) has no line', () => {
    const p = adminProvenanceFor({
      tableName: 'ipos',
      fieldName: 'sector',
      lineage: { mode: 'typed', sourceNote: '', adminEmpty: true },
      updatedAt: 'x',
    });
    expect(p).toEqual({ key: 'ipos.sector', empty: true });
  });
});
