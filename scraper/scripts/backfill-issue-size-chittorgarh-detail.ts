/**
 * Backfill: source-backed issue_size repair for below-floor rows (W-177 follow-up).
 *
 * WHY: 26 `ipos` rows with `offering_type='IPO'` store a raw SHARE COUNT in the
 * rupees column `issue_size` (e.g. ESDS Software 17,647,058 where the real issue
 * is ~Rs757 Cr) — see `docs/reviews/issue-size-repair-candidates-2026-09-06.csv`.
 * The write-time guard (`collectImplausibleIssueSizeFields`, W-177) now refuses
 * NEW share counts landing in this column, but it does not repair the 26 rows
 * already corrupted before the guard existed.
 *
 * These rows are NOT fixed by arithmetic (shares * price cap) — at least 7 of
 * the 26 (Windlas, AAA Technologies, Induss, Banganga, Nirbhay, Sanmitra,
 * Piyush) are wrong under that formula because the exchange's share count can
 * be the net-of-anchor offer at the FLOOR price, not the full offer at the CAP
 * (see the coherence-check comment in data-consolidation-service.ts). The only
 * correct fix is a SOURCE: the Chittorgarh per-IPO detail page states the total
 * issue size directly (`extractIssueSizeFromDetailHtml`,
 * scraper/src/scrapers/chittorgarh-detail-fields.ts), gated by the SAME segment
 * floor the write-time guard uses and (when the page states a share count too)
 * a shares*cap cross-check against the page's own numbers.
 *
 * Modelled on `backfill-lot-size-chittorgarh-detail.ts` (report-118 discovery,
 * dry-run default, --apply, --limit) and `reset-document.ts` (the
 * production-database guard: refuse a write against the resolved database name
 * "ipodhan" unless --allow-prod is given — NODE_ENV never distinguishes prod
 * from staging on this VPS).
 *
 * Usage (from scraper/, tunnel env exported):
 *   npx tsx scripts/backfill-issue-size-chittorgarh-detail.ts [--slug a,b,c] [--limit N]
 *   npx tsx scripts/backfill-issue-size-chittorgarh-detail.ts --apply --allow-prod
 */
