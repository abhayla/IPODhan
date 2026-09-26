/**
 * OD-74 one-time repair (item 14, part of #728): the IPO rows whose issue_size
 * was COMPUTED from BSE's share count are replaced, ONCE, by the total printed
 * on each IPO's CHITTORGARH detail page, written with CHITTORGARH provenance
 * (OD-73: CHITTORGARH outranks BSE for issueSize in field-priority-matrix.ts).
 *
 * Why a one-time tool: CHITTORGARH re-reads only LIVE IPOs and OD-65 forbids
 * going back, so the ordinary pipeline can never overwrite these rows.
 *
 * Class (selected by rule, never by a slug list): offering_type = 'IPO' AND the
 * field_sources row for (ipos, issueSize) has source = 'BSE' AND issue_size > 0.
 *
 * One read per IPO, ever (OD-74, §5.2): every CHITTORGARH byte read (detail page, or the one
 * report-118 lookup for an IPO with no page recorded) is pinned in the TRACKED store
 * scripts/data/od74-issue-size/ (gzipped bytes + manifest.json with url, sha256, read time). A
 * pinned read is hash-verified; a missing or altered file is a refusal, never a re-fetch. PROD
 * MODE (database `ipodhan`, or --prod-mode to rehearse it anywhere) never fetches: a page that is
 * not pinned refuses the whole run (exit 2) before anything is written. All reads happen before
 * any write.
 *
 * OD-73 (§3.2): an identical value, or one equal within the page's printed rounding, is a no-op —
 * never written, never re-stamped. Only a real difference is written (CHITTORGARH outranks BSE).
 *
 * Page URL: ipos.verifier_url, then a chittorgarh /ipo/ URL in any field_sources lineage, then an
 * explicit `--url slug=<url>`, then ONE lookup (report 118, the IPO's fiscal year, exact
 * normalized-name match only). No match -> reported and left.
 *
 * Mode `--zeros` (OD-77, §1.11, §2.7, OD-62): every issue_size = 0 row. TENDER/BUYBACK -> NULL
 * (NOT_APPLICABLE is derived from offering_type, never stored); OFS/RIGHTS/NCD/IPO -> NULL plus
 * the plan row's reason code NOT_SOURCED (scripts/lib/od77-issue-size-zeros.ts).
 *
 * `--undo <apply ledger>`: the exact reverse from the recorded before-image (issue_size,
 * updated_at, the whole field_sources / plan row), refusing any row changed since the apply.
 *
 * Usage (from scraper/, tunnel env exported — docs/ops/prod-ops-recipes.md §5):
 *   npx tsx scripts/repair-issue-size-chittorgarh-once-od74.ts              # dry run
 *   npx tsx scripts/repair-issue-size-chittorgarh-once-od74.ts --apply      # staging
 *   npx tsx scripts/repair-issue-size-chittorgarh-once-od74.ts --apply --allow-prod   # owner's word only
 *   npx tsx scripts/repair-issue-size-chittorgarh-once-od74.ts --zeros [--apply]
 *   npx tsx scripts/repair-issue-size-chittorgarh-once-od74.ts --undo scripts/state/<apply ledger>.json
 * Options: --store-dir <dir>, --url slug=<chittorgarh url> (repeatable), --no-fetch, --prod-mode.
 * Held-proof: node scripts/assert-repair-held.mjs scripts/lib/repair-invariants/issue-size-od74.mjs --cycles 2
 */
import { db, getRedisClient, IPORepository } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { and, eq, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  extractIssueSizeFromDetailHtml,
  extractIssueSizeRupeesFromDetailHtml,
} from '../src/scrapers/chittorgarh-detail-fields.js';
import { invalidateIPOCaches } from '../src/services/cache-invalidator.js';
import {
  assertNoSchemaDrift,
  diffToLedgerEntries,
  buildIpoScopeCondition,
  decideUndoIpoConflict,
  describeIpoScope,
  guardCacheInvalidation,
  openRepairDb,
  PRODUCTION_DATABASE_NAME,
  resolveIpoScope,
  upsertFieldSource,
  writeLedgerFile,
  type RepairLedgerFieldChange,
} from './lib/repair-tool.js';
import { decidePageRead, PageStore } from './lib/od74-page-store.js';
import { applyZeroRow, classifyZeroAction, undoZeroRow, type ZeroOutcome, type ZeroRow } from './lib/od77-issue-size-zeros.js';

