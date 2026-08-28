/**
 * T-403 acceptance harness — runs the REAL discovery runner against the REAL
 * exchange APIs, twice, and writes the evidence.
 *
 * WHY IT HAS ITS OWN IPO LIST INSTEAD OF QUERYING THE DATABASE
 * ------------------------------------------------------------
 * The dev database (`ipodhan_wpab`, a restored prod dump) was dropped mid-task
 * when its host ran out of disk — an owner-handled production incident on
 * 2026-08-28. Rather than fabricate a database-backed run, this harness keeps
 * the four acceptance IPOs as literals, using the values READ FROM that database
 * before it went away (recorded in each entry), and swaps only the persistence
 * layer for `InMemoryDocumentFetchStateStore`.
 *
 * What that costs and what it does not: the discovery logic, the classifier, the
 * BSE/NSE payload parsing, the download verification, the state transitions and
 * the network accounting are all the SAME code that runs in production against
 * the SAME live hosts. What is NOT exercised is Postgres persistence — the
 * repository's SQL, the unique constraint, and the migration itself. That gap is
 * real and is reported as such; it is closed by re-running with `--db` once the
 * host is back.
 *
 * Usage (from scraper/):
 *   npx tsx scripts/run-document-discovery.ts
 *   npx tsx scripts/run-document-discovery.ts --no-download   (skip PDFs)
 *   DATABASE_URL=... npx tsx scripts/run-document-discovery.ts --db
 *   npx tsx scripts/run-document-discovery.ts --evidence-dir=path/to/dir
 *
 * `--db` (V4) swaps the in-memory store for the real
 * `DocumentFetchStateRepository` against `DATABASE_URL`. It requires the four
 * acceptance IPO rows to already exist there (matched by company name) and
 * migration 0035 to be applied. NOT EXERCISED as of 2026-08-28: the only
 * credentials this task may use are refused DDL on the available test database,
 * so no database with the 0035 schema was reachable. It is implemented rather
 * than documented-and-missing, which is what the review flagged.
 */

import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DocumentDiscoveryRunner,
  defaultFetcher,
  toStateRow,
  type DiscoveryIpo,
  type IpoRunResult,
} from '../src/services/document-discovery-runner.js';
import { InMemoryDocumentFetchStateStore } from '../src/services/in-memory-document-fetch-state-store.js';
import { DocumentFetchStateRepository } from '@ipodhan/shared/repositories/document-fetch-state-repository';
import { NetworkCounter } from '../src/utils/network-counter.js';

/**
 * The four acceptance IPOs. `status`, `segment` and the dates are the values
 * read from `ipodhan_wpab` (restored prod dump of 2026-08-28) at 12:20 IST,
 * before the host went down. `stage` is derived from those dates against the run
 * date, exactly as `deriveLifecycleStage` would.
 */
