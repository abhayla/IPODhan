// Content test for scraper/config/field-manifest.json's `comparisonFamily` key —
// item S3b step 1 (issue #775, docs/design/s3b-verdict-plan.md "Step 1").
//
// CORE: every one of the 190 manifest fields resolves to a ComparisonFamily,
// derived from structure (the amount-columns probe + the schema.ts column
// declaration + a small explicit decisions file), never guessed from naming.
// A field with no family silently falls back to the OLD string comparison in
// areEquivalent — which reads as "working" in every log and is exactly the
// OD-59 failure the consensus model exists to remove. This test is the proof
// that cannot happen: every field must resolve, and none may reach a default.
//
// Reads the REAL manifest file (not a copied literal) so a mutation to the
// generator or a drifted committed file is caught here, not silently accepted.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const MANIFEST_PATH = path.join(__dirname, '../../../config/field-manifest.json');

const VALID_FAMILIES = new Set(['MONEY', 'RATIO', 'IDENTITY', 'IDENTIFIER', 'DATE', 'BOOLEAN', 'SET', 'ABSTAIN']);

function loadManifest(): { fields: Record<string, any> } {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
}

describe('field-manifest comparisonFamily (S3b step 1, issue #775)', () => {
  it('every one of the 190 manifest fields carries a comparisonFamily', () => {
    const manifest = loadManifest();
    const keys = Object.keys(manifest.fields);
    expect(keys.length).toBe(190);

    const missing = keys.filter((k) => !manifest.fields[k].comparisonFamily);
    expect(missing).toEqual([]);
  });

  it('no field reaches an undefined/default family — every value is one of the known families', () => {
    const manifest = loadManifest();
    const bad: string[] = [];
    for (const [key, entry] of Object.entries(manifest.fields)) {
      const fam = (entry as any).comparisonFamily;
      if (!VALID_FAMILIES.has(fam)) bad.push(`${key}: ${fam}`);
    }
    expect(bad).toEqual([]);
  });

  // Layer 1 (amount-columns probe): the 76 MONEY-shaped + 24 RATIO-shaped fields
  // the probe classifies with zero guesses (docs/design/s3b-verdict-plan.md
  // "MEASURED: this classifies 100 of 190 fields").
  it('the 100 probe-covered fields resolve to MONEY (76) or RATIO (24), never guessed from naming', () => {
    const manifest = loadManifest();
    const probe = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '../../../../docs/design/probes/amount-columns.out.json'),
        'utf-8'
      )
    );
    const MONEY_CLS = new Set(['CRORE', 'PER_SHARE', 'RUPEES_KEPT', 'SHARE_COUNT']);
    const RATIO_CLS = new Set(['RATIO', 'PERCENT', 'MULTIPLE']);
    const probeMap = new Map(probe.columns.map((c: any) => [`${c.table}.${c.col}`, c.cls]));

    let moneyCount = 0;
    let ratioCount = 0;
    for (const [key, entry] of Object.entries(manifest.fields)) {
      const cls = probeMap.get(key);
      if (!cls) continue;
      const fam = (entry as any).comparisonFamily;
      if (MONEY_CLS.has(cls as string)) {
        expect(fam, `${key} (probe cls ${cls})`).toBe('MONEY');
        moneyCount++;
      } else if (RATIO_CLS.has(cls as string)) {
        expect(fam, `${key} (probe cls ${cls})`).toBe('RATIO');
        ratioCount++;
      }
    }
    expect(moneyCount).toBe(76);
    expect(ratioCount).toBe(24);
  });

  // Layer 2 (schema.ts column type): the null-collapse bug (#774) this whole
  // slice exists to prevent. `class === 'T' ? 'DATE'` would ALSO catch
  // ipos.status (an enum string) and ipos.listing_exchanges (an array), both
  // of which normalise to null via normalizeDate and would then compare EQUAL.
  // The column-type layer must NOT make that mistake.
  it('DATE is derived from the schema column type, not from spec class T — status and listing_exchanges are excluded', () => {
    const manifest = loadManifest();
    expect(manifest.fields['ipos.status']?.comparisonFamily).not.toBe('DATE');
    expect(manifest.fields['ipos.listing_exchanges']?.comparisonFamily).not.toBe('DATE');
    // Positive control: real date columns the column-type pass finds that
    // neither the manifest class nor a name-pattern guess would catch.
    expect(manifest.fields['brlm_track_record.as_of_date']?.comparisonFamily).toBe('DATE');
    expect(manifest.fields['documents.filing_date']?.comparisonFamily).toBe('DATE');
  });

  it('exactly 10 DATE fields and 4 BOOLEAN fields (measured column-type counts)', () => {
    const manifest = loadManifest();
    const families = Object.values(manifest.fields).map((e: any) => e.comparisonFamily);
    expect(families.filter((f) => f === 'DATE').length).toBe(10);
    expect(families.filter((f) => f === 'BOOLEAN').length).toBe(4);
  });

  // Layer 3 decision (b): the 6 true sets of scalars get a new SET family; the
  // 7 structured lists of objects explicitly ABSTAIN (never silently DISPUTED
  // on JSON key-order noise).
  it('the 6 true sets of scalars resolve to SET; the 7 structured lists of objects ABSTAIN', () => {
    const manifest = loadManifest();
    const SET_FIELDS = [
      'ipos.listing_exchanges',
      'ipo_details.exchanges',
      'ipo_details.sponsor_banks',
      'ipo_details.sub_categories_upi',
      'ipos.lead_managers',
      'ipo_details.lead_managers',
    ];
    const ABSTAIN_LIST_FIELDS = [
      'anchor_investors.investor_list',
      'ipos.objectives',
      'ipo_details.category_details',
      'ipo_details.bid_windows',
      'ipo_details.allocation_pct',
      'ipo_risk_factors.kpis',
      'ipo_details.promoter_group_transactions_since_drhp',
    ];
    for (const f of SET_FIELDS) {
      expect(manifest.fields[f]?.comparisonFamily, f).toBe('SET');
    }
    for (const f of ABSTAIN_LIST_FIELDS) {
      expect(manifest.fields[f]?.comparisonFamily, f).toBe('ABSTAIN');
    }
  });

  it('free text fields ABSTAIN — two sources never produce identical prose', () => {
    const manifest = loadManifest();
    expect(manifest.fields['ipo_risk_factors.body']?.comparisonFamily).toBe('ABSTAIN');
    expect(manifest.fields['ipo_risk_factors.heading']?.comparisonFamily).toBe('ABSTAIN');
    expect(manifest.fields['ipo_valuation.pe_not_ascertainable_reason']?.comparisonFamily).toBe('ABSTAIN');
  });

  it('brlm_track_record.issues_3y resolves (not silently defaulted) — a plain integer count absent from the amount probe', () => {
    const manifest = loadManifest();
    const entry = manifest.fields['brlm_track_record.issues_3y'];
    expect(entry).toBeDefined();
    expect(VALID_FAMILIES.has(entry.comparisonFamily)).toBe(true);
  });
});
