/**
 * Backfill: `ipos.sector` for existing rows from Chittorgarh per-IPO detail
 * pages (T-507, issue #394, owner decision 5 of 2026-09-08).
 *
 * WHY: `ipos.sector` is '' on every row (T-455/#242 found no live scraper
 * source ever wrote it). T-507 wired a LIVE per-IPO detail-page visit
 * (`chittorgarh-sector-visitor.ts`, called from `runChittorgarhScraper()`)
 * that fills NEW/rotating rows going forward for the CURRENT fiscal year
 * (cheap discovery) at a 5-per-cycle budget — this script is the one-time
 * catch-up for EVERY EXISTING empty row across ALL fiscal years, run
 * manually against staging first (owner decision: prod backfill later, by
 * Fable).
 *
 * Uses the SAME extractor (`extractSectorFromDetailHtml`) and the SAME
 * discovery/URL resolver (`chittorgarh-detail-url-resolver.ts` — resolves
 * slug+id from Chittorgarh's own report-82 feed; a slug-only URL guess was
 * verified LIVE to 404 for every company, see that module's header comment)
 * as the live visitor, so there is exactly one place that knows how to reach
 * a Chittorgarh detail page. Built on `scripts/lib/repair-tool.ts` (T-490)
 * per the project's own repair-tool mandate: `openRepairDb` (refuses a prod
 * `--apply` without `--allow-prod`, verified from the WRITING pool, not an
 * env var), `upsertFieldSource` (provenance row, source=CHITTORGARH,
 * previous_source read from whatever is already stored), per-field
 * idempotency (never re-upsert a field a prior run already repaired — that
 * would overwrite the audit trail), and `writeLedgerFile` (applied-ledger
 * artifact for the staging/prod proof).
 *
 * Write-time guards (mirrors the live visitor's `upsertIpoSector`):
 *   - never overwrites a `field_sources` row already carrying `source: 'ADMIN'`
 *   - never overwrites any existing non-empty `ipos.sector` value (including a
 *     prior CHITTORGARH-sourced one) — `WHERE sector IS NULL OR sector = ''`
 *
 * dry-run by default; --apply writes. --limit N caps detail fetches.
 * --slug a,b,c scopes to specific companies (matched against the resolved
 * discovery slug, e.g. `ather-energy-ipo`) — for a small staging proof run
 * without touching the whole table.
 *
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1 PORT=15432 + creds):
 *   npx tsx scripts/backfill-sector-chittorgarh.ts [--slug a,b,c] [--limit N]
 *   npx tsx scripts/backfill-sector-chittorgarh.ts --apply --limit 40
 *   npx tsx scripts/backfill-sector-chittorgarh.ts --apply --allow-prod   (prod — Fable, later)
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { extractSectorFromDetailHtml } from '../src/scrapers/chittorgarh-detail-fields.js';
import {
  buildChittorgarhDiscoveryMap,
  buildChittorgarhDetailUrlFromRef,
  type FiscalYear,
} from '../src/services/chittorgarh-detail-url-resolver.js';
import logger from '../src/utils/logger.js';
import {
  openRepairDb,
  readFieldSource,
  upsertFieldSource,
  alreadyRepairedKey,
  buildAlreadyRepairedSet,
  writeLedgerFile,
} from './lib/repair-tool.js';

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;
const slugIdx = process.argv.indexOf('--slug');
const SLUG_SCOPE: Set<string> | null = slugIdx >= 0
  ? new Set(process.argv[slugIdx + 1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  : null;

/** Full historical fiscal-year sweep (same range `backfill-lot-size-chittorgarh-detail.ts` uses). */
const FISCAL_YEARS: FiscalYear[] = [
  { year: 2026, range: '2026-27' },
  { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' },
  { year: 2023, range: '2023-24' },
  { year: 2022, range: '2022-23' },
  { year: 2021, range: '2021-22' },
  { year: 2020, range: '2020-21' },
];

async function fetchDetailHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) { logger.warn({ url, status: r.status }, 'detail HTTP error'); return null; }
    return await r.text();
  } catch (err) {
    logger.warn({ url, error: err instanceof Error ? err.message : String(err) }, 'detail fetch failed');
    return null;
  }
}

interface Plan { id: string; name: string; sector: string; url: string; previousSource: string | null; }

