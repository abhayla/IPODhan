/**
 * Backfill: IPO DRHP/RHP/Prospectus documents from Chittorgarh report 20/29 (C3a keystone)
 *
 * WHY: `documents` is 0% because nothing writes prospectus links (DRHP downloader stubbed;
 * BSE detail page is now an SPA — static fetch yields no links). Chittorgarh report 20 lists
 * each IPO with a real `Prospectus (pdf)` URL + isin/symbol/bse-code. This backfill matches
 * those rows to our genuine IPOs and persists the real external PDF URL via DocumentRepository.
 * Populating `documents` unblocks the already-registered objectives/peer/financial jobs that
 * read the `documents` table.
 *
 * SAFETY: dry-run by default (prints what WOULD be written). `--apply` persists. Idempotent
 * (DocumentRepository.upsertDocument dedups by URL). Honesty: only real PDF URLs are stored;
 * unmatched IPOs are reported, never fabricated.
 *
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 ...):
 *   npx tsx scripts/backfill-chittorgarh-documents.ts            # dry-run
 *   npx tsx scripts/backfill-chittorgarh-documents.ts --apply    # persist
 *   npx tsx scripts/backfill-chittorgarh-documents.ts --apply --limit=20
 */
import { db, getRedisClient } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { DocumentRepository } from '@ipodhan/shared';
import type { DocumentInsert } from '@ipodhan/shared/repositories/types';
import {
  fetchChittorgarhProspectusRows,
  type ChittorgarhProspectusRow,
} from '../src/scrapers/chittorgarh-document-scraper.js';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const a = process.argv.find((x) => x.startsWith('--limit='));
  return a ? parseInt(a.split('=')[1], 10) : Infinity;
})();

