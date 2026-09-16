/**
 * Repair: IPO rows that store the FACE VALUE as the price band (lane C item
 * 2 slice 6).
 *
 * RCA: an ingestion path stored the face value as `price_range_min` AND
 * `price_range_max` on some rows — provenance shows BSE wrote 2 of the 5
 * class members. `price_range_min = price_range_max = face_value` is not a
 * degenerate-but-real fixed-price issue (a real fixed-price issue's band
 * equals its OFFER price, not its face value); it is the face value
 * mis-filed into the wrong column.
 *
 * Class: every `ipos` row, on either slot (`ipodhan` / `ipodhan_staging`),
 * where `price_range_min = price_range_max = face_value` — the SQL below,
 * never a hard-coded slug list. Measured 2026-09-16, both slots: 5 rows —
 * banganga-paper-industries-ltd, maruti-interior-products-ltd,
 * muthoot-fincotp-ltd, nirbhay-colours-india-ltd, stanbik-agro-ltd. STANBIK
 * is the sample this tool resolves (Chittorgarh report 82, FY2025-26 SME,
 * Issue Price 30.00, https://www.chittorgarh.com/ipo/stanbik-agro-ipo/2602/);
 * the other four are IN the class filter but resolve to 'no source'
 * (Chittorgarh report 82 across FY2024-25/2025-26/2026-27, both categories,
 * carries no matching company name for them) and are printed as such —
 * never written.
 *
 * Per-row resolution (never a hard-coded price): fetch report 82 for both
 * categories across the three fiscal years, match the row's company name
 * against the report's `Company` text using the SAME fold
 * `normalizeCompanyNameForMatching` from `@ipodhan/shared/utils/
 * company-name-normalizer` uses elsewhere in this codebase to compare a
 * stored IPO name against a scraped source name. TWO OR MORE report rows
 * folding to the same name is an AMBIGUOUS match — refused, both candidates
 * named, nothing written for that row. A candidate whose `Issue Price
 * (Rs.)` does not parse as a positive number is not accepted as a source
 * either. On a resolved price, this tool also fetches the report row's
 * OWN detail page (linked from its `Company` anchor href) to read the
 * REAL face value via `extractFaceValueFromDetailHtml` — if that page does
 * not yield a plausible face value, `face_value` is left untouched and the
 * reason is printed; `price_range_min`/`price_range_max` are still
 * resolved and written independently.
 *
 * Writes go THROUGH the repository, on ONE transaction per row:
 * `IPORepository.applyOfferTerms` for the price-band pair and the sibling
 * `IPORepository.applyFaceValue` for the face value (added in
 * `packages/shared/src/repositories/ipo-repository.ts` next to
 * `applyOfferTerms`) — never a direct `db.update(ipos)`. Each CHANGED field
 * gets its own `field_sources` row (source CHITTORGARH), never an
 * unchanged or null one.
 *
 * dry-run by default (prints each class row's resolved price or its 'no
 * source' reason); `--apply` requires `--expect-db <name>` matching
 * `current_database()` and refuses production without `--allow-prod`
 * (never passed by this tool's own CI/proof runs). `--slug <slug>` narrows
 * the class scan to one row for a rehearsal — never a list of named slugs
 * standing in for the class filter.
 *
 * Usage (run from scraper/ with the tunnel env exported):
 *   npx tsx scripts/repair-face-value-band-chittorgarh.ts                      # dry-run, whole class
 *   npx tsx scripts/repair-face-value-band-chittorgarh.ts --slug stanbik-agro-ltd
 *   npx tsx scripts/repair-face-value-band-chittorgarh.ts --apply --expect-db ipodhan_staging
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db, getRedisClient, configureUtcTimestampParsing } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared/repositories';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import { openRepairDb, upsertFieldSource, writeLedgerFile, queryCurrentDatabase } from './lib/repair-tool.js';
import { fetchReport82CurrentYear } from './lib/chittorgarh-report82-discovery.js';
import { extractFaceValueFromDetailHtml } from '../src/scrapers/chittorgarh-detail-fields.js';

// Every pool this tool opens (the shared `db` proxy) must read naive
// timestamps as UTC — see CLAUDE.md's "Timestamps off by 5h30m" entry.
configureUtcTimestampParsing();

const TOOL_NAME = 'repair-face-value-band-chittorgarh';
const UPDATED_BY = 'SYSTEM_LANEC_ITEM2_S6_FACE_VALUE_BAND';
const FISCAL_YEARS = [2024, 2025, 2026] as const;
const CATEGORIES = ['mainboard', 'sme'] as const;

export interface ClassRow {
  id: string;
  companyName: string;
  slug: string;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  faceValue: number | null;
}

/**
 * The class predicate, as SQL — never a slug list. `offering_type = 'IPO'`
 * excludes RIGHTS/TENDER/etc offerings, which do not carry this class's
 * mechanism at all. A row missing any of the three values (any NULL) can
 * never satisfy `min = max = face_value` in SQL (NULL = NULL is not true),
 * so an incomplete row is naturally excluded, not specially cased.
 */
