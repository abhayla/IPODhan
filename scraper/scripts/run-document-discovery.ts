/**
 * T-403 acceptance harness — runs the REAL discovery runner against the REAL
 * exchange APIs, twice, and writes the evidence.
 *
 * TWO MODES, AND ONLY ONE OF THEM IS EVIDENCE
 * -------------------------------------------
 * `--db` is the mode that counts. It persists through the real
 * `DocumentFetchStateRepository` into a Postgres whose name must end in `_test`
 * (`assertTestDatabase`), writes the source hints through the real
 * `recordDocumentSourceHints`, and finishes by reading the result back out with
 * SQL via `scripts/readback-document-state.ts`. Everything the pipeline claims
 * is then checkable in the database rather than in this process's memory.
 *
 * Without `--db` the same decision logic runs against the same live hosts with
 * an in-memory store. That mode exists so the chain can be exercised with no
 * database at all; it proves nothing about persistence, the migration, or the
 * constraints, and its output must never be presented as if it did.
 *
 * WHY THE IPO LIST IS LITERAL EITHER WAY
 * -------------------------------------
 * The four acceptance IPOs are pinned here (`status`, `segment` and the dates
 * are the values read from a restored prod dump on 2026-08-28) so the run is
 * reproducible against a fixed set rather than against whatever the database
 * happens to hold that day. In `--db` mode each one is resolved to its real
 * `ipos.id` by company name, because the state table has a foreign key to it.
 *
 * Usage (from scraper/):
 *   npx tsx scripts/run-document-discovery.ts
 *   npx tsx scripts/run-document-discovery.ts --no-download   (skip PDFs)
 *   DATABASE_URL=... npx tsx scripts/run-document-discovery.ts --db
 *   npx tsx scripts/run-document-discovery.ts --evidence-dir=path/to/dir
 *   DATABASE_URL=... npx tsx scripts/run-document-discovery.ts --db --reset
 *   DATABASE_URL=... npx tsx scripts/run-document-discovery.ts --db --ipos=PERNIASPOP   (T-433)
 *
 * `--ipos <symbol|name,...>` (T-433) replaces the four hardcoded acceptance
 * IPOs with real row(s) loaded from `DATABASE_URL`'s `ipos` table, one per
 * comma-separated selector, matched by `symbol = selector OR company_name
 * ILIKE '%selector%'`. Requires `--db`. Without `--ipos` nothing changes —
 * the four-IPO acceptance fixture below stays the default.
 *
 * `--db` swaps the in-memory store for the real `DocumentFetchStateRepository`
 * against `DATABASE_URL`. It requires the four acceptance IPO rows to exist
 * there (matched by company name) and the journal to have been replayed.
 * `--reset` clears those four IPOs' state and document rows first, so "run 1"
 * is a genuine first run — without it the persistent state table makes run 1
 * cost zero calls and the run-2 assertions pass vacuously.
 *
 * EXERCISED: yes, against `ipodhan_test` after replaying the journal into an
 * empty schema. See evidence/T-403/db-run/ and its README for what that run
 * does and does not prove.
 *
 * `assertTestDatabase` refuses any --db write unless the database name ends in
 * `_test`: this harness INSERTs and, with --reset, DELETEs, and `scraper/.env`
 * points DATABASE_URL at the production host.
 */

import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  EXCHANGE_FAILURE_OUTCOMES,
  DocumentDiscoveryRunner,
  defaultFetcher,
  toStateRow,
  type DiscoveryIpo,
  type IpoRunResult,
} from '../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../src/services/in-memory-document-fetch-state-store.js';
import { DocumentFetchStateRepository } from '@ipodhan/shared/repositories/document-fetch-state-repository';
import {
  recordDocumentSourceHints,
  type DocumentSourceHintWriter,
} from '../src/services/data-persister.js';
import { readback } from './readback-document-state.js';
import { NetworkCounter } from '../src/utils/network-counter.js';
import { deriveLifecycleStage } from '../src/scheduler/stage-reconciler.js';

/**
 * The four acceptance IPOs. `status`, `segment` and the dates are the values
 * read from `ipodhan_wpab` (restored prod dump of 2026-08-28) at 12:20 IST,
 * before the host went down. `stage` is derived from those dates against the run
 * date, exactly as `deriveLifecycleStage` would.
 */
