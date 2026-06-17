/**
 * Backfill (Stage E): enrich financial_data from stored RHP/Prospectus PDFs via
 * the free pdfplumber sidecar (C3b, #8). NO LLM.
 *
 * WHY: the Chittorgarh detail HTML (Stage A–D) carries a compact restated table
 * (Total Income / PAT / EBITDA / Net Worth) but NOT a "Revenue from operations"
 * line. The stored RHP PDFs do. This stage runs the deterministic Python sidecar
 * (extract_financials_pdf.py — emits JSON only, no DB) on each stored-PDF IPO and
 * ENRICHES financial_data: it fills ONLY fields currently NULL (revenue per FY,
 * and any P&L the HTML missed). Existing HTML/admin values are never overwritten.
 *
 * Honesty: RHP values are normalised from their published unit (Lakhs/Crores) to
 * ₹ crore and passed through the SAME plausibility gate as Stage A; a value that
 * fails a bound is dropped (NULL), never guessed. EPS is per-share (₹) and is NOT
 * unit-scaled.
 *
 * Writes go through data-persister.createFinancialData (scraper-write-path.md);
 * the existing row is read and merged so the upsert never nulls a populated field.
 *
 * dry-run by default; --apply writes. --limit N caps PDFs; --force re-extracts.
 * Run from scraper/ (tunnel creds from web/.env.local, override:true).
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '../web/.env.local', override: true });

import { spawnSync } from 'child_process';
import { db, getRedisClient, FinancialDataRepository } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { inArray, eq } from 'drizzle-orm';
import { createFinancialData } from '../src/services/data-persister.js';
import { FINANCIAL_FIELD_BOUNDS } from '../src/scrapers/chittorgarh-detail-fields.js';
import type { ScrapedFinancialData } from '../src/scrapers/financial-data-scraper.js';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;

const FY_SLOTS = [2022, 2023, 2024] as const;
type Bound = { min: number; max: number };

function gate(v: number | null | undefined, b: Bound): number | undefined {
  if (v == null || !Number.isFinite(v) || v < b.min || v > b.max) return undefined;
  return v;
}

/** Normalise a published amount to ₹ crore. EPS (per-share) must NOT pass through here. */
function toCrore(v: number, unit: string): number {
  if (unit === 'crores') return v;
  if (unit === 'millions') return v / 10; // 1 crore = 10 million
  return v / 100; // lakhs (default)
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

function runSidecar(url: string): any | null {
  const res = spawnSync('python', ['scripts/extract_financials_pdf.py', url], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (res.status !== 0 && !res.stdout) {
    logger.warn({ url, err: res.stderr?.slice(0, 300) }, 'sidecar failed');
    return null;
  }
  try {
    const parsed = JSON.parse(res.stdout.trim().split('\n').pop() || '{}');
    if (parsed.error) {
      logger.warn({ url, error: parsed.error }, 'sidecar reported error');
      return null;
    }
    return parsed;
  } catch {
    logger.warn({ url }, 'sidecar output not JSON');
    return null;
  }
}

/**
 * Map an existing financial_data DB row into ScrapedFinancialData numbers.
 * Drizzle `.select()` returns camelCase TS field names (netWorth, revenueFy2024),
 * NOT snake_case columns — read those so the enrich-only merge sees populated
 * values and never overwrites an existing HTML/admin number.
 */
function existingToScraped(row: Record<string, any> | undefined): Partial<ScrapedFinancialData> {
  if (!row) return {};
  const num = (s: any) => (s == null ? undefined : Number(s));
  return {
    revenueFy2022: num(row.revenueFy2022), revenueFy2023: num(row.revenueFy2023), revenueFy2024: num(row.revenueFy2024),
    profitFy2022: num(row.profitFy2022), profitFy2023: num(row.profitFy2023), profitFy2024: num(row.profitFy2024),
    ebitdaFy2022: num(row.ebitdaFy2022), ebitdaFy2023: num(row.ebitdaFy2023), ebitdaFy2024: num(row.ebitdaFy2024),
    totalIncomeFy2022: num(row.totalIncomeFy2022), totalIncomeFy2023: num(row.totalIncomeFy2023), totalIncomeFy2024: num(row.totalIncomeFy2024),
    netWorth: num(row.netWorth), peRatio: num(row.peRatio), eps: num(row.eps), roe: num(row.roe), ronw: num(row.ronw),
    debtToEquity: num(row.debtToEquity), reservesAndSurplus: num(row.reservesAndSurplus), totalAssets: num(row.totalAssets),
    totalBorrowing: num(row.totalBorrowing), marketCap: num(row.marketCap), preIpoEps: num(row.preIpoEps), postIpoEps: num(row.postIpoEps),
  };
}

async function main() {
  const redis = getRedisClient();
  const finRepo = new FinancialDataRepository(db, redis);

  console.log('='.repeat(80));
  console.log(`C3b STAGE E — PDF (pdfplumber) financial ENRICHMENT — ${APPLY ? 'APPLY' : 'DRY-RUN'}${FORCE ? ' --force' : ''}`);
  console.log('='.repeat(80));

  // Stored RHP/Prospectus PDFs + their IPO + existing financial_data row.
  const docs = await withRetry(() =>
    db
      .select({ ipoId: schema.documents.ipoId, type: schema.documents.type, url: schema.documents.url, companyName: schema.ipos.companyName })
      .from(schema.documents)
      .innerJoin(schema.ipos, eq(schema.documents.ipoId, schema.ipos.id))
      .where(inArray(schema.documents.type, ['RHP', 'PROSPECTUS'] as any))
  );
  const byIpo = new Map<string, (typeof docs)[number]>();
  for (const d of docs) if (d.url && !byIpo.has(d.ipoId)) byIpo.set(d.ipoId, d); // one PDF per IPO (prefer first)

  const ipoIds = [...byIpo.keys()];
  const finRows = ipoIds.length
    ? await withRetry(() => db.select().from(schema.financialData).where(inArray(schema.financialData.ipoId, ipoIds)))
    : [];
  const finByIpo = new Map<string, any>(finRows.map((r: any) => [r.ipoId ?? r.ipo_id, r]));

  console.log(`stored-PDF IPOs: ${byIpo.size} | with existing financial_data: ${finByIpo.size}`);

  const stats = { processed: 0, enriched: 0, noNew: 0, sidecarFail: 0, failed: 0 };
  const samples: string[] = [];

  for (const [ipoId, doc] of byIpo) {
    if (stats.processed >= LIMIT) break;
    stats.processed++;

    const data = runSidecar(doc.url!);
    if (!data || !data.metrics || Object.keys(data.metrics).length === 0) {
      stats.sidecarFail++;
      continue;
    }
    const unit: string = data.unit || 'lakhs';
    const m = data.metrics as Record<string, Record<string, number>>;

    const existingRow = finByIpo.get(ipoId);
    const existing = existingToScraped(existingRow);

    // PDF-derived candidate fields (unit-normalised + gated). EPS is per-share, not scaled.
    const pdf: Partial<ScrapedFinancialData> = {};
    const perFy = (metricKey: string, prefix: 'revenue' | 'totalIncome' | 'profit' | 'ebitda', b: Bound) => {
      const byYear = m[metricKey];
      if (!byYear) return;
      for (const y of FY_SLOTS) {
        const raw = byYear[String(y)];
        if (raw == null) continue;
        const v = gate(toCrore(raw, unit), b);
        if (v != null) (pdf as any)[`${prefix}Fy${y}`] = v;
      }
    };
    perFy('revenue', 'revenue', FINANCIAL_FIELD_BOUNDS.revenue);
    perFy('totalIncome', 'totalIncome', FINANCIAL_FIELD_BOUNDS.totalIncome);
    perFy('profit', 'profit', FINANCIAL_FIELD_BOUNDS.profit);
    perFy('ebitda', 'ebitda', FINANCIAL_FIELD_BOUNDS.ebitda);
    const latestAnnual = (metricKey: string): number | undefined => {
      const byYear = m[metricKey];
      if (!byYear) return undefined;
      const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
      return years.length ? byYear[String(years[0])] : undefined;
    };
    const nw = latestAnnual('netWorth');
    if (nw != null) pdf.netWorth = gate(toCrore(nw, unit), FINANCIAL_FIELD_BOUNDS.netWorth);
    const epsLatest = latestAnnual('eps');
    if (epsLatest != null) pdf.eps = gate(epsLatest, FINANCIAL_FIELD_BOUNDS.eps); // per-share, no unit scale

    // ENRICH-only: keep existing non-null; fill gaps from PDF.
    const newFields: string[] = [];
    const merged: ScrapedFinancialData = { ipoId, ...existing } as ScrapedFinancialData;
    for (const [k, v] of Object.entries(pdf)) {
      if (v == null) continue;
      const cur = (merged as any)[k];
      if (FORCE || cur == null) {
        if (cur == null) newFields.push(k);
        (merged as any)[k] = v;
      }
    }

    if (newFields.length === 0) {
      stats.noNew++;
      continue;
    }
    if (samples.length < 12) {
      samples.push(`  - ${doc.companyName} [${doc.type}] +${newFields.length}: ${newFields.join(',')} (unit=${unit})`);
    }

    if (!APPLY) {
      stats.enriched++;
      continue;
    }
    try {
      await createFinancialData(finRepo, merged);
      stats.enriched++;
      logger.info({ company: doc.companyName, added: newFields }, 'PDF enrichment written');
    } catch (err) {
      stats.failed++;
      logger.error({ company: doc.companyName, error: err instanceof Error ? err.message : String(err) }, 'PDF enrichment failed');
    }
  }

  console.log('\nSample enrichments:');
  for (const s of samples) console.log(s);
  console.log(`\nprocessed=${stats.processed} | enriched=${stats.enriched} | no-new-fields=${stats.noNew} | sidecar-no-data=${stats.sidecarFail} | failed=${stats.failed}`);
  console.log(APPLY ? '\nAPPLY complete.' : '\nDRY-RUN: nothing written. Re-run with --apply.');
  console.log('='.repeat(80));
  process.exit(stats.failed > stats.enriched ? 1 : 0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'C3b PDF backfill crashed');
  console.error(e);
  process.exit(1);
});
