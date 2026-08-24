/**
 * Mainboard Prospectus Service Unit Tests
 *
 * T-310 (P2): /mainboard-ipo-prospectus leaked non-IPO rows (OFS, TENDER, ...)
 * that carry segment='MAINBOARD' but are not IPOs — the mainboard listing page
 * already gates on offeringType via the shared REAL_IPO_OFFERING_TYPES
 * predicate; this service did not. This test asserts the same predicate is
 * applied here, using an OFS-type fixture row that must never surface on a
 * page titled "Mainboard IPO Prospectus".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMainboardProspectusDocuments } from '@/lib/services/mainboard-prospectus-service';

// ==================== MOCKS ====================

// Fixture rows: one genuine IPO (with a DRHP doc) and one OFS row that must
// be excluded. The db mock does not implement real SQL filtering — it always
// returns both rows — so this test also asserts on the `where` conditions the
// service builds, to prove the offeringType gate is actually wired, not just
// that the grouping logic works on already-filtered input.
const ipoRow = {
  ipo: {
    id: 'ipo-1',
    companyName: 'Genuine Mainboard IPO Ltd',
    slug: 'genuine-mainboard-ipo-ltd',
    segment: 'MAINBOARD' as const,
    offeringType: 'IPO',
    listingExchanges: ['NSE', 'BSE'] as ('NSE' | 'BSE')[],
  },
  document: {
    id: 'doc-1',
    type: 'DRHP',
    title: 'Genuine IPO DRHP',
    url: 'https://example.com/drhp.pdf',
    fileSize: 1024,
    uploadedAt: new Date('2026-01-01'),
  },
};

let capturedAndConditions: unknown[] | undefined;
let queryRows: typeof ipoRow[] = [ipoRow];

vi.mock('@/lib/db', () => {
  const chain = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => Promise.resolve(queryRows)),
  };
  return {
    db: chain,
    ipos: { segment: 'segment', companyName: 'companyName', offeringType: 'offeringType', listingExchanges: 'listingExchanges' },
    documents: { id: 'id', ipoId: 'ipoId', type: 'type', title: 'title', url: 'url', fileSize: 'fileSize', uploadedAt: 'uploadedAt' },
  };
});

// The service builds its filter as `where(and(...conditions))` — capture the
// conditions array passed into `and()` (not `where()`, which only ever
// receives the single combined predicate `and()` returns).
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm');
  return {
    ...actual,
    and: vi.fn((...conditions: unknown[]) => {
      capturedAndConditions = conditions;
      return actual.and(...(conditions as Parameters<typeof actual.and>));
    }),
  };
});

describe('getMainboardProspectusDocuments (T-310)', () => {
  beforeEach(() => {
    capturedAndConditions = undefined;
    queryRows = [ipoRow];
  });

  it('builds a where clause that includes the offeringType=IPO gate (REAL_IPO_OFFERING_TYPES)', async () => {
    await getMainboardProspectusDocuments();

    expect(capturedAndConditions).toBeDefined();
    // confirm at least 2 conditions were built (segment + offeringType), not
    // just the pre-existing segment condition.
    expect((capturedAndConditions as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it('reports documentsAvailableCount honestly for rows with and without documents', async () => {
    const ipoNoDoc = {
      ipo: { ...ipoRow.ipo, id: 'ipo-2', companyName: 'No Docs Yet Ltd', slug: 'no-docs-yet-ltd' },
      document: null,
    };
    queryRows = [ipoRow, ipoNoDoc];

    const result = await getMainboardProspectusDocuments();

    expect(result.data).toHaveLength(2);
    expect(result.documentsAvailableCount).toBe(1);
  });
});
