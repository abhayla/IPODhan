import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { revalidateAfterStatusChange } from '@/lib/services/status-updater-service';

/**
 * Item 21 — a status flip must refresh the PAGE, not just the data cache.
 *
 * The status updater already clears Redis for every IPO whose status it
 * changes. That is the data layer. The pages are statically generated with a
 * timer (`CacheTTL.IPO_LISTINGS: 300 // matches page ISR revalidation`), so the
 * rendered HTML keeps being served until that timer expires no matter what
 * Redis holds.
 *
 * The visible consequence, in plain terms: an IPO closes, the database says
 * CLOSED within the minute, and ipodhan.com keeps telling readers it is OPEN
 * for up to another fifteen minutes. A status flip is the single most visible
 * thing on an IPO page, and it was the one write path that never reached the
 * refresh mechanism item 21 exists to provide — because the transition is
 * applied inside the web app while the scraper's touched-IPO tracker lives in a
 * different process entirely.
 */
describe('a status transition refreshes the pages a reader sees', () => {
  it('revalidates the detail page of every IPO whose status changed', async () => {
    const revalidatePath = vi.fn();
    const redis = { del: vi.fn().mockResolvedValue(1) };

    await revalidateAfterStatusChange(['kanohar-electricals', 'prasol-chemicals'], {
      redis,
      revalidatePath,
    });

    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/ipos/kanohar-electricals');
    expect(paths).toContain('/ipos/prasol-chemicals');
  });

  it('revalidates the listing pages too, not only the detail page', async () => {
    // A closed IPO still shows as OPEN in the LIST until that page is
    // refreshed. Clearing only the detail page fixes the page almost nobody
    // lands on first.
    const revalidatePath = vi.fn();
    const redis = { del: vi.fn().mockResolvedValue(1) };

    await revalidateAfterStatusChange(['kanohar-electricals'], { redis, revalidatePath });

    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths.some((p) => p !== '/ipos/kanohar-electricals')).toBe(true);
  });

  it('does nothing at all when no status changed', async () => {
    // Most cycles change nothing. Revalidating every path on every cycle would
    // throw away the whole static cache every thirty minutes.
    const revalidatePath = vi.fn();
    const redis = { del: vi.fn().mockResolvedValue(1) };

    await revalidateAfterStatusChange([], { redis, revalidatePath });

    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('a failing refresh never takes down the status update itself', async () => {
    // The transition is already committed to the database by this point.
    // Losing one cycle's page refresh means the page waits out its timer,
    // which is exactly the old behaviour — but throwing here would abort the
    // rest of the status update and lose the reporting the caller returns.
    const revalidatePath = vi.fn(() => {
      throw new Error('revalidate exploded');
    });
    const redis = { del: vi.fn().mockResolvedValue(1) };

    await expect(
      revalidateAfterStatusChange(['kanohar-electricals'], { redis, revalidatePath })
    ).resolves.not.toThrow();
  });
});

/**
 * The tests above prove the helper WORKS. These prove it is CALLED.
 *
 * That distinction is not academic here: this very item already shipped a
 * correct, well-tested refresh mechanism that the status-update path never
 * reached, which is the whole defect being fixed. A helper with no caller is
 * indistinguishable from no helper at all, and the isolated tests above would
 * stay green through exactly that regression.
 *
 * Asserted against the source because the alternative - driving
 * `updateIPOStatuses` end to end - needs a live database and Redis, which a
 * unit test must not require.
 */
describe('the refresh is actually wired into the path that flips a status', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('updateIPOStatuses calls the refresh after it changes statuses', () => {
    const src = read('lib/services/status-updater-service.ts');
    expect(src).toMatch(/await revalidateAfterStatusChange\(/);
  });

  it('the route hands the service a real revalidatePath', () => {
    // `revalidatePath` only works inside a Next request context, so the route
    // is the only place it can come from. Without this argument the service
    // silently skips the refresh and the bug is back with every test green.
    const src = read('app/api/admin/status/update/route.ts');
    expect(src).toMatch(/from 'next\/cache'/);
    expect(src).toMatch(/updateIPOStatuses\(\{\s*revalidatePath\s*\}\)/);
  });
});
