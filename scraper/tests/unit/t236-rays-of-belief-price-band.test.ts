/**
 * T-236 (fix round): a literal ZERO price band must be treated as
 * UNANNOUNCED and KEPT, not rejected.
 *
 * PROVEN FACTS (supervisor probe on fix/rays-of-belief-price-band-t236,
 * pre this fix - see D:\Abhay\GetWorkDone\evidence\2026-08-20-T-228C\
 * vps-cycle-zoderrors.txt):
 *   - The live scraper feeds `{ priceRangeMin: 0, priceRangeMax: 0 }` for
 *     Chittorgarh rows with a blank "Issue Price" cell.
 *   - `validateChittorgarhIPOData({ ..., priceRangeMin: 0, priceRangeMax: 0 })`
 *     returned `success: false` with `too_small, minimum 0, inclusive false`
 *     on BOTH priceRangeMin and priceRangeMax - dropping a real IPO
 *     (`Rays of Belief Ltd.`) from the site.
 *   - `Kwick Forensic Solutions Ltd.` fails with the IDENTICAL error shape
 *     in the same evidence log - same defect, same fix.
 *   - The prior worker's test used `priceRangeMin: undefined` fixtures,
 *     which pass on both the pre-fix and post-fix schema - it proved
 *     nothing about the zero-band regression.
 *
 * THE FIX (scraper/src/utils/validators.ts, ScrapedIPOSchema): a
 * `z.preprocess` on priceRangeMin/priceRangeMax normalizes a literal 0 to
 * `undefined` before the `.positive()` check runs, so "unannounced" (0)
 * is treated the same as "absent" (undefined) - the record is kept.
 * This is the schema-level fix (not a per-orchestrator normalize), because
 * every caller (Chittorgarh x2 orchestrators, BSE, NSE, Moneycontrol) shares
 * ScrapedIPOSchema/ChittorgarhIPOSchema - one change point covers all of
 * them, smaller than patching every choke point individually.
 */
import { describe, it, expect } from 'vitest';
import { validateChittorgarhIPOData } from '../../src/utils/validators.js';

function chittorgarhFixture(companyName: string, priceRangeMin: number | undefined, priceRangeMax: number | undefined) {
  return {
    companyName,
    dataSource: 'CHITTORGARH' as const,
    issueSize: 250000000,
    priceRangeMin,
    priceRangeMax,
    openDate: '2026-09-01',
    closeDate: '2026-09-03',
    listingExchange: 'BSE' as const,
    segment: 'SME' as const,
    offeringType: 'IPO' as const,
    status: 'UPCOMING' as const,
  };
}

describe('T-236 / a zero price band is unannounced, not invalid', () => {
  it('Rays of Belief Ltd. passes with the REAL production shape (priceRangeMin/Max literally 0)', () => {
    const result = validateChittorgarhIPOData(
      chittorgarhFixture('Rays of Belief Ltd.', 0, 0)
    );
    expect(result.success).toBe(true);
    expect(result.data?.companyName).toBe('Rays of Belief Ltd.');
    // 0 must be normalized away, never stored as a literal ₹0 band.
    expect(result.data?.priceRangeMin).toBeUndefined();
    expect(result.data?.priceRangeMax).toBeUndefined();
  });

  it('Kwick Forensic Solutions Ltd. passes with the same zero-band shape', () => {
    const result = validateChittorgarhIPOData(
      chittorgarhFixture('Kwick Forensic Solutions Ltd.', 0, 0)
    );
    expect(result.success).toBe(true);
    expect(result.data?.companyName).toBe('Kwick Forensic Solutions Ltd.');
  });

  it('a genuinely absent price band (undefined) still passes, unchanged', () => {
    const result = validateChittorgarhIPOData(
      chittorgarhFixture('Rays of Belief Ltd.', undefined, undefined)
    );
    expect(result.success).toBe(true);
  });

  it('a real positive band still parses through unchanged (not normalized away)', () => {
    const good = validateChittorgarhIPOData(
      chittorgarhFixture('Rays of Belief Ltd.', 90, 100)
    );
    expect(good.success).toBe(true);
    expect(good.data?.priceRangeMin).toBe(90);
    expect(good.data?.priceRangeMax).toBe(100);
  });
});

/**
 * T-236C follow-up (fleet worker T-236C): the T-236C contract's "supervisor
 * probe" called `validateChittorgarhIPOData({companyName, priceRangeMin: 0,
 * priceRangeMax: 0})` with ONLY those 3 fields and treated `success: false`
 * as proof the price-band fix (above) hadn't landed on the live path.
 *
 * Reproduced here byte-for-byte: it DOES return `success: false` - but the
 * `error.issues` array (asserted below) contains ZERO issues on
 * `priceRangeMin`/`priceRangeMax`. Every issue is `issueSize`, `openDate`,
 * `closeDate`, `listingExchange`, `offeringType`, `status`, `dataSource` -
 * fields the 3-field probe never populated. ChittorgarhIPOSchema requires
 * all of them; the probe was never going to pass regardless of the
 * price-band fix, because it wasn't exercising the price-band path at all.
 * This is NOT evidence of a live regression - it is a malformed fixture.
 * The REAL production shape (all required fields present, exactly what
 * chittorgarh-orchestrator-v2.ts feeds the validator) is covered above and
 * has passed since f9df24fa; this test exists so the next worker sees WHY
 * the minimal probe fails instead of re-diagnosing the price band again.
 */
describe('T-236C / the minimal 3-field "supervisor probe" fails for unrelated reasons', () => {
  it('fails on missing required fields, NOT on priceRangeMin/priceRangeMax', () => {
    const result = validateChittorgarhIPOData({
      companyName: 'Rays of Belief Ltd.',
      priceRangeMin: 0,
      priceRangeMax: 0,
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(paths).not.toContain('priceRangeMin');
    expect(paths).not.toContain('priceRangeMax');
    expect(paths).toEqual(
      expect.arrayContaining([
        'issueSize',
        'openDate',
        'closeDate',
        'listingExchange',
        'offeringType',
        'status',
        'dataSource',
      ])
    );
  });
});
