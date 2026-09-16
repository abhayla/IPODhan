/**
 * #597: the listed-IPO listings page published a price the issue did not sell at.
 *
 * `findListings` projected `issuePrice: ipos.priceRangeMax` — the price BAND cap —
 * while the SAME query already left-joins `listing_performance`, taking
 * `listingPrice`, `listingGainPercent` and `currentPrice` from it in the very next
 * lines. The authoritative `listing_performance.issue_price` was therefore present
 * in the query and ignored.
 *
 * Measured on production before this fix (read-only):
 *   MARUTI INTERIOR PRODUCTS  band cap 10 (its FACE VALUE)   issue_price 55
 *   ADMACH SYSTEMS            band cap 227                   issue_price 239
 *   NET PIX SHORTS            band cap 32                    issue_price 30
 * and the API's own listingGainPercent of 30.73 for MARUTI is (71.9 - 55) / 55,
 * i.e. the response was already internally consistent with 55 while publishing 10.
 *
 * WHY THE FIX IS A COALESCE AND WHY THAT IS NOT THE #515 TRAP. For DISPLAY the
 * fallback is correct: an IPO with no listing_performance row (never listed) has no
 * issue price, and its band cap is the best available figure. The trap documented in
 * scripts/lib/substance-checks.mjs is about CHECKING — a check that compares against
 * COALESCE(lp.issue_price, i.price_range_max) compares a degenerate row to itself and
 * can never fire. Checks must keep reading the RAW column, and
 * audit-substance-plausibility.mjs does exactly that via its separate
 * `lp.issue_price AS authoritative_issue_price` projection. Display prefers; checks
 * compare raw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import type Redis from 'ioredis';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
} as any;

const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
} as unknown as Redis;

/**
 * Render whatever Drizzle put in the projection slot to inspectable text.
 *
 * NOT JSON.stringify: Drizzle column objects are CIRCULAR (PgTable -> PgUUID ->
 * back to table), so stringifying throws "Converting circular structure to JSON"
 * and every assertion below fails for a reason that has nothing to do with the
 * defect. The first version of this file did exactly that and produced three red
 * tests that proved nothing.
 *
 * Instead: walk the object with a seen-set and collect every `name` string it
 * carries. That works for a bare column (`price_range_max`) AND for a
 * `sql\`coalesce(...)\`` expression, whose embedded columns appear in its query
 * chunks - so the same assertion reads both the broken and the fixed shape.
 */
function describeProjection(value: unknown): string {
  const names: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    const rec = v as Record<string, unknown>;
    if (typeof rec.name === 'string') names.push(rec.name);
    for (const child of Object.values(rec)) walk(child);
  };
  walk(value);
  return names.join(' ');
}

describe('#597 — the listings query publishes the price the issue actually sold at', () => {
  let repository: IPORepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get = vi.fn().mockResolvedValue(null);
    mockRedis.setex = vi.fn().mockResolvedValue('OK');
    mockDb.execute = vi.fn().mockResolvedValue({ rows: [] });
    repository = new IPORepository(mockDb, mockRedis);
  });

  async function captureListingsProjection(): Promise<Record<string, unknown>> {
    const mockCountSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ count: 0 }]),
    };
    const mockListingsSelect = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
    };
    mockDb.select = vi.fn().mockReturnValueOnce(mockCountSelect).mockReturnValueOnce(mockListingsSelect);

    await repository.findListings({ category: 'MAINBOARD', page: 1, limit: 50 });

    // POSITIVE CONTROL: the second select IS the listings projection. Without this
    // a wrong index would yield `undefined` and every assertion below would pass
    // vacuously — the shape this whole file exists to prevent.
    const projection = mockDb.select.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(projection, 'listings projection not captured — has the query order changed?').toBeTruthy();
    expect(Object.keys(projection)).toContain('companyName');
    expect(Object.keys(projection)).toContain('listingGainPercent');
    return projection;
  }

  it('projects issuePrice from listing_performance.issue_price, not from the band cap', async () => {
    const projection = await captureListingsProjection();
    const rendered = describeProjection(projection.issuePrice);

    expect(projection.issuePrice, 'findListings no longer projects issuePrice at all').toBeTruthy();
    expect(
      rendered,
      'issuePrice still resolves to the price BAND cap — the #597 shape: the band cap is what the ' +
        'issue was OFFERED in, not what it SOLD at, and on a face-value row (MARUTI, 10 vs 55) it is ' +
        'not even a price',
    ).toMatch(/issue_price/);
  });

  it('still falls back to the band cap, so a never-listed IPO keeps showing a figure', async () => {
    const projection = await captureListingsProjection();
    const rendered = describeProjection(projection.issuePrice);

    expect(
      rendered,
      'no fallback to price_range_max — an IPO with no listing_performance row would publish null ' +
        'where it used to publish its band cap, which is a regression for every UPCOMING/OPEN row',
    ).toMatch(/price_range_max/);
  });

  it('keeps taking the listing-performance figures from the joined table', async () => {
    const projection = await captureListingsProjection();
    // Guards the fix against being "achieved" by dropping the join.
    expect(describeProjection(projection.listingPrice)).toMatch(/listing_price/);
    expect(describeProjection(projection.listingGainPercent)).toMatch(/listing_gain_percent/);
  });
});
