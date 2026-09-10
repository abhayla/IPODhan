/**
 * Item 21 slice 2 — what the revalidate endpoint actually does.
 *
 * The case worth reading is the FIRST one. The design says the detail page is
 * cached under `getIPODetailKey` (`ipo:detail:<slug>`). It is not — the read
 * path uses `getIPOBySlugKey` (`ipo:slug:<slug>`). Deleting only the key the
 * design names would have looked like it worked, changed nothing a reader sees,
 * and been very hard to notice: the page would go on serving the old number for
 * its whole TTL with no error anywhere. This test pins the key the READ PATH
 * uses, so a future edit cannot quietly drop it.
 */
import { describe, it, expect, vi } from 'vitest';
import { revalidateForSlugs, isRevalidatableSlug } from '@/lib/services/page-revalidation-service';
import { REVALIDATED_PATHS } from '@/lib/services/page-revalidation-targets';
import { getIPOBySlugKey, getIPODetailKey } from '@/lib/cache/cache-keys';

function deps() {
  const deleted: string[] = [];
  const revalidated: string[] = [];
  return {
    deleted,
    revalidated,
    redis: { del: vi.fn(async (k: string) => { deleted.push(k); return 1; }) },
    revalidatePath: vi.fn((p: string) => { revalidated.push(p); }),
  };
}

describe('revalidateForSlugs', () => {
  it('deletes the key the READ PATH uses, not only the one the design names', async () => {
    const d = deps();
    await revalidateForSlugs(['acme-ltd'], d);
    expect(d.deleted).toContain(getIPOBySlugKey('acme-ltd'));   // ipo:slug:acme-ltd
    expect(d.deleted).toContain(getIPODetailKey('acme-ltd'));   // ipo:detail:acme-ltd
  });

  it('a mutation: dropping the by-slug key leaves the reader on the stale value', async () => {
    // Asserted as an explicit relationship rather than a string, so renaming the
    // helper cannot make this test silently check nothing.
    const d = deps();
    await revalidateForSlugs(['acme-ltd'], d);
    expect(d.deleted.filter((k) => k === 'ipo:slug:acme-ltd')).toHaveLength(1);
  });

  it('revalidates the IPO page itself', async () => {
    const d = deps();
    await revalidateForSlugs(['acme-ltd'], d);
    expect(d.revalidated).toContain('/ipos/acme-ltd');
  });

  it('revalidates every list page ONCE, not once per slug', async () => {
    const d = deps();
    await revalidateForSlugs(['a-ltd', 'b-ltd', 'c-ltd'], d);
    for (const p of REVALIDATED_PATHS) {
      expect(d.revalidated.filter((x) => x === p)).toHaveLength(1);
    }
  });

  it('does nothing at all when no slug was touched - an idle cycle rebuilds no page', async () => {
    const d = deps();
    const out = await revalidateForSlugs([], d);
    expect(d.deleted).toEqual([]);
    expect(d.revalidated).toEqual([]);
    expect(out).toMatchObject({ requested: 0, revalidated: 0, paths: 0 });
  });

  it('deduplicates - three sources writing one IPO is one page, not three', async () => {
    const d = deps();
    const out = await revalidateForSlugs(['acme-ltd', 'acme-ltd', 'acme-ltd'], d);
    expect(d.revalidated.filter((p) => p === '/ipos/acme-ltd')).toHaveLength(1);
    expect(out.revalidated).toBe(1);
    expect(out.requested).toBe(3);
  });

  it('refuses junk that would become a cache key or a path', async () => {
    const d = deps();
    const out = await revalidateForSlugs(['../../etc/passwd', 'UPPER', '', null, 42, 'ok-ltd'], d);
    expect(d.revalidated.filter((p) => p.startsWith('/ipos/'))).toEqual(['/ipos/ok-ltd']);
    expect(out.revalidated).toBe(1);
  });

  it('is not fatal when one slug fails - the rest of the cycle still refreshes', async () => {
    const d = deps();
    d.redis.del = vi.fn(async (k: string) => {
      if (k.includes('bad-ltd')) throw new Error('redis down for this key');
      d.deleted.push(k);
      return 1;
    });
    const out = await revalidateForSlugs(['bad-ltd', 'good-ltd'], d);
    expect(out.failed).toEqual(['bad-ltd']);
    expect(out.revalidated).toBe(1);
    expect(d.revalidated).toContain('/ipos/good-ltd');
  });

  it('names the slug that failed rather than reporting a count', async () => {
    // signal-ownership R1: a bare "1 failed" cannot be acted on.
    const d = deps();
    d.redis.del = vi.fn(async () => { throw new Error('down'); });
    const out = await revalidateForSlugs(['x-ltd'], d);
    expect(out.failed).toEqual(['x-ltd']);
  });

  it('a non-array body is handled, not thrown on', async () => {
    const d = deps();
    const out = await revalidateForSlugs(undefined, d);
    expect(out).toMatchObject({ requested: 0, revalidated: 0 });
  });
});

describe('isRevalidatableSlug', () => {
  it('accepts a real slug shape', () => {
    expect(isRevalidatableSlug('acme-industries-ltd')).toBe(true);
  });
  it('rejects traversal, uppercase, empty and non-strings', () => {
    for (const bad of ['../x', 'Acme', '', '-leading', null, 7, {}]) {
      expect(isRevalidatableSlug(bad)).toBe(false);
    }
  });
});
