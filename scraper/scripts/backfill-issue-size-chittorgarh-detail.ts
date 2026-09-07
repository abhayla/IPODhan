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
 *
 * Round-N: --recheck-above-floor widens selection to rows that already clear
 * the segment floor but may still carry the WRONG figure (Windlas Biotech
 * stored 47 Cr for a real 401 Cr issue; AAA Technologies, Induss, Banganga,
 * Sanmitra similar — all above-floor, so invisible to the below-floor query
 * above). It sources the same way and only ever FLAGS a >40% divergence —
 * writing needs --overwrite-above-floor ON TOP of --apply (and --allow-prod
 * on prod, same rule as below-floor). Rows within 40% are OK and never
 * touched.
 *   npx tsx scripts/backfill-issue-size-chittorgarh-detail.ts --recheck-above-floor
 *   npx tsx scripts/backfill-issue-size-chittorgarh-detail.ts --recheck-above-floor --apply --overwrite-above-floor --allow-prod
 */
import { db, getRedisClient } from '@ipodhan/shared';
import { invalidateIPOCaches } from '../src/services/cache-invalidator.js';
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
import {
  openRepairDb,
  PRODUCTION_DATABASE_NAME,
  readFieldSource,
  upsertFieldSource,
} from './lib/repair-tool.js';

// T-490: the prod guard and the provenance upsert now live in
// scripts/lib/repair-tool.ts — one reviewed implementation shared by every
// repair tool. This tool's RCA (it wrote `ipos` with NO field_sources row) is
// exactly the class the shared upsert closes. Re-exported for existing tests.
export { PRODUCTION_DATABASE_NAME };

const APPLY = process.argv.includes('--apply');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;

/**
 * T-452: `--slug` as the LAST argv token used to crash (`argv[slugIdx+1]` is
 * `undefined`, and `.split` on `undefined` throws before any usage message
 * prints). Pure so the crash-fix is unit-testable without spawning the CLI.
 */
export function parseSlugArg(argv: string[]): { slugs: string[] | null; error?: string } {
  const idx = argv.indexOf('--slug');
  if (idx < 0) return { slugs: null };
  const next = argv[idx + 1];
  if (next === undefined || next.startsWith('--')) {
    return {
      slugs: null,
      error:
        'backfill-issue-size: --slug requires a comma-separated value, e.g. --slug windlas-biotech-ipo,aaa-technologies-ipo',
    };
  }
  return { slugs: next.split(',').map((s) => s.trim()).filter(Boolean) };
}

const slugParse = parseSlugArg(process.argv);
const SLUGS = slugParse.slugs;
// Round-N residue: rows ABOVE the segment floor can still carry the wrong unit
// (Windlas Biotech 47 Cr stored vs 401 Cr real; AAA Technologies, Induss,
// Banganga, Sanmitra similar) — invisible to the below-floor selection above.
// --recheck-above-floor widens selection to floor-clearing rows and FLAGS (never
// writes) a >40% divergence from the source figure unless --overwrite-above-floor
// is also given (and --apply, and --allow-prod on prod, same as the below-floor path).
const RECHECK_ABOVE_FLOOR = process.argv.includes('--recheck-above-floor');
const OVERWRITE_ABOVE_FLOOR = process.argv.includes('--overwrite-above-floor');
const ABOVE_FLOOR_DIVERGENCE_THRESHOLD = 0.40;

