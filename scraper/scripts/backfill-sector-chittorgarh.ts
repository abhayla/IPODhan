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
 * Uses the SAME extractor (`extractSectorFromDetailHtml`), the SAME identity
 * guard (`extractCompanyNameFromDetailHtml`), and the SAME discovery/URL
 * resolver (`chittorgarh-detail-url-resolver.ts`) as the live visitor, so
 * there is exactly one place that knows how to reach a Chittorgarh detail
 * page and one place that decides whether a fetched page actually belongs to
 * the candidate. ALL writes route through `upsertIpoSector`
 * (data-persister.ts) — the same sanctioned write door the live visitor
 * uses — never a direct `db.update(ipos)` (round-2 review MAJOR 3: a direct
 * update here tripped `check-write-ratchet.mjs`, and duplicating the write
 * path is exactly the class that guard exists to catch).
 *
 * Identity guard (round-2 review CRITICAL 2): the live site resolves a
 * detail URL by NUMERIC ID ONLY — an unmatched/wrong slug still 200s and
 * silently serves whatever company that id belongs to. A normalized-name
 * collision in the discovery map (two companies sharing a normalized name;
 * `chittorgarh-detail-url-resolver.ts` keeps "first wins") would otherwise
 * write the WRONG company's sector onto the candidate, permanently (`ipos`
 * has no admin-edit UI for this field yet, and the write is write-once).
 * Before extracting anything, the fetched page's own company name
 * (`extractCompanyNameFromDetailHtml`) is compared to the candidate via
 * `normalizeCompanyNameForMatching`; a mismatch is logged and counted,
 * never written.
 *
 * Built on `scripts/lib/repair-tool.ts` (T-490): `openRepairDb` (refuses a
 * prod `--apply` without `--allow-prod`, verified from the WRITING pool, not
 * an env var) and `writeLedgerFile` (applied-ledger artifact for the
 * staging/prod proof). Per-field idempotency is `upsertIpoSector`'s own
 * ADMIN/non-empty guard (checked here first too, to skip an unnecessary
 * fetch for a row already resolved).
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
import { eq, isNull, or, sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import {
  extractSectorFromDetailHtml,
  extractCompanyNameFromDetailHtml,
} from '../src/scrapers/chittorgarh-detail-fields.js';
import { upsertIpoSector } from '../src/services/data-persister.js';
import {
  buildChittorgarhDiscoveryMap,
  buildChittorgarhDetailUrlFromRef,
  type FiscalYear,
} from '../src/services/chittorgarh-detail-url-resolver.js';
import logger from '../src/utils/logger.js';
import {
  openRepairDb,
  readFieldSource,
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

interface Written { id: string; name: string; sector: string; url: string; wrote: boolean; }
interface IdentityMismatch { id: string; candidateName: string; pageName: string | null; url: string; }

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

  // 3. Fetch + IDENTITY CHECK + extract (plausibility-gated), skipping ADMIN-owned rows.
  const written: Written[] = [];
  const identityMismatches: IdentityMismatch[] = [];
  let fetched = 0, noSector = 0, skippedAdmin = 0;
  for (const c of matched) {
    if (fetched >= LIMIT) break;

    const previousSource = await readFieldSource(db as any, { ipoId: c.id, fieldName: 'sector' });
    if (previousSource === 'ADMIN') { skippedAdmin++; continue; }

    fetched++;
    const url = buildChittorgarhDetailUrlFromRef(c.ref);
    const html = await fetchDetailHtml(url);
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 600)); // polite rate limit
    if (!html) { noSector++; continue; }

    // CRITICAL 2 guard: the site ignores an unmatched slug and serves
    // whatever company the numeric id belongs to. Never trust an extracted
    // field without first confirming the page IS the candidate.
    const pageName = extractCompanyNameFromDetailHtml(html);
    const identityMatches = !!pageName && (() => {
      const n1 = normalizeCompanyNameForMatching(c.companyName);
      const n2 = normalizeCompanyNameForMatching(pageName);
      return n1 === n2 || n1.includes(n2) || n2.includes(n1);
    })();
    if (!identityMatches) {
      identityMismatches.push({ id: c.id, candidateName: c.companyName, pageName, url });
      logger.warn({ candidate: c.companyName, pageName, url }, '[backfill-sector] identity mismatch — refusing to write');
      continue;
    }

    const sector = extractSectorFromDetailHtml(html, c.companyName);
    if (!sector) { noSector++; logger.debug({ company: c.companyName }, 'sector not found / rejected on detail page'); continue; }

    if (!APPLY) {
      written.push({ id: c.id, name: c.companyName, sector, url, wrote: false });
      continue;
    }

    try {
      const wrote = await upsertIpoSector(c.id, sector);
      written.push({ id: c.id, name: c.companyName, sector, url, wrote });
    } catch (err) {
      logger.error({ company: c.companyName, error: err instanceof Error ? err.message : String(err) }, 'sector update failed');
    }
  }

  console.log(`\nsector extracted/written for: ${written.length} | detail had no sector: ${noSector} | skipped (ADMIN-owned): ${skippedAdmin} | identity mismatches (refused): ${identityMismatches.length} | detail-fetched: ${fetched}`);
  for (const p of written.slice(0, 12)) console.log(`  - ${p.name} -> ${p.sector}  (${p.url})`);
  for (const m of identityMismatches) console.log(`  MISMATCH REFUSED: ${m.candidateName} != page "${m.pageName}"  (${m.url})`);

  const ledgerPath = path.join(process.cwd(), 'scripts', '.ledger', `sector-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeLedgerFile(ledgerPath, {
    tool: 'backfill-sector-chittorgarh',
    ranAt: new Date().toISOString(),
    apply: APPLY,
    allowProd: ALLOW_PROD,
    written,
    identityMismatches,
  });
  console.log(`ledger: ${ledgerPath}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${written.length} sector values WOULD be filled (${identityMismatches.length} candidates refused on identity mismatch). Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  const actuallyWritten = written.filter((w) => w.wrote).length;
  const racedOrSkipped = written.length - actuallyWritten;
  console.log(`\nAPPLY complete: written=${actuallyWritten} raced-or-guarded=${racedOrSkipped} identity-mismatches-refused=${identityMismatches.length}`);
  console.log('='.repeat(80));
  process.exit(0);
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