const ACCEPTANCE_IPOS: (DiscoveryIpo & { dbStatus: string; closeDate: string; accId: string })[] = [
  {
    id: 'acc-skyways',
    accId: 'acc-skyways',
    companyName: 'Skyways Air Services Ltd.',
    symbol: 'SKYWAYS',
    segment: 'MAINBOARD',
    // Closed 27 Aug IST. CLOSED makes the final Prospectus due — the S4 path.
    stage: 'CLOSED',
    dbStatus: 'OPEN',
    closeDate: '2026-08-27',
    // Skyways has already LEFT the BSE board (it lists only live and forthcoming
    // issues), so without a remembered IPO_NO its core payload is unreachable.
    // 7903 is the value the board carried while it was still live.
    bseIpoNo: 7903,
  },
  {
    id: 'acc-madhurknit',
    accId: 'acc-madhurknit',
    companyName: 'Madhur Knit Crafts Ltd.',
    symbol: 'MADHURKNIT',
    segment: 'SME',
    stage: 'CLOSED',
    dbStatus: 'OPEN',
    closeDate: '2026-08-27',
    bseIpoNo: null, // SME is never on the BSE mainboard board (F13)
  },
  {
    id: 'acc-esds',
    accId: 'acc-esds',
    companyName: 'ESDS Software Solution Limited',
    symbol: 'ESDS',
    segment: 'MAINBOARD',
    // Opens 28 Aug; the band is published, so PRE_OPEN. NOTE: the contract
    // expected the anchor report to be NOT_YET_FILED here, but anchor day was
    // 27 Aug and NSE was already serving ANCHOR_ESDS.zip when this ran — see A4.
    stage: 'PRE_OPEN',
    dbStatus: 'UPCOMING',
    closeDate: '2026-09-01',
    bseIpoNo: null, // still on the board, so it resolves by name
    // Read from Chittorgarh's live mainboard list on 2026-08-28 — the same page
    // the Chittorgarh orchestrator scrapes in production, which is what puts
    // this value in `ipos.verifier_url`. Used ONLY to check which exchange URL
    // is the right one; a document is never stored from this host.
    verifierUrl: 'https://www.chittorgarh.com/ipo/esds-software-ipo/1198/',
  },
  {
    id: 'acc-deepa',
    accId: 'acc-deepa',
    companyName: 'Deepa Jewellers Ltd.',
    symbol: null, // no NSE symbol in our data yet
    segment: 'MAINBOARD',
    stage: 'UPCOMING',
    dbStatus: 'UPCOMING',
    closeDate: '2026-09-03',
    bseIpoNo: null,
    verifierUrl: 'https://www.chittorgarh.com/ipo/deepa-jewellers-ipo/2827/',
  },
];

/** Hosts that are NOT an exchange. A call to one of these is a FALLBACK call. */
const EXCHANGE_HOSTS = ['api.bseindia.com', 'www.nseindia.com', 'nsearchives.nseindia.com', 'listing.bseindia.com', 'www.bseindia.com'];

interface RunEvidence {
  run: number;
  startedAt: string;
  results: IpoRunResult[];
  network: ReturnType<NetworkCounter['toJSON']>;
  fallbackCalls: number;
  stateTable: unknown[];
}

/**
 * The state store for this run: the real repository when `--db` is given,
 * otherwise in-memory. `--db` also resolves each acceptance IPO to its real
 * `ipos.id`, because the state table has a foreign key to it — the literal ids
 * used in memory would violate it.
 */
/**
 * Refuse to run --db against anything that is not an obvious test database
 * (T-403 M-5).
 *
 * This harness INSERTS state rows and, with --reset, DELETEs them. `scraper/.env`
 * points DATABASE_URL at the PRODUCTION Postgres host, so a stray `--db` in the
 * wrong shell was one keystroke from writing to prod — the exact incident class
 * `tests/helpers/db-safety-guard.ts` exists for (GitHub #163). The check is on
 * EVERY --db write, not only --reset: an INSERT into prod is not acceptable
 * either.
 *
 * Deliberately fail-closed and name-based: an unparseable URL, or one whose
 * database name does not end in `_test`, is refused rather than interpreted.
 */
export function assertTestDatabase(databaseUrl: string): void {
  let dbName: string;
  try {
    dbName = new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error('--db refused: DATABASE_URL is not parseable, so the target cannot be confirmed');
  }
  if (!/_test$/i.test(dbName)) {
    throw new Error(
      `--db refused: database "${dbName}" does not end in _test. ` +
        'This harness writes (and with --reset deletes) rows; it will only ever ' +
        'do that against an obvious test database.'
    );
  }
}

/**
 * T-433: one row of `ipos` as returned by the `--ipos <symbol|name,...>`
 * selector query — the columns the acceptance-fixture shape (`DiscoveryIpo`
 * + `dbStatus`/`closeDate`/`accId`) is built from.
 */
export interface IposSelectorRow {
  id: string;
  companyName: string;
  symbol: string | null;
  segment: string | null;
  status: string;
  priceRangeMin: number | string | null;
  closeDate: string | null;
  bseIpoNo: number | null;
  companyWebsite: string | null;
  verifierUrl: string | null;
}

/** A selector's row-fetch: `symbol = selector OR company_name ILIKE '%'||selector||'%'`. */
export type IposSelectorQuery = (selector: string) => Promise<IposSelectorRow[]>;

