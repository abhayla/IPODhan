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
import { IPORepository } from '@ipodhan/shared';
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

/**
 * Identity facts the write must carry so the row resolves; never claims (OD-66).
 * `listingExchange` is a context too: a Chittorgarh "BSE, NSE" is not proof of
 * the venue (W-145), so this write never claims it.
 */
const IDENTITY_CONTEXT = ['companyName', 'segment', 'offeringType', 'openDate', 'closeDate', 'issueSize', 'priceRangeMax', 'listingExchange'];

export function createListingAdvanceWriter(redis: ReturnType<typeof getRedisClient>): ListingAdvanceWriter {
  const ipoRepo = new IPORepository(db, redis);
  return makeListingAdvanceWriter({
    resolve: (ipo) =>
      resolveIpoRow(ipoRepo, {
        companyName: ipo.companyName,
        normalizedName: normalizeCompanyNameForMatching(ipo.companyName),
        slug: ipo.slug,
        isin: ipo.isin,
        symbol: ipo.symbol,
      }),
    upsert: (scraped, pre, contextFields) =>
      upsertIPO(ipoRepo, scraped, 'CHITTORGARH', pre as Parameters<typeof upsertIPO>[3], contextFields),
    readBack: async (ipoId) => {
      const [row] = await db
        .select({ listingDate: schema.ipos.listingDate, status: schema.ipos.status })
        .from(schema.ipos)
        .where(eq(schema.ipos.id, ipoId));
      return {
        storedListingDate: row?.listingDate ? String(row.listingDate) : null,
        storedStatus: row?.status ? String(row.status) : null,
      };
    },
  });
}

export interface ListingAdvanceDeps {
  resolve: (ipo: StuckIpo) => Promise<unknown>;
  upsert: (scraped: ScrapedIPO, pre: unknown, contextFields: string[]) => Promise<unknown>;
  readBack: (ipoId: string) => Promise<ListingAdvanceResult>;
}

/**
 * #70 round 3: two writes. The first claims only the listing date (status goes
 * as context, never asserted). LISTED is claimed in a second write only after
 * the read-back shows ipos really holds the listing date, so a rejected date can
 * never leave a LISTED row without one.
 */
export function makeListingAdvanceWriter(deps: ListingAdvanceDeps): ListingAdvanceWriter {
  return async (ipo, scraped) => {
    const pre = await deps.resolve(ipo);
    await deps.upsert({ ...scraped, status: ipo.status as ScrapedIPO['status'] }, pre, [...IDENTITY_CONTEXT, 'status']);
    const afterDate = await deps.readBack(ipo.id);
    if (!afterDate.storedListingDate) return afterDate;
    await deps.upsert({ ...scraped, status: 'LISTED' }, pre, [...IDENTITY_CONTEXT, 'listingDate']);
    return deps.readBack(ipo.id);
  };
}
