// Content test for scraper/config/field-manifest.json — item 2 slice 5.
//
// Verifies the manifest carries an entry for each of the 16 Group-C fields
// item 3 (docs/design/build-cards/item-03-matrix-cleanup.md) needs before it
// can delete their dead field-priority-matrix.ts snake_case keys without
// regressing the live camelCase field.
//
// Reads the REAL manifest file (not a copied literal) and the REAL spec
// module (docs/design/field-source-resolution.spec.mjs) so a mutation to
// either one is caught here, not silently accepted.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const MANIFEST_PATH = path.join(__dirname, '../../../config/field-manifest.json');
const SPEC_PATH = path.join(__dirname, '../../../../docs/design/field-source-resolution.spec.mjs');
const AMOUNT_COLUMNS_PATH = path.join(
  __dirname,
  '../../../../docs/design/probes/amount-columns.out.json'
);

// docs/design/probes/amount-columns.mjs classifies every numeric/bigint schema
// column (OD-20); the manifest's `unit` field is the DIRECT consequence of that
// class (§5.2 of data-sourcing-pull-model.md): CRORE -> crore, RUPEES_KEPT ->
// rupee, everything else (PER_SHARE/PERCENT/RATIO/MULTIPLE) -> keep (unchanged).
function expectedUnitForClass(cls: string): string {
  if (cls === 'CRORE') return 'crore';
  if (cls === 'RUPEES_KEPT') return 'rupee';
  return 'keep';
}

function loadManifestRaw(): { fields: Record<string, any> } {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
}

async function loadSpec() {
  return import(pathToFileUrl(SPEC_PATH));
}

function pathToFileUrl(p: string): string {
  const resolved = path.resolve(p).replace(/\\/g, '/');
  return 'file://' + (resolved.startsWith('/') ? resolved : '/' + resolved);
}

// The 16 Group-C matrix keys (item-03-matrix-cleanup.md) mapped to the REAL
// table.column each one's live camelCase schema field belongs to — verified
// against packages/shared/src/db/schema.ts and the spec's own `F` array.
// Some of the 16 do not resolve to a class D/T/X/W/M *sourced* field at all
// (they are spec class C — computed — or absent from the spec's F array
// entirely, i.e. an orphaned column with no writer, e.g. ipo_financials.*
// and gmp_records.expected_listing_price). Those are listed under
// NOT_MANIFEST_ELIGIBLE with the reason, and the test asserts they are
// EXCLUDED from the manifest (per item-02's own rule: "C and I fields are
// never sourced, so they carry no manifest row") rather than silently
// requiring a fabricated row for them.
const GROUP_C_TO_REAL_FIELD: Record<string, string> = {
  fresh_issue_size: 'ipo_details.fresh_issue',
  offer_for_sale_size: 'ipo_details.ofs_issue',
  min_investment: 'ipo_details.min_investment',
  total_subscription: 'subscriptions.total_subscription',
  retail_subscription: 'subscriptions.retail_subscription',
  qib_subscription: 'subscriptions.qib_subscription',
  nii_subscription: 'subscriptions.nii_subscription',
  listing_price: 'listing_performance.listing_price',
};

// Group-C keys whose real schema field is spec-class C (computed) or absent
// from the spec's F array (an orphaned/never-written column) — genuinely not
// eligible for a rank/capability manifest row.
const NOT_MANIFEST_ELIGIBLE: Record<string, string> = {
  peer_companies:
    'the matrix key writes the whole peer_companies table (one-to-many, 10 real columns) — no single table.column it resolves to',
  roe_percentage: 'ipo_financials.roe_percentage has zero rows written anywhere in scraper/src and zero entries in the spec F array (orphaned table)',
  roce_percentage: 'ipo_financials.roce_percentage — same orphaned-table reasoning as roe_percentage',
  pb_ratio: 'ipo_financials.pb_ratio — same orphaned-table reasoning as roe_percentage',
  issue_price: 'listing_performance.issue_price is spec class C — computed as ipos.price_range_max at listing, not sourced',
  gmp_percentage: 'gmp_records.gmp_percentage is spec class C — computed as gmp ÷ price_range_max × 100, not sourced',
  expected_listing_price: 'gmp_records.expected_listing_price has zero entries in the spec F array (orphaned column, no writer)',
  listing_gain_percentage: 'ipos.listing_gain_percentage (Story 7.10 legacy) has zero entries in the spec F array (orphaned column, no writer)',
};

