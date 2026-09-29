/**
 * §9.2 item 23 (OD-116 as corrected by OD-118): "its address answers 410 Gone".
 *
 * The App Router cannot give a page a 410 status, so the middleware answers it, before the IPO
 * page (and its fuzzy slug fallback, which would otherwise send the address to a neighbouring IPO)
 * ever runs. The middleware asks this module whether a slug is hidden. Hidden rows are few, so the
 * whole set is read in one query and held for HIDDEN_SLUGS_TTL_MS per process; a hide or unhide
 * reaches every process within that window. Until then the page itself still refuses a hidden row
 * (findBySlugWithFallback returns null -> 404), so a reader never sees its content.
 */
import { logger } from '../logger';

export const HIDDEN_SLUGS_TTL_MS = 30_000;

export type HiddenSlugQuery = () => Promise<string[]>;

async function queryHiddenSlugs(): Promise<string[]> {
  // Imported lazily: the middleware module stays free of the database until an /ipos/ path asks.
  const { db, ipos } = await import('../db');
  const { isNotNull } = await import('drizzle-orm');
  const rows = await db.select({ slug: ipos.slug }).from(ipos).where(isNotNull(ipos.hiddenAt));
  return rows.map((r) => r.slug);
}

let cached: { at: number; slugs: Set<string> } | null = null;
let inflight: Promise<Set<string>> | null = null;

/** Test seam: forget the cached set. */
export function resetHiddenIpoSlugCache(): void {
  cached = null;
  inflight = null;
}

async function hiddenSlugs(query: HiddenSlugQuery, now: number): Promise<Set<string>> {
  if (cached && now - cached.at < HIDDEN_SLUGS_TTL_MS) return cached.slugs;
  if (!inflight) {
    inflight = query()
      .then((slugs) => {
        const set = new Set(slugs);
        cached = { at: now, slugs: set };
        return set;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * True when an admin hid the IPO at this slug. Fails OPEN (false) when the database cannot be read:
 * the page then applies the same rule itself and answers 404, never the hidden row's content.
 */
export async function isHiddenIpoSlug(
  slug: string,
  options: { query?: HiddenSlugQuery; now?: number } = {}
): Promise<boolean> {
  try {
    const set = await hiddenSlugs(options.query ?? queryHiddenSlugs, options.now ?? Date.now());
    return set.has(slug);
  } catch (error) {
    logger.error(
      { slug, error: error instanceof Error ? error.message : String(error) },
      '[item 23] hidden-slug lookup failed - page-level guard applies instead'
    );
    return false;
  }
}