/**
 * Env-derived database name. Kept for the informational `database:` line and
 * its unit test ONLY — it is NOT the guard (T-490 / #165 CRITICAL: initPool()
 * prefers DATABASE_HOST, so this can read "staging" while the pool opens
 * prod). The guard is `openRepairDb()` on the writing pool.
 */
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
  mode?: 'below-floor' | 'above-floor'; // default 'below-floor' (original behaviour, unchanged)
  overwriteAboveFloor?: boolean; // --overwrite-above-floor: required to WRITE a divergent above-floor row
}): { write: boolean; reason: string; status: 'OK' | 'FLAG' | 'WRITE' | 'SKIP' } {
  const mode = input.mode ?? 'below-floor';
  const floor =
    input.segment === 'MAINBOARD' ? MAINBOARD_ISSUE_SIZE_FLOOR : input.segment === 'SME' ? SME_ISSUE_SIZE_FLOOR : null;

  if (mode === 'below-floor') {
    if (floor !== null && input.current !== null && input.current >= floor) {
      return { write: false, status: 'SKIP', reason: 'current value already clears the segment floor — never overwritten' };
    }
    if (input.sourced === null) {
      return { write: false, status: 'SKIP', reason: 'no plausible source figure (absent, ambiguous, or cross-check failed)' };
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
      return { write: false, status: 'SKIP', reason: `sourced value failed the write-time guard (${implausible.reason})` };
    }
    return { write: true, status: 'WRITE', reason: 'sourced value passes floor + cross-check gates' };
  }

  // mode === 'above-floor': rows that already clear the segment floor but may
  // still carry the WRONG unit/figure (Windlas/AAA/Induss/Banganga/Sanmitra
  // class) — the below-floor gate above is blind to these by construction.
  //
  // CAVEAT (round 4): a >40% divergence FLAG is not always a wrong stored
  // value — some IPOs legitimately publish a fresh-issue-only total on one
  // page and a total-incl-OFS figure on another (the "Meesho-type" shape),
  // so the two numbers can disagree by design, not by corruption.
  // --overwrite-above-floor writes EVERY flagged row in the run with no
  // per-row human check, so callers MUST triage with --slug first — see
  // validateOverwriteAboveFloorRequiresSlug(), which refuses a whole-table
  // overwrite.
  if (input.sourced === null) {
    return { write: false, status: 'SKIP', reason: 'no plausible source figure (absent, ambiguous, or cross-check failed)' };
  }
  const implausible = collectImplausibleIssueSizeFields(
    { issueSize: input.sourced, segment: input.segment },
    null,
    'ADMIN'
  );
  if (implausible.fields.has('issueSize')) {
    return { write: false, status: 'SKIP', reason: `sourced value failed the write-time guard (${implausible.reason})` };
  }
  if (input.current === null || input.current === 0) {
    // Selection guarantees current >= floor in this mode; defensive only.
    return { write: false, status: 'SKIP', reason: 'no usable current value to compare against (defensive — selection should exclude this)' };
  }
  const divergence = Math.abs(input.sourced / input.current - 1);
  if (divergence <= ABOVE_FLOOR_DIVERGENCE_THRESHOLD) {
    return {
      write: false,
      status: 'OK',
      reason: `within ${(ABOVE_FLOOR_DIVERGENCE_THRESHOLD * 100).toFixed(0)}% of stored value (source=${input.sourced}, stored=${input.current}, divergence=${(divergence * 100).toFixed(1)}%) — never touched`,
    };
  }
  if (!input.overwriteAboveFloor) {
    return {
      write: false,
      status: 'FLAG',
      reason: `diverges from stored value by >${(ABOVE_FLOOR_DIVERGENCE_THRESHOLD * 100).toFixed(0)}% (source=${input.sourced}, stored=${input.current}, divergence=${(divergence * 100).toFixed(1)}%) — pass --overwrite-above-floor to write`,
    };
  }
  return {
    write: true,
    status: 'WRITE',
    reason: `diverges from stored value by >${(ABOVE_FLOOR_DIVERGENCE_THRESHOLD * 100).toFixed(0)}% — overwritten (--overwrite-above-floor given)`,
  };
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

function buildDetailUrl(slug: string, id: string): string {
  return `https://www.chittorgarh.com/ipo/${slug}/${id}/`;
}

/**
 * Round-3 recheck diagnostics: when the extractor returns null in
 * --recheck-above-floor mode, print WHY — the first 160 chars of the raw
 * "Issue Size" table cell (comment nodes stripped) so the architect can see
 * the actual markup instead of guessing. Mirrors the label-matching regex in
 * extractIssueSizeFromDetailHtml (diagnostic-only duplicate — never used to
 * decide a write, only to print).
 */
export function extractIssueSizeCellSnippet(html: string): string | null {
  if (!html) return null;
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const labelMatch =
    clean.match(/title="Total Issue Size"[\s\S]{0,200}?<\/a>([\s\S]{0,260})/i) ??
    clean.match(/(?:Total\s+)?Issue\s*Size\s*<\/a>([\s\S]{0,260})/i) ??
    clean.match(/(?:Total\s+)?Issue\s*Size\s*<\/(?:td|span)>([\s\S]{0,260})/i) ??
    clean.match(/(?:Total\s+)?Issue\s*Size[^<]{0,20}<\/[a-z]+>([\s\S]{0,260})/i);
  if (!labelMatch) return null;
  const rawBlock = labelMatch[1];
  const rowEnd = rawBlock.search(/<\/tr>/i);
  const block = rowEnd === -1 ? rawBlock : rawBlock.slice(0, rowEnd);
  return block.slice(0, 160);
}

async function fetchDetailHtml(slug: string, id: string): Promise<string | null> {
  const u = buildDetailUrl(slug, id);
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

/**
 * Round-4: --overwrite-above-floor writes EVERY flagged row in one run — but
 * a FLAG can be a legitimate divergence (fresh-issue-only vs total-incl-OFS
 * figures, the "Meesho-type" shape), not a wrong value. Requiring --slug
 * forces a human to triage the flagged list first and name exactly which
 * rows to overwrite, instead of blindly overwriting a whole table's worth of
 * FLAGs — some of which may be correct as stored. Pure for unit testing.
 */
export function validateOverwriteAboveFloorRequiresSlug(
  overwriteAboveFloor: boolean,
  slugs: string[] | null
): { ok: boolean; message?: string } {
  if (overwriteAboveFloor && (!slugs || slugs.length === 0)) {
    return {
      ok: false,
      message:
        '--overwrite-above-floor requires --slug a,b,c — refusing a whole-table overwrite. ' +
        'A FLAG can be a legitimate fresh-issue-vs-total (incl. OFS) divergence, not a wrong value ' +
        '(the "Meesho-type" shape) — triage the flagged list first, then re-run naming exactly which rows to write.',
    };
  }
  return { ok: true };
}

/** `updated_by` stamp on every field_sources row this tool writes (T-452). */
export const BACKFILL_UPDATED_BY = 'backfill-issue-size-chittorgarh-detail';

/**
 * T-452 round 2: BOTH write paths are labelled ADMIN, not CHITTORGARH for
 * below-floor / ADMIN for above-floor. The tool's values are source-backed
 * (Chittorgarh detail page), cross-checked (segment floor + shares-x-cap
 * gate), and owner-authorized (the repair is an intentional definitional
 * correction) — CHITTORGARH-labelled repairs stayed revertible by a later
 * NSE/BSE scrape (exactly the bug this task fixes) until the field-priority
 * matrix is reordered; ADMIN always wins regardless of matrix order.
 * `updated_by` stays the tool's own name, so provenance still shows this was
 * a tool repair, not a human edit through the admin UI.
 */
export const WRITE_DATA_LINEAGE = { note: 'repair: chittorgarh-detail source-backed, cross-checked, owner-authorized (T-452)' };

/** Lineage note for an exact-match provenance stamp (round 2, item 1). */
export const STAMP_DATA_LINEAGE = { note: 'stamp: owner definition total-incl-OFS 2026-09-07' };

/**
 * T-452 RCA: this tool repaired `ipos.issue_size` with a raw update and wrote
 * NO `field_sources` row, so the consolidation service (field-priority-matrix
 * issueSize: ADMIN > DRHP > NSE > BSE > CHITTORGARH > MONEYCONTROL) had no
 * provenance to beat a later NSE/BSE scrape's derived (and structurally
 * different — shares_offered x price cap, not total incl. OFS) figure, which
 * could then silently revert the repair. Every WRITE this tool makes now
 * upserts the matching `field_sources` row in the SAME transaction as the
 * `ipos` update (shape mirrors `FieldSourcesRepository.trackFieldUpdate`,
 * packages/shared/src/repositories/field-sources-repository.ts).
 *
 * `previousSource` is read from whatever row already exists — never
 * fabricated — so a row with no prior tracked source stays NULL.
 * `dataLineage` is ALWAYS set (round 2, item 3) — a prior source's stale
 * lineage never survives an upsert this tool performs.
 */
export async function upsertIssueSizeProvenance(
  txLike: {
    select: typeof db.select;
    insert: typeof db.insert;
  },
  params: {
    ipoId: string;
    previousValue: number | null;
    updatedBy: string;
  }
): Promise<void> {
  await upsertFieldSource(txLike, {
    ipoId: params.ipoId,
    tableName: 'ipos',
    fieldName: 'issueSize',
    source: 'ADMIN',
    confidence: 100,
    previousValue: params.previousValue,
    dataLineage: WRITE_DATA_LINEAGE,
    updatedBy: params.updatedBy,
  });
}

/**
 * T-452 round 2 (item 1): the round-1 "stamp if missing" logic left 8 real
 * staging rows revertible — they already carried an OLD CHITTORGARH/BSE
 * `field_sources` row from a prior write path, so "if none exists" silently
 * skipped them ("stamped 0"). The fix stamps ADMIN provenance whenever the
 * STORED value is EXACTLY EQUAL (numeric, in rupees — never the 40% "OK"
 * band) to the source figure, REGARDLESS of whether a provenance row already
 * exists — an existing CHITTORGARH/BSE row is exactly the case that must be
 * upgraded, not skipped. `previousValue` stays the stored value (this call
 * never changes `ipos.issue_size` — the row was already correct); the caller
 * is responsible for gating on `--apply`, `--overwrite-above-floor`,
 * `--slug`, and exact equality — this function unconditionally stamps once
 * called.
 */
export async function stampExactMatchProvenance(
  txLike: {
    select: typeof db.select;
    insert: typeof db.insert;
  },
  params: {
    ipoId: string;
    storedValue: number;
    updatedBy: string;
  }
): Promise<{ stamped: boolean; previousSource: string | null }> {
  const previousSource = await readFieldSource(txLike, {
    ipoId: params.ipoId,
    tableName: 'ipos',
    fieldName: 'issueSize',
  });

  // Idempotent re-run (round 2, item 4d): a row already carrying ADMIN
  // provenance from a prior stamp is a no-op — re-inserting identical data
  // would churn `updated_at`/`updated_by` for no informational gain, and the
  // caller's "second run stamps 0" contract needs a real signal.
  if (previousSource === 'ADMIN') {
    return { stamped: false, previousSource };
  }

  await upsertFieldSource(txLike, {
    ipoId: params.ipoId,
    tableName: 'ipos',
    fieldName: 'issueSize',
    source: 'ADMIN',
    confidence: 100,
    previousValue: params.storedValue,
    dataLineage: STAMP_DATA_LINEAGE,
    updatedBy: params.updatedBy,
  });
  return { stamped: true, previousSource };
}

async function main() {
  console.log('='.repeat(80));
  console.log(`ISSUE-SIZE BACKFILL (Chittorgarh detail pages, W-177 repair) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  if (slugParse.error) {
    console.error(slugParse.error);
    process.exit(1);
  }

  const overwriteGuard = validateOverwriteAboveFloorRequiresSlug(OVERWRITE_ABOVE_FLOOR, SLUGS);
  if (!overwriteGuard.ok) {
    console.error(`backfill-issue-size: ${overwriteGuard.message}`);
    process.exit(1);
  }
  if (RECHECK_ABOVE_FLOOR) {
    console.log(
      'CAVEAT: FLAG can be fresh-issue vs total (incl. OFS): Meesho-type rows diverge legitimately; ' +
        '--overwrite-above-floor writes EVERY flagged row, so triage with --slug before writing.'
    );
  }

  // T-490 (this tool's own RCA class): the guard asks the WRITING POOL, not the
  // env, which database it is in — `resolveDatabaseName(process.env)` can read
  // "ipodhan_staging" while initPool() (which prefers DATABASE_HOST) opens prod.
  const { dbName } = await openRepairDb(db, {
    apply: APPLY,
    allowProd: process.argv.includes('--allow-prod'),
    toolName: 'backfill-issue-size',
  });
  console.log(`database: ${dbName || '(unresolved)'}`);

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
      if (r.issueSize === null) return RECHECK_ABOVE_FLOOR ? false : true; // NULL — below-floor's "no usable value" class; nothing to recheck above the floor
      const val = Number(r.issueSize);
      if (!Number.isFinite(val) || val <= 0) return RECHECK_ABOVE_FLOOR ? false : true; // 0 — same defect class, below-floor only
      return RECHECK_ABOVE_FLOOR ? val >= floor : val < floor;
    }) as Candidate[];
  console.log(
    RECHECK_ABOVE_FLOOR
      ? `considered (offering_type=IPO, has price cap, live status, issue_size >= segment floor — recheck mode): ${candidates.length}`
      : `considered (offering_type=IPO, has price cap, live status, issue_size NULL/0/below segment floor): ${candidates.length}`
  );

  // 3. Match to a Chittorgarh detail URL.
  const matched = candidates
    .map((c) => ({ ...c, disc: discovery.get(normalizeCompanyNameForMatching(c.companyName)) }))
    .filter((c): c is Candidate & { disc: DiscoveryEntry } => !!c.disc);
  console.log(`matched to a Chittorgarh detail URL: ${matched.length} (unmatched: ${candidates.length - matched.length})`);

  // 4. Fetch + extract + decide.
  let sourced = 0, written = 0, skipped = 0, fetchFailed = 0, ok = 0, flagged = 0, stamped = 0, writeFailures = 0;
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

    if (RECHECK_ABOVE_FLOOR) {
      console.log(`    url: ${buildDetailUrl(c.disc.slug, c.disc.id)}`);
      if (value === null) {
        const snippet = extractIssueSizeCellSnippet(html);
        console.log(`    source=none — Issue Size cell (first 160 chars): ${snippet ?? '(no "Issue Size" label found on page)'}`);
      }
    }

    const decision = decideIssueSizeRepair({
      current,
      segment: c.segment,
      sourced: value,
      mode: RECHECK_ABOVE_FLOOR ? 'above-floor' : 'below-floor',
      overwriteAboveFloor: OVERWRITE_ABOVE_FLOOR,
    });
    console.log(
      `  ${c.slug}: old=${current ?? "NULL"} source=${value ?? 'none'} cap=${c.priceRangeMax} -> ${decision.status} (${decision.reason})`
    );

    if (decision.status === 'OK') {
      ok++;
      // T-452 round 2 (item 1): stamp ADMIN provenance ONLY on an EXACT
      // numeric match (never the 40%-band OK case, never dry-run, never
      // without --slug — --overwrite-above-floor already requires --slug via
      // validateOverwriteAboveFloorRequiresSlug above, SLUGS is re-checked
      // here defensively) — REGARDLESS of whether a provenance row already
      // exists, so an old CHITTORGARH/BSE row on an already-correct value
      // gets upgraded to ADMIN, not left revertible.
      const exactMatch = current !== null && value !== null && current === value;
      if (APPLY && OVERWRITE_ABOVE_FLOOR && SLUGS && SLUGS.length > 0 && exactMatch) {
        try {
          const stampResult = await db.transaction((tx) =>
            stampExactMatchProvenance(tx, { ipoId: c.id, storedValue: current as number, updatedBy: BACKFILL_UPDATED_BY })
          );
          if (stampResult.stamped) {
            stamped++;
            console.log(`    STAMPED ${c.slug} provenance ADMIN (was ${stampResult.previousSource ?? 'none'})`);
          } else {
            console.log(`    STAMP SKIP ${c.slug}: already ADMIN (idempotent)`);
          }
        } catch (err) {
          writeFailures++;
          logger.warn(
            { slug: c.slug, error: err instanceof Error ? err.message : String(err) },
            'provenance stamp failed'
          );
        }
      }
    }
    if (decision.status === 'FLAG') flagged++;

    if (!decision.write) {
      if (decision.status !== 'OK') {
        skipped++;
        skipReasons[decision.reason] = (skipReasons[decision.reason] ?? 0) + 1;
      }
      continue;
    }

    if (!APPLY) continue;

    try {
      // Round 4: `eq(issueSize, c.issueSize)` never matches when the
      // CURRENT value is SQL NULL (`= NULL` is always unknown/false in
      // Postgres) — a plain eq guard silently dropped every NULL-row write.
      // `IS NOT DISTINCT FROM` treats NULL=NULL as true, so the guard works
      // identically for NULL, '0', and a below-floor positive value.
      // T-452: the ipos update and its field_sources provenance row write in
      // the SAME transaction — a repair that lands the value without the
      // provenance row is the exact defect this fix closes (a later
      // NSE/BSE scrape had nothing to lose to and could silently revert it).
      const result = await db.transaction(async (tx) => {
        const updated = await tx
          .update(schema.ipos)
          .set({ issueSize: String(value), updatedAt: new Date() })
          .where(and(eq(schema.ipos.id, c.id), sql`${schema.ipos.issueSize} IS NOT DISTINCT FROM ${c.issueSize}`))
          .returning({ id: schema.ipos.id });
        if (updated.length > 0) {
          await upsertIssueSizeProvenance(tx, {
            ipoId: c.id,
            previousValue: current,
            updatedBy: BACKFILL_UPDATED_BY,
          });
        }
        return updated;
      });
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
      writeFailures++; // T-452 round 2 (item 3): a hard failure for the exit code, tracked separately from fetch failures
      logger.error({ slug: c.slug, error: err instanceof Error ? err.message : String(err) }, 'issue_size update failed');
    }
  }

  const reasonsStr = Object.entries(skipReasons).map(([k, v]) => `${k}=${v}`).join(', ') || 'none';
  console.log(`\nconsidered ${candidates.length}, sourced ${sourced}, written ${written}, skipped ${skipped} (${reasonsStr})`);
  if (RECHECK_ABOVE_FLOOR) {
    console.log(`recheck: ${matched.length} rows, ok ${ok}, flagged ${flagged}, written ${written}, stamped ${stamped}`);
    if (flagged > 0 && !OVERWRITE_ABOVE_FLOOR) {
      console.log('FLAGGED rows above need owner review — re-run with --apply --overwrite-above-floor (and --allow-prod on prod) to write.');
    }
  }
  if (!APPLY) console.log('DRY-RUN: re-run with --apply to write.');
  console.log('='.repeat(80));
  // T-452 round 2 (item 3): ANY write or stamp failure is a hard exit-1,
  // regardless of how many OTHER rows succeeded (writeFailures > 0 no longer
  // masked by written > 0 from unrelated rows). Dry-run's "everything failed
  // to fetch" case is preserved separately.
  process.exit(writeFailures > 0 ? 1 : fetchFailed > 0 && !APPLY && sourced === 0 ? 1 : 0);
}

/**
 * Drop the CANONICAL IPO cache-key set after a repaired row is written —
 * round 4 residue: the printed "drop cache keys" line told an operator to do
 * this BY HAND, so a repaired row could sit stale behind a 15-min TTL until
 * someone remembered. Fail-open (redis-best-effort per
 * `redis-best-effort-fail-open.md`): a drop failure never fails the backfill,
 * it just falls back to the printed manual-drop line with a WARN.
 *
 * Round 5: dropping only `ipo:slug:*`/`ipo:id:*` left `ipo:detail:<slug>`
 * (the /api/ipos/[slug] response cache) and the `ipo:list:*`/`ipo:search:*`/
 * `ipos:history:*` pattern keys stale — a repaired issue_size could still
 * render its OLD value on the listing/search pages after a "fixed" write.
 * Routes through the scraper's own `invalidateIPOCaches` (the canonical set
 * for detail/slug/list/search/history) for everything it covers, then drops
 * `ipo:id:<id>` directly — that key is NOT one `invalidateIPOCaches` clears
 * (it only takes a slug), so this backfill (which has both slug and id from
 * its `ipos` row) still has to own it.
 */
export async function dropIpoCacheKeys(
  redis: { del: (...keys: string[]) => Promise<unknown> },
  slug: string,
  id: string
): Promise<void> {
  await invalidateIPOCaches(redis as unknown as Parameters<typeof invalidateIPOCaches>[0], slug);
  await redis.del(`ipo:id:${id}`);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'issue-size detail backfill crashed');
    console.error(e);
    process.exit(1);
  });
}
