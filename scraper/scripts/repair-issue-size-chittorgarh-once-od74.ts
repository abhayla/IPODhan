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
 * One read per IPO, ever: every fetched page is saved to a page cache keyed by
 * the CHITTORGARH page itself (`<page-slug>-<id>.html`), and a cached page is
 * never fetched again — so dry run -> apply -> prod all use the SAME bytes. The
 * database also records the read: the field_sources lineage carries the url,
 * the read time and the page sha256; once written the row's source is
 * CHITTORGARH and the rule no longer selects it.
 *
 * Page URL: only URLs we already hold (ipos.verifier_url, then a chittorgarh
 * /ipo/ URL recorded in any field_sources lineage for that IPO), or an explicit
 * `--url slug=https://www.chittorgarh.com/ipo/...`. Never guessed; a row with no
 * URL is reported and left.
 *
 * Mode `--zeros` (OD-62): lists non-IPO events that store issue_size = 0. Report
 * only: OD-62's code set has no "not applicable" code (spec gap, see PR), so
 * this mode refuses --apply rather than pick a code the spec did not name.
 *
 * Usage (from scraper/, tunnel env exported — docs/ops/prod-ops-recipes.md §5):
 *   npx tsx scripts/repair-issue-size-chittorgarh-once-od74.ts              # dry run
 *   npx tsx scripts/repair-issue-size-chittorgarh-once-od74.ts --apply      # staging
 *   npx tsx scripts/repair-issue-size-chittorgarh-once-od74.ts --apply --allow-prod
 *   npx tsx scripts/repair-issue-size-chittorgarh-once-od74.ts --zeros
 * Options: --page-dir <dir> (default scripts/state/od74-issue-size-pages),
 *          --url slug=<chittorgarh url> (repeatable), --no-fetch (cache only).
 * Held-proof: node scripts/assert-repair-held.mjs scripts/lib/repair-invariants/issue-size-od74.mjs --cycles 2
 */
import { db, getRedisClient } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  extractIssueSizeFromDetailHtml,
  extractIssueSizeRupeesFromDetailHtml,
} from '../src/scrapers/chittorgarh-detail-fields.js';
import { invalidateIPOCaches } from '../src/services/cache-invalidator.js';
import { openRepairDb, upsertFieldSource, writeLedgerFile } from './lib/repair-tool.js';

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
      return { rupees: null, precise, tableRounded, reason: `prose total and table total disagree (${precise} vs ${tableRounded})` };
    }
    return { rupees: precise, precise, tableRounded, reason: null };
  }
  if (precise !== null) {
    const anchored = /issue\s*<\/a>\s*<\/span>\s*of\s*₹/i.test(html);
    return anchored
      ? { rupees: precise, precise, tableRounded, reason: null }
      : { rupees: null, precise, tableRounded, reason: 'prose total not anchored to the issue sentence and no table total' };
  }
  if (tableRounded !== null) return { rupees: tableRounded, precise, tableRounded, reason: null };
  return { rupees: null, precise, tableRounded, reason: 'no printed total on the page' };
}

export function decideOd74(input: { stored: number; printed: number | null }): {
  status: 'WRITE' | 'CONFIRM' | 'SKIP';
  write: boolean;
  reason: string;
} {
  if (input.printed === null) return { status: 'SKIP', write: false, reason: 'no printed total — left as is, never guessed' };
  const delta = Math.abs(input.printed - input.stored);
  if (delta <= PRINTED_PRECISION) {
    return { status: 'CONFIRM', write: true, reason: `printed total agrees within printed precision (delta ${delta})` };
  }
  return { status: 'WRITE', write: true, reason: `printed total differs by ${((delta / input.stored) * 100).toFixed(1)}%` };
}

export function resolveChittorgarhUrl(input: { verifierUrl: string | null; lineageUrls: string[]; override?: string }): string | null {
  const ok = (u: string | null | undefined): u is string => !!u && CHITTORGARH_IPO_URL.test(u);
  if (input.override !== undefined) return ok(input.override) ? input.override : null;
  if (ok(input.verifierUrl)) return input.verifierUrl;
  return input.lineageUrls.find(ok) ?? null;
}