/**
 * T-433: resolve `--ipos <symbol|name,...>` selectors to real `ipos` rows, in
 * the same literal shape `ACCEPTANCE_IPOS` uses, so the rest of this harness
 * (which is written against that shape) needs no other change. Pulled out as
 * a pure function of an injectable query so it is unit-testable with a mock —
 * no live DB required.
 */
export async function resolveIposFromSelectors(
  selectors: string[],
  query: IposSelectorQuery
): Promise<(DiscoveryIpo & { dbStatus: string; closeDate: string; accId: string })[]> {
  if (selectors.length === 0) {
    throw new Error('--ipos requires at least one symbol or name, comma-separated');
  }
  const out: (DiscoveryIpo & { dbStatus: string; closeDate: string; accId: string })[] = [];
  for (const selector of selectors) {
    const rows = await query(selector);
    if (rows.length === 0) {
      throw new Error(
        `--ipos: no ipos row matched "${selector}" (symbol = or company_name ILIKE '%${selector}%')`
      );
    }
    const row = rows[0];
    out.push({
      id: row.id,
      accId: row.id,
      companyName: row.companyName,
      symbol: row.symbol,
      segment: row.segment,
      stage: deriveLifecycleStage({ status: row.status, priceRangeMin: row.priceRangeMin }),
      dbStatus: row.status,
      closeDate: row.closeDate ?? '',
      bseIpoNo: row.bseIpoNo,
      companyWebsite: row.companyWebsite,
      verifierUrl: row.verifierUrl,
    });
  }
  return out;
}