export function buildClassWhereClause(slug?: string) {
  const base = sql`${schema.ipos.priceRangeMin} = ${schema.ipos.priceRangeMax}
    AND ${schema.ipos.priceRangeMin} = ${schema.ipos.faceValue}
    AND ${schema.ipos.offeringType} = 'IPO'`;
  return slug ? sql`${base} AND ${schema.ipos.slug} = ${slug}` : base;
}

/** Pure predicate mirroring the SQL above, for fixture-level unit tests without a database. */
export function isClassMember(row: {
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  faceValue: number | null;
  offeringType: string;
}): boolean {
  if (row.offeringType !== 'IPO') return false;
  if (row.priceRangeMin === null || row.priceRangeMax === null || row.faceValue === null) return false;
  return row.priceRangeMin === row.priceRangeMax && row.priceRangeMin === row.faceValue;
}

export interface Report82Candidate {
  companyName: string;
  issuePriceRaw: string | undefined;
  detailUrl: string | null;
  year: number;
  category: 'mainboard' | 'sme';
}

/**
 * Extract the detail-page URL from a report-82 row's `Company` anchor href.
 *
 * Built from `String.fromCharCode(34)` rather than a literal `"` inside the
 * pattern: `scripts/ci/require-repair-tool-module.mjs`'s comment/string
 * stripper does not understand regex literals, so a literal double-quote
 * character sitting inside a `/regex/` here reads to it as an ODD, unmatched
 * quote — it then treats the NEXT unrelated `"..."` string in this file as
 * the closer and swallows everything between them as one "string" token,
 * which silently deleted this file's real `openRepairDb(...)` call from the
 * lint's view (round-1 bug, caught by `node scripts/ci/require-repair-tool-
 * module.mjs` failing on this exact file). Building the quote at runtime
 * sidesteps the lint's tokenizer entirely, the same trick `repair-tool.ts`
 * itself documents for a different reason (`decideProdWriteRefusal`'s
 * neighboring file header).
 */
const DQ = String.fromCharCode(34);
const HREF_PATTERN = new RegExp(`<a\\s+href=${DQ}([^${DQ}]+)${DQ}`, 'i');
export function detailUrlFromCompanyAnchor(companyHtml: string): string | null {
  const m = HREF_PATTERN.exec(companyHtml);
  return m ? m[1] : null;
}

