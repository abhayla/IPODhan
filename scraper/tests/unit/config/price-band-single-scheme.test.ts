import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from '@ipodhan/shared/db/schema';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/**
 * T-276 (round-2 P3-4) — "kill the ambiguity: one price-band naming scheme".
 *
 * The band lives in exactly ONE place: `ipos.price_range_min` /
 * `ipos.price_range_max`, surfaced as `priceRangeMin`/`priceRangeMax`. The prod
 * table still carries `price_band_low`/`price_band_high` from an older schema
 * (verified 2026-08-22: 328 rows, 0 non-null in either). They are absent from
 * the SSOT schema, and the DROP is parked in
 * `web/drizzle/migrations/_gated/D1_ipos_drop_dead_price_band_columns.sql`
 * pending owner sign-off (destructive DDL is never auto-applied).
 *
 * Until that runs, this test is the guard that they stay dead: nothing in the
 * SSOT schema declares them and no source file writes them.
 */
describe('T-276 — one price-band naming scheme', () => {
  it('the SSOT schema declares only price_range_min/max on ipos', () => {
    const columns = Object.keys(schema.ipos);
    expect(columns).toContain('priceRangeMin');
    expect(columns).toContain('priceRangeMax');
    expect(columns).not.toContain('priceBandLow');
    expect(columns).not.toContain('priceBandHigh');
    expect(columns).not.toContain('priceBandMin');
    expect(columns).not.toContain('priceBandMax');
  });

  it('no source file writes the deprecated price_band_low/high columns', () => {
    const DEAD = /priceBandLow|priceBandHigh|price_band_low|price_band_high/;
    const roots = ['scraper/src', 'scraper/scripts', 'web/app', 'web/lib', 'packages/shared/src'];
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          walk(full);
        } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
          if (DEAD.test(fs.readFileSync(full, 'utf8'))) {
            offenders.push(path.relative(REPO_ROOT, full));
          }
        }
      }
    };
    for (const r of roots) {
      const abs = path.join(REPO_ROOT, r);
      if (fs.existsSync(abs)) walk(abs);
    }

    expect(offenders, 'deprecated price-band columns referenced in: ' + offenders.join(', ')).toEqual([]);
  });
});