const FISCAL_YEARS = [
  { year: 2026, range: '2026-27' },
  { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' },
  { year: 2023, range: '2023-24' },
];

function mapExchange(raw: string | null): string | null {
  if (!raw) return null;
  return /nse/i.test(raw) ? 'NSE' : 'BSE';
}

async function main() {
  console.log('='.repeat(80));
  console.log(`CHITTORGARH DOCUMENTS BACKFILL — ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  console.log('='.repeat(80));

  // 1. Load genuine IPOs + build match indexes
  const ipos = await db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      symbol: schema.ipos.symbol,
      isin: schema.ipos.isin,
      segment: schema.ipos.segment,
      status: schema.ipos.status,
    })
    .from(schema.ipos)
    .where(eq(schema.ipos.offeringType, 'IPO'));

  const byNorm = new Map<string, (typeof ipos)[number]>();
  const bySymbol = new Map<string, (typeof ipos)[number]>();
  const byIsin = new Map<string, (typeof ipos)[number]>();
  for (const ipo of ipos) {
    const n = normalizeCompanyNameForMatching(ipo.companyName);
    if (n && !byNorm.has(n)) byNorm.set(n, ipo);
    if (ipo.symbol) bySymbol.set(ipo.symbol.trim().toUpperCase(), ipo);
    if (ipo.isin) byIsin.set(ipo.isin.trim().toUpperCase(), ipo);
  }
  console.log(`Genuine IPOs loaded: ${ipos.length} (byNorm=${byNorm.size} bySymbol=${bySymbol.size} byIsin=${byIsin.size})`);

  // 2. Fetch Chittorgarh prospectus rows
  console.log('Fetching Chittorgarh prospectus report (20/29) across fiscal years...');
  const rows = await fetchChittorgarhProspectusRows(FISCAL_YEARS);
  console.log(`Chittorgarh prospectus rows with a real PDF URL: ${rows.length}`);

  // 3. Match → plan inserts
  type Plan = { ipo: (typeof ipos)[number]; row: ChittorgarhProspectusRow; via: string };
  const plans: Plan[] = [];
  const matchedIpoIds = new Set<string>();
  let unmatched = 0;
  const unmatchedSamples: string[] = [];

  for (const row of rows) {
    let ipo: (typeof ipos)[number] | undefined;
    let via = '';
    const isinKey = row.isin?.trim().toUpperCase();
    const symKey = row.nseSymbol?.trim().toUpperCase();
    const normKey = row.companyName ? normalizeCompanyNameForMatching(row.companyName) : '';
    if (isinKey && byIsin.has(isinKey)) { ipo = byIsin.get(isinKey); via = 'isin'; }
    else if (symKey && bySymbol.has(symKey)) { ipo = bySymbol.get(symKey); via = 'symbol'; }
    else if (normKey && byNorm.has(normKey)) { ipo = byNorm.get(normKey); via = 'name'; }

    if (!ipo) {
      unmatched++;
      if (unmatchedSamples.length < 10) unmatchedSamples.push(`${row.companyName} [${row.exchange}]`);
      continue;
    }
    plans.push({ ipo, row, via });
    matchedIpoIds.add(ipo.id);
  }

  const viaCounts = plans.reduce<Record<string, number>>((a, p) => ((a[p.via] = (a[p.via] || 0) + 1), a), {});
  const typeCounts = plans.reduce<Record<string, number>>((a, p) => ((a[p.row.docType] = (a[p.row.docType] || 0) + 1), a), {});

  console.log(`\nMATCH RESULTS:`);
  console.log(`  matched chittorgarh rows -> our IPOs: ${plans.length}  (distinct IPOs: ${matchedIpoIds.size})`);
  console.log(`  match keys: ${JSON.stringify(viaCounts)}`);
  console.log(`  doc types:  ${JSON.stringify(typeCounts)}`);
  console.log(`  unmatched chittorgarh rows: ${unmatched}`);
  if (unmatchedSamples.length) console.log(`  unmatched samples:\n   - ${unmatchedSamples.join('\n   - ')}`);
  console.log(`\n  sample planned documents:`);
  for (const p of plans.slice(0, 10)) {
    console.log(`   - [${p.row.docType}/${p.via}] ${p.ipo.companyName} (${p.ipo.segment}/${p.ipo.status}) -> ${p.row.pdfUrl}`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN complete. ${plans.length} documents WOULD be written for ${matchedIpoIds.size} IPOs. Re-run with --apply to persist.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  // 4. Persist via DocumentRepository (idempotent by URL)
  let redis: ReturnType<typeof getRedisClient> | undefined;
  try { redis = getRedisClient(); } catch { /* redis optional */ }
  const repo = new DocumentRepository(db, redis as any);

  let written = 0, failed = 0, processedIpos = 0;
  const errors: string[] = [];
  const planByIpo = new Map<string, Plan[]>();
  for (const p of plans) {
    const arr = planByIpo.get(p.ipo.id) || [];
    arr.push(p);
    planByIpo.set(p.ipo.id, arr);
  }

  for (const [ipoId, ps] of planByIpo) {
    if (processedIpos >= LIMIT) break;
    processedIpos++;
    const docs: DocumentInsert[] = ps.map((p) => ({
      ipoId,
      type: p.row.docType as DocumentInsert['type'],
      title: `${p.row.docType} — ${p.ipo.companyName} (Chittorgarh)`,
      url: p.row.pdfUrl,
      exchange: mapExchange(p.row.exchange) as DocumentInsert['exchange'],
      mediaType: 'PDF',
      extractionStatus: 'PENDING',
    }));
    try {
      const res = await repo.upsertDocuments(docs);
      written += res.success;
      failed += res.failed;
      if (res.errors.length) errors.push(...res.errors);
      logger.info({ ipoId, company: ps[0].ipo.companyName, written: res.success, failed: res.failed }, 'Documents upserted');
    } catch (err) {
      failed += docs.length;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${ps[0].ipo.companyName}: ${msg}`);
      logger.error({ ipoId, error: msg }, 'Document upsert failed');
    }
  }

  console.log(`\nAPPLY complete: written=${written} failed=${failed} IPOs=${processedIpos}`);
  if (errors.length) console.log(`  errors (first 10):\n   - ${errors.slice(0, 10).join('\n   - ')}`);
  console.log('='.repeat(80));
  process.exit(failed > written ? 1 : 0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'Chittorgarh documents backfill crashed');
  console.error(e);
  process.exit(1);
});
