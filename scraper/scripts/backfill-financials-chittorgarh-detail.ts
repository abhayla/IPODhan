/**
 * Backfill: financials + KPIs + peers + objectives for genuine IPOs from the
 * Chittorgarh per-IPO detail page (C3b, #8). NO LLM — pure deterministic HTML
 * extraction.
 *
 * WHY: financial_data / peer_companies / ipos.objectives are dark (0 rows). All
 * three live on the per-IPO detail page (`/ipo/<slug>/<id>/`). Report 118 (full
 * historical, per-fiscal-year JSON) provides the slug+id DISCOVERY map; we fetch
 * each missing IPO's detail page and run the plausibility-gated extractors in
 * `chittorgarh-detail-fields.ts`.
 *
 * CORRECTIVE + idempotent: matches report rows to EXISTING genuine IPOs by the
 * canonical normalizer; writes a payload ONLY when that target is currently empty
 * (financial_data row absent / no peer rows / objectives null) — unless --force.
 * Never overwrites admin edits, never creates an IPO row. Real data only: a value
 * that doesn't parse cleanly or fails a sane bound is left NULL, never guessed.
 *
 * ALL writes go through data-persister (scraper-write-path.md): createFinancialData,
 * createPeerCompanies, updateIPOObjectives. NEVER db.insert() directly.
 *
 * dry-run by default; --apply writes. --limit N caps detail fetches; --force
 * re-writes even when a target already has data.
 *
 * Run from scraper/. DB is prod via the SSH tunnel (localhost:15432); creds come
 * from web/.env.local (the scraper's own .env has stale direct-prod creds).
 */
import { config as loadEnv } from 'dotenv';
// override:true is REQUIRED — an imported module (scraper config.ts) loads the
// scraper's own .env (stale DIRECT-prod creds 103.118.16.189:5432, firewalled)
// at import time; we must override it with the tunnel creds in web/.env.local
// (DATABASE_HOST=localhost:15432). The db Proxy reads env lazily at first query,
// so this top-level override (running after import hoisting) wins.
loadEnv({ path: '../web/.env.local', override: true });

import { db, getRedisClient, IPORepository, FinancialDataRepository } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import {
  extractFinancialsFromDetailHtml,
  extractPeersFromDetailHtml,
  extractObjectivesFromDetailHtml,
} from '../src/scrapers/chittorgarh-detail-fields.js';
import {
  createFinancialData,
  createPeerCompanies,
  updateIPOObjectives,
} from '../src/services/data-persister.js';
import { PeerCompanyRepository } from '../src/repositories/peer-company-repository.js';
import type { ScrapedPeerCompany } from '../src/scrapers/peer-companies-scraper.js';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;

const FISCAL_YEARS = [
  { year: 2026, range: '2026-27' },
  { year: 2025, range: '2025-26' },
  { year: 2024, range: '2024-25' },
  { year: 2023, range: '2023-24' },
  { year: 2022, range: '2022-23' },
  { year: 2021, range: '2021-22' },
  { year: 2020, range: '2020-21' },
];

interface DiscoveryEntry {
  slug: string;
  id: string;
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
    if (!r.ok) {
      logger.warn({ slug, id, status: r.status }, 'detail HTTP error');
      return null;
    }
    return await r.text();
  } catch (err) {
    logger.warn({ slug, id, error: err instanceof Error ? err.message : String(err) }, 'detail fetch failed');
    return null;
  }
}