async function main() {
  console.log('='.repeat(80));
  console.log(`SECTOR BACKFILL (Chittorgarh detail pages) — T-507/#394 — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'backfill-sector-chittorgarh',
  });

  // 1. Every row with an empty sector.
  const candidates = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName })
    .from(schema.ipos)
    .where(or(isNull(schema.ipos.sector), eq(schema.ipos.sector, '')))
    .orderBy(sql`${schema.ipos.updatedAt} ASC`);
  console.log(`ipos rows with empty sector: ${candidates.length}`);

  // 2. Full historical discovery map (report 82, every fiscal year, mainboard + SME).
  console.log(`building discovery map across ${FISCAL_YEARS.length} fiscal years (mainboard + SME)...`);
  const discovery = await buildChittorgarhDiscoveryMap(FISCAL_YEARS);
  console.log(`discovery map: ${discovery.size} IPOs`);

  let matched = candidates
    .map((c) => ({ ...c, ref: discovery.get(normalizeCompanyNameForMatching(c.companyName)) }))
    .filter((c): c is typeof c & { ref: NonNullable<typeof c.ref> } => !!c.ref);
  console.log(`matched to a Chittorgarh detail URL: ${matched.length} (unmatched: ${candidates.length - matched.length})`);

  if (SLUG_SCOPE) {
    matched = matched.filter((c) => SLUG_SCOPE.has(c.ref.slug.toLowerCase()));
    console.log(`scoped by --slug to: ${matched.length}`);
  }

  // 3. Per-field idempotency: skip a row this tool already repaired (never
  // re-upsert and overwrite the recorded previous_source audit trail).
  const priorSourceRows = await db
    .select({ ipoId: schema.fieldSources.ipoId, fieldName: schema.fieldSources.fieldName, source: schema.fieldSources.source })
    .from(schema.fieldSources)
    .where(eq(schema.fieldSources.fieldName, 'sector'));
  const alreadyRepaired = buildAlreadyRepairedSet(
    priorSourceRows.map((r) => ({ ipoId: r.ipoId, fieldName: r.fieldName })),
    (r) => priorSourceRows.some((row) => row.ipoId === r.ipoId && row.fieldName === r.fieldName && row.source === 'CHITTORGARH')
  );

  // 4. Fetch + extract (plausibility-gated), skipping ADMIN-owned or already-repaired fields.
  const plans: Plan[] = [];
  let fetched = 0, noSector = 0, skippedAdmin = 0, skippedIdempotent = 0;
  for (const c of matched) {
    if (fetched >= LIMIT) break;

    if (alreadyRepaired.has(alreadyRepairedKey(c.id, 'sector'))) { skippedIdempotent++; continue; }

    const previousSource = await readFieldSource(db as any, { ipoId: c.id, fieldName: 'sector' });
    if (previousSource === 'ADMIN') { skippedAdmin++; continue; }

    fetched++;
    const url = buildChittorgarhDetailUrlFromRef(c.ref);
    const html = await fetchDetailHtml(url);
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 600)); // polite rate limit
    if (!html) { noSector++; continue; }

    const sector = extractSectorFromDetailHtml(html);
    if (!sector) { noSector++; logger.debug({ company: c.companyName }, 'sector not found on detail page'); continue; }

    plans.push({ id: c.id, name: c.companyName, sector, url, previousSource });
  }
  console.log(`\nsector extracted for: ${plans.length} | detail had no sector: ${noSector} | skipped (ADMIN-owned): ${skippedAdmin} | skipped (already repaired): ${skippedIdempotent} | detail-fetched: ${fetched}`);
  for (const p of plans.slice(0, 12)) console.log(`  - ${p.name} -> ${p.sector}  (${p.url})`);

  const ledgerPath = path.join(process.cwd(), 'scripts', '.ledger', `sector-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${plans.length} sector values WOULD be filled. Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  // 5. Fill only where still empty (admin-edit / concurrent-write safe) + provenance row.
  let written = 0, failed = 0, raced = 0;
  for (const p of plans) {
    try {
      const result = await db
        .update(schema.ipos)
        .set({ sector: p.sector, updatedAt: new Date() })
        .where(and(eq(schema.ipos.id, p.id), or(isNull(schema.ipos.sector), eq(schema.ipos.sector, ''))))
        .returning({ id: schema.ipos.id });
      if (result.length === 0) { raced++; continue; } // someone else filled it between read and write
      await upsertFieldSource(db as any, {
        ipoId: p.id,
        fieldName: 'sector',
        source: 'CHITTORGARH',
        confidence: 80,
        previousValue: null,
        dataLineage: { tool: 'backfill-sector-chittorgarh', url: p.url },
        updatedBy: 'backfill-sector-chittorgarh',
      });
      written++;
      logger.info({ company: p.name, sector: p.sector }, 'sector filled');
    } catch (err) {
      failed++;
      logger.error({ company: p.name, error: err instanceof Error ? err.message : String(err) }, 'sector update failed');
    }
  }
  console.log(`\nAPPLY complete: written=${written} raced=${raced} failed=${failed}`);

  writeLedgerFile(ledgerPath, {
    tool: 'backfill-sector-chittorgarh',
    ranAt: new Date().toISOString(),
    apply: APPLY,
    allowProd: ALLOW_PROD,
    plans,
    written,
    raced,
    failed,
  });
  console.log(`ledger: ${ledgerPath}`);
  console.log('='.repeat(80));
  process.exit(failed > written ? 1 : 0);
}

// MUST use pathToFileURL, not a hand-rolled `file://${argv[1]}` template — see
// tests/unit/utils/cli-entry-guard.test.ts (T-223). Guards main() from running
// as an import side effect so pure helpers stay unit-testable without the DB.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'sector backfill crashed');
    console.error(e);
    process.exit(1);
  });
}