import { db, getRedisClient } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNotNull, inArray, sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { extractIssueSizeFromDetailHtml } from '../src/scrapers/chittorgarh-detail-fields.js';
import { fillDiscoveryGapsFromReport82 } from './lib/chittorgarh-report82-discovery.js';
import {
  MAINBOARD_ISSUE_SIZE_FLOOR,
  SME_ISSUE_SIZE_FLOOR,
  collectImplausibleIssueSizeFields,
} from '../src/services/data-consolidation-service.js';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;
const slugIdx = process.argv.indexOf('--slug');
const SLUGS = slugIdx >= 0 ? process.argv[slugIdx + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;

/** The one database name this CLI refuses to WRITE to without --allow-prod. */
export const PRODUCTION_DATABASE_NAME = 'ipodhan';

/** Same resolution order as reset-document.ts's resolveDatabaseName. */
export function resolveDatabaseName(env: NodeJS.ProcessEnv): string {
  const raw = env.DATABASE_URL || '';
  const fromUrl = raw
    ? (() => {
        try {
          return new URL(raw).pathname.replace(/^\//, '');
        } catch {
          return '';
        }
      })()
    : '';
  return fromUrl || env.DATABASE_NAME || env.PGDATABASE || '';
}

// WITHDRAWN/POSTPONED are excluded ON PURPOSE, not an oversight: those rows
// belong to the purge/archival path (repair-name-pollution-and-redirects.ts
// and friends), which owns their lifecycle — this backfill only repairs a
// LIVE row's issue_size, never resurrects or re-touches a row a different
// script is responsible for retiring.
const STATUSES = ['UPCOMING', 'OPEN', 'CLOSED', 'LISTED'] as const;

interface Candidate {
  id: string;
  slug: string;
  companyName: string;
  segment: 'MAINBOARD' | 'SME' | null;
  issueSize: string | null; // numeric column comes back as a string, or null
  priceRangeMax: number | null;
  status: string;
}

interface DiscoveryEntry { slug: string; id: string; }

/**
 * Pure decision: given the row's current stored value and a source-extracted
 * candidate, decide whether to write. Extracted for unit testing (no DB/network).
 * The extractor already applies the floor + shares-x-cap cross-check gate on
 * the SOURCED figure itself — this function additionally guards that we never
 * touch a row whose CURRENT value already clears the floor (admin edits / a
 * value the write-time guard would already have accepted stay untouched).
 */
export function decideIssueSizeRepair(input: {
  current: number | null; // null/0 (round 4): same defect class — no usable value
  segment: 'MAINBOARD' | 'SME' | null;
  sourced: number | null; // already floor + cross-check gated by the extractor, or null
}): { write: boolean; reason: string } {
  const floor =
    input.segment === 'MAINBOARD' ? MAINBOARD_ISSUE_SIZE_FLOOR : input.segment === 'SME' ? SME_ISSUE_SIZE_FLOOR : null;

  if (floor !== null && input.current !== null && input.current >= floor) {
    return { write: false, reason: 'current value already clears the segment floor — never overwritten' };
  }
  if (input.sourced === null) {
    return { write: false, reason: 'no plausible source figure (absent, ambiguous, or cross-check failed)' };
  }
  // Belt-and-braces: re-run the exact write-time guard on the sourced value
  // before deciding to write, so this script and the persister door can never
  // disagree about what counts as plausible.
  const implausible = collectImplausibleIssueSizeFields(
    { issueSize: input.sourced, segment: input.segment },
    null,
    'ADMIN' // filing-total semantics: this is a stated total, not an exchange share count
  );
  if (implausible.fields.has('issueSize')) {
    return { write: false, reason: `sourced value failed the write-time guard (${implausible.reason})` };
  }
  return { write: true, reason: 'sourced value passes floor + cross-check gates' };
}

async function fetchReport118(year: number, range: string): Promise<any[]> {
  const u = `https://webnodejs.chittorgarh.com/cloud/report/data-read/118/1/10/${year}/${range}/0/all/0?search=&v=15-11`;
  const r = await fetch(u, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://www.chittorgarh.com/',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`report 118 HTTP ${r.status}`);
  const d: any = await r.json();
  return d?.reportTableData ?? [];
}

async function fetchDetailHtml(slug: string, id: string): Promise<string | null> {
  const u = `https://www.chittorgarh.com/ipo/${slug}/${id}/`;
  try {
    const r = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) { logger.warn({ slug, id, status: r.status }, 'detail HTTP error'); return null; }
    return await r.text();
  } catch (err) {
    logger.warn({ slug, id, error: err instanceof Error ? err.message : String(err) }, 'detail fetch failed');
    return null;
  }
}

const FISCAL_YEARS = [
  { year: 2026, range: '2026-27' },
  { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' },
  { year: 2023, range: '2023-24' },
  { year: 2022, range: '2022-23' },
  { year: 2021, range: '2021-22' },
  { year: 2020, range: '2020-21' },
];

async function main() {
  console.log('='.repeat(80));
  console.log(`ISSUE-SIZE BACKFILL (Chittorgarh detail pages, W-177 repair) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const dbName = resolveDatabaseName(process.env);
  console.log(`database: ${dbName || '(unresolved)'}`);
  const isProdDb = dbName === PRODUCTION_DATABASE_NAME;
  const allowProd = process.argv.includes('--allow-prod');
  if (APPLY && isProdDb && !allowProd) {
    console.error(
      `backfill-issue-size: refusing to APPLY writes against the production database "${PRODUCTION_DATABASE_NAME}" — pass --allow-prod to override.`
    );
    process.exit(1);
  }
  if (APPLY && isProdDb && allowProd) {
    console.log(`ALLOW-PROD: writing against "${PRODUCTION_DATABASE_NAME}" (--allow-prod given).`);
  }

  // 1. Discovery map (report 118 historical + report 82 upcoming fallback) —
  //    identical approach to the lot-size backfill.
  const discovery = new Map<string, DiscoveryEntry>();
  for (const fy of FISCAL_YEARS) {
    try {
      const rows = await fetchReport118(fy.year, fy.range);
      let added = 0;
      for (const row of rows) {
        const name = row?.Company ? String(row.Company) : '';
        const slug = row?.['~urlrewrite_folder_name'] ? String(row['~urlrewrite_folder_name']) : '';
        const id = row?.['~id'] != null ? String(row['~id']) : '';
        if (!name || !slug || !id) continue;
        const key = normalizeCompanyNameForMatching(name);
        if (key && !discovery.has(key)) { discovery.set(key, { slug, id }); added++; }
      }
      logger.info({ fy: fy.range, rows: rows.length, added }, 'report 118 page fetched');
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      logger.warn({ fy: fy.range, error: err instanceof Error ? err.message : String(err) }, 'report 118 fetch failed (continuing)');
    }
  }
  const report82Added = await fillDiscoveryGapsFromReport82(
    discovery,
    normalizeCompanyNameForMatching,
    (cat, err) => logger.warn({ cat, error: err instanceof Error ? err.message : String(err) }, 'report 82 fallback fetch failed (continuing)')
  );
  console.log(`discovery map: ${discovery.size} IPOs (+${report82Added} from report 82 fallback)`);

  // 2. Selection: IPO offering type, price_range_max present, a LIVE status
  //    (WITHDRAWN/POSTPONED excluded — see the STATUSES comment above),
  //    and issue_size that is either NULL, 0, or a positive value below the
  //    segment floor (round 4: NULL/0 is the SAME "no usable value" defect
  //    class as a below-floor share count — all three get the same source
  //    repair). Import the SAME floor constants the write-time guard uses —
  //    never re-typed.
  const whereClauses = [
    eq(schema.ipos.offeringType, 'IPO'),
    isNotNull(schema.ipos.priceRangeMax),
    inArray(schema.ipos.status, STATUSES as unknown as string[]),
  ];
  if (SLUGS) whereClauses.push(inArray(schema.ipos.slug, SLUGS));

  const rows = await db
    .select({
      id: schema.ipos.id,
      slug: schema.ipos.slug,
      companyName: schema.ipos.companyName,
      segment: schema.ipos.segment,
      issueSize: schema.ipos.issueSize,
      priceRangeMax: schema.ipos.priceRangeMax,
      status: schema.ipos.status,
    })
    .from(schema.ipos)
    .where(and(...whereClauses));

  const candidates: Candidate[] = rows
    .map((r) => ({ ...r, issueSize: r.issueSize == null ? null : String(r.issueSize) }))
    .filter((r) => {
      const floor = r.segment === 'MAINBOARD' ? MAINBOARD_ISSUE_SIZE_FLOOR : r.segment === 'SME' ? SME_ISSUE_SIZE_FLOOR : null;
      if (floor === null) return false;
      if (r.issueSize === null) return true; // NULL — no usable value
      const val = Number(r.issueSize);
      if (!Number.isFinite(val) || val <= 0) return true; // 0 — same defect class
      return val < floor;
    }) as Candidate[];
  console.log(`considered (offering_type=IPO, has price cap, live status, issue_size NULL/0/below segment floor): ${candidates.length}`);

  // 3. Match to a Chittorgarh detail URL.
  const matched = candidates
    .map((c) => ({ ...c, disc: discovery.get(normalizeCompanyNameForMatching(c.companyName)) }))
    .filter((c): c is Candidate & { disc: DiscoveryEntry } => !!c.disc);
  console.log(`matched to a Chittorgarh detail URL: ${matched.length} (unmatched: ${candidates.length - matched.length})`);

  // 4. Fetch + extract + decide.
  let sourced = 0, written = 0, skipped = 0, fetchFailed = 0;
  const skipReasons: Record<string, number> = {};
  let fetched = 0;

  for (const c of matched) {
    if (fetched >= LIMIT) break;
    fetched++;
    const current = c.issueSize === null ? null : Number(c.issueSize);
    const html = await fetchDetailHtml(c.disc.slug, c.disc.id);
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 600)); // rate limit
    if (!html) {
      fetchFailed++;
      skipped++;
      skipReasons['fetch failed'] = (skipReasons['fetch failed'] ?? 0) + 1;
      console.log(`  ${c.slug}: SKIP (detail fetch failed)`);
      continue;
    }

    const floor = c.segment === 'MAINBOARD' ? MAINBOARD_ISSUE_SIZE_FLOOR : c.segment === 'SME' ? SME_ISSUE_SIZE_FLOOR : null;
    const value = extractIssueSizeFromDetailHtml(html, { floor, priceRangeMax: c.priceRangeMax, companyName: c.companyName });
    if (value !== null) sourced++;

    const decision = decideIssueSizeRepair({ current, segment: c.segment, sourced: value });
    console.log(
      `  ${c.slug}: old=${current ?? "NULL"} source=${value ?? 'none'} cap=${c.priceRangeMax} -> ${decision.write ? 'WRITE' : 'SKIP'} (${decision.reason})`
    );

    if (!decision.write) {
      skipped++;
      skipReasons[decision.reason] = (skipReasons[decision.reason] ?? 0) + 1;
      continue;
    }

    if (!APPLY) continue;

    try {
      // Round 4: `eq(issueSize, c.issueSize)` never matches when the
      // CURRENT value is SQL NULL (`= NULL` is always unknown/false in
      // Postgres) — a plain eq guard silently dropped every NULL-row write.
      // `IS NOT DISTINCT FROM` treats NULL=NULL as true, so the guard works
      // identically for NULL, '0', and a below-floor positive value.
      const result = await db
        .update(schema.ipos)
        .set({ issueSize: String(value), updatedAt: new Date() })
        .where(and(eq(schema.ipos.id, c.id), sql`${schema.ipos.issueSize} IS NOT DISTINCT FROM ${c.issueSize}`))
        .returning({ id: schema.ipos.id });
      if (result.length > 0) {
        written++;
        console.log(`    WROTE ${c.slug} issue_size ${current ?? 'NULL'} -> ${value}`);
        console.log(`    drop cache keys: ipo:slug:${c.slug}  ipo:id:${c.id}`);
        if (process.env.REDIS_URL) {
          try {
            await dropIpoCacheKeys(getRedisClient(), c.slug, c.id);
          } catch (err) {
            logger.warn(
              { slug: c.slug, id: c.id, error: err instanceof Error ? err.message : String(err) },
              'cache drop failed - drop the printed keys by hand'
            );
          }
        }
      } else {
        skipped++;
        skipReasons['concurrent write (row changed since selection)'] = (skipReasons['concurrent write (row changed since selection)'] ?? 0) + 1;
        console.log(`    SKIP ${c.slug}: row changed since selection (IS NOT DISTINCT FROM guard missed)`);
      }
    } catch (err) {
      fetchFailed++; // treat as a hard failure for the exit code
      logger.error({ slug: c.slug, error: err instanceof Error ? err.message : String(err) }, 'issue_size update failed');
    }
  }

  const reasonsStr = Object.entries(skipReasons).map(([k, v]) => `${k}=${v}`).join(', ') || 'none';
  console.log(`\nconsidered ${candidates.length}, sourced ${sourced}, written ${written}, skipped ${skipped} (${reasonsStr})`);
  if (!APPLY) console.log('DRY-RUN: re-run with --apply to write.');
  console.log('='.repeat(80));
  process.exit(fetchFailed > 0 && written === 0 && APPLY ? 1 : fetchFailed > 0 && !APPLY && sourced === 0 ? 1 : 0);
}

/**
 * Drop the two IPO detail caches (`ipo:slug:*`, `ipo:id:*`) after a repaired
 * row is written — round 4 residue: the printed "drop cache keys" line told
 * an operator to do this BY HAND, so a repaired row could sit stale behind
 * a 15-min TTL until someone remembered. Fail-open (redis-best-effort per
 * `redis-best-effort-fail-open.md`): a drop failure never fails the backfill,
 * it just falls back to the printed manual-drop line with a WARN.
 */
export async function dropIpoCacheKeys(
  redis: { del: (...keys: string[]) => Promise<unknown> },
  slug: string,
  id: string
): Promise<void> {
  await redis.del(`ipo:slug:${slug}`, `ipo:id:${id}`);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'issue-size detail backfill crashed');
    console.error(e);
    process.exit(1);
  });
}