export const TOOL_NAME = 'repair-issue-size-chittorgarh-once-od74';
const CRORE = 10_000_000;
/** The table cell prints whole crore ("agg. up to ₹54 Cr"); the prose prints 2 decimals. */
const TABLE_ROUNDING_TOLERANCE = 0.51 * CRORE;
/** Half of the prose's last printed digit (0.01 Cr): a difference inside it is agreement. */
const PRINTED_PRECISION = 0.005 * CRORE;
const FETCH_GAP_MS = 2500;
const CHITTORGARH_IPO_URL = /^https:\/\/www\.chittorgarh\.com\/ipo\/([a-z0-9-]+)\/(\d+)\/?$/i;

export interface PrintedTotal {
  rupees: number | null;
  precise: number | null;
  tableRounded: number | null;
  reason: string | null;
  /** Half the last printed digit of the figure used: 0.005 Cr for the prose, 0.5 Cr for the table cell. */
  precision: number;
}

/**
 * The printed total, read with the two EXISTING extractors (never a third
 * parser): the precise prose figure ("book build issue of ₹54.27 crores") and
 * the table cell ("agg. up to ₹54 Cr"). Both present -> they must agree within
 * the table's whole-crore rounding. Prose only -> accepted only when the page
 * carries the anchored "issue </a></span> of ₹" sentence (the extractor's own
 * last-resort pattern is unanchored and could pick a neighbour's figure).
 */
export function readPrintedTotal(html: string, priceRangeMax: number | null): PrintedTotal {
  const precise = extractIssueSizeRupeesFromDetailHtml(html);
  const tableRounded = extractIssueSizeFromDetailHtml(html, { floor: null, priceRangeMax });
  if (precise !== null && tableRounded !== null) {
    if (Math.abs(precise - tableRounded) > TABLE_ROUNDING_TOLERANCE) {
      return { rupees: null, precise, tableRounded, reason: `prose total and table total disagree (${precise} vs ${tableRounded})`, precision: PRINTED_PRECISION };
    }
    return { rupees: precise, precise, tableRounded, reason: null, precision: PRINTED_PRECISION };
  }
  if (precise !== null) {
    const anchored = /issue\s*<\/a>\s*<\/span>\s*of\s*₹/i.test(html);
    return anchored
      ? { rupees: precise, precise, tableRounded, reason: null, precision: PRINTED_PRECISION }
      : { rupees: null, precise, tableRounded, reason: 'prose total not anchored to the issue sentence and no table total', precision: PRINTED_PRECISION };
  }
  if (tableRounded !== null) return { rupees: tableRounded, precise, tableRounded, reason: null, precision: 0.5 * CRORE };
  return { rupees: null, precise, tableRounded, reason: 'no printed total on the page', precision: PRINTED_PRECISION };
}

export type Od74Status = 'WRITE' | 'NOOP_IDENTICAL' | 'NOOP_WITHIN_ROUNDING' | 'SKIP';

/**
 * OD-73 (§3.2): an identical incoming value is never written and never re-stamps provenance. A
 * value equal to the stored one within the page's own printed rounding is the SAME value (the
 * page prints 2-decimal crore in prose, whole crore in the table cell), so it is also a no-op:
 * the stored exact number is kept. Only a real difference beyond that rounding is written —
 * CHITTORGARH outranks BSE for issueSize (§1.11), so OD-73's higher-rank exception applies.
 */
export function decideOd74(input: { stored: number; printed: number | null; precision?: number }): {
  status: Od74Status;
  write: boolean;
  reason: string;
} {
  if (input.printed === null) return { status: 'SKIP', write: false, reason: 'no printed total — left as is, never guessed' };
  const delta = Math.abs(input.printed - input.stored);
  if (delta === 0) return { status: 'NOOP_IDENTICAL', write: false, reason: 'identical — OD-73: never written, never re-stamped' };
  if (delta <= (input.precision ?? PRINTED_PRECISION)) {
    return { status: 'NOOP_WITHIN_ROUNDING', write: false, reason: `equal within the printed rounding (delta ${delta}) — OD-73: stored exact value kept, not re-stamped` };
  }
  return { status: 'WRITE', write: true, reason: `printed total differs by ${((delta / input.stored) * 100).toFixed(1)}%` };
}

export function resolveChittorgarhUrl(input: { verifierUrl: string | null; lineageUrls: string[]; override?: string }): string | null {
  const ok = (u: string | null | undefined): u is string => !!u && CHITTORGARH_IPO_URL.test(u);
  if (input.override !== undefined) return ok(input.override) ? input.override : null;
  if (ok(input.verifierUrl)) return input.verifierUrl;
  return input.lineageUrls.find(ok) ?? null;
}


