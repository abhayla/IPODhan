/**
 * PR #1327 Tier A follow-up (§9.2 item 18, §1.11): /api/ipos/listings shows each row's applicable
 * fields only, like the detail page and the other reader routes. The route queries `db` directly, so
 * the query builder is stubbed with a chain that returns the queued result sets in order (count,
 * listings, subscriptions, gmp). MUTATION: drop the applicability shaping from the route -> RED.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const results: unknown[][] = [];
function chain(): unknown {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']) c[m] = () => c;
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(results.shift() ?? []).then(resolve, reject);
  return c;
}

vi.mock('@/lib/db/index', () => ({ db: { select: () => chain() } }));
vi.mock('@/lib/db', async () => {
  const schema = await import('@ipodhan/shared/db/schema');
  return { ipos: schema.ipos, listingPerformance: schema.listingPerformance, subscriptions: schema.subscriptions, gmpRecords: schema.gmpRecords };
});

const base = {
  segment: 'MAINBOARD',
  listingExchanges: ['NSE', 'BSE'],
  openDate: '2026-09-01',
  closeDate: '2026-09-03',
  listingDate: '2026-09-08',
  allotmentDate: '2026-09-04',
  listingPrice: '1010',
  listingGainPercent: '1',
  currentPrice: '1020',
  currentPriceBSE: 1020,
  currentPriceNSE: 1020,
  currentGainPercent: '2',
};
const rows = [
  { ...base, id: 'a', companyName: 'Ncd Ltd', slug: 'ncd', offeringType: 'NCD', issuePrice: '1000', issueSize: '5000000', lotSize: 10 },
  { ...base, id: 'b', companyName: 'Buyback Ltd', slug: 'buyback', offeringType: 'BUYBACK', issuePrice: '1000', issueSize: '7000000', lotSize: 20 },
  { ...base, id: 'c', companyName: 'Ipo Ltd', slug: 'ipo', offeringType: 'IPO', issuePrice: '100', issueSize: '9000000', lotSize: 150 },
];

describe('/api/ipos/listings hides the fields a row type makes not applicable', () => {
  it('NCD: lot size and issue price hidden; BUYBACK: issue size, lot size, issue price hidden; IPO untouched', async () => {
    results.push([{ count: 3 }], rows.map((r) => ({ ...r })), [], []);
    const { GET } = await import('@/app/api/ipos/listings/route');
    const res = await GET(new NextRequest('http://localhost/api/ipos/listings'));
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    const [ncd, buyback, ipo] = body.data;
    expect(ncd).toMatchObject({ lotSize: null, issuePrice: null, issueSize: 5000000, marketCap: null });
    expect(buyback).toMatchObject({ lotSize: null, issuePrice: null, issueSize: null, marketCap: null });
    expect(ipo).toMatchObject({ lotSize: 150, issuePrice: 100, issueSize: 9000000 });
    expect(ipo.marketCap).not.toBeNull();
  });
});
