import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Item 12 (OD-68): repair-decorated-slugs.ts renames a decorated SLUG on a
 * name-clean row, writes an ipo_slug_redirects row in the same transaction,
 * and refuses a rename that would collide with another row's live slug.
 * Real-data example this class was built from (staging,
 * i_ipo_title_in_name): "purple-style-labs-ltd-pernia-s-pop-up-studio-ipo"
 * with company_name "Purple Style Labs Limited" (clean).
 */

const warnMock = vi.fn();
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: warnMock, error: vi.fn() },
}));

vi.mock('../../../src/services/ipo-identity-slug.js', () => ({
  // Mirrors the real computeIpoIdentitySlug for a clean, non-OFS company name:
  // lowercase, spaces -> hyphens, strip anything non [a-z0-9-]. No offeringType
  // year suffix is exercised here (matches this class: OFS explicit rows are
  // out of scope for item 12, per the tool's own doc comment).
  computeIpoIdentitySlug: (input: { companyName: string }) =>
    input.companyName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
}));

const selectResults: Array<Array<{ id: string; companyName?: string }>> = [];
// The ipos.slug update + ipo_slug_redirects insert now live in
// IPORepository.renameSlugWithRedirect (the shared write path, R0) —
// applyRename() only calls that method, never db.transaction() directly.
const renameSlugWithRedirectDetailed = vi.fn();