/** Strip the anchor markup from a report-82 row's `Company` field down to plain text. */
export function plainCompanyName(companyHtml: string): string {
  return String(companyHtml ?? '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

export type ResolveOutcome =
  | { status: 'resolved'; issuePrice: number; detailUrl: string | null; source: Report82Candidate }
  | { status: 'ambiguous'; candidates: Report82Candidate[] }
  | { status: 'no-source' };

/**
 * Resolve one row's issue price from the collected report-82 candidates
 * (across all fiscal years and both categories, already fetched by the
 * caller). A candidate is eligible only if its normalized name matches AND
 * its `Issue Price (Rs.)` parses as a positive number. 2+ eligible
 * candidates is refused as ambiguous (both/all named); 0 is 'no-source'.
 */
export function resolveIssuePrice(
  companyName: string,
  candidates: Report82Candidate[],
  normalize: (name: string) => string
): ResolveOutcome {
  const target = normalize(companyName);
  const eligible = candidates.filter((c) => {
    if (normalize(c.companyName) !== target) return false;
    const price = c.issuePriceRaw != null ? parseFloat(String(c.issuePriceRaw).replace(/,/g, '')) : NaN;
    return Number.isFinite(price) && price > 0;
  });
  if (eligible.length === 0) return { status: 'no-source' };
  if (eligible.length > 1) return { status: 'ambiguous', candidates: eligible };
  const winner = eligible[0];
  const issuePrice = parseFloat(String(winner.issuePriceRaw).replace(/,/g, ''));
  return { status: 'resolved', issuePrice, detailUrl: winner.detailUrl, source: winner };
}

/**
 * Fetch + flatten report 82 across every (year, category) pair into
 * candidates, pure name/price/url extraction.
 *
 * A single (year, category) fetch failure — measured live 2026-09-16:
 * FY2026-27 mainboard returns the SAME 82-row page for every page number
 * (never an empty page), so the reader's own pagination loop hits its
 * 200-page hard ceiling and throws — does not abort the whole class scan.
 * That reader's pagination behavior is out of this tool's scope (owned by
 * `scripts/lib/chittorgarh-report82-discovery.ts`, PR #686); this tool's
 * job is to keep resolving every OTHER (year, category) pair rather than
 * losing all of them to one bucket's upstream oddity. The failure is
 * printed so it is visible, never swallowed silently.
 */
export async function collectReport82Candidates(
  fetchYear: (category: 'mainboard' | 'sme', year: number) => Promise<unknown[]>,
  onFetchError: (year: number, category: 'mainboard' | 'sme', error: unknown) => void = (y, c, e) =>
    console.error(`report-82 fetch failed for FY${y} ${c}, skipping this bucket: ${e instanceof Error ? e.message : String(e)}`)
): Promise<Report82Candidate[]> {
  const out: Report82Candidate[] = [];
  for (const year of FISCAL_YEARS) {
    for (const category of CATEGORIES) {
      let rows: unknown[];
      try {
        rows = await fetchYear(category, year);
      } catch (e) {
        onFetchError(year, category, e);
        continue;
      }
      for (const row of rows as Array<Record<string, unknown>>) {
        const companyHtml = String(row?.Company ?? '');
        const companyName = plainCompanyName(companyHtml);
        if (!companyName) continue;
        out.push({
          companyName,
          issuePriceRaw: row?.['Issue Price (Rs.)'] as string | undefined,
          detailUrl: detailUrlFromCompanyAnchor(companyHtml),
          year,
          category,
        });
      }
    }
  }
  return out;
}

export interface RepoLike {
  applyOfferTerms(id: string, data: { priceRangeMin: number; priceRangeMax: number }): Promise<unknown>;
  applyFaceValue(id: string, faceValue: number): Promise<unknown>;
}

export interface ApplyRowInput {
  row: ClassRow;
  issuePrice: number;
  resolvedFaceValue: number | null;
  reportUrlNote: string;
  stamp: string;
  writeBackup: (path: string, payload: unknown) => string;
  writeLedger: (path: string, payload: unknown) => string;
  upsert: typeof upsertFieldSource;
}

export interface ApplyRowResult {
  wrote: boolean;
  fieldsWritten: string[];
  backupPath?: string;
  ledgerPath?: string;
}

/**
 * The write body for one class row: backup -> per-field provenance ->
 * repository writes, all inside one transaction. Only fields that
 * DIFFER from the stored value are written; a field with no diff gets no
 * provenance row and no write. `resolvedFaceValue === null` means the
 * detail page could not yield a plausible face value — `face_value` is
 * left untouched (only the price-band pair may still be written).
 */
export async function applyRowRepair(
  executors: {
    transaction: (fn: (tx: unknown) => Promise<void>) => Promise<void>;
    makeRepo: (tx: unknown) => RepoLike;
  },
  input: ApplyRowInput
): Promise<ApplyRowResult> {
  const { row, issuePrice, resolvedFaceValue, reportUrlNote, stamp, writeBackup, writeLedger, upsert } = input;

  const fieldsToWrite: Array<{ field: 'priceRangeMin' | 'priceRangeMax' | 'faceValue'; from: number | null; to: number }> = [];
  if (row.priceRangeMin !== issuePrice) fieldsToWrite.push({ field: 'priceRangeMin', from: row.priceRangeMin, to: issuePrice });
  if (row.priceRangeMax !== issuePrice) fieldsToWrite.push({ field: 'priceRangeMax', from: row.priceRangeMax, to: issuePrice });
  if (resolvedFaceValue !== null && row.faceValue !== resolvedFaceValue) {
    fieldsToWrite.push({ field: 'faceValue', from: row.faceValue, to: resolvedFaceValue });
  }

  if (fieldsToWrite.length === 0) {
    return { wrote: false, fieldsWritten: [] };
  }

  const dateDir = stamp.slice(0, 10);
  const backupPath = `evidence/${dateDir}-lane-c-item-02-s6-${row.slug}/before.json`;
  writeBackup(backupPath, { capturedAt: stamp, row });

  await executors.transaction(async (tx) => {
    for (const f of fieldsToWrite) {
      await upsert(tx as any, {
        ipoId: row.id,
        fieldName: f.field,
        source: 'CHITTORGARH',
        confidence: 100,
        previousValue: f.from,
        dataLineage: {
          reason: `face-value-as-band repair, resolved from Chittorgarh report 82 issue price ${stamp}`,
          tool: TOOL_NAME,
          slug: row.slug,
          note: reportUrlNote,
        },
        updatedBy: UPDATED_BY,
      });
    }

    const repo = executors.makeRepo(tx);
    const priceUpdate: { priceRangeMin?: number; priceRangeMax?: number } = {};
    for (const f of fieldsToWrite) {
      if (f.field === 'priceRangeMin') priceUpdate.priceRangeMin = f.to;
      if (f.field === 'priceRangeMax') priceUpdate.priceRangeMax = f.to;
    }
    if (priceUpdate.priceRangeMin !== undefined || priceUpdate.priceRangeMax !== undefined) {
      await repo.applyOfferTerms(row.id, {
        priceRangeMin: priceUpdate.priceRangeMin ?? (row.priceRangeMin as number),
        priceRangeMax: priceUpdate.priceRangeMax ?? (row.priceRangeMax as number),
      });
    }
    const faceValueTarget = fieldsToWrite.find((f) => f.field === 'faceValue');
    if (faceValueTarget) {
      await repo.applyFaceValue(row.id, faceValueTarget.to);
    }
  });

  const ledgerPath = `evidence/${dateDir}-lane-c-item-02-s6-${row.slug}/applied.json`;
  writeLedger(ledgerPath, {
    appliedAt: stamp,
    slug: row.slug,
    written: fieldsToWrite.map((f) => ({ field: f.field, from: f.from, to: f.to })),
  });

  return { wrote: true, fieldsWritten: fieldsToWrite.map((f) => f.field), backupPath, ledgerPath };
}

function readFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function fetchDetailFaceValue(url: string | null): Promise<{ value: number | null; reason: string }> {
  if (!url) return { value: null, reason: 'no detail URL on the report-82 candidate' };
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://www.chittorgarh.com/',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return { value: null, reason: `detail page HTTP ${r.status}` };
    const html = await r.text();
    const value = extractFaceValueFromDetailHtml(html);
    return value === null ? { value: null, reason: 'Face Value not found or implausible on the detail page' } : { value, reason: '' };
  } catch (e) {
    return { value: null, reason: `detail page fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function main() {
  const APPLY = process.argv.includes('--apply');
  const ALLOW_PROD = process.argv.includes('--allow-prod');
  const slug = readFlag('slug');
  const expectDb = readFlag('expect-db');

  console.log('='.repeat(80));
  console.log(`FACE-VALUE-AS-BAND REPAIR (lane C item 2 slice 6) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const { dbName } = await openRepairDb(db, { apply: APPLY, allowProd: ALLOW_PROD, toolName: TOOL_NAME });

  if (APPLY) {
    if (!expectDb) {
      console.error(`${TOOL_NAME}: --apply requires --expect-db <name>.`);
      process.exit(1);
      return;
    }
    if (expectDb.toLowerCase() !== dbName.toLowerCase()) {
      console.error(
        `${TOOL_NAME}: --expect-db "${expectDb}" does not match current_database() "${dbName}" — refusing to apply.`
      );
      process.exit(1);
      return;
    }
  }

  const rows = (await db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      slug: schema.ipos.slug,
      priceRangeMin: schema.ipos.priceRangeMin,
      priceRangeMax: schema.ipos.priceRangeMax,
      faceValue: schema.ipos.faceValue,
    })
    .from(schema.ipos)
    .where(buildClassWhereClause(slug))) as ClassRow[];

  console.log(`class rows (db=${dbName}${slug ? `, --slug ${slug}` : ''}): ${rows.length}`);
  if (rows.length === 0) {
    console.log('nothing in the class — exiting clean.');
    console.log('='.repeat(80));
    process.exit(0);
    return;
  }

  console.log('fetching Chittorgarh report 82 (FY2024-25 / FY2025-26 / FY2026-27, mainboard + SME)...');
  const candidates = await collectReport82Candidates(fetchReport82CurrentYear);
  console.log(`report-82 candidates collected: ${candidates.length}`);

  const redisClient = getRedisClient();
  const stamp = new Date().toISOString();
  let anyWrote = false;
  let anyBroke = false;

  for (const row of rows) {
    const outcome = resolveIssuePrice(row.companyName, candidates, normalizeCompanyNameForMatching);
    if (outcome.status === 'no-source') {
      console.log(`${row.slug}: NO SOURCE — no report-82 row across the three FYs matches "${row.companyName}"`);
      continue;
    }
    if (outcome.status === 'ambiguous') {
      console.log(
        `${row.slug}: REFUSED (ambiguous) — ${outcome.candidates.length} report-82 rows fold to "${row.companyName}": ` +
          outcome.candidates.map((c) => `[${c.year} ${c.category} "${c.companyName}" price=${c.issuePriceRaw}]`).join(', ')
      );
      continue;
    }

    const { value: faceValue, reason: faceValueReason } = await fetchDetailFaceValue(outcome.detailUrl);
    console.log(
      `${row.slug}: resolved issue price ${outcome.issuePrice.toFixed(2)} (${outcome.source.year} ${outcome.source.category}, ` +
        `${outcome.detailUrl ?? 'no detail URL'}); face_value=${faceValue ?? 'UNRESOLVED (' + faceValueReason + ')'}`
    );

    if (!APPLY) continue;

    try {
      const result = await applyRowRepair(
        { transaction: (fn) => (db as any).transaction(fn), makeRepo: (tx) => new IPORepository(tx as any, redisClient) },
        {
          row,
          issuePrice: outcome.issuePrice,
          resolvedFaceValue: faceValue,
          reportUrlNote: `${outcome.detailUrl ?? ''} FY${outcome.source.year} ${outcome.source.category}`,
          stamp,
          writeBackup: writeLedgerFile,
          writeLedger: writeLedgerFile,
          upsert: upsertFieldSource,
        }
      );
      if (result.wrote) {
        anyWrote = true;
        console.log(`  APPLIED: wrote [${result.fieldsWritten.join(', ')}] — backup ${result.backupPath}, ledger ${result.ledgerPath}`);
      } else {
        console.log('  no diff to write (already matches resolved values) — no-op.');
      }
    } catch (e) {
      anyBroke = true;
      console.error(`  BROKE writing ${row.slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log('='.repeat(80));
  if (anyBroke) {
    process.exit(2);
    return;
  }
  console.log(APPLY ? (anyWrote ? 'APPLY complete.' : 'APPLY ran — nothing needed writing.') : 'DRY-RUN complete — re-run with --apply --expect-db <name> to write.');
  process.exit(0);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, `${TOOL_NAME} crashed`);
    console.error(e);
    process.exit(2);
  });
}

// Re-export for tests / callers that need the current-database check independent of main().
export { queryCurrentDatabase };