/** Real Postgres-backed `IposSelectorQuery`, used by `main()` for a live `--ipos` run. */
async function makeDbIposSelectorQuery(databaseUrl: string): Promise<{
  query: IposSelectorQuery;
  close: () => Promise<void>;
}> {
  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const schema = await import('@ipodhan/shared/db/schema');
  const { sql } = await import('drizzle-orm');
  const pool = new Pool({ connectionString: databaseUrl, max: 2, options: '-c timezone=UTC' });
  const db = drizzle(pool, { schema });
  return {
    query: async (selector: string) => {
      const found = await db.execute(
        sql`SELECT id, company_name, symbol, segment, status, price_range_min, close_date,
                   bse_ipo_no, company_website, verifier_url
            FROM ipos
            WHERE symbol = ${selector} OR company_name ILIKE ${'%' + selector + '%'}
            LIMIT 1`
      );
      const rows = (found as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
      return rows.map((r) => ({
        id: String(r.id),
        companyName: String(r.company_name),
        symbol: (r.symbol as string | null) ?? null,
        segment: (r.segment as string | null) ?? null,
        status: String(r.status),
        priceRangeMin: (r.price_range_min as number | string | null) ?? null,
        closeDate: r.close_date ? String(r.close_date) : null,
        bseIpoNo: (r.bse_ipo_no as number | null) ?? null,
        companyWebsite: (r.company_website as string | null) ?? null,
        verifierUrl: (r.verifier_url as string | null) ?? null,
      }));
    },
    close: async () => {
      await pool.end();
    },
  };
}

async function makeStore(useDb: boolean): Promise<{
  store: InMemoryDocumentFetchStateStore | DocumentFetchStateRepository;
  documents: { upsertDocument: (doc: never) => Promise<{ id: string }> } | null;
  /**
   * H-1: the real `recordDocumentSourceHints` write path, or null in memory
   * mode. Present so the harness EXERCISES the hint write rather than asserting
   * about a code path it never runs — `ipos.verifier_url` was NULL for every IPO
   * in production and no acceptance run noticed, because none of them wrote one.
   */
  hintWriter: DocumentSourceHintWriter | null;
  dump: () => Promise<unknown[]>;
  close: () => Promise<void>;
}> {
  if (!useDb) {
    const store = new InMemoryDocumentFetchStateStore();
    return {
      store,
      documents: null,
      hintWriter: null,
      dump: async () => store.all(),
      close: async () => undefined,
    };
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('--db requires DATABASE_URL');
  assertTestDatabase(url);

  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const schema = await import('@ipodhan/shared/db/schema');
  const { sql } = await import('drizzle-orm');

  const pool = new Pool({ connectionString: url, max: 4, options: '-c timezone=UTC' });
  const db = drizzle(pool, { schema });
  const store = new DocumentFetchStateRepository(db as never, {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 0,
    keys: async () => [],
  } as never);

  // Resolve each acceptance IPO to its real row; the FK makes the literal ids unusable.
  for (const ipo of ACCEPTANCE_IPOS) {
    const found = await db.execute(
      sql`SELECT id FROM ipos WHERE company_name = ${ipo.companyName} LIMIT 1`
    );
    const rows = ((found as unknown as { rows?: { id: string }[] }).rows ?? []);
    if (rows.length === 0) {
      throw new Error(
        `--db: no ipos row for ${ipo.companyName}. Seed the four acceptance rows first.`
      );
    }
    ipo.id = rows[0].id;
  }

  // The REAL documents writer in --db mode.
  //
  // Until r5 this was a hand-rolled raw INSERT, because `DocumentRepository`
  // could not run against a journal-built `documents` table: the journal created
  // EIGHT of the nineteen columns `schema.ts` declares, and the repository's
  // SELECT died on `media_type`. Migration 0037 repairs that one table, so the
  // acceptance run now writes documents through the SAME repository the
  // production cycle uses — which is what makes this run evidence about the
  // shipped write path rather than about a stand-in that resembles it.
  const { DocumentRepository } = await import('@ipodhan/shared/repositories');
  const documents = new DocumentRepository(db as never, {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 0,
    keys: async () => [],
  } as never);

  // --reset clears ONLY these four IPOs' state and document rows, so "run 1" is a
  // genuine first run. Without it the state table remembers the previous run and
  // run 1 legitimately costs zero calls — which would make A6/A7 pass vacuously.
  if (process.argv.includes('--reset')) {
    for (const ipo of ACCEPTANCE_IPOS) {
      await db.execute(sql`DELETE FROM document_fetch_state WHERE ipo_id = ${ipo.id}::uuid`);
      await db.execute(sql`DELETE FROM documents WHERE ipo_id = ${ipo.id}::uuid`);
    }
  }

  /**
   * The REAL repository, for the real write path (H-1).
   *
   * An earlier cut of this used raw SQL here, because `IPORepository.update`
   * cannot run against a journal-built `ipos`. The write ratchet caught that
   * immediately and correctly: it put a new `ipos` writer outside the shared
   * write path, which is the precise thing the ratchet exists to stop. The fix
   * belonged in the repository — `updateDocumentSourceHints` writes the two
   * columns and returns only the id — not in a stand-in here.
   */
  const { IPORepository } = await import('@ipodhan/shared/repositories');
  const hintWriter = new IPORepository(db as never, {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 0,
    keys: async () => [],
  } as never) as unknown as DocumentSourceHintWriter;

  return {
    store,
    documents: documents as never,
    hintWriter,
    dump: async () => {
      const out: unknown[] = [];
      for (const ipo of ACCEPTANCE_IPOS) out.push(...(await store.listForIpo(ipo.id)));
      return out;
    },
    close: async () => {
      await pool.end();
    },
  };
}

/** The stable `acc-*` key for a company, so evidence file names never change. */
function stableIdFor(companyName: string): string {
  return ACCEPTANCE_IPOS.find((i) => i.companyName === companyName)?.accId ?? 'unknown';
}

async function runOnce(
  run: number,
  store: InMemoryDocumentFetchStateStore | DocumentFetchStateRepository,
  realDocuments: { upsertDocument: (doc: never) => Promise<{ id: string }> } | null,
  dump: () => Promise<unknown[]>,
  download: boolean,
  storeDir: string
): Promise<RunEvidence> {
  const counter = new NetworkCounter();
  const documents = realDocuments ?? {
    rows: [] as Record<string, unknown>[],
    async upsertDocument(doc: Record<string, unknown>) {
      (this.rows as Record<string, unknown>[]).push(doc);
      // A UUID, not 'doc-1': document_fetch_state.document_id is uuid-typed, so
      // an obviously-fake id would only fail once a real database is behind it.
      return { id: randomUUID() };
    },
  };

  const runner = new DocumentDiscoveryRunner({
    fetcher: defaultFetcher,
    store,
    documents: documents as never,
    counter,
    storeDir,
    skipDownload: !download,
  });

  const startedAt = new Date().toISOString();
  const results: IpoRunResult[] = [];
  for (const ipo of ACCEPTANCE_IPOS) {
    const rows = (await store.listForIpo(ipo.id)).map(toStateRow);
    results.push(await runner.runIpo(ipo, rows));
  }

  const network = counter.toJSON();
  const fallbackCalls = network.calls.filter((c) => !EXCHANGE_HOSTS.includes(c.host)).length;

  return {
    run,
    startedAt,
    results,
    network,
    fallbackCalls,
    stateTable: (await dump()).map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        ipoId: r.ipoId,
        docType: r.docType,
        state: r.state,
        attempts: r.attempts,
        nextRetryAt: r.nextRetryAt,
        documentId: r.documentId,
      };
    }),
  };
}

