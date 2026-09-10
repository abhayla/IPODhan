/**
 * Refresh the pages a scraper cycle actually changed (OD-40).
 *
 * Today a correction waits out two independent timers before a reader sees it:
 * the Redis entry the read path caches under, and Next's own timed rebuild of
 * the page. This drops the first and triggers the second for the IPOs that
 * genuinely changed, so a fix is visible in the same cycle that made it.
 *
 * THE CACHE KEY IS THE PART THE DESIGN GOT WRONG. §2.11 says the detail page
 * lives under `getIPODetailKey` (`ipo:detail:<slug>`). It does not:
 * `IPORepository.findBySlug()` caches under `getIPOBySlugKey`
 * (`ipo:slug:<slug>`), and `getIPODetailKey` has exactly one call site in the
 * whole repository — an invalidation-only `redis.del()` on admin edit, under a
 * key nothing populates. Deleting only the key the design names would have
 * looked like it worked, changed nothing a reader sees, and been extremely hard
 * to notice: the page would just keep serving the old number for its full TTL.
 * Both are deleted here — the one the read path uses, and the one the admin
 * path also clears, so the two write paths stay consistent.
 *
 * NOT copied from the admin route: its `redis.del('ipo:list:*')` at line 299.
 * `del` takes exact key names, not globs, so that call deletes a key literally
 * named `ipo:list:*` and the list cache survives untouched. List pages are
 * refreshed here through `revalidatePath`, which actually works.
 */
import { getIPOBySlugKey, getIPODetailKey } from '@/lib/cache/cache-keys';
import { REVALIDATED_PATHS } from './page-revalidation-targets';

export interface RevalidationDeps {
  /** Only `del` is used; injected so the unit tests need no Redis. */
  redis: { del(key: string): Promise<unknown> };
  revalidatePath: (path: string) => void;
}

export interface RevalidationOutcome {
  requested: number;
  revalidated: number;
  /** Slugs whose cache delete threw. Reported, never fatal to the batch. */
  failed: string[];
  paths: number;
}

/** A slug shape a page could actually have. Keeps junk out of a cache key. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

export function isRevalidatableSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && SLUG.test(slug);
}

export async function revalidateForSlugs(
  slugs: unknown,
  deps: RevalidationDeps
): Promise<RevalidationOutcome> {
  const list = Array.isArray(slugs) ? slugs : [];
  // Dedup before doing work: three sources writing one IPO is one page.
  const valid = Array.from(new Set(list.filter(isRevalidatableSlug)));

  const failed: string[] = [];
  for (const slug of valid) {
    try {
      await deps.redis.del(getIPOBySlugKey(slug));
      await deps.redis.del(getIPODetailKey(slug));
      deps.revalidatePath(`/ipos/${slug}`);
    } catch {
      // One bad slug must not cost the whole cycle its refresh. The page it
      // could not clear simply waits out its timer, which is today's behaviour.
      failed.push(slug);
    }
  }

  // Once per call, never per slug: refreshing the calendar 40 times for one
  // cycle is 39 rebuilds of the same page.
  let paths = 0;
  if (valid.length > 0) {
    for (const path of REVALIDATED_PATHS) {
      try {
        deps.revalidatePath(path);
        paths++;
      } catch {
        // Same rule: a path that will not rebuild is not worth failing a cycle.
      }
    }
  }

  return {
    requested: list.length,
    revalidated: valid.length - failed.length,
    failed,
    paths,
  };
}
