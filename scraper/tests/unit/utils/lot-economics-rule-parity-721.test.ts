/**
 * #721 review r2: Rule 9 (spec §1.2 row 4 lot economics) has a write-side definition in
 * @ipodhan/shared (TypeScript, compiled) and ONE scripts-side definition in
 * scripts/lib/substance-checks.mjs (plain node, which detection-floor-checks.mjs imports). The
 * two cannot share a module, so this test is the guard: it fails when the skipped offering types,
 * the inference threshold, the bounds or the verdict on any case differ, and when the skipped set
 * drifts from the manifest's `ipos.lot_size` na set (#1401).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LOT_ECONOMICS_NOT_JUDGED as WRITE_SKIPPED,
  SME_INFERENCE_MIN_LOT_VALUE as WRITE_SME_INFERENCE,
  SEBI_RETAIL_WINDOW,
  inferSegmentFromLotValue as writeInfer,
  lotEconomicsViolation,
} from '../../../src/utils/data-validation.js';
import {
  LOT_ECONOMICS_NOT_JUDGED as READ_SKIPPED,
  SME_INFERENCE_MIN_LOT_VALUE as READ_SME_INFERENCE,
  MAINBOARD_LOT_ECONOMICS_MIN,
  MAINBOARD_LOT_ECONOMICS_MAX,
  SME_LOT_ECONOMICS_MIN,
  SME_LOT_ECONOMICS_MAX,
  inferSegmentFromLotValue as readInfer,
  checkLotEconomicsRetailRange,
} from '../../../../scripts/lib/substance-checks.mjs';
import { SME_INFERENCE_MIN_LOT_VALUE as FLOOR_SME_INFERENCE } from '../../../../scripts/lib/detection-floor-checks.mjs';

const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../config/field-manifest.json'), 'utf-8'));
const sorted = (s: Iterable<string>) => [...s].sort();

describe('#721 Rule 9 parity: write rule, scripts rule and manifest agree', () => {
  it('the skipped offering types equal the manifest ipos.lot_size na set, on both sides', () => {
    const na = manifest.fields['ipos.lot_size'].na as string[];
    expect(na.length).toBeGreaterThan(0);
    expect(sorted(WRITE_SKIPPED)).toEqual(sorted(na));
    expect(sorted(READ_SKIPPED)).toEqual(sorted(na));
  });

  it('the §2.8 inference threshold and the §1.2 row 4 bounds are the same numbers', () => {
    expect(READ_SME_INFERENCE).toBe(WRITE_SME_INFERENCE);
    expect(FLOOR_SME_INFERENCE).toBe(WRITE_SME_INFERENCE);
    expect([MAINBOARD_LOT_ECONOMICS_MIN, MAINBOARD_LOT_ECONOMICS_MAX]).toEqual([SEBI_RETAIL_WINDOW.MAINBOARD.min, SEBI_RETAIL_WINDOW.MAINBOARD.max]);
    expect([SME_LOT_ECONOMICS_MIN, SME_LOT_ECONOMICS_MAX]).toEqual([SEBI_RETAIL_WINDOW.SME.min, SEBI_RETAIL_WINDOW.SME.max]);
  });

  it('every case gets the same verdict and the same inferred segment from both sides', () => {
    const segments = ['MAINBOARD', 'SME', null];
    const types = ['IPO', 'FPO', null, 'DELISTING', ...(manifest.fields['ipos.lot_size'].na as string[])];
    const exchanges = [null, ['NSE'], ['BSE'], ['NSE', 'BSE']];
    const pairs: [number, number][] = [
      [100, 300], [45, 300], [50, 290], [150, 110], [130, 110], [185, 83], [180, 83], [1000, 50],
      [1000, 100], [1600, 100], [2000, 125], [100, 515], [3000, 120], [4000, 25], [1, 9999], [10, 1500],
    ];
    let compared = 0;
    for (const [lot, cap] of pairs) {
      for (const ex of exchanges) {
        expect(readInfer(lot, cap, ex)).toBe(writeInfer(lot, cap, ex));
        for (const segment of segments) {
          for (const offeringType of types) {
            const write = lotEconomicsViolation({ lotSize: lot, priceRangeMax: cap, segment, offeringType, listingExchanges: ex } as any) !== null;
            const read = checkLotEconomicsRetailRange({
              lot_size: lot, price_range_max: cap, segment, offering_type: offeringType, listing_exchanges: ex,
            }) !== null;
            expect({ lot, cap, ex, segment, offeringType, read }).toEqual({ lot, cap, ex, segment, offeringType, read: write });
            compared++;
          }
        }
      }
    }
    expect(compared).toBe(16 * 4 * 3 * 11);
  });
});