async function main(): Promise<void> {
  const download = !process.argv.includes('--no-download');
  // NIT-1: no machine-specific absolute path. The env var is the real control;
  // the fallback is relative to the repo so this runs anywhere.
  const storeDir =
    process.env.PROSPECTUS_STORE_DIR ?? join(process.cwd(), '..', '.prospectus-acceptance');
  // V7: never silently overwrite a previous run's evidence. Each run gets its
  // own timestamped directory unless one is named explicitly.
  const dirArg = process.argv.find((a) => a.startsWith('--evidence-dir='));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = dirArg
    ? dirArg.slice('--evidence-dir='.length)
    : join(process.cwd(), '..', 'evidence', 'T-403', `run-${stamp}`);
  mkdirSync(evidenceDir, { recursive: true });

  const useDb = process.argv.includes('--db');

  // T-433: `--ipos <symbol|name,...>` swaps the hardcoded 4-IPO
  // ACCEPTANCE_IPOS fixture for real row(s) loaded from the target DB, by
  // symbol or ILIKE company-name match. Default (no `--ipos`) behavior — the
  // T-403 acceptance fixture — is unchanged.
  const iposFlag = process.argv.find((a) => a.startsWith('--ipos='));
  const iposMode = Boolean(iposFlag);
  if (iposMode) {
    if (!useDb) throw new Error('--ipos requires --db (the IPO list is loaded from the target DB)');
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('--ipos requires DATABASE_URL');
    assertTestDatabase(url);
    const selectors = iposFlag!
      .slice('--ipos='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const { query, close: closeSelectorQuery } = await makeDbIposSelectorQuery(url);
    try {
      const resolved = await resolveIposFromSelectors(selectors, query);
      ACCEPTANCE_IPOS.splice(0, ACCEPTANCE_IPOS.length, ...resolved);
    } finally {
      await closeSelectorQuery();
    }
  }

  const { store, documents: realDocuments, hintWriter, dump, close } = await makeStore(useDb);

  console.log('=== T-403 acceptance run 1 (discovery) ===');
  const run1 = await runOnce(1, store, realDocuments, dump, download, storeDir);

  // H-1: write the source hints through the REAL `recordDocumentSourceHints`,
  // between the runs — which is also when production writes them. Two sources:
  // the issuer website the runner read off a filing cover, and the verifier page
  // the Chittorgarh orchestrator supplies. Doing this here is what makes the
  // readback's `company_website` / `verifier_url` columns mean something; the
  // previous rounds asserted about a rung whose input no code ever populated.
  if (hintWriter) {
    for (const ipo of ACCEPTANCE_IPOS) {
      const learned = run1.results.find((r) => r.ipoId === ipo.id)?.learnedCompanyWebsite;
      if (!learned && !ipo.verifierUrl) continue;
      try {
        await recordDocumentSourceHints(hintWriter, ipo.id, {
          companyWebsite: learned ?? null,
          verifierUrl: ipo.verifierUrl ?? null,
        });
        console.log(
          `  hints written for ${ipo.companyName}: website=${learned ?? '-'} verifier=${ipo.verifierUrl ?? '-'}`
        );
      } catch (error) {
        console.error(
          `  hint write FAILED for ${ipo.companyName}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  console.log('=== T-403 acceptance run 2 (must cost ZERO calls for found IPOs) ===');
  const run2 = await runOnce(2, store, realDocuments, dump, download, storeDir);
  console.log('=== T-403 acceptance run 3 (must be a pure skip — convergence) ===');
  const run3 = await runOnce(3, store, realDocuments, dump, download, storeDir);

  for (const evidence of [run1, run2, run3]) {
    writeFileSync(
      join(evidenceDir, `run-${evidence.run}-network-calls.json`),
      JSON.stringify(evidence.network, null, 2)
    );
    writeFileSync(
      join(evidenceDir, `run-${evidence.run}-state-table.json`),
      JSON.stringify(evidence.stateTable, null, 2)
    );
    for (const result of evidence.results) {
      writeFileSync(
        join(evidenceDir, `run-${evidence.run}-attempts-${stableIdFor(result.companyName)}.json`),
        JSON.stringify(result, null, 2)
      );
    }
  }

  // The acceptance assertions, evaluated here so the harness itself reports
  // pass/fail rather than leaving it to a human reading json.
  // Matched by COMPANY NAME, not id: in --db mode each acceptance IPO's id is
  // replaced with its real `ipos.id`, so an id lookup silently returns undefined.
  // T-433: the fixed A1-A9 checks below are literal to the 4-IPO acceptance
  // fixture (hardcoded accIds/company names). In `--ipos` mode the resolved
  // IPO(s) are arbitrary, so a generic per-IPO check set is built instead —
  // see the `else` branch below.
  let checks: { id: string; name: string; pass: boolean; detail: string }[];
  if (!iposMode) {
  const find = (e: RunEvidence, accId: string) => {
    const wanted = ACCEPTANCE_IPOS.find((i) => i.id === accId || i.accId === accId);
    return e.results.find((r) => r.companyName === wanted?.companyName)!;
  };
  const skyways1 = find(run1, 'acc-skyways');
  const madhur1 = find(run1, 'acc-madhurknit');
  const esds1 = find(run1, 'acc-esds');
  const skyways2 = find(run2, 'acc-skyways');
  const madhur2 = find(run2, 'acc-madhurknit');

  checks = [
    {
      id: 'A1',
      name: 'Skyways: >=4 documents typed RHP/CORRIGENDUM/ADDENDUM/PRICE_BAND_AD',
      pass:
        skyways1.found.length >= 4 &&
        ['RHP', 'CORRIGENDUM', 'ADDENDUM', 'PRICE_BAND_AD'].every((t) =>
          skyways1.found.includes(t as never)
        ),
      detail: skyways1.found.join(', '),
    },
    {
      id: 'A2',
      // F-2: this used to say "from the BSE payload" and fail whenever BSE was
      // down — which it was on 2026-08-28, even though NSE's payload listed the
      // same three firms and the run had them in memory. An acceptance check
      // that fails on one source's outage is testing the weather, not the code.
      // What is under test is that all THREE book running lead managers are
      // captured (the co-BRLM undercount, F17), from whichever exchange answered.
      name: 'Skyways: all 3 book running lead managers captured (from whichever exchange answered)',
      pass: skyways1.leadManagers.length === 3,
      detail: `${skyways1.leadManagers.join(' | ')} (source: ${skyways1.leadManagerSource ?? 'none'})`,
    },
    {
      id: 'A3',
      name: 'Madhur (SME): documents discovered from NSE',
      pass: madhur1.found.length > 0,
      detail: madhur1.found.join(', '),
    },
    {
      id: 'A4',
      // The contract expected ESDS's ANCHOR report to be NOT_YET_FILED. That was
      // factually wrong: ESDS opened 28 Aug, so its anchor round was 27 Aug and
      // NSE was already serving ANCHOR_ESDS.zip.
      //
      // What IS under test is the F3-vs-F6 distinction, and it is asserted in
      // BOTH directions so the check does not depend on BSE's mood on the day:
      //   every consulted exchange answered -> missing types are NOT_YET_FILED,
      //                                        and nothing is BLOCKED_ALL;
      //   an exchange FAILED               -> nothing may be called NOT_YET_FILED
      //                                        (we have no evidence it is unfiled),
      //                                        and the missing types are BLOCKED_ALL.
      // Round 1 got the second branch wrong, which is why it is pinned here.
      name: 'ESDS: F3 vs F6 — NOT_YET_FILED only when every consulted exchange answered',
      pass: (() => {
        const exchangeCalls = esds1.attempts.filter(
          (a) => (a.source === 'BSE' || a.source === 'NSE') && (!a.url || !/.(pdf|zip)/i.test(a.url))
        );
        // r5: `outcome !== 'ok'` was WRONG, and it passed for four rounds only
        // because ESDS happened to still be on the BSE board every time this ran.
        // The moment it closed and BSE dropped it, `not_on_board` was read as a
        // FAILURE and the check demanded BLOCKED_ALL rows for a day on which
        // nothing failed. The runner has always used EXCHANGE_FAILURE_OUTCOMES
        // for exactly this distinction (matrix section 9: `not_on_board` and
        // `no_symbol` are neither an answer nor a failure — that exchange does
        // not carry this issue); the check now uses the same set, from the same
        // module, instead of a second definition that could drift.
        const anyFailed = exchangeCalls.some((a) =>
          EXCHANGE_FAILURE_OUTCOMES.includes(a.outcome)
        );
        return anyFailed
          ? esds1.notYetFiled.length === 0 && esds1.blocked.length > 0
          : esds1.notYetFiled.length > 0 && esds1.blocked.length === 0;
      })(),
      detail: `not_yet=[${esds1.notYetFiled.join(', ')}] blocked=[${esds1.blocked.join(', ')}] found=[${esds1.found.join(', ')}] exchanges=${esds1.attempts
        .filter((a) => (a.source === 'BSE' || a.source === 'NSE') && (!a.url || !/.(pdf|zip)/i.test(a.url)))
        .map((a) => `${a.source}:${a.outcome}`)
        .join(',')}`,
    },
    {
      id: 'A5',
      // This used to assert ZERO non-exchange calls, which was asserting the
      // B-1 BUG: the chain never escalated, so SEBI was never called and the
      // check passed for the wrong reason. The real contract is narrower: a rung
      // beyond the exchanges is consulted ONLY for a type the exchanges did not
      // settle, and no document host outside the exchanges + SEBI is ever used.
      // F-2: asserted PER TYPE, from the rung chains — not from the set of
      // hosts the run happened to touch. The host-list form failed the moment
      // BSE went down for one IPO, because then EVERY type legitimately
      // escalated and the issuer's own host legitimately appeared. That is the
      // chain working, and the check called it a failure.
      //
      // The invariant that actually holds in every weather: a type the
      // exchanges SETTLED must show only skips after the exchange rung, and a
      // type they did NOT settle must have gone on to a later rung.
      name: 'Fallback rungs are consulted for exactly the types the exchanges did not settle',
      pass: (() => {
        const rungLines = run1.results.flatMap((r) =>
          r.attempts.filter((a) => a.source === 'CHAIN').map((a) => a.outcome)
        );
        const settledButEscalated = rungLines.filter(
          (line) =>
            line.includes('exchanges_settled_it') &&
            /(?:SEBI|COMPANY|VERIFIER):(?!skipped)/.test(line)
        );
        // The converse: a line that did NOT settle must record all three later
        // rungs (found, failed, or an explicit skip reason) — never silence.
        const unsettledWithoutRungs = rungLines.filter(
          (line) =>
            !line.includes('exchanges_settled_it') &&
            !(line.includes('SEBI:') && line.includes('COMPANY:') && line.includes('VERIFIER:')) &&
            !line.includes(':found')
        );
        return (
          settledButEscalated.length === 0 && unsettledWithoutRungs.length === 0 && rungLines.length > 0
        );
      })(),
      detail: (() => {
        const rungLines = run1.results.flatMap((r) =>
          r.attempts.filter((a) => a.source === 'CHAIN').map((a) => a.outcome)
        );
        const settled = rungLines.filter((l) => l.includes('exchanges_settled_it')).length;
        const escalated = rungLines.length - settled;
        const nonExchangeHosts = Object.keys(run1.network.byHost).filter(
          (h) => !EXCHANGE_HOSTS.includes(h)
        );
        return `types settled by exchanges=${settled} escalated=${escalated} non-exchange hosts=[${nonExchangeHosts.join(', ')}]`;
      })(),
    },
    {
      id: 'A8',
      // The signal that exposed the multi-member-zip defect: two different
      // document types stored with an identical sha256, because the unwrapper
      // took whichever PDF came first out of a 3-PDF archive.
      // Two types CAN legitimately be the same filing: Skyways' BSE price-band
      // advertisement and NSE's 'Ratios / Basis of Issue Price' are byte-identical
      // (6,585,368 bytes). E7/R2 says that is ONE document with two URLs, so the
      // correct outcome is one file on disk plus a deduped_by_sha256 attempt —
      // never two copies of the same bytes under two names. Asserted against the
      // actual STORE, not against the log, because the store is what the
      // extractor will read.
      name: 'No IPO holds the same bytes on disk under two document types (E7/R2)',
      pass: (() => {
        // V5: this used to return true under --no-download, so the check
        // passed while asserting nothing. It now fails loudly instead of
        // pretending — a vacuous PASS is worse than an honest FAIL.
        if (!download) return false;
        const anyFiles = ACCEPTANCE_IPOS.some((ipo) =>
          existsSync(join(storeDir, ipo.id)) &&
          readdirSync(join(storeDir, ipo.id)).some((f) => f.endsWith('.pdf'))
        );
        if (!anyFiles) return false; // nothing stored means nothing was proven
        return ACCEPTANCE_IPOS.every((ipo) => {
          const dir = join(storeDir, ipo.id);
          if (!existsSync(dir)) return true;
          const shas = readdirSync(dir)
            .filter((f) => f.endsWith('.pdf'))
            .map((f) => f.replace(/.pdf$/, '').split('-').pop());
          return new Set(shas).size === shas.length;
        });
      })(),
      detail: (download ? '' : 'SKIPPED-VACUOUS: --no-download stores no files, so this check cannot pass. ') +
        ACCEPTANCE_IPOS.map((ipo) => {
        const dir = join(storeDir, ipo.id);
        const n = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.pdf')).length : 0;
        const deduped = find(run1, ipo.id).attempts.filter(
          (a) => typeof a.outcome === 'string' && a.outcome.startsWith('deduped_by_sha256')
        ).length;
        return `${ipo.id}: ${n} file(s), ${deduped} deduped`;
        }).join(' | '),
    },
    {
      id: 'A6',
      // The contract is ZERO NETWORK CALLS, and that is what is asserted.
      // `skipped` is not the same claim: after run 1 finds an RHP, run 2 has one
      // piece of bookkeeping left — marking the superseded DRHP (F-3) — so it is
      // not a "skip", and it still costs nothing on the wire. Asserting
      // `skipped` here would have forced the marking pass to be deferred to keep
      // a check green, which is backwards. A9 asserts the convergence instead.
      name: 'Run 2: ZERO network calls for Skyways',
      pass: skyways2.networkCalls === 0,
      detail: `calls=${skyways2.networkCalls} skipped=${skyways2.skipped} superseded=[${skyways2.superseded.join(', ')}] reason=${skyways2.skipReason}`,
    },
    {
      id: 'A7',
      name: 'Run 2: ZERO network calls for Madhur',
      pass: madhur2.networkCalls === 0,
      detail: `calls=${madhur2.networkCalls} skipped=${madhur2.skipped} superseded=[${madhur2.superseded.join(', ')}] reason=${madhur2.skipReason}`,
    },
    {
      id: 'A9',
      // Convergence, which is the claim `skipped` was standing in for: once run
      // 2's bookkeeping is written, run 3 is a pure skip for every IPO whose
      // documents are settled. Without this the state machine could churn
      // forever at zero cost and nobody would notice.
      name: 'Run 3: every settled IPO is a pure skip, no work left at all',
      pass:
        run3.results.every((r) => r.networkCalls === 0) &&
        [find(run3, 'acc-skyways'), find(run3, 'acc-madhurknit')].every((r) => r.skipped),
      detail: run3.results
        .map((r) => `${r.companyName}: calls=${r.networkCalls} skipped=${r.skipped}`)
        .join(' | '),
    },
  ];
  } else {
    // T-433: generic per-IPO checks for `--ipos` mode — only claim run2 costs
    // zero network calls (the contract actually asked for), never the
    // fixture-specific document-shape assertions above.
    checks = ACCEPTANCE_IPOS.map((ipo) => {
      const r1 = run1.results.find((r) => r.companyName === ipo.companyName);
      const r2 = run2.results.find((r) => r.companyName === ipo.companyName);
      return {
        id: `IPOS-${ipo.symbol ?? ipo.companyName}`,
        name: `${ipo.companyName}: run 2 costs ZERO network calls`,
        pass: (r2?.networkCalls ?? -1) === 0,
        detail:
          `run1 found=[${r1?.found.join(', ') ?? '-'}] run1 calls=${r1?.networkCalls} ` +
          `run2 calls=${r2?.networkCalls} skipped=${r2?.skipped}`,
      };
    });
  }

  const summary = {
    task: 'T-403',
    ranAt: new Date().toISOString(),
    persistence: useDb
      ? 'POSTGRES via DATABASE_URL (--db)'
      : 'IN-MEMORY (no database with the 0035 schema was reachable — see the module header)',
    downloadsEnabled: download,
    storeDir,
    run1Calls: run1.network.total,
    run2Calls: run2.network.total,
    run3Calls: run3.network.total,
    checks,
    allPassed: checks.every((c) => c.pass),
  };
  // r5: the summary was BUILT and printed but never written. `db-run/acceptance-summary.json`
  // therefore had no producer in the repo - the same defect W-2 fixed for the SQL
  // readback, still standing on the file that states the verdict.
  writeFileSync(join(evidenceDir, 'acceptance-summary.json'), JSON.stringify(summary, null, 2));

  // W-2: the SQL readback, by the committed script, as the last thing the run
  // does. The round-3 evidence carried a `state-table-from-postgres.json` whose
  // producer was never committed — unreproducible, unreadable, and therefore an
  // assertion rather than evidence. This is the same file, from a script anyone
  // can read and re-run.
  if (useDb && process.env.DATABASE_URL) {
    try {
      const rb = await readback(
        process.env.DATABASE_URL,
        ACCEPTANCE_IPOS.map((i) => i.companyName)
      );
      writeFileSync(
        join(evidenceDir, 'state-table-from-postgres.json'),
        JSON.stringify(rb, null, 2)
      );
      const hinted = rb.ipos.filter((i) => i.company_website || i.verifier_url).length;
      console.log(
        `readback: ${rb.rowCount} state row(s), ${rb.documents.length} document(s), ` +
          `${rb.withLastAttempt} with last_attempt, ${rb.foundWithSha256} FOUND row(s) with a sha256, ` +
          `${hinted}/${rb.ipos.length} ipos carrying a source hint`
      );
    } catch (error) {
      console.error('readback FAILED:', error instanceof Error ? error.message : String(error));
    }
  }

  console.log('');
  for (const c of checks) console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.id} ${c.name} — ${c.detail}`);
  console.log(
    `\nrun1 calls=${run1.network.total}  run2 calls=${run2.network.total}  run3 calls=${run3.network.total}`
  );
  console.log(`evidence: ${evidenceDir}`);
  await close();
  process.exit(summary.allPassed ? 0 : 1);
}

/**
 * Only run when this file IS the entry point.
 *
 * Found by importing `assertTestDatabase` from a unit test: the bare `main()`
 * call meant merely importing anything from this module launched a live
 * acceptance run — real network requests, and with --db in the environment,
 * real writes. A script that cannot be imported without being executed cannot
 * have its pieces tested.
 */
const isEntryPoint = /run-document-discovery[.]ts$/.test(
  String(process.argv[1] ?? '').split(/[/\\]/).pop() ?? ''
);

if (isEntryPoint) {
  main().catch((error) => {
    console.error('acceptance run failed:', error);
    process.exit(2);
  });
}
