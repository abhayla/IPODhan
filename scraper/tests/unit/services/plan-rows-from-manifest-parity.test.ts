import { describe, it, expect } from 'vitest';
import { planRowsFromManifest, planTypeKey } from '@ipodhan/shared/services/plan-invalidating-rebuild';
import { generateFieldPlan, resolveIpoTypeKey, type PlanIpo } from '../../../src/services/field-plan-generator';
import { loadFieldManifest } from '../../../src/config/field-manifest-loader';
import type { FieldManifest } from '../../../src/config/field-manifest-schema';

/**
 * §2.8 / §9.2 item 18: the admin save rebuilds the plan with `planRowsFromManifest` (packages/shared,
 * reachable from web) because the scraper's generator is not importable there. This pins the two to
 * the SAME rows for every IPO type the manifest keys, so a generator rule change cannot leave the
 * admin rebuild planting a different plan than the cycle does.
 */
const manifest = loadFieldManifest();
const IPOS: PlanIpo[] = [
  { id: 'i', segment: 'MAINBOARD', listingExchanges: ['NSE', 'BSE'] },
  { id: 'i', segment: 'MAINBOARD', listingExchanges: ['BSE'] },
  { id: 'i', segment: null, listingExchanges: null },
  { id: 'i', segment: 'SME', listingExchanges: ['BSE'] },
  { id: 'i', segment: 'SME', listingExchanges: ['NSE'] },
  { id: 'i', segment: 'SME', listingExchanges: null },
];
const shape = (r: { tableName: string; fieldName: string; rank1Source: string | null; rank2Source: string | null; rank3Source: string | null; manifestVersion: number; policyOrigin: string }) =>
  `${r.tableName}.${r.fieldName}|${r.rank1Source}|${r.rank2Source}|${r.rank3Source}|${r.manifestVersion}|${r.policyOrigin}`;

describe('planRowsFromManifest matches generateFieldPlan (item 18 parity)', () => {
  it.each(IPOS)('same rows and type key for %o', (ipo) => {
    expect(planTypeKey(ipo)).toBe(resolveIpoTypeKey(ipo));
    const shared = planRowsFromManifest(manifest as never, ipo).map(shape);
    const scraper = generateFieldPlan(ipo, manifest).map(shape);
    expect(shared.length).toBeGreaterThan(100);
    expect(shared).toEqual(scraper);
  });

  it('both skip an empty rank list and a missing type key, and both refuse more than three ranks', () => {
    const m = {
      ...manifest,
      fields: {
        'ipos.a': { ...Object.values(manifest.fields)[0], rank: { MAINBOARD: [], SME_BSE: ['BSE'], SME_NSE: ['NSE'] } },
        'ipos.b': { ...Object.values(manifest.fields)[0], rank: { MAINBOARD: ['DOC'] } },
      },
    } as unknown as FieldManifest;
    const ipo: PlanIpo = { id: 'i', segment: 'SME', listingExchanges: ['BSE'] };
    expect(planRowsFromManifest(m as never, ipo).map(shape)).toEqual(generateFieldPlan(ipo, m).map(shape));
    const four = { ...m, fields: { 'ipos.c': { ...Object.values(manifest.fields)[0], rank: { MAINBOARD: ['DOC', 'NSE', 'BSE', 'CHITTORGARH'] } } } } as unknown as FieldManifest;
    const main: PlanIpo = { id: 'i', segment: 'MAINBOARD' };
    expect(() => generateFieldPlan(main, four)).toThrow();
    expect(() => planRowsFromManifest(four as never, main)).toThrow();
  });
});
