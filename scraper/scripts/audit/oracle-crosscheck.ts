/**
 * Stage-0 oracle cross-check (READ-ONLY audit harness).
 *
 * Given an IPO {slug, companyName}, fetch a fixed field set from BOTH oracles —
 * chittorgarh.com and moneycontrol.com — normalize each field, and emit, per
 * field: { ours, chittorgarh, moneycontrol, verdict } where verdict is one of
 * CORRECT | WRONG | SOURCE-CONFLICT | SOURCE-UNAVAILABLE.
 *
 * Verdict rules:
 *   - both oracles agree (within tolerance)  -> compare the consensus vs `ours`
 *   - only one oracle has the field          -> compare that oracle vs `ours`
 *   - the two oracles disagree               -> SOURCE-CONFLICT (both recorded)
 *   - neither oracle has it                   -> SOURCE-UNAVAILABLE
 * Tolerance: money ±1%, dates exact, counts/lot exact, text normalized.
 *
 * This module NEVER writes to the DB and NEVER fabricates a value — a value the
 * oracle does not publish is `null` (see .claude/rules/scraper-write-path.md:
 * nothing here touches upsertIPO / the consolidation path). `ours` is read from
 * prod via the shared DB (SSH tunnel), but if the tunnel/DB is unavailable it
 * falls back to a passed-in / --ours-json value and does NOT hard-fail.
 *
 * Logging: pino (object-first) per .claude/rules/structured-logging.md.
 *
 * CLI:  tsx oracle-crosscheck.ts --slug <slug> [--company "Name"] \
 *          [--ours-json path] [--out path] [--no-cache] [--cache-ttl <min>]
 * API:  import { crossCheckIPO } from './oracle-crosscheck.js'
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import logger from '../../src/utils/logger.js';
import { retryWithExponentialBackoff } from '../../src/utils/scraper-utils.js';
import {
  parseListingReportRows,
  type ChittorgarhListingRow,
} from '../../src/scrapers/chittorgarh-listing-scraper.js';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import {
  extractOracleFields,
  EMPTY_FIELDS,
  type OracleFields,
  type OracleFieldKey,
} from './oracle-field-extractors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '.oracle-cache');
const MC_URL_MAP = path.join(__dirname, 'fixtures', 'moneycontrol-url-map.json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ---------------------------------------------------------------------------
// throttle + cached fetch (so re-runs don't re-hammer the oracles)
// ---------------------------------------------------------------------------

const THROTTLE_MS = Number(process.env.ORACLE_THROTTLE_MS ?? 800);
let lastFetchAt = 0;
async function throttle(): Promise<void> {
  const wait = THROTTLE_MS - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
}

interface FetchOpts {
  json?: boolean;
  useCache?: boolean;
  cacheTtlMin?: number;
  timeoutMs?: number;
}

function cacheKeyFor(url: string): string {
  return createHash('md5').update(url).digest('hex');
}

/**
 * Fetch a URL with an on-disk response cache (JSON sidecar under .oracle-cache/),
 * throttle, and retry-with-backoff. Returns the raw text, or null on hard failure
 * (never throws to the caller — a dead oracle is SOURCE-UNAVAILABLE, not a crash).
 */
async function cachedFetch(url: string, opts: FetchOpts = {}): Promise<string | null> {
  const { useCache = true, cacheTtlMin = 1440, timeoutMs = 25000 } = opts;
  const keyPath = path.join(CACHE_DIR, cacheKeyFor(url) + '.json');

  if (useCache) {
    try {
      const raw = await fs.readFile(keyPath, 'utf8');
      const entry = JSON.parse(raw) as { url: string; fetchedAt: number; body: string };
      if (Date.now() - entry.fetchedAt < cacheTtlMin * 60_000) {
        logger.debug({ url }, 'oracle cache hit');
        return entry.body;
      }
    } catch {
      /* cache miss / stale — fall through to network */
    }
  }

  try {
    const body = await retryWithExponentialBackoff(async () => {
      await throttle();
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Referer: 'https://www.chittorgarh.com/',
          Accept: opts.json ? 'application/json' : 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    }, 2, 1500);

    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(keyPath, JSON.stringify({ url, fetchedAt: Date.now(), body }), 'utf8');
    } catch (err) {
      logger.warn({ url, error: msg(err) }, 'oracle cache write failed (non-fatal)');
    }
    return body;
  } catch (err) {
    logger.warn({ url, error: msg(err) }, 'oracle fetch failed after retries (SOURCE-UNAVAILABLE)');
    return null;
  }
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Chittorgarh oracle
// ---------------------------------------------------------------------------