export function pageCachePath(dir: string, url: string): string {
  const m = url.match(CHITTORGARH_IPO_URL);
  if (!m) throw new Error(`not a chittorgarh /ipo/ url: ${url}`);
  return path.join(dir, `${m[1]}-${m[2]}.html`);
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

export function classifyZeroRow(r: { offeringType: string; issueSize: number | null }): boolean {
  return r.offeringType !== 'IPO' && r.issueSize !== null && Number(r.issueSize) === 0;
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

/** Read a page from the cache, or fetch it ONCE and cache it. */
async function readPageOnce(url: string, dir: string, allowFetch: boolean): Promise<{ html: string | null; fetched: boolean }> {
  const file = pageCachePath(dir, url);
  if (fs.existsSync(file)) return { html: fs.readFileSync(file, 'utf8'), fetched: false };
  if (!allowFetch) return { html: null, fetched: false };
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'text/html' },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    console.log(`    fetch ${url} -> HTTP ${r.status} (not cached; a later run may retry)`);
    return { html: null, fetched: true };
  }
  const html = await r.text();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, html);
  return { html, fetched: true };
}

async function runZeros(): Promise<void> {
  const rows = await db.execute(sql`
    SELECT i.slug, i.offering_type AS "offeringType", i.status, i.issue_size::text AS "issueSize", fs.source
      FROM ipos i
      LEFT JOIN field_sources fs ON fs.ipo_id = i.id AND fs.table_name = 'ipos' AND fs.field_name = 'issueSize' AND fs.row_key = ''
     WHERE i.issue_size = 0 ORDER BY i.offering_type, i.slug`);
  const list = (rows as unknown as { rows: Array<Record<string, string>> }).rows ?? (rows as unknown as Array<Record<string, string>>);
  const members = list.filter((r) => classifyZeroRow({ offeringType: r.offeringType, issueSize: Number(r.issueSize) }));
  for (const r of list) {
    const m = classifyZeroRow({ offeringType: r.offeringType, issueSize: Number(r.issueSize) });
    console.log(`  ${m ? 'MEMBER ' : 'REPORT '} ${r.offeringType.padEnd(8)} ${r.slug} status=${r.status} source=${r.source ?? 'none'}`);
  }
  console.log(`zero-valued rows ${list.length}; non-IPO class members ${members.length}; IPO-typed zeros reported only ${list.length - members.length}`);
  if (process.argv.includes('--apply')) {
    console.error('--zeros refuses --apply: OD-62 names no reason code for "not applicable to this offering type"; owner decision needed.');
    process.exit(3);
  }
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  const { dbName } = await openRepairDb(db, { apply: APPLY, allowProd: process.argv.includes('--allow-prod'), toolName: TOOL_NAME });
  console.log(`OD-74 issue-size one-time repair — ${APPLY ? 'APPLY' : 'DRY-RUN'} — database ${dbName}`);
  if (process.argv.includes('--zeros')) return runZeros();

  const here = path.dirname(fileURLToPath(import.meta.url));
  const pageDir = path.resolve(argValue('--page-dir') ?? path.join(here, 'state', 'od74-issue-size-pages'));
  const allowFetch = !process.argv.includes('--no-fetch');
  const overrides = parseUrlOverrides(process.argv);

  const res = await db.execute(sql`
    SELECT i.id, i.slug, i.status, i.issue_size::text AS "issueSize", i.price_range_max::text AS "priceRangeMax",
           i.verifier_url AS "verifierUrl",
           ARRAY(SELECT f2.data_lineage->>'url' FROM field_sources f2
                  WHERE f2.ipo_id = i.id AND f2.data_lineage->>'url' ILIKE 'https://www.chittorgarh.com/ipo/%') AS "lineageUrls"
      FROM ipos i
      JOIN field_sources fs ON fs.ipo_id = i.id AND fs.table_name = 'ipos' AND fs.field_name = 'issueSize' AND fs.row_key = ''
     WHERE i.offering_type = 'IPO' AND fs.source = 'BSE'
     ORDER BY i.slug`);
  const all = ((res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{
    id: string; slug: string; status: string; issueSize: string | null; priceRangeMax: string | null; verifierUrl: string | null; lineageUrls: string[] | null;
  }>;
  const zeroOrNull = all.filter((r) => !(Number(r.issueSize) > 0));
  for (const r of zeroOrNull) console.log(`  OUT-OF-CLASS ${r.slug}: issue_size=${r.issueSize ?? 'NULL'} with BSE provenance — no BSE-computed value to repair (reported, not touched)`);
  const rows = all.filter((r) => Number(r.issueSize) > 0);
  console.log(`class (offering_type IPO, issueSize provenance BSE, value > 0): ${rows.length}`);

  const ledger: unknown[] = [];
  let lastFetchAt = 0, writes = 0, failures = 0;
  for (const r of rows) {
    const stored = Number(r.issueSize);
    const url = resolveChittorgarhUrl({ verifierUrl: r.verifierUrl, lineageUrls: r.lineageUrls ?? [], override: overrides[r.slug] });
    if (!url) {
      console.log(`  ${r.slug} | stored ${stored} | NO-URL (no chittorgarh page recorded; pass --url ${r.slug}=<url>)`);
      ledger.push({ slug: r.slug, stored, outcome: 'NO_URL' });
      continue;
    }
    if (allowFetch && !fs.existsSync(pageCachePath(pageDir, url))) {
      const wait = lastFetchAt + FETCH_GAP_MS - Date.now();
      if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    }
    const { html, fetched } = await readPageOnce(url, pageDir, allowFetch);
    if (fetched) lastFetchAt = Date.now();
    if (!html) {
      console.log(`  ${r.slug} | stored ${stored} | NO-PAGE ${url}`);
      ledger.push({ slug: r.slug, stored, url, outcome: 'NO_PAGE' });
      continue;
    }
    const printed = readPrintedTotal(html, r.priceRangeMax === null ? null : Number(r.priceRangeMax));
    const d = decideOd74({ stored, printed: printed.rupees });
    console.log(`  ${r.slug} | stored ${stored} | printed ${printed.rupees ?? 'none'} | ${d.status} (${printed.reason ?? d.reason}) | ${url}${fetched ? ' [fetched]' : ' [cached]'}`);
    const sha256 = createHash('sha256').update(html).digest('hex');
    ledger.push({ id: r.id, slug: r.slug, stored, printed: printed.rupees, status: d.status, url, sha256 });
    if (!d.write || !APPLY) continue;

    try {
      const updated = await db.transaction(async (tx) => {
        const u = await tx
          .update(schema.ipos)
          .set({ issueSize: String(printed.rupees), updatedAt: new Date() })
          .where(and(eq(schema.ipos.id, r.id), sql`${schema.ipos.issueSize} IS NOT DISTINCT FROM ${r.issueSize}`))
          .returning({ id: schema.ipos.id });
        if (u.length > 0) {
          await upsertFieldSource(tx, {
            ipoId: r.id,
            fieldName: 'issueSize',
            source: 'CHITTORGARH',
            confidence: 100,
            previousValue: stored,
            dataLineage: { tool: TOOL_NAME, od: 'OD-74', url, readAt: new Date().toISOString(), pageSha256: sha256, printedRupees: printed.rupees, outcome: d.status },
            updatedBy: TOOL_NAME,
          });
        }
        return u.length;
      });
      if (updated > 0) {
        writes++;
        if (process.env.REDIS_URL) {
          try {
            await invalidateIPOCaches(getRedisClient() as never, r.slug);
          } catch (e) {
            console.log(`    cache drop failed for ${r.slug} (drop ipo:* keys by hand): ${e instanceof Error ? e.message : e}`);
          }
        }
      } else console.log(`    SKIP ${r.slug}: row changed since selection`);
    } catch (e) {
      failures++;
      console.error(`    WRITE FAILED ${r.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const file = writeLedgerFile(path.join(here, 'state', `od74-issue-size-${dbName}-${APPLY ? 'apply' : 'dryrun'}-${Date.now()}.json`), { dbName, apply: APPLY, rows: ledger });
  console.log(`ledger ${file}; written ${writes}; failures ${failures}${APPLY ? '' : ' — DRY-RUN, re-run with --apply to write'}`);
  if (failures > 0) process.exit(1);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