/** Retry a DB read a few times — the shared pool's 2s connect timeout can clip a cold tunnel. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      logger.warn({ attempt: i + 1, error: err instanceof Error ? err.message : String(err) }, 'DB read failed, retrying');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

async function main() {
  const redis = getRedisClient();
  const ipoRepo = new IPORepository(db, redis);
  const finRepo = new FinancialDataRepository(db, redis);
  const peerRepo = new PeerCompanyRepository(db);

  console.log('='.repeat(80));
  console.log(`C3b FINANCIALS BACKFILL (Chittorgarh detail via report-118 discovery) — ${APPLY ? 'APPLY' : 'DRY-RUN'}${FORCE ? ' --force' : ''}`);
  console.log('='.repeat(80));

  // 1. DB reads FIRST (while the SSH tunnel is fresh — the shared pool's 2s
  //    connect timeout is too tight to survive the multi-second discovery idle
  //    gap, so read before fetching). withRetry covers a cold first connection.
  const ipos = await withRetry(() =>
    db
      .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, sector: schema.ipos.sector, objectives: schema.ipos.objectives })
      .from(schema.ipos)
      .where(eq(schema.ipos.offeringType, 'IPO'))
  );

  const finRows = await withRetry(() => db.select({ ipoId: schema.financialData.ipoId }).from(schema.financialData));
  const peerRows = await withRetry(() => db.selectDistinct({ ipoId: schema.peerCompanies.ipoId }).from(schema.peerCompanies));
  const haveFin = new Set(finRows.map((r) => r.ipoId));
  const havePeers = new Set(peerRows.map((r) => r.ipoId));
  const haveObjectives = (o: unknown) => Array.isArray(o) && o.length > 0;

  console.log(`genuine IPOs: ${ipos.length} | with financial_data: ${haveFin.size} | with peers: ${havePeers.size}`);

  // 2. Build normalizedName -> {slug,id} discovery map from report 118.
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
        if (key && !discovery.has(key)) {
          discovery.set(key, { slug, id });
          added++;
        }
      }
      logger.info({ fy: fy.range, rows: rows.length, added }, 'report 118 page fetched');
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      logger.warn({ fy: fy.range, error: err instanceof Error ? err.message : String(err) }, 'report 118 fetch failed (continuing)');
    }
  }
  console.log(`discovery map (name -> detail url): ${discovery.size} IPOs`);

  // 3. Candidates: matched to discovery AND missing >=1 payload (or --force).
  const candidates = ipos
    .map((c) => ({ ...c, disc: discovery.get(normalizeCompanyNameForMatching(c.companyName)) }))
    .filter((c): c is typeof c & { disc: DiscoveryEntry } => !!c.disc)
    .filter((c) => FORCE || !haveFin.has(c.id) || !havePeers.has(c.id) || !haveObjectives(c.objectives));
  console.log(`matched to a detail URL and missing >=1 payload: ${candidates.length}`);

  // 4. Fetch detail + extract + plan/write.
  const stats = { fetched: 0, fin: 0, peers: 0, objectives: 0, noData: 0, failed: 0 };
  const samples: string[] = [];

  for (const c of candidates) {
    if (stats.fetched >= LIMIT) break;
    stats.fetched++;
    const html = await fetchDetailHtml(c.disc.slug, c.disc.id);
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 600)); // rate limit
    if (!html) {
      stats.noData++;
      continue;
    }

    const fin = extractFinancialsFromDetailHtml(html);
    const objectives = extractObjectivesFromDetailHtml(html);
    const peersRaw = extractPeersFromDetailHtml(html);
    // Drop the IPO's own row from the peer table (it is the subject, not a peer).
    const selfKey = normalizeCompanyNameForMatching(c.companyName);
    const peers = peersRaw.filter((p) => normalizeCompanyNameForMatching(p.companyName) !== selfKey);

    const willFin = (FORCE || !haveFin.has(c.id)) && fin != null;
    const willPeers = (FORCE || !havePeers.has(c.id)) && peers.length > 0;
    const willObj = (FORCE || !haveObjectives(c.objectives)) && objectives.length > 0;

    if (!willFin && !willPeers && !willObj) {
      stats.noData++;
      continue;
    }

    if (samples.length < 12) {
      const bits = [
        willFin ? `fin(${Object.keys(fin!).length}f netWorth=${fin!.netWorth ?? '-'} eps=${fin!.eps ?? '-'} pe=${fin!.peRatio ?? '-'})` : '',
        willPeers ? `peers(${peers.length})` : '',
        willObj ? `obj(${objectives.length})` : '',
      ].filter(Boolean).join(' ');
      samples.push(`  - ${c.companyName} -> ${bits}  (/ipo/${c.disc.slug}/${c.disc.id}/)`);
    }

    if (!APPLY) {
      if (willFin) stats.fin++;
      if (willPeers) stats.peers++;
      if (willObj) stats.objectives++;
      continue;
    }

    try {
      if (willFin) {
        await createFinancialData(finRepo, { ipoId: c.id, ...fin! });
        stats.fin++;
      }
      if (willObj) {
        await updateIPOObjectives(ipoRepo, c.id, objectives);
        stats.objectives++;
      }
      if (willPeers) {
        const mapped: ScrapedPeerCompany[] = peers.map((p) => ({
          companyName: p.companyName,
          symbol: null,
          sector: c.sector ?? '',
          isListed: true, // peer-group companies are listed comparables
          peRatio: p.peRatio,
          eps: p.eps,
          dilutedEps: p.dilutedEps,
          ronw: p.ronw,
          nav: p.nav,
          dataSource: 'CHITTORGARH',
        }));
        await createPeerCompanies(peerRepo, c.id, mapped);
        stats.peers++;
      }
      logger.info({ company: c.companyName, fin: willFin, peers: willPeers ? peers.length : 0, objectives: willObj ? objectives.length : 0 }, 'C3b payload written');
    } catch (err) {
      stats.failed++;
      logger.error({ company: c.companyName, error: err instanceof Error ? err.message : String(err) }, 'C3b write failed');
    }
  }

  console.log(`\nSample plans:`);
  for (const s of samples) console.log(s);
  console.log(`\nfetched=${stats.fetched} | financial_data=${stats.fin} | peers=${stats.peers} | objectives=${stats.objectives} | no-usable-data=${stats.noData} | failed=${stats.failed}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN: nothing written. Re-run with --apply.`);
  } else {
    console.log(`\nAPPLY complete.`);
  }
  console.log('='.repeat(80));
  process.exit(stats.failed > stats.fin + stats.peers + stats.objectives ? 1 : 0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'C3b financials backfill crashed');
  console.error(e);
  process.exit(1);
});