const ACCEPTANCE_IPOS: (DiscoveryIpo & { dbStatus: string; closeDate: string })[] = [
  {
    id: 'acc-skyways',
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
  },
  {
    id: 'acc-deepa',
    companyName: 'Deepa Jewellers Ltd.',
    symbol: null, // no NSE symbol in our data yet
    segment: 'MAINBOARD',
    stage: 'UPCOMING',
    dbStatus: 'UPCOMING',
    closeDate: '2026-09-03',
    bseIpoNo: null,
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
async function makeStore(useDb: boolean): Promise<{
  store: InMemoryDocumentFetchStateStore | DocumentFetchStateRepository;
  dump: () => Promise<unknown[]>;
  close: () => Promise<void>;
}> {
  if (!useDb) {
    const store = new InMemoryDocumentFetchStateStore();
    return { store, dump: async () => store.all(), close: async () => undefined };
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('--db requires DATABASE_URL');

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

  return {
    store,
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

async function runOnce(
  run: number,
  store: InMemoryDocumentFetchStateStore | DocumentFetchStateRepository,
  dump: () => Promise<unknown[]>,
  download: boolean,
  storeDir: string
): Promise<RunEvidence> {
  const counter = new NetworkCounter();
  const documents = {
    rows: [] as Record<string, unknown>[],
    async upsertDocument(doc: Record<string, unknown>) {
      this.rows.push(doc);
      return { id: `doc-${this.rows.length}` };
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
  const storeDir =
    process.env.PROSPECTUS_STORE_DIR ?? 'D:/Abhay/Ventures/IPODhan-backups/prospectus-wpab';
  // V7: never silently overwrite a previous run's evidence. Each run gets its
  // own timestamped directory unless one is named explicitly.
  const dirArg = process.argv.find((a) => a.startsWith('--evidence-dir='));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = dirArg
    ? dirArg.slice('--evidence-dir='.length)
    : join(process.cwd(), '..', 'evidence', 'T-403', `run-${stamp}`);
  mkdirSync(evidenceDir, { recursive: true });

  const useDb = process.argv.includes('--db');
  const { store, dump, close } = await makeStore(useDb);

  console.log('=== T-403 acceptance run 1 (discovery) ===');
  const run1 = await runOnce(1, store, dump, download, storeDir);
  console.log('=== T-403 acceptance run 2 (must cost ZERO calls for found IPOs) ===');
  const run2 = await runOnce(2, store, dump, download, storeDir);

  for (const evidence of [run1, run2]) {
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
        join(evidenceDir, `run-${evidence.run}-attempts-${result.ipoId}.json`),
        JSON.stringify(result, null, 2)
      );
    }
  }

  // The acceptance assertions, evaluated here so the harness itself reports
  // pass/fail rather than leaving it to a human reading json.
  const find = (e: RunEvidence, id: string) => e.results.find((r) => r.ipoId === id)!;
  const skyways1 = find(run1, 'acc-skyways');
  const madhur1 = find(run1, 'acc-madhurknit');
  const esds1 = find(run1, 'acc-esds');
  const skyways2 = find(run2, 'acc-skyways');
  const madhur2 = find(run2, 'acc-madhurknit');

  const checks = [
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
      name: 'Skyways: 3 lead managers parsed from the BSE payload',
      pass: skyways1.leadManagers.length === 3,
      detail: skyways1.leadManagers.join(' | '),
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
        const anyFailed = exchangeCalls.some((a) => a.outcome !== 'ok');
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
      name: 'ESDS: ZERO fallback (non-exchange) calls',
      pass: run1.fallbackCalls === 0,
      detail: `${run1.fallbackCalls} non-exchange call(s) in run 1; hosts=${Object.keys(run1.network.byHost).join(', ')}`,
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
      name: 'Run 2: ZERO network calls for Skyways',
      pass: skyways2.networkCalls === 0 && skyways2.skipped,
      detail: `calls=${skyways2.networkCalls} skipped=${skyways2.skipped} reason=${skyways2.skipReason}`,
    },
    {
      id: 'A7',
      name: 'Run 2: ZERO network calls for Madhur',
      pass: madhur2.networkCalls === 0 && madhur2.skipped,
      detail: `calls=${madhur2.networkCalls} skipped=${madhur2.skipped} reason=${madhur2.skipReason}`,
    },
  ];

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
    checks,
    allPassed: checks.every((c) => c.pass),
  };
  writeFileSync(join(evidenceDir, 'acceptance-summary.json'), JSON.stringify(summary, null, 2));

  console.log('');
  for (const c of checks) console.log(`[${c.pass ? 'PASS' : 'FAIL'}] ${c.id} ${c.name} — ${c.detail}`);
  console.log(`\nrun1 calls=${run1.network.total}  run2 calls=${run2.network.total}`);
  console.log(`evidence: ${evidenceDir}`);
  await close();
  process.exit(summary.allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error('acceptance run failed:', error);
  process.exit(2);
});
