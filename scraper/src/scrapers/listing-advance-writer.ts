/**
 * #70: writes the listing source's listing date (and LISTED) to `ipos` through
 * the normal scraper write path, then reads back what `ipos` actually holds.
 *
 * The write is a CHITTORGARH claim through `upsertIPO`, so the field priority
 * matrix decides it like any other source's value: NSE and BSE outrank it for
 * `listing_date` (spec field 7, E-1), and ADMIN outranks everything. The read
 * back is the point: `listing_performance.listing_date` is a copy of
 * `ipos.listing_date`, so the caller writes the listing row only with the date
 * `ipos` really stored, and not at all when consolidation kept it empty.
 */
import { eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { db } from '@ipodhan/shared/db';
import { IPORepository } from '@ipodhan/shared/repositories/ipo-repository';
import { resolveIpoRow } from '@ipodhan/shared/repositories';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import type { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { upsertIPO } from '../services/data-persister.js';
import type { StuckIpo } from '../services/listing-reconciliation.js';
import type { ScrapedIPO } from '../utils/validators.js';

export interface ListingAdvanceResult {
  /** `ipos.listing_date` after the write (YYYY-MM-DD), or null when it stayed empty. */
  storedListingDate: string | null;
  storedStatus: string | null;
}

export type ListingAdvanceWriter = (ipo: StuckIpo, scraped: ScrapedIPO) => Promise<ListingAdvanceResult>;

export function createListingAdvanceWriter(redis: ReturnType<typeof getRedisClient>): ListingAdvanceWriter {
  const ipoRepo = new IPORepository(db, redis);
  return async (ipo, scraped) => {
    const preResolved = await resolveIpoRow(ipoRepo, {
      companyName: ipo.companyName,
      normalizedName: normalizeCompanyNameForMatching(ipo.companyName),
      slug: ipo.slug,
      isin: ipo.isin,
      symbol: ipo.symbol,
    });
    await upsertIPO(ipoRepo, scraped, 'CHITTORGARH', preResolved);
    const [row] = await db
      .select({ listingDate: schema.ipos.listingDate, status: schema.ipos.status })
      .from(schema.ipos)
      .where(eq(schema.ipos.id, ipo.id));
    return {
      storedListingDate: row?.listingDate ? String(row.listingDate) : null,
      storedStatus: row?.status ? String(row.status) : null,
    };
  };
}
