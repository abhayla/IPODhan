/**
 * PR #1327 Tier A MAJOR-2 (§9.2 item 18, §1.11): a field the IPO's (corrected) type makes not
 * applicable disappears from EVERY reader path, not only the detail payload. One test per route that
 * reads a child table on its own; the repositories are stubbed so the route's own shaping is what is
 * asserted. The IPO here is a BUYBACK (financial_data, peer_companies, ipo_financials not applicable)
 * whose stored rows still hold values from its old type. MUTATION: drop the helper call from any one
 * route -> that route's test goes RED.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: vi.fn(() => ({})) }));
vi.mock('@/lib/logger', () => {
  const methods = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), trace: vi.fn() });
  const logger = { ...methods(), child: vi.fn(() => ({ ...methods(), child: vi.fn(() => methods()) })) };
  return { logger, default: logger, createLogger: vi.fn(() => logger) };
});
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const ipo = {
  id: '00000000-0000-4000-8000-00000000c142',
  slug: 'od142-buyback',
  companyName: 'OD142 Buyback Ltd',
  status: 'UPCOMING',
  segment: 'MAINBOARD',
  listingExchanges: ['NSE', 'BSE'],
  offeringType: 'BUYBACK',
  priceRangeMin: null,
  priceRangeMax: null,
  lotSize: null,
};
const financialRow = { id: 'f1', ipoId: ipo.id, revenueFy2024: '900', eps: '4.5', peRatio: '20', roe: '12' };
const peerRows = [{ id: 'p1', ipoId: ipo.id, companyName: 'Peer Ltd', peRatio: '15', eps: '2' }];
const listingRow = { id: 'l1', ipoId: ipo.id, listingPrice: '120', currentPrice: '130', listingDate: '2026-10-01' };
const ipoFinancialsRow = { id: 'x1', ipoId: ipo.id, pbRatio: '3', rocePercentage: '18', industryPe: '25' };

vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({ findBySlug: vi.fn(async () => ({ ...ipo })) })),
}));
vi.mock('@/lib/repositories/financial-data-repository', () => ({
  FinancialDataRepository: vi.fn().mockImplementation(() => ({ findByIPO: vi.fn(async () => ({ ...financialRow })) })),
}));
vi.mock('@/lib/repositories/peer-company-repository', () => ({
  PeerCompanyRepository: vi.fn().mockImplementation(() => ({ findByIPO: vi.fn(async () => peerRows.map((r) => ({ ...r }))) })),
}));
vi.mock('@/lib/repositories/listing-performance-repository', () => ({
  ListingPerformanceRepository: vi.fn().mockImplementation(() => ({ findByIPO: vi.fn(async () => ({ ...listingRow })) })),
}));
vi.mock('@/lib/repositories/ipo-financials-repository', () => ({
  IpoFinancialsRepository: vi.fn().mockImplementation(() => ({ findByIPO: vi.fn(async () => ({ ...ipoFinancialsRow })) })),
}));
vi.mock('@/lib/repositories/subscription-repository', () => ({
  SubscriptionRepository: vi.fn().mockImplementation(() => ({ findLatest: vi.fn(async () => null) })),
}));
vi.mock('@/lib/repositories/gmp-repository', () => ({
  GMPRepository: vi.fn().mockImplementation(() => ({ findByIPO: vi.fn(async () => []) })),
}));

const ctx = { params: Promise.resolve({ slug: ipo.slug }) };
const req = (path: string) => new NextRequest(`http://localhost${path}`);

describe('PR #1327 MAJOR-2: not-applicable fields leave every reader path (BUYBACK)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('/api/ipos/[slug]/financials blanks every financial_data field', async () => {
    const { GET } = await import('@/app/api/ipos/[slug]/financials/route');
    const body = await (await GET(req(`/api/ipos/${ipo.slug}/financials`), ctx as never)).json();
    expect(body.data).toMatchObject({ revenueFy2024: null, eps: null, peRatio: null, roe: null });
  });

  it('/api/ipos/[slug]/peers blanks every peer field the manifest rules not applicable', async () => {
    const { GET } = await import('@/app/api/ipos/[slug]/peers/route');
    const body = await (await GET(req(`/api/ipos/${ipo.slug}/peers`), ctx as never)).json();
    expect(body.data).toEqual([expect.objectContaining({ companyName: null, peRatio: null, eps: null })]);
  });

  it('/api/ipos/[slug]/listing-performance hands its row to the helper under listing_performance', async () => {
    // Today's manifest rules no listing_performance field not applicable for any type (SME_BSE's
    // empty current_price_nse list is a gap, #858, not N/A), so the proof is the wiring: the route's
    // row goes through the one helper, under its own table name, and comes back as the payload.
    const helper = await import('@/lib/ipo-field-applicability');
    const spy = vi.spyOn(helper, 'hideNotApplicableRows');
    const { GET } = await import('@/app/api/ipos/[slug]/listing-performance/route');
    const body = await (await GET(req(`/api/ipos/${ipo.slug}/listing-performance`), ctx as never)).json();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ offeringType: 'BUYBACK' }), 'listing_performance', expect.objectContaining({ listingPrice: '120' }));
    expect(body.data).toMatchObject({ listingPrice: '120', currentPrice: '130' });
    spy.mockRestore();
  });

  it('/api/tools/compare hides financials and ipoFinancials', async () => {
    const { POST } = await import('@/app/api/tools/compare/route');
    const other = { ...ipo, slug: 'od142-buyback-2' };
    const { IPORepository } = await import('@/lib/repositories/ipo-repository');
    (IPORepository as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(() => ({
      findBySlug: vi.fn(async (s: string) => (s === ipo.slug ? { ...ipo } : { ...other })),
    }));
    const res = await POST(
      new NextRequest('http://localhost/api/tools/compare', {
        method: 'POST',
        body: JSON.stringify({ ipoSlugs: [ipo.slug, other.slug] }),
        headers: { 'content-type': 'application/json' },
      })
    );
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    const first = body.comparisons[0];
    expect(first.financials).toEqual({ peRatio: null, roe: null, revenueGrowth: null, eps: null });
    expect(first.ipoFinancials).toBeNull();
  });
});

describe('every manifest table has a declared reader exposure; an unknown table fails loudly', () => {
  it('declares every manifest table and throws for a table it does not know', async () => {
    const manifest = (await import('../../../../scraper/config/field-manifest.json')).default as { fields: Record<string, unknown> };
    const { READER_TABLE_EXPOSURE, hideNotApplicableRows } = await import('@/lib/ipo-field-applicability');
    for (const key of Object.keys(manifest.fields)) expect(READER_TABLE_EXPOSURE, key).toHaveProperty(key.split('.')[0]);
    expect(() => hideNotApplicableRows({ offeringType: 'IPO' }, 'no_such_table', {})).toThrow(/no_such_table/);
  });

  it('a rows-only table (promoters, BUYBACK) is blanked by the same rule', async () => {
    const { hideNotApplicableRows } = await import('@/lib/ipo-field-applicability');
    const out = hideNotApplicableRows({ segment: 'MAINBOARD', offeringType: 'BUYBACK' }, 'promoters', [{ name: 'A', waca: '1', id: 'x' }]);
    expect(out).toEqual([{ name: null, waca: null, id: 'x' }]);
  });
});
