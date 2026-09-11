/**
 * #597 detection upgrade: no read path may publish the price BAND cap as the
 * price the issue sold at.
 *
 * WHY A STATIC SCAN RATHER THAN A BEHAVIOUR TEST. The defect was found in
 * `ipo-repository.findListings`, fixed, and then found AGAIN in a completely
 * separate query — `web/app/api/ipos/listings/route.ts`, which builds its own
 * Drizzle select and had the identical `issuePrice: ipos.priceRangeMax`. Two
 * independent copies means the next one will be a third, and a behaviour test
 * only ever covers the call sites someone remembered to write a test for.
 *
 * The second copy was the worse of the two: its `issuePrice` feeds a marketCap
 * estimate, so MARUTI INTERIOR's market cap was computed from 10 (its face
 * value) instead of 55 — overstating it by roughly 5.5x.
 *
 * This is the same class as the duplicated `checkIssueSizeSegmentFloor`
 * (substance-checks.mjs vs detection-floor-checks.mjs), where a fix landed on one
 * copy and the other kept emitting the defect for hours.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const WEB_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SCAN_DIRS = ['lib', 'app'];

/** The shape being banned: issuePrice projected straight off the band column. */
const BANNED = /issuePrice\s*:\s*ipos\.priceRangeMax/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'tests') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('#597 — the band cap is never published as the issue price', () => {
  const files = SCAN_DIRS.flatMap((d) => collectSourceFiles(path.join(WEB_ROOT, d)));

  it('the scan actually reads the source tree (positive control)', () => {
    // Without this, a broken path would scan zero files and the ban below would
    // pass forever while the defect sat in the code — the exact vacuous-green
    // shape this project keeps hitting.
    expect(files.length, `scanned only ${files.length} files — WEB_ROOT resolved wrong?`).toBeGreaterThan(50);
    expect(files.some((f) => f.includes('ipo-repository'))).toBe(true);
    expect(files.some((f) => f.includes(path.join('api', 'ipos')))).toBe(true);
  });

  it('the detector can actually fire (mutation control)', () => {
    // A banned-pattern test whose regex no longer matches the thing it bans is
    // indistinguishable from a clean tree. Prove it matches the real shape.
    expect(BANNED.test('        issuePrice: ipos.priceRangeMax,')).toBe(true);
    expect(BANNED.test('issuePrice: sql`coalesce(x, y)`')).toBe(false);
  });

  it('no source file projects issuePrice from the price band cap', () => {
    const offenders = files.filter((f) => BANNED.test(readFileSync(f, 'utf8')));
    expect(
      offenders.map((f) => path.relative(WEB_ROOT, f)),
      'A read path is publishing the price BAND cap as the issue price. The band cap is what the ' +
        'issue was OFFERED in, not what it SOLD at, and on a face-value row it is not a price at ' +
        'all (MARUTI INTERIOR: band cap 10, actual issue price 55). Use ' +
        'coalesce(listingPerformance.issuePrice, ipos.priceRangeMax) so a listed IPO shows what it ' +
        'sold at and a never-listed one still shows its band.',
    ).toEqual([]);
  });
});