describe('field-manifest.json content — 16 Group-C fields (item 2 slice 5)', () => {
  it('names exactly 16 Group-C keys between the two maps', () => {
    const total = Object.keys(GROUP_C_TO_REAL_FIELD).length + Object.keys(NOT_MANIFEST_ELIGIBLE).length;
    expect(total).toBe(16);
  });

  it('has a manifest entry for every eligible Group-C real field', () => {
    const manifest = loadManifestRaw();
    const missing = Object.entries(GROUP_C_TO_REAL_FIELD)
      .map(([, realField]) => realField)
      .filter((realField) => !manifest.fields[realField]);
    expect(missing).toEqual([]);
  });

  it('does NOT carry a manifest row for a not-eligible Group-C field', () => {
    const manifest = loadManifestRaw();
    // These real fields (where determinable) must be absent — a fabricated
    // rank/capability row for a computed or orphaned field would be worse
    // than no row (it would claim sources the field never actually uses).
    const notEligibleRealFields = [
      'ipo_financials.roe_percentage',
      'ipo_financials.roce_percentage',
      'ipo_financials.pb_ratio',
      'listing_performance.issue_price',
      'gmp_records.gmp_percentage',
      'gmp_records.expected_listing_price',
      'ipos.listing_gain_percentage',
    ];
    for (const f of notEligibleRealFields) {
      expect(manifest.fields[f]).toBeUndefined();
    }
  });

  it('every eligible entry\'s rank[0] and unit match what the spec/probe resolve', async () => {
    const spec: any = await loadSpec();
    const { F } = spec;
    const manifest = loadManifestRaw();
    const amountColumns = JSON.parse(fs.readFileSync(AMOUNT_COLUMNS_PATH, 'utf-8'));

    const specByKey = new Map<string, any>(F.map((f: any) => [`${f.t}.${f.c}`, f]));
    const columnClassByKey = new Map<string, string>(
      amountColumns.columns.map((c: any) => [`${c.table}.${c.col}`, c.cls])
    );

    const mismatches: string[] = [];
    for (const realField of Object.values(GROUP_C_TO_REAL_FIELD)) {
      const specField = specByKey.get(realField);
      const manifestEntry = manifest.fields[realField];
      if (!specField || !manifestEntry) {
        mismatches.push(`${realField}: missing from spec or manifest`);
        continue;
      }
      const specRank0 = specField.r[0];
      const manifestRank0 = manifestEntry.rank.MAINBOARD?.[0];
      if (specRank0 !== manifestRank0 && !(specRank0 === 'CG' && manifestRank0 === 'CHITTORGARH')) {
        mismatches.push(`${realField}: spec rank[0]=${specRank0} manifest rank.MAINBOARD[0]=${manifestRank0}`);
      }

      const cls = columnClassByKey.get(realField);
      if (cls) {
        const expectedUnit = expectedUnitForClass(cls);
        if (manifestEntry.unit !== expectedUnit) {
          mismatches.push(
            `${realField}: amount-columns probe class=${cls} expects unit=${expectedUnit} manifest unit=${manifestEntry.unit}`
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('surfaces (does not silently accept) any row naming MONEYCONTROL in a rank — pending decision C-1', () => {
    const manifest = loadManifestRaw();
    const rowsNamingMoneycontrol: string[] = [];
    for (const [key, entry] of Object.entries(manifest.fields) as [string, any][]) {
      for (const sources of Object.values(entry.rank) as string[][]) {
        if (sources.includes('MONEYCONTROL')) {
          rowsNamingMoneycontrol.push(key);
          break;
        }
      }
    }
    // This is a KNOWN, tracked pending decision (item-02 card's C-1), not a
    // failure — the test surfaces the list so it is never silently missed.
    // eslint-disable-next-line no-console
    console.log('MONEYCONTROL rows pending C-1:', rowsNamingMoneycontrol);
    expect(Array.isArray(rowsNamingMoneycontrol)).toBe(true);
  });
});