vi.mock('@ipodhan/shared', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResults.shift() ?? [],
        }),
      }),
    }),
  },
  IPORepository: class {},
  getRedisClient: () => ({ del: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('@ipodhan/shared/db/schema', () => ({
  ipos: { id: 'id', slug: 'slug' },
  ipoSlugRedirects: { oldSlug: 'oldSlug' },
}));

// checkIpoTitleInName / strip* are the audit's real predicate — imported
// unmocked so classify() is proven against the actual detector, not a stub.

describe('classify() — reuses the audit predicate, no third copy', () => {
  it('flags a decorated slug on a clean company name as in-scope', async () => {
    const { classify } = await import('../../../scripts/repair-decorated-slugs.js');
    const result = classify({
      id: 'ipo-1',
      companyName: 'Purple Style Labs Limited',
      slug: 'purple-style-labs-ltd-pernia-s-pop-up-studio-ipo',
      offeringType: 'IPO',
      status: 'UPCOMING',
    });
    expect(result).toBe('in-scope');
  });

  it('leaves a name-polluted row alone as a different class', async () => {
    const { classify } = await import('../../../scripts/repair-decorated-slugs.js');
    const result = classify({
      id: 'ipo-2',
      companyName: 'Some Company Limited (IPO)',
      slug: 'some-company-ltd-ipo',
      offeringType: 'IPO',
      status: 'UPCOMING',
    });
    expect(result).toBe('name-polluted');
  });

  it('leaves an already-clean row untouched', async () => {
    const { classify } = await import('../../../scripts/repair-decorated-slugs.js');
    const result = classify({
      id: 'ipo-3',
      companyName: 'Clean Company Limited',
      slug: 'clean-company-limited',
      offeringType: 'IPO',
      status: 'UPCOMING',
    });
    expect(result).toBe('clean');
  });
});

describe('planRow() / applyRename() — rename, redirect, collision refusal, idempotency', () => {
  beforeEach(() => {
    selectResults.length = 0;
    renameSlugWithRedirectDetailed.mockReset();
    warnMock.mockClear();
  });

  it('plans a rename for a decorated slug with no collision', async () => {
    const { planRow } = await import('../../../scripts/repair-decorated-slugs.js');
    selectResults.push([]); // no collision on the new slug
    const plan = await planRow({
      id: 'ipo-1',
      companyName: 'Purple Style Labs Limited',
      slug: 'purple-style-labs-ltd-pernia-s-pop-up-studio-ipo',
      offeringType: 'IPO',
      status: 'UPCOMING',
    });
    expect(plan.outcome).toBe('planned');
    expect(plan.newSlug).toBe('purple-style-labs-limited');
  });

  it('refuses a rename that collides with another row\'s live slug', async () => {
    const { planRow } = await import('../../../scripts/repair-decorated-slugs.js');
    selectResults.push([{ id: 'other-row', companyName: 'Purple Style Labs Limited' }]);
    const plan = await planRow({
      id: 'ipo-1',
      companyName: 'Purple Style Labs Limited',
      slug: 'purple-style-labs-ltd-pernia-s-pop-up-studio-ipo',
      offeringType: 'IPO',
      status: 'UPCOMING',
    });
    expect(plan.outcome).toBe('refused-collision');
    expect(plan.collisionWith).toContain('other-row');
  });

  it('is a no-op (second run does 0) when the slug is already the computed clean slug', async () => {
    const { planRow } = await import('../../../scripts/repair-decorated-slugs.js');
    const plan = await planRow({
      id: 'ipo-1',
      companyName: 'Purple Style Labs Limited',
      slug: 'purple-style-labs-limited',
      offeringType: 'IPO',
      status: 'UPCOMING',
    });
    expect(plan.outcome).toBe('no-op-already-clean');
    // no collision select was ever issued for a no-op
    expect(selectResults.length).toBe(0);
  });

  it('applyRename writes the slug update and the redirect in the same transaction', async () => {
    const { applyRename } = await import('../../../scripts/repair-decorated-slugs.js');
    selectResults.push([]); // slugIsLive(oldSlug) shadow-guard check: nobody else holds it
    renameSlugWithRedirectDetailed.mockResolvedValueOnce({
      outcome: 'written',
      before: { slug: 'purple-style-labs-ltd-pernia-s-pop-up-studio-ipo', updatedAt: '2026-09-01 10:00:00' },
      after: { slug: 'purple-style-labs-limited', updatedAt: '2026-09-26 12:00:00' },
      redirect: null,
    });

    const outcome = await applyRename(
      {
        id: 'ipo-1',
        companyName: 'Purple Style Labs Limited',
        oldSlug: 'purple-style-labs-ltd-pernia-s-pop-up-studio-ipo',
        newSlug: 'purple-style-labs-limited',
        outcome: 'planned',
      },
      'ipodhan_staging',
      { renameSlugWithRedirectDetailed }
    );

    expect(outcome.outcome).toBe('written');
    // a pre-existing redirect (redirect: null) is never ledgered as an insert (#457)
    expect(outcome.changes.map((c) => `${c.table}.${c.field}`)).toEqual(['ipos.slug', 'ipos.updated_at']);
    expect(renameSlugWithRedirectDetailed).toHaveBeenCalledTimes(1);
    expect(renameSlugWithRedirectDetailed).toHaveBeenCalledWith(
      'ipo-1',
      'purple-style-labs-ltd-pernia-s-pop-up-studio-ipo',
      'purple-style-labs-limited',
      'DECORATED_SLUG_CLEANUP'
    );
  });

  it('applyRename skips (shadow guard) when another live row now holds the old slug', async () => {
    const { applyRename } = await import('../../../scripts/repair-decorated-slugs.js');
    selectResults.push([{ id: 'someone-else' }]); // slugIsLive(oldSlug) -> true

    const outcome = await applyRename(
      {
        id: 'ipo-1',
        companyName: 'Purple Style Labs Limited',
        oldSlug: 'purple-style-labs-ltd-pernia-s-pop-up-studio-ipo',
        newSlug: 'purple-style-labs-limited',
        outcome: 'planned',
      },
      'ipodhan_staging',
      { renameSlugWithRedirectDetailed }
    );

    expect(outcome.outcome).toBe('skipped-shadow');
    expect(outcome.changes).toEqual([]);
    expect(renameSlugWithRedirectDetailed).not.toHaveBeenCalled();
  });
});