export function pageFileName(url: string): string {
  const m = url.match(CHITTORGARH_IPO_URL);
  if (!m) throw new Error(`not a chittorgarh /ipo/ url: ${url}`);
  return `${m[1]}-${m[2]}.html.gz`;
}

export function parseUrlOverrides(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  argv.forEach((a, i) => {
    if (a !== '--url') return;
    const v = argv[i + 1] ?? '';
    const eqAt = v.indexOf('=');
    if (eqAt > 0) out[v.slice(0, eqAt)] = v.slice(eqAt + 1);
  });
  return out;
}

/** Indian fiscal year (April-March) of a date, in CHITTORGARH report 118's two path segments. */
export function fiscalYearOf(isoDate: string): { year: number; range: string } {
  const [y, m] = isoDate.slice(0, 7).split('-').map(Number);
  const year = m >= 4 ? y : y - 1;
  return { year, range: `${year}-${String((year + 1) % 100).padStart(2, '0')}` };
}

/** ONE lookup per IPO: report 118 (the list the scraper's own backfills read), searched by name in the IPO's fiscal year. */
export function lookupUrlFor(companyName: string, openDate: string): string {
  const fy = fiscalYearOf(openDate);
  const term = normalizeCompanyNameForMatching(companyName).split(' ').slice(0, 2).join(' ');
  return `https://webnodejs.chittorgarh.com/cloud/report/data-read/118/1/10/${fy.year}/${fy.range}/0/all/0?search=${encodeURIComponent(term)}&v=15-11`;
}