const CG_API = 'https://webnodejs.chittorgarh.com/cloud/report/data-read';
const CG_FISCAL_YEARS = [
  { year: 2026, range: '2026-27' },
  { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' },
  { year: 2023, range: '2023-24' },
  { year: 2022, range: '2022-23' },
];

/** Build a name -> {slug,id} discovery map from Chittorgarh report 118. */
async function chittorgarhDiscovery(opts: FetchOpts): Promise<Map<string, { slug: string; id: string }>> {
  const disc = new Map<string, { slug: string; id: string }>();
  for (const fy of CG_FISCAL_YEARS) {
    const url = `${CG_API}/118/1/10/${fy.year}/${fy.range}/0/all/0?search=&v=15-11`;
    const body = await cachedFetch(url, { ...opts, json: true });
    if (!body) continue;
    let rows: any[] = [];
    try {
      rows = JSON.parse(body)?.reportTableData ?? [];
    } catch {
      continue;
    }
    for (const row of rows) {
      const name = row?.Company ? String(row.Company) : '';
      const slug = row?.['~urlrewrite_folder_name'] ? String(row['~urlrewrite_folder_name']) : '';
      const id = row?.['~id'] != null ? String(row['~id']) : '';
      if (!name || !slug || !id) continue;
      const key = normalizeCompanyNameForMatching(name);
      if (key && !disc.has(key)) disc.set(key, { slug, id });
    }
  }
  return disc;
}

/** Fetch the Chittorgarh report-25 listing row for a company (listing price + gain). */
async function chittorgarhListingRow(companyName: string, opts: FetchOpts): Promise<ChittorgarhListingRow | null> {
  const wanted = normalizeCompanyNameForMatching(companyName);
  for (const cat of ['mainboard', 'sme']) {
    for (const fy of CG_FISCAL_YEARS) {
      const url = `${CG_API}/25/1/10/${fy.year}/${fy.range}/0/${cat}/0?search=&v=15-11`;
      const body = await cachedFetch(url, { ...opts, json: true });
      if (!body) continue;
      let rows: any[] = [];
      try {
        rows = JSON.parse(body)?.reportTableData ?? [];
      } catch {
        continue;
      }
      const match = parseListingReportRows(rows).find(
        (r) => normalizeCompanyNameForMatching(r.companyName) === wanted,
      );
      if (match) return match;
    }
  }
  return null;
}

async function fetchChittorgarh(ipo: IPOInput, opts: FetchOpts): Promise<OracleFields> {
  const disc = await chittorgarhDiscovery(opts);
  const hit = disc.get(normalizeCompanyNameForMatching(ipo.companyName)) ?? (ipo.slug ? findBySlug(disc, ipo.slug) : undefined);
  const fields: OracleFields = { ...EMPTY_FIELDS };

  if (hit) {
    const url = `https://www.chittorgarh.com/ipo/${hit.slug}/${hit.id}/`;
    const html = await cachedFetch(url, opts);
    Object.assign(fields, extractOracleFields(html, 'chittorgarh'));
  } else {
    logger.warn({ company: ipo.companyName, slug: ipo.slug }, 'no Chittorgarh detail-page match (SOURCE-UNAVAILABLE for detail fields)');
  }

  // Listing price / gain come from report-25 regardless of the detail page.
  const listing = await chittorgarhListingRow(ipo.companyName, opts);
  if (listing) {
    fields.listingPrice = listing.listingClose ?? fields.listingPrice;
    fields.listingGainPct = listing.listingGainPct ?? fields.listingGainPct;
    fields.listingDate = fields.listingDate ?? listing.listingDate;
    if (fields.companyName == null && listing.companyName) fields.companyName = listing.companyName;
  }
  return fields;
}

function findBySlug(disc: Map<string, { slug: string; id: string }>, slug: string) {
  for (const v of disc.values()) if (v.slug === slug) return v;
  return undefined;
}

// ---------------------------------------------------------------------------
// Moneycontrol oracle
//
// Moneycontrol IPO detail pages live at unpredictable /ipo/<slug>/<code> URLs
// with no public name->url resolver we can hit deterministically (the subscription
// API path 404s from this environment). Rather than guess an endpoint and risk
// parsing garbage, the adapter reads a per-slug URL from an OPTIONAL
// fixtures/moneycontrol-url-map.json ({ "<slug>": "<detail-url>" }) and fetches
// THAT. When no mapping exists, moneycontrol fields are SOURCE-UNAVAILABLE — never
// fabricated. This keeps the harness honest and extensible; the larger run can
// populate the URL map once, then get full moneycontrol coverage.
// ---------------------------------------------------------------------------

let mcUrlMap: Record<string, string> | null | undefined;
async function loadMcUrlMap(): Promise<Record<string, string>> {
  if (mcUrlMap !== undefined) return mcUrlMap ?? {};
  try {
    mcUrlMap = JSON.parse(await fs.readFile(MC_URL_MAP, 'utf8')) as Record<string, string>;
  } catch {
    mcUrlMap = null;
  }
  return mcUrlMap ?? {};
}

async function fetchMoneycontrol(ipo: IPOInput, opts: FetchOpts): Promise<OracleFields> {
  const map = await loadMcUrlMap();
  const url = ipo.slug ? map[ipo.slug] : undefined;
  if (!url) {
    logger.warn({ slug: ipo.slug }, 'no moneycontrol URL mapping (add fixtures/moneycontrol-url-map.json) — SOURCE-UNAVAILABLE');
    return { ...EMPTY_FIELDS };
  }
  const html = await cachedFetch(url, opts);
  return extractOracleFields(html, 'moneycontrol');
}

// ---------------------------------------------------------------------------
// normalization + tolerance + verdict
// ---------------------------------------------------------------------------

type FieldKind = 'money' | 'count' | 'date' | 'text' | 'price';

const FIELD_KIND: Record<OracleFieldKey, FieldKind> = {
  companyName: 'text',
  issueSizeCr: 'money',
  priceMin: 'price',
  priceMax: 'price',
  lotSize: 'count',
  faceValue: 'count',
  openDate: 'date',
  closeDate: 'date',
  allotmentDate: 'date',
  listingDate: 'date',
  subscriptionTotal: 'money',
  subscriptionQIB: 'money',
  subscriptionNII: 'money',
  subscriptionRetail: 'money',
  gmp: 'money',
  listingPrice: 'money',
  listingGainPct: 'money',
  registrar: 'text',
  sector: 'text',
};

const MONEY_TOL = 0.01; // ±1%

function normText(v: unknown): string | null {
  if (v == null) return null;
  const s = normalizeCompanyNameForMatching(String(v));
  return s.length ? s : null;
}

/** Two normalized values agree within tolerance for their kind. */
function agree(kind: FieldKind, a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  if (kind === 'text') return normText(a) === normText(b);
  if (kind === 'date') return String(a) === String(b);
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  if (kind === 'count' || kind === 'price') return na === nb;
  // money: ±1% relative
  const denom = Math.max(Math.abs(na), Math.abs(nb), 1e-9);
  return Math.abs(na - nb) / denom <= MONEY_TOL;
}

export type Verdict = 'CORRECT' | 'WRONG' | 'SOURCE-CONFLICT' | 'SOURCE-UNAVAILABLE';

export interface FieldResult {
  field: OracleFieldKey;
  ours: unknown;
  chittorgarh: unknown;
  moneycontrol: unknown;
  verdict: Verdict;
}

function verdictFor(kind: FieldKind, ours: unknown, cg: unknown, mc: unknown): Verdict {
  const hasCg = cg != null;
  const hasMc = mc != null;
  if (!hasCg && !hasMc) return 'SOURCE-UNAVAILABLE';

  let consensus: unknown;
  if (hasCg && hasMc) {
    if (!agree(kind, cg, mc)) return 'SOURCE-CONFLICT';
    consensus = cg;
  } else {
    consensus = hasCg ? cg : mc; // best-effort match the single available oracle
  }
  // Compare `ours` against the oracle consensus. A null/absent `ours` cannot match
  // a value the oracle publishes -> WRONG (a real data gap in our DB).
  return agree(kind, ours, consensus) ? 'CORRECT' : 'WRONG';
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export interface IPOInput {
  slug: string;
  companyName: string;
  /** Optional pre-supplied `ours` field set (bypasses the DB read entirely). */
  ours?: Partial<OracleFields>;
}

export interface CrossCheckReport {
  slug: string;
  companyName: string;
  oursSource: 'db' | 'passed' | 'json' | 'unknown';
  chittorgarhReachable: boolean;
  moneycontrolReachable: boolean;
  results: FieldResult[];
  summary: Record<Verdict, number>;
  generatedAt: string;
}

/**
 * Cross-check one IPO against both oracles. Never throws for a network/DB outage —
 * unreachable oracles surface as SOURCE-UNAVAILABLE, an unreachable DB as
 * oursSource:'unknown'.
 */
export async function crossCheckIPO(ipo: IPOInput, fetchOpts: FetchOpts = {}): Promise<CrossCheckReport> {
  logger.info({ slug: ipo.slug, company: ipo.companyName }, 'oracle cross-check starting');

  let ours: Partial<OracleFields> = ipo.ours ?? {};
  let oursSource: CrossCheckReport['oursSource'] = ipo.ours ? 'passed' : 'unknown';
  if (!ipo.ours) {
    const fromDb = await readOursFromDb(ipo.slug);
    if (fromDb) {
      ours = fromDb;
      oursSource = 'db';
    }
  }

  const [cg, mc] = await Promise.all([
    fetchChittorgarh(ipo, fetchOpts),
    fetchMoneycontrol(ipo, fetchOpts),
  ]);

  const cgReachable = Object.values(cg).some((v) => v != null);
  const mcReachable = Object.values(mc).some((v) => v != null);

  const results: FieldResult[] = (Object.keys(FIELD_KIND) as OracleFieldKey[]).map((field) => {
    const kind = FIELD_KIND[field];
    const oursVal = (ours as Record<string, unknown>)[field] ?? null;
    const verdict = verdictFor(kind, oursVal, cg[field], mc[field]);
    return { field, ours: oursVal, chittorgarh: cg[field], moneycontrol: mc[field], verdict };
  });

  const summary: Record<Verdict, number> = { CORRECT: 0, WRONG: 0, 'SOURCE-CONFLICT': 0, 'SOURCE-UNAVAILABLE': 0 };
  for (const r of results) summary[r.verdict]++;

  logger.info({ slug: ipo.slug, summary, oursSource }, 'oracle cross-check complete');
  return {
    slug: ipo.slug,
    companyName: ipo.companyName,
    oursSource,
    chittorgarhReachable: cgReachable,
    moneycontrolReachable: mcReachable,
    results,
    summary,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Read `ours` from prod via the shared DB (SSH tunnel). Dynamically imported so a
 * missing/unbuilt @ipodhan/shared or a dead tunnel degrades to null instead of a
 * hard failure at module load. Returns null when unavailable.
 */
async function readOursFromDb(slug: string): Promise<Partial<OracleFields> | null> {
  try {
    const [{ db }, schema, { eq, desc }] = await Promise.all([
      import('@ipodhan/shared/db'),
      import('@ipodhan/shared/db/schema'),
      import('drizzle-orm'),
    ]);

    const rows = await db
      .select()
      .from(schema.ipos)
      .where(eq(schema.ipos.slug, slug))
      .limit(1);
    const ipo = rows[0];
    if (!ipo) {
      logger.warn({ slug }, 'ours: no IPO row for slug (treating as unknown)');
      return null;
    }

    const [sub] = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.ipoId, ipo.id))
      .orderBy(desc(schema.subscriptions.timestamp))
      .limit(1);
    const [gmp] = await db
      .select()
      .from(schema.gmpRecords)
      .where(eq(schema.gmpRecords.ipoId, ipo.id))
      .orderBy(desc(schema.gmpRecords.timestamp))
      .limit(1);
    const [lp] = await db
      .select()
      .from(schema.listingPerformance)
      .where(eq(schema.listingPerformance.ipoId, ipo.id))
      .limit(1);

    const numOrNull = (v: unknown): number | null => {
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    return {
      companyName: ipo.companyName ?? null,
      issueSizeCr: ipo.issueSize != null ? +(Number(ipo.issueSize) / 1e7).toFixed(2) : null,
      priceMin: ipo.priceRangeMin ?? null,
      priceMax: ipo.priceRangeMax ?? null,
      lotSize: ipo.lotSize ?? null,
      faceValue: ipo.faceValue ?? null,
      openDate: ipo.openDate ?? null,
      closeDate: ipo.closeDate ?? null,
      allotmentDate: ipo.allotmentDate ?? null,
      listingDate: ipo.listingDate ?? null,
      registrar: ipo.registrar ?? null,
      sector: ipo.sector ?? null,
      subscriptionTotal: sub ? numOrNull(sub.totalSubscription) : null,
      subscriptionQIB: sub ? numOrNull(sub.qibSubscription) : null,
      subscriptionNII: sub ? numOrNull(sub.niiSubscription) : null,
      subscriptionRetail: sub ? numOrNull(sub.retailSubscription) : null,
      gmp: gmp ? numOrNull(gmp.gmp) : null,
      listingPrice: lp ? numOrNull(lp.listingPrice) : null,
      listingGainPct: lp ? numOrNull(lp.listingGainPercent) : null,
    };
  } catch (err) {
    logger.warn({ slug, error: msg(err) }, 'ours DB read unavailable — falling back (oursSource=unknown)');
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

async function cli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const slug = typeof args.slug === 'string' ? args.slug : '';
  if (!slug) {
    console.error('Usage: tsx oracle-crosscheck.ts --slug <slug> [--company "Name"] [--ours-json path] [--out path] [--no-cache] [--cache-ttl <min>]');
    process.exit(2);
  }
  const companyName = typeof args.company === 'string' ? args.company : slug.replace(/-/g, ' ');

  let ours: Partial<OracleFields> | undefined;
  if (typeof args['ours-json'] === 'string') {
    try {
      ours = JSON.parse(await fs.readFile(args['ours-json'] as string, 'utf8'));
    } catch (err) {
      logger.warn({ file: args['ours-json'], error: msg(err) }, '--ours-json read failed (ignoring)');
    }
  }

  const fetchOpts: FetchOpts = {
    useCache: args['no-cache'] ? false : true,
    cacheTtlMin: typeof args['cache-ttl'] === 'string' ? Number(args['cache-ttl']) : 1440,
  };

  const report = await crossCheckIPO({ slug, companyName, ours }, fetchOpts);

  if (typeof args.out === 'string') {
    await fs.writeFile(args.out, JSON.stringify(report, null, 2), 'utf8');
    logger.info({ out: args.out }, 'cross-check report written');
  }

  // Human-readable table to stdout (audit summaries are fine on stdout).
  console.log(`\n=== ORACLE CROSS-CHECK: ${report.companyName} (${report.slug}) ===`);
  console.log(`ours: ${report.oursSource} | chittorgarh reachable: ${report.chittorgarhReachable} | moneycontrol reachable: ${report.moneycontrolReachable}`);
  console.log('field'.padEnd(20), 'verdict'.padEnd(19), 'ours'.padEnd(16), 'chittorgarh'.padEnd(16), 'moneycontrol');
  for (const r of report.results) {
    console.log(
      String(r.field).padEnd(20),
      String(r.verdict).padEnd(19),
      String(r.ours ?? '—').slice(0, 15).padEnd(16),
      String(r.chittorgarh ?? '—').slice(0, 15).padEnd(16),
      String(r.moneycontrol ?? '—').slice(0, 15),
    );
  }
  console.log('\nsummary:', JSON.stringify(report.summary));
}

// Run as CLI only when invoked directly (tsx sets import.meta.url to the file).
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  cli().catch((err) => {
    logger.error({ error: msg(err) }, 'oracle cross-check CLI failed');
    process.exit(1);
  });
}