/** Only an EXACT normalized-name match resolves to a page; a near match is reported, never taken. */
export function matchLookupRows(rows: Array<Record<string, unknown>>, companyName: string): string | null {
  const want = normalizeCompanyNameForMatching(companyName);
  const hit = rows.find((r) => r?.Company && normalizeCompanyNameForMatching(String(r.Company)) === want);
  if (!hit || !hit['~urlrewrite_folder_name'] || hit['~id'] == null) return null;
  return `https://www.chittorgarh.com/ipo/${String(hit['~urlrewrite_folder_name'])}/${String(hit['~id'])}/`;
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const rowsOf = <T>(res: unknown): T[] => ((res as { rows?: T[] }).rows ?? (res as T[]));

interface ReadCtx { store: PageStore; prodMode: boolean; allowFetch: boolean; lastFetchAt: number }

/** The one network read, when OD-74 allows it. Timeout and HTTP errors land in the ledger, never throw past it. */
async function fetchOnce(ctx: ReadCtx, url: string, accept: string): Promise<{ text: string | null; readAt: Date; error: string | null }> {
  const wait = ctx.lastFetchAt + FETCH_GAP_MS - Date.now();
  if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
  const readAt = new Date();
  ctx.lastFetchAt = Date.now();
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://www.chittorgarh.com/', Accept: accept },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return { text: null, readAt, error: `HTTP ${r.status}` };
    return { text: await r.text(), readAt, error: null };
  } catch (e) {
    return { text: null, readAt, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

type PageRead = { html: string; sha256: string; readAt: string; how: 'pinned' | 'fetched' } | { refuse: string } | { missing: string };

async function readPage(ctx: ReadCtx, url: string): Promise<PageRead> {
  const d = decidePageRead({ pinned: ctx.store.isPagePinned(url), prodMode: ctx.prodMode, allowFetch: ctx.allowFetch });
  if (d.decision === 'REFUSE') return { refuse: `${url}: ${d.reason}` };
  if (d.decision === 'READ_PINNED') {
    try {
      const { text, entry } = ctx.store.readPinned(url);
      return { html: text, sha256: entry.sha256, readAt: entry.readAt, how: 'pinned' };
    } catch (e) {
      return { refuse: e instanceof Error ? e.message : String(e) };
    }
  }
  const f = await fetchOnce(ctx, url, 'text/html');
  if (!f.text) return { missing: `${url}: ${f.error}` };
  const entry = ctx.store.pinPage(url, f.text, pageFileName(url), f.readAt);
  return { html: f.text, sha256: entry.sha256, readAt: entry.readAt, how: 'fetched' };
}

/** A class row with no page recorded: one lookup (pinned like a page), exact-name match or nothing. */
async function lookupPage(
  ctx: ReadCtx,
  r: { slug: string; companyName: string; openDate: string | null }
): Promise<{ url: string | null; note: string; refuse?: string }> {
  let pinned: ReturnType<PageStore['readLookup']>;
  try {
    pinned = ctx.store.readLookup(r.slug);
  } catch (e) {
    return { url: null, note: 'lookup pin broken', refuse: e instanceof Error ? e.message : String(e) };
  }
  if (pinned) {
    return { url: pinned.entry.match, note: `lookup pinned ${pinned.entry.readAt}: ${pinned.entry.candidates} candidate(s), ${pinned.entry.match ? 'exact match' : 'no exact match'}` };
  }
  if (!r.openDate) return { url: null, note: 'no open date — no fiscal year to look up in' };
  const url = lookupUrlFor(r.companyName, r.openDate);
  const d = decidePageRead({ pinned: false, prodMode: ctx.prodMode, allowFetch: ctx.allowFetch });
  if (d.decision === 'REFUSE') return { url: null, note: 'lookup not pinned', refuse: `lookup for ${r.slug}: ${d.reason}` };
  const f = await fetchOnce(ctx, url, 'application/json');
  if (!f.text) return { url: null, note: `lookup failed: ${f.error} (not pinned; a later staging run may retry)` };
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = (JSON.parse(f.text) as { reportTableData?: Array<Record<string, unknown>> }).reportTableData ?? [];
  } catch {
    rows = [];
  }
  const match = matchLookupRows(rows, r.companyName);
  ctx.store.pinLookup(r.slug, url, f.text, match, rows.length, f.readAt);
  return { url: match, note: `lookup read: ${rows.length} candidate(s), ${match ? 'exact match' : 'no exact match'}` };
}

interface Od74Before { issueSize: string; updatedAt: string; fieldSource: Record<string, unknown> | null }
type Counts = { writes: number; failures: number };

/**
 * #1054 (sweep of #1045/#1053's class): the `runRepair` candidate query, ANDed
 * with the shared `--ipo` scope when given. Exported (pure, no DB) so the
 * compiled-SQL scope test can assert `i.id = ANY(...)` is present when scoped
 * and absent when not, without executing against a database — same pattern as
 * `repair-reopen-stale-doc-nay.ts`'s `buildStaleRowsQuery`.
 */
export function buildRepairCandidatesQuery(ipoIds: readonly string[]) {
  const scope = buildIpoScopeCondition(ipoIds, 'i.id');
  // #1059 round 2 (MINOR-1): branched, not an interpolated-but-empty
  // `sql\`\`` clause, so the UNSCOPED query is byte-identical to origin/main's
  // (no stray blank line / doubled whitespace where the scope clause would
  // have gone) — same query, not merely an equivalent one.
  return scope
    ? sql`
    SELECT i.id, i.slug, i.company_name AS "companyName", i.open_date::text AS "openDate", i.issue_size::text AS "issueSize",
           i.price_range_max::text AS "priceRangeMax", i.verifier_url AS "verifierUrl",
           ARRAY(SELECT f2.data_lineage->>'url' FROM field_sources f2
                  WHERE f2.ipo_id = i.id AND f2.data_lineage->>'url' ILIKE 'https://www.chittorgarh.com/ipo/%') AS "lineageUrls"
      FROM ipos i
      JOIN field_sources fs ON fs.ipo_id = i.id AND fs.table_name = 'ipos' AND fs.field_name = 'issueSize' AND fs.row_key = ''
     WHERE i.offering_type = 'IPO' AND fs.source = 'BSE'
       AND ${scope}
     ORDER BY i.slug`
    : sql`
    SELECT i.id, i.slug, i.company_name AS "companyName", i.open_date::text AS "openDate", i.issue_size::text AS "issueSize",
           i.price_range_max::text AS "priceRangeMax", i.verifier_url AS "verifierUrl",
           ARRAY(SELECT f2.data_lineage->>'url' FROM field_sources f2
                  WHERE f2.ipo_id = i.id AND f2.data_lineage->>'url' ILIKE 'https://www.chittorgarh.com/ipo/%') AS "lineageUrls"
      FROM ipos i
      JOIN field_sources fs ON fs.ipo_id = i.id AND fs.table_name = 'ipos' AND fs.field_name = 'issueSize' AND fs.row_key = ''
     WHERE i.offering_type = 'IPO' AND fs.source = 'BSE'
     ORDER BY i.slug`;
}

/**
 * #1054: the `runZeros` candidate query (a distinct shape from the repair
 * query above — `issue_size = 0`, no join), ANDed with the shared `--ipo`
 * scope when given. Exported for the same compiled-SQL testability reason.
 */
export function buildZerosCandidatesQuery(ipoIds: readonly string[]) {
  const scope = buildIpoScopeCondition(ipoIds, 'id');
  // #1059 round 2 (MINOR-1): branched for the same byte-identical reason as
  // buildRepairCandidatesQuery above.
  return scope
    ? sql`
    SELECT id, slug, offering_type::text AS "offeringType", segment::text AS segment, listing_exchanges AS "listingExchanges",
           issue_size::text AS "issueSize", updated_at::text AS "updatedAt"
      FROM ipos WHERE issue_size = 0 AND ${scope} ORDER BY offering_type, slug`
    : sql`
    SELECT id, slug, offering_type::text AS "offeringType", segment::text AS segment, listing_exchanges AS "listingExchanges",
           issue_size::text AS "issueSize", updated_at::text AS "updatedAt"
      FROM ipos WHERE issue_size = 0 ORDER BY offering_type, slug`;
}

/**
 * #457 round 2: the typed changes of THIS run — pushed only from the committed
 * write (issue_size + updated_at read under FOR UPDATE before, and read back
 * after, in the same transaction; plus the field_sources upsert's own
 * before/after), or from the dry-run plan. Never lifted from heterogeneous rows.
 */
const od74Changes: RepairLedgerFieldChange[] = [];

async function runRepair(APPLY: boolean, ctx: ReadCtx, ledger: unknown[], ipoIds: readonly string[]): Promise<Counts> {
  // #1059 round 2 (MAJOR-2): printed from the SAME `ipoIds` this function
  // actually uses to build the candidate query below — not from main()'s copy
  // — so a call site accidentally passing `[]` here prints "ALL IPOs" and an
  // integration test asserting the scope line catches it, rather than a
  // main()-side print that stays correct regardless of what runRepair received.
  console.log(`${TOOL_NAME}: scope = ${describeIpoScope(ipoIds)}`);
  const overrides = parseUrlOverrides(process.argv);
  const all = rowsOf<{
    id: string; slug: string; companyName: string; openDate: string | null; issueSize: string | null;
    priceRangeMax: string | null; verifierUrl: string | null; lineageUrls: string[] | null;
  }>(await db.execute(buildRepairCandidatesQuery(ipoIds)));
  for (const r of all.filter((x) => !(Number(x.issueSize) > 0))) {
    console.log(`  OUT-OF-CLASS ${r.slug}: issue_size=${r.issueSize ?? 'NULL'} — no BSE-computed value (the --zeros mode owns it)`);
  }
  const rows = all.filter((r) => Number(r.issueSize) > 0);
  console.log(`class (offering_type IPO, issueSize provenance BSE, value > 0): ${rows.length}`);

  // Pass 1: every read, before any write. A refusal anywhere stops the run with nothing written.
  const plans: Array<{ r: (typeof rows)[number]; url: string; sha256: string; readAt: string; printed: PrintedTotal; d: ReturnType<typeof decideOd74> }> = [];
  const refusals: string[] = [];
  for (const r of rows) {
    const stored = Number(r.issueSize);
    let url = resolveChittorgarhUrl({ verifierUrl: r.verifierUrl, lineageUrls: r.lineageUrls ?? [], override: overrides[r.slug] });
    let lookupNote = '';
    if (!url) {
      const l = await lookupPage(ctx, r);
      if (l.refuse) refusals.push(l.refuse);
      url = l.url;
      lookupNote = l.note;
    }
    if (!url) {
      console.log(`  ${r.slug} | stored ${stored} | NO-PAGE (${lookupNote}) — left as is`);
      ledger.push({ slug: r.slug, stored, outcome: 'NO_PAGE', note: lookupNote });
      continue;
    }
    const p = await readPage(ctx, url);
    if ('refuse' in p) {
      refusals.push(p.refuse);
      ledger.push({ slug: r.slug, stored, url, outcome: 'REFUSED', note: p.refuse });
      continue;
    }
    if ('missing' in p) {
      console.log(`  ${r.slug} | stored ${stored} | NO-PAGE ${p.missing}`);
      ledger.push({ slug: r.slug, stored, url, outcome: 'NO_PAGE', note: p.missing });
      continue;
    }
    const printed = readPrintedTotal(p.html, r.priceRangeMax === null ? null : Number(r.priceRangeMax));
    const d = decideOd74({ stored, printed: printed.rupees, precision: printed.precision });
    console.log(`  ${r.slug} | stored ${stored} | printed ${printed.rupees ?? 'none'} | ${d.status} (${printed.reason ?? d.reason}) | ${url} [${p.how}]${lookupNote ? ` [${lookupNote}]` : ''}`);
    ledger.push({ id: r.id, slug: r.slug, stored, printed: printed.rupees, status: d.status, url, sha256: p.sha256, readAt: p.readAt });
    plans.push({ r, url, sha256: p.sha256, readAt: p.readAt, printed, d });
    if (!APPLY && d.write) od74Changes.push({ table: 'ipos', rowKey: r.id, field: 'issue_size', before: r.issueSize, after: String(printed.rupees) });
    if (!ctx.prodMode) ctx.store.recordExpected(r.slug, { url, printedRupees: printed.rupees, status: d.status });
  }
  if (refusals.length > 0) {
    for (const x of refusals) console.error(`  REFUSED ${x}`);
    throw new RefusedError(`${refusals.length} read(s) not allowed under OD-74's one-read rule — nothing written`);
  }

  const counts: Counts = { writes: 0, failures: 0 };
  for (const { r, url, sha256, readAt, printed, d } of plans) {
    if (!d.write || !APPLY) continue;
    try {
      const committed = await db.transaction(async (tx) => {
        const cur = rowsOf<{ issueSize: string; updatedAt: string }>(
          await tx.execute(sql`SELECT issue_size::text AS "issueSize", updated_at::text AS "updatedAt" FROM ipos WHERE id = ${r.id} FOR UPDATE`)
        )[0];
        const fsRow = rowsOf<Record<string, unknown>>(await tx.execute(sql`
          SELECT source::text AS source, confidence, previous_value AS "previousValue", previous_source::text AS "previousSource",
                 data_lineage AS "dataLineage", updated_at::text AS "updatedAt", updated_by AS "updatedBy"
            FROM field_sources WHERE ipo_id = ${r.id} AND table_name = 'ipos' AND field_name = 'issueSize' AND row_key = ''`))[0] ?? null;
        if (!cur || cur.issueSize !== r.issueSize) return null;
        await ipoRepo(tx).applyIssueSizeRepair(r.id, String(printed.rupees));
        const now = rowsOf<{ issueSize: string; updatedAt: string }>(
          await tx.execute(sql`SELECT issue_size::text AS "issueSize", updated_at::text AS "updatedAt" FROM ipos WHERE id = ${r.id}`)
        )[0];
        const upserted = await upsertFieldSource(tx, {
          ipoId: r.id,
          fieldName: 'issueSize',
          source: 'CHITTORGARH',
          confidence: 100,
          previousValue: r.issueSize,
          dataLineage: { tool: TOOL_NAME, od: 'OD-74', url, readAt, pageSha256: sha256, printedRupees: printed.rupees, outcome: d.status },
          updatedBy: TOOL_NAME,
        });
        const before: Od74Before = { issueSize: cur.issueSize, updatedAt: cur.updatedAt, fieldSource: fsRow };
        return {
          before,
          changes: [
            ...diffToLedgerEntries('ipos', r.id, { issue_size: cur.issueSize, updated_at: cur.updatedAt }, { issue_size: now?.issueSize ?? null, updated_at: now?.updatedAt ?? null }),
            ...upserted.changes,
          ],
        };
      });
      if (!committed) {
        console.log(`    SKIP ${r.slug}: row changed since selection`);
        continue;
      }
      const { before } = committed;
      od74Changes.push(...committed.changes);
      counts.writes++;
      ledger.push({ undo: 'od74', id: r.id, slug: r.slug, wrote: String(printed.rupees), before });
      await dropCache(r.slug);
    } catch (e) {
      counts.failures++;
      console.error(`    WRITE FAILED ${r.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return counts;
}

async function runZeros(APPLY: boolean, ledger: unknown[], ipoIds: readonly string[]): Promise<Counts> {
  // #1059 round 2 (MAJOR-2): same reasoning as runRepair above — printed from
  // the `ipoIds` this function actually passes into buildZerosCandidatesQuery.
  console.log(`${TOOL_NAME}: scope = ${describeIpoScope(ipoIds)}`);
  const list = rowsOf<ZeroRow>(await db.execute(buildZerosCandidatesQuery(ipoIds)));
  const counts: Counts = { writes: 0, failures: 0 };
  const byType: Record<string, number> = {};
  for (const r of list) {
    const action = classifyZeroAction(r.offeringType);
    byType[`${r.offeringType}:${action}`] = (byType[`${r.offeringType}:${action}`] ?? 0) + 1;
    if (!APPLY) {
      console.log(`  ${action.padEnd(21)} ${r.offeringType.padEnd(8)} ${r.slug}`);
      ledger.push({ slug: r.slug, offeringType: r.offeringType, action, written: false });
      continue;
    }
    try {
      const o = await db.transaction((tx) => applyZeroRow(tx, r, ipoRepo));
      console.log(`  ${action.padEnd(21)} ${r.offeringType.padEnd(8)} ${r.slug} — ${o.note}`);
      ledger.push({ ...o, undo: o.written ? 'od77' : undefined });
      if (o.written) {
        counts.writes++;
        await dropCache(r.slug);
      }
    } catch (e) {
      counts.failures++;
      console.error(`    WRITE FAILED ${r.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`zero-valued rows ${list.length}: ${Object.entries(byType).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  return counts;
}

/** --undo <apply ledger>: the exact reverse from the before-image, refusing any row changed since. */
async function runUndo(file: string, ledger: unknown[]): Promise<Counts> {
  const src = JSON.parse(fs.readFileSync(file, 'utf8')) as { apply?: boolean; rows: Array<Record<string, any>> };
  if (!src.apply) throw new RefusedError(`${file} is not an --apply ledger; nothing to undo`);
  const counts: Counts = { writes: 0, failures: 0 };
  const fsKey = (id: string) =>
    and(eq(schema.fieldSources.ipoId, id), eq(schema.fieldSources.tableName, 'ipos'), eq(schema.fieldSources.fieldName, 'issueSize'), eq(schema.fieldSources.rowKey, ''));
  for (const e of src.rows.filter((x) => x.undo)) {
    try {
      const ok = await db.transaction(async (tx) => {
        if (e.undo === 'od77') return undoZeroRow(tx, e as ZeroOutcome, ipoRepo);
        const b = e.before as Od74Before;
        const cur = rowsOf<{ same: boolean }>(
          await tx.execute(sql`SELECT issue_size = ${e.wrote}::numeric AS same FROM ipos WHERE id = ${e.id} FOR UPDATE`)
        )[0];
        if (!cur?.same) return false;
        await ipoRepo(tx).applyIssueSizeRepair(e.id, b.issueSize, b.updatedAt);
        const f = b.fieldSource;
        if (f === null) {
          await tx.delete(schema.fieldSources).where(fsKey(e.id));
        } else {
          await tx
            .update(schema.fieldSources)
            .set({
              source: f.source as never,
              confidence: f.confidence as number,
              previousValue: f.previousValue as string | null,
              previousSource: f.previousSource as never,
              dataLineage: f.dataLineage as never,
              updatedAt: sql`${f.updatedAt as string}::timestamp`,
              updatedBy: f.updatedBy as string | null,
            })
            .where(fsKey(e.id));
        }
        return true;
      });
      console.log(`  ${ok ? 'UNDONE' : 'SKIP (changed since the apply)'} ${e.slug}`);
      ledger.push({ slug: e.slug, undone: ok });
      if (ok) {
        counts.writes++;
        await dropCache(e.slug);
      }
    } catch (err) {
      counts.failures++;
      console.error(`    UNDO FAILED ${e.slug}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return counts;
}

/** The repository write path, on the caller's transaction (write ratchet T-316). No REDIS_URL -> no cache to drop. */
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] };
export function ipoRepo(tx: unknown): IPORepository {
  return new IPORepository(tx as never, (process.env.REDIS_URL ? getRedisClient() : noRedis) as never);
}

/** Set once main() resolves openRepairDb()'s dbName — #1070's guard needs it and dropCache() is called from several places below main(). */
let currentDbName = '';

async function dropCache(slug: string): Promise<void> {
  const guard = guardCacheInvalidation({
    dbName: currentDbName,
    toolName: TOOL_NAME,
    keys: [`ipo:detail:${slug}`, `ipo:slug:${slug}`, 'ipo:list:*', 'ipo:search:*', 'ipos:history:*'],
  });
  if (guard.blocked) return;
  try {
    await invalidateIPOCaches(getRedisClient() as never, slug);
  } catch (e) {
    console.log(`    cache drop failed for ${slug} (drop ipo:* keys by hand): ${e instanceof Error ? e.message : e}`);
  }
}

export class RefusedError extends Error {}

async function main(): Promise<number> {
  const undoFile = argValue('--undo');
  const APPLY = process.argv.includes('--apply') || undoFile !== null;
  // #1054 (sweep of #1045/#1053's class): `--ipo` scopes both candidate
  // queries so an integration test can only ever touch its own fixture rows.
  // `--undo` stays ledger-scoped (unchanged) — the ledger's own row ids are
  // the scope, per the brief.
  const ipoScope = resolveIpoScope(process.argv, '--ipo');
  if (ipoScope.invalid.length > 0) {
    console.error(`${TOOL_NAME}: --ipo value(s) are not valid uuids, refusing: ${ipoScope.invalid.join(', ')}`);
    return 2;
  }
  if (ipoScope.unusable) {
    console.error(
      `${TOOL_NAME}: --ipo was given but no usable uuid could be parsed from it (check quoting, placement or a missing value) — refusing rather than silently falling back to ALL IPOs DB-wide.`
    );
    return 2;
  }
  if (decideUndoIpoConflict(process.argv, undoFile !== null)) {
    console.error(`${TOOL_NAME}: --ipo does not apply to --undo; the ledger defines the rows.`);
    return 2;
  }
  const { dbName } = await openRepairDb(db, { apply: APPLY, allowProd: process.argv.includes('--allow-prod'), toolName: TOOL_NAME });
  currentDbName = dbName;
  await assertNoSchemaDrift(db, { apply: APPLY, toolName: TOOL_NAME });
  const prodMode = dbName === PRODUCTION_DATABASE_NAME || process.argv.includes('--prod-mode');
  const mode = undoFile ? 'undo' : process.argv.includes('--zeros') ? 'zeros' : 'repair';
  console.log(`OD-74 issue-size one-time repair — ${mode} — ${APPLY ? 'APPLY' : 'DRY-RUN'} — database ${dbName}${prodMode ? ' — PROD MODE (never fetches; pinned pages only)' : ''}`);
  // #1059 round 2 (MAJOR-2): the scope line a reader/test relies on is printed
  // INSIDE runRepair/runZeros from the ids they actually received, not here —
  // printing it here from `ipoScope.ipoIds` would stay correct even if the
  // call site below silently handed `[]` to the run function, hiding an
  // unscoped run behind a scoped-looking line. `--undo` stays ledger-scoped
  // (unaffected by `--ipo`), so it has no scope line of its own here.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const store = new PageStore(path.resolve(argValue('--store-dir') ?? path.join(here, 'data', 'od74-issue-size')), TOOL_NAME);
  const ctx: ReadCtx = { store, prodMode, allowFetch: !process.argv.includes('--no-fetch'), lastFetchAt: 0 };
  const ledger: unknown[] = [];
  let counts: Counts = { writes: 0, failures: 0 };
  let exitCode = 0;
  try {
    counts =
      mode === 'undo'
        ? await runUndo(undoFile!, ledger)
        : mode === 'zeros'
          ? await runZeros(APPLY, ledger, ipoScope.ipoIds)
          : await runRepair(APPLY, ctx, ledger, ipoScope.ipoIds);
    if (counts.failures > 0) exitCode = 1;
  } catch (e) {
    exitCode = e instanceof RefusedError ? 2 : 1;
    console.error(`${e instanceof RefusedError ? 'REFUSED' : 'FAILED'}: ${e instanceof Error ? e.message : e}`);
    ledger.push({ outcome: exitCode === 2 ? 'REFUSED' : 'FAILED', error: e instanceof Error ? e.message : String(e) });
  } finally {
    const file = writeLedgerFile(path.join(here, 'state', `od74-issue-size-${mode}-${dbName}-${APPLY ? 'apply' : 'dryrun'}-${Date.now()}.json`), {
      tool: TOOL_NAME,
      mode: APPLY ? 'apply' : 'dry-run',
      generatedAt: new Date().toISOString(),
      // repair mode only; `zeros` / `undo` runs keep their before-image in `rows`
      // (the undo reads `rows`) and are listed as a remaining gap on #457.
      changes: od74Changes,
      dbName,
      apply: APPLY,
      rows: ledger,
    });
    console.log(`ledger ${file}; written ${counts.writes}; failures ${counts.failures}${APPLY ? '' : ' — DRY-RUN, re-run with --apply to write'}`);
  }
  return exitCode;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
