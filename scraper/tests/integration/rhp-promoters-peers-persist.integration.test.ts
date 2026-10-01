// implements: #545 real-DB persist proof — RHP promoters + peers with DOC provenance
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray, and } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
// Relative imports, NOT the `@ipodhan/shared` alias — a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout
// (same guard as field-plan-walk-real-writer.integration.test.ts and
// peer-company-replace-atomicity.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';
import { rowKeyForName } from '../../../packages/shared/src/utils/company-name-normalizer';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { FinancialStatementsRepository } from '../../../packages/shared/src/repositories/financial-statements-repository';
import { IpoValuationRepository } from '../../../packages/shared/src/repositories/ipo-valuation-repository';
import { PromotersRepository } from '../../../packages/shared/src/repositories/promoters-repository';
import { IpoIntermediariesRepository } from '../../../packages/shared/src/repositories/ipo-intermediaries-repository';
import { BrlmTrackRecordRepository } from '../../../packages/shared/src/repositories/brlm-track-record-repository';
import { FinancialDataRepository } from '../../../packages/shared/src/repositories/financial-data-repository';
import { ListingPerformanceRepository } from '../../../packages/shared/src/repositories/listing-performance-repository';
import { PeerCompanyRepository } from '../../src/repositories/peer-company-repository.js';
import { findOrphanPeerSourceKeys, retireOrphanPeerSources, PRE_OD157_ORPHAN_REASON } from '../../src/services/orphan-peer-sources.js';
// The nightly floor's own SQL text (r_child_provenance_orphan), run here against ipodhan_test.
import { CHILD_PROVENANCE_ORPHAN_SQL } from '../../../scripts/lib/detection-floor-checks.mjs';
import type {
  FilingExtraction,
  FilingPersisterDeps,
  IpoDetailsWriter,
} from '../../src/services/filing-persister.js';

type PersistFilingExtractionFn = typeof import('../../src/services/filing-persister.js').persistFilingExtraction;
type DataConsolidationOrchestratorCtor =
  typeof import('../../src/services/data-consolidation-orchestrator.js').DataConsolidationOrchestrator;

/**
 * #545 — real-DB proof that `persistFilingExtraction` (the ONE write door the
 * document cycle uses, `scraper/src/services/filing-persist-deps.ts`) turns a
 * REAL RHP extraction into `promoters` rows, `peer_companies` rows, and their
 * `field_sources` provenance.
 *
 * The extraction payload is never hand-typed and never a recorded copy. It is
 * produced AT TEST TIME by `extract_filing.run()` (the Python extractor
 * `filing-persister.ts` is fed from in production) on pages from TWO real,
 * committed fixtures for the same issuer's RHP — `a-one-steels-india-ltd-rhp-
 * cover-pages.json` and `a-one-steels-india-ltd-rhp-peer-pages.json` —
 * concatenated so one `FilingExtraction` envelope carries both fields. Round 2
 * dropped the recorded copy: it went stale whenever the extractor changed, and
 * it was one more identity-unchecked fixture. Needs `python` on PATH: without
 * it the suite is skipped on a developer machine and FAILS in CI (the `CI`
 * guard below), because a skipped proof reads as a green one (#1166 item 4).
 *
 * Follows the REAL-orchestrator pattern of
 * field-plan-walk-real-writer.integration.test.ts (real Pool + real ioredis +
 * dynamic import of the feature-flag-baked modules AFTER env vars are set)
 * and the delete-then-insert seeding pattern of
 * peer-company-replace-atomicity.integration.test.ts.
 *
 * SKIPS CLEANLY when no database is configured.
 *
 * To run (both flag states - prod runs with child consolidation OFF):
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *   REDIS_URL=redis://localhost:6379/15 ENABLE_CHILD_TABLE_CONSOLIDATION=false|true \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/rhp-promoters-peers-persist.integration.test.ts
 */

// Baked at module-eval time by feature-flags.ts — set BEFORE any static
// import of filing-persister.js / data-consolidation-orchestrator.js, same
// reasoning as field-plan-walk-real-writer.integration.test.ts's top-of-file
// comment. This file only ever imports those two modules dynamically, in
// beforeAll, after these lines run.
// Child consolidation defaults ON here; ENABLE_CHILD_TABLE_CONSOLIDATION=false
// runs the file the way production runs (the flag is off on prod).
const CHILD_CONSOLIDATION = (process.env.ENABLE_CHILD_TABLE_CONSOLIDATION ?? 'true') === 'true';
process.env.ENABLE_CHILD_TABLE_CONSOLIDATION = String(CHILD_CONSOLIDATION);
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
// The interpreter that runs the real extractor. In CI a missing interpreter is
// a FAILURE, never a skip: a skipped proof reads as a green one.
const PYTHON = ['python3', 'python'].find(
  (bin) => spawnSync(bin, ['--version'], { encoding: 'utf-8' }).status === 0
);
if (!PYTHON && process.env.CI) throw new Error('#545: no python on PATH - the persist proof needs the real extractor');
const PYTHON_OK = Boolean(PYTHON);

const IPO_ID = '00000000-0000-4000-8000-0000000545a1';
const DOC_ID = '00000000-0000-4000-8000-0000000545d1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts');
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'extractor');

// extract_filing.run() on the two real A-One Steels RHP fixtures (cover + peer pages).
const EXTRACT_PY = [
  'import json, sys',
  'from extract_filing import run',
  'd = sys.argv[1]',
  "cover = json.load(open(d + '/a-one-steels-india-ltd-rhp-cover-pages.json', encoding='utf-8'))",
  "peer = json.load(open(d + '/a-one-steels-india-ltd-rhp-peer-pages.json', encoding='utf-8'))",
  "pages = [tuple(p) for p in cover] + [tuple(p) for p in peer['pages']]",
  "tables = {int(k): v for k, v in peer['tables'].items()}",
  "out = run(pages, 'RHP', 'a-one-steels-rhp', 'MAINBOARD', tables_for_page=lambda i: tables.get(i, []))",
  'sys.stdout.write(json.dumps(out))',
].join('\n');

let extractionJson = '';

// #1165: the German Green Steel and Power RHP peer table is read by the TABLE
// path, which returns the figures as the strings the document printed
// ('18.94', '1,19,694.32'). Same real-extractor rule as above: produced at test time.
const EXTRACT_GG_PY = [
  'import json, sys',
  'from extract_filing import run',
  'd = sys.argv[1]',
  "peer = json.load(open(d + '/german-green-steel-and-power-ltd-rhp-peer-pages.json', encoding='utf-8'))",
  "pages = [tuple(p) for p in peer['pages']]",
  "tables = {int(k): v for k, v in peer['tables'].items()}",
  "out = run(pages, 'RHP', 'german-green-rhp', 'MAINBOARD', tables_for_page=lambda i: tables.get(i, []))",
  'sys.stdout.write(json.dumps(out))',
].join('\n');
let germanGreenJson = '';

// OD-156 (#1166 item 1): the same issuer's real DRHP (cover + peer pages), so a
// DRHP peer set can be stored and then met by the RHP's.
const EXTRACT_DRHP_PY = [
  'import json, sys',
  'from extract_filing import run',
  'd = sys.argv[1]',
  "cover = json.load(open(d + '/a-one-steels-india-ltd-drhp-cover-pages.json', encoding='utf-8'))",
  "peer = json.load(open(d + '/a-one-steels-india-ltd-drhp-peer-pages.json', encoding='utf-8'))",
  "pages = [tuple(p) for p in cover] + [tuple(p) for p in peer['pages']]",
  "tables = {int(k): v for k, v in peer['tables'].items()}",
  "out = run(pages, 'DRHP', 'a-one-steels-drhp', 'MAINBOARD', tables_for_page=lambda i: tables.get(i, []))",
  'sys.stdout.write(json.dumps(out))',
].join('\n');
let drhpJson = '';

function runRealExtractor(script: string = EXTRACT_PY): string {
  const res = spawnSync(PYTHON as string, ['-c', script, FIXTURE_DIR], {
    cwd: SCRIPTS_DIR,
    encoding: 'utf-8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`extract_filing.run failed: ${res.stderr}`);
  return res.stdout;
}

/** The real extractor's output - parsed fresh per test so a mutation never leaks. */
function loadExtraction(): FilingExtraction {
  return JSON.parse(extractionJson) as FilingExtraction;
}

const EXPECTED_PROMOTERS = ['Sandeep Kumar', 'Sunil Jallan', 'Krishan Kumar Jalan'];
const EXPECTED_PEERS = [
  'MSP Steel and Power Limited',
  'Jai Balaji Industries Ltd.',
  'Shyam Metallics and Energy Ltd.',
];

let pool: Pool | null = null;
let redis: Redis | null = null;
let db: ReturnType<typeof drizzle>;
let persistFilingExtraction: PersistFilingExtractionFn;
let deps: FilingPersisterDeps;

async function cleanup() {
  if (!pool) return;
  await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
  await db.delete(schema.fieldSourcesRetired).where(eq(schema.fieldSourcesRetired.ipoId, IPO_ID));
  await db.delete(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO_ID));
  await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
  await db.delete(schema.promoters).where(eq(schema.promoters.ipoId, IPO_ID));
  await db.delete(schema.documents).where(eq(schema.documents.id, DOC_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
}

describe.skipIf(!DATABASE_URL || !PYTHON_OK)(
  `#545 RHP promoters + peers persist with provenance (child consolidation ${CHILD_CONSOLIDATION ? 'on' : 'off'})`,
  () => {
  beforeAll(async () => {
    if (!DATABASE_URL) return;
    extractionJson = runRealExtractor();
    germanGreenJson = runRealExtractor(EXTRACT_GG_PY);
    drhpJson = runRealExtractor(EXTRACT_DRHP_PY);
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const dbCheck = await pool.query('select current_database()');
    const currentDb = dbCheck.rows[0].current_database as string;
    if (currentDb !== 'ipodhan_test') {
      throw new Error(
        `Refusing to run: connected to '${currentDb}', not 'ipodhan_test'. ` +
          'This integration test only runs against the test database.'
      );
    }
    db = drizzle(pool, { schema });

    redis = new Redis(REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
    await redis.connect();

    // Dynamic imports, AFTER the feature-flag env vars above are set.
    const { persistFilingExtraction: fn } = await import('../../src/services/filing-persister.js');
    persistFilingExtraction = fn;
    const { DataConsolidationOrchestrator }: { DataConsolidationOrchestrator: DataConsolidationOrchestratorCtor } =
      await import('../../src/services/data-consolidation-orchestrator.js');

    await cleanup();

    await db.insert(schema.ipos).values({
      id: IPO_ID,
      companyName: 'S545 A-One Steels Fixture Ltd.',
      slug: 's545-a-one-steels-fixture-ltd',
      category: 'MAINBOARD',
      status: 'OPEN',
    } as never);

    await db.insert(schema.documents).values({
      id: DOC_ID,
      ipoId: IPO_ID,
      type: 'RHP',
      title: 'RHP',
      url: 'https://example.invalid/s545-rhp.pdf',
      isActive: true,
    } as never);

    const ipoRepository = new IPORepository(db as never, redis as never);
    const fieldSources = new FieldSourcesRepository(db as never, redis as never);
    const childRowConsolidator = new DataConsolidationOrchestrator(
      ipoRepository,
      fieldSources,
      new DataConflictsRepository(db as never, redis as never),
      redis as never,
      new ListingPerformanceRepository(db as never, redis as never)
    );

    const ipoDetailsWriter: IpoDetailsWriter = {
      async upsert(ipoId, values) {
        await db
          .insert(schema.ipoDetails)
          .values({ ipoId, ...values, updatedAt: new Date() } as never)
          .onConflictDoUpdate({
            target: schema.ipoDetails.ipoId,
            set: { ...values, updatedAt: new Date() } as never,
          });
      },
      async insertIfMissing(ipoId, values) {
        const result = await db
          .insert(schema.ipoDetails)
          .values({ ipoId, ...values } as never)
          .onConflictDoNothing({ target: schema.ipoDetails.ipoId });
        return (result.rowCount ?? 0) > 0;
      },
    };

    // The REAL production wiring's dependency set
    // (filing-persist-deps.ts's buildFilingPersistDeps), rebuilt against this
    // file's own pool + redis instead of the `@ipodhan/shared` singleton `db`
    // (which resolves its OWN connection from env at import time, not this
    // test's tunnel) — same repository classes, same real
    // DataConsolidationOrchestrator as production.
    deps = {
      ipoRepository,
      financialStatements: new FinancialStatementsRepository(db as never, redis as never),
      ipoValuation: new IpoValuationRepository(db as never, redis as never),
      promoters: new PromotersRepository(db as never, redis as never),
      intermediaries: new IpoIntermediariesRepository(db as never, redis as never),
      brlmTrackRecord: new BrlmTrackRecordRepository(db as never, redis as never),
      peerCompanies: new PeerCompanyRepository(db as never, redis as never),
      financialData: new FinancialDataRepository(db as never, redis as never),
      fieldSources,
      ipoDetailsWriter,
      childRowConsolidator,
    };
  }, 60000);

  afterAll(async () => {
    if (!pool) return;
    await cleanup();
    await pool.end();
    if (redis) await redis.quit();
  }, 60000);

  beforeEach(async () => {
    if (!pool) return;
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.fieldSourcesRetired).where(eq(schema.fieldSourcesRetired.ipoId, IPO_ID));
    await db.delete(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO_ID));
    await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
    await db.delete(schema.promoters).where(eq(schema.promoters.ipoId, IPO_ID));
    if (redis) {
      const keys = await redis.keys(`*${IPO_ID}*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  });

  it('a real RHP extraction writes promoters and peer_companies rows', async () => {
    const extraction = loadExtraction();

    const summary = await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'RHP', documentId: DOC_ID, apply: true },
      deps
    );

    expect(summary.applied).toBe(true);

    const promoterRows = await db
      .select()
      .from(schema.promoters)
      .where(eq(schema.promoters.ipoId, IPO_ID));
    expect(promoterRows.map((r) => r.name).sort()).toEqual([...EXPECTED_PROMOTERS].sort());

    const peerRows = await db
      .select()
      .from(schema.peerCompanies)
      .where(eq(schema.peerCompanies.ipoId, IPO_ID));
    expect(peerRows.map((r) => r.companyName).sort()).toEqual([...EXPECTED_PEERS].sort());
  });

  it.skipIf(!CHILD_CONSOLIDATION)('field_sources rows record source DOC (the offer document — scraperSourceForDocType) with the promoters/peer_companies table_name and row_key', async () => {
    const extraction = loadExtraction();
    await persistFilingExtraction(
      IPO_ID,
      extraction,
      { docType: 'RHP', documentId: DOC_ID, apply: true },
      deps
    );

    const promoterSourceRows = await db
      .select()
      .from(schema.fieldSources)
      .where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.tableName, 'promoters')));
    expect(promoterSourceRows.length).toBeGreaterThan(0);
    for (const row of promoterSourceRows) {
      expect(row.source).toBe('DRHP'); // scraperSourceForDocType: the offer document, best available type
    }
    // Per-row provenance (`name`, `isPromoterGroup`, ...) carries the row key
    // (the promoter's normalized name); the whole-table `rows` summary field
    // (bump('promoters', 'rows'), filing-persister.ts) is the one row with
    // rowKey === '' and is not itself per-promoter provenance.
    const perRowPromoterSources = promoterSourceRows.filter((r) => r.fieldName !== 'rows');
    expect(perRowPromoterSources.length).toBeGreaterThan(0);
    for (const row of perRowPromoterSources) {
      expect(row.rowKey.length).toBeGreaterThan(0);
    }
    const promoterRowKeys = new Set(perRowPromoterSources.map((r) => r.rowKey));
    for (const name of EXPECTED_PROMOTERS) {
      expect([...promoterRowKeys].some((k) => k === name.toLowerCase() || k.includes(name.toLowerCase().split(' ')[0]))).toBe(
        true
      );
    }

    const peerSourceRows = await db
      .select()
      .from(schema.fieldSources)
      .where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.tableName, 'peer_companies')));
    expect(peerSourceRows.length).toBeGreaterThan(0);
    for (const row of peerSourceRows) {
      expect(row.source).toBe('DRHP');
    }
    const perRowPeerSources = peerSourceRows.filter((r) => r.fieldName !== 'rows');
    expect(perRowPeerSources.length).toBeGreaterThan(0);
    for (const row of perRowPeerSources) {
      expect(row.rowKey.length).toBeGreaterThan(0);
    }
  });

  it('running the persister twice is idempotent — no duplicate rows', async () => {
    const first = loadExtraction();
    await persistFilingExtraction(IPO_ID, first, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);

    const second = loadExtraction();
    await persistFilingExtraction(IPO_ID, second, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);

    const promoterRows = await db
      .select()
      .from(schema.promoters)
      .where(eq(schema.promoters.ipoId, IPO_ID));
    expect(promoterRows).toHaveLength(EXPECTED_PROMOTERS.length);

    const peerRows = await db
      .select()
      .from(schema.peerCompanies)
      .where(eq(schema.peerCompanies.ipoId, IPO_ID));
    expect(peerRows).toHaveLength(EXPECTED_PEERS.length);

    const promoterSourceRows = await db
      .select()
      .from(schema.fieldSources)
      .where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.tableName, 'promoters')));
    const peerSourceRows = await db
      .select()
      .from(schema.fieldSources)
      .where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.tableName, 'peer_companies')));
    // One field_sources row per (rowKey, fieldName) — the second run must
    // UPDATE those rows in place, never add a second row per key.
    const promoterKeyField = new Set(promoterSourceRows.map((r) => `${r.rowKey}::${r.fieldName}`));
    expect(promoterKeyField.size).toBe(promoterSourceRows.length);
    const peerKeyField = new Set(peerSourceRows.map((r) => `${r.rowKey}::${r.fieldName}`));
    expect(peerKeyField.size).toBe(peerSourceRows.length);
  });

  it('mutation check: removing promoter_names from the payload makes the promoter assertion fail', async () => {
    const extraction = loadExtraction();
    expect(extraction.fields.promoter_names).toBeDefined();
    delete (extraction.fields as Record<string, unknown>).promoter_names;

    await persistFilingExtraction(IPO_ID, extraction, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);

    const promoterRows = await db
      .select()
      .from(schema.promoters)
      .where(eq(schema.promoters.ipoId, IPO_ID));

    // Without `promoter_names`, the persister falls back to the single
    // `promoter_name` field (filing-persister.ts:2339-2343) — one row, not
    // the three the real fixture names. The assertion the happy-path test
    // makes (all three promoters present) fails here, proving the field is
    // load-bearing.
    expect(promoterRows.map((r) => r.name).sort()).not.toEqual([...EXPECTED_PROMOTERS].sort());
  });

  // ------------------------------------------------------------ #545 round 2
  // Chittorgarh had already stored these peers WITH ratios. The RHP text path
  // reads names only. Before round 2 the persister's whole-set replace deleted
  // every stored row and re-inserted the names with null ratios.
  const CHITTORGARH_ROWS = [
    { companyName: 'MSP Steel and Power Limited', peRatio: '61.52', eps: '0.60', dilutedEps: '0.56', ronw: '3.28', nav: '18.18', pbvRatio: '1.10' },
    { companyName: 'Kamdhenu Limited', peRatio: '14.57', eps: '2.78', dilutedEps: '2.72', ronw: '19.77', nav: '14.06', pbvRatio: '2.05' },
  ];
  const RATIO_COLS = ['peRatio', 'eps', 'dilutedEps', 'ronw', 'nav', 'pbvRatio'] as const;

  async function seedChittorgarhPeers() {
    await db.insert(schema.peerCompanies).values(
      CHITTORGARH_ROWS.map((r) => ({
        ipoId: IPO_ID,
        ...r,
        normalizedName: rowKeyForName(r.companyName) as string,
        isListed: true,
        dataSource: 'CHITTORGARH',
        lastUpdated: new Date(),
      })) as never
    );
  }

  async function storedPeers() {
    return db.select().from(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
  }

  it('a name-only DOC peer set never nulls a ratio another source stored, and never deletes its rows', async () => {
    await seedChittorgarhPeers();
    const extraction = loadExtraction();
    const peers = (extraction.fields.peer_companies as unknown as { value: Record<string, unknown>[] }).value;
    // The real payload IS name-only: the text path assigns no figure to a column.
    expect(peers.every((p) => ['pe', 'eps_basic', 'eps_diluted', 'ronw_pct', 'nav', 'pb'].every((k) => p[k] == null))).toBe(true);

    await persistFilingExtraction(IPO_ID, extraction, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);

    const after = await storedPeers();
    for (const seeded of CHITTORGARH_ROWS) {
      const row = after.find((r) => r.companyName === seeded.companyName);
      expect(row, seeded.companyName).toBeDefined();
      for (const col of RATIO_COLS) {
        expect(row![col], `${seeded.companyName}.${col}`).not.toBeNull();
        expect(Number(row![col])).toBeCloseTo(Number(seeded[col]), 2);
      }
    }
    // The document's peers Chittorgarh did not have are added (gap fill).
    expect(after.map((r) => r.companyName)).toEqual(
      expect.arrayContaining(['Jai Balaji Industries Ltd.', 'Shyam Metallics and Energy Ltd.'])
    );
  });

  it('a DOC peer set WITH figures still wins where it printed a value, and a null in it keeps the stored value', async () => {
    await seedChittorgarhPeers();
    const extraction = loadExtraction();
    const peers = (extraction.fields.peer_companies as unknown as { value: Record<string, unknown>[] }).value;
    const msp = peers.find((p) => p.name === 'MSP Steel and Power Limited')!;
    // A printed P/E, as the table path prints it (#1165: the persister parses
    // printed text); every other column left empty.
    msp.pe = '70.01';

    await persistFilingExtraction(IPO_ID, extraction, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);

    const row = (await storedPeers()).find((r) => r.companyName === 'MSP Steel and Power Limited')!;
    expect(Number(row.peRatio)).toBeCloseTo(70.01, 2); // DRHP outranks CHITTORGARH
    for (const col of ['eps', 'dilutedEps', 'ronw', 'nav', 'pbvRatio'] as const) {
      expect(row[col], col).not.toBeNull();
      expect(Number(row[col])).toBeCloseTo(Number(CHITTORGARH_ROWS[0][col]), 2);
    }
  });

  // ---------------------------------------------------------------- #1165
  it('a real RHP peer TABLE (German Green) persists its printed figures as numbers', async () => {
    const extraction = JSON.parse(germanGreenJson) as FilingExtraction;
    const printed = (extraction.fields.peer_companies as unknown as { value: Record<string, unknown>[] }).value;
    // The real payload carries the figures as printed TEXT - the shape that was dropped before #1165.
    expect(printed.find((p) => p.name === 'Beekay Steel Industries Ltd')).toMatchObject({ eps_basic: '18.94', nav: '548.18' });

    await persistFilingExtraction(IPO_ID, extraction, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);

    const after = await storedPeers();
    expect(after).toHaveLength(5);
    const byName = new Map(after.map((r) => [r.companyName, r]));
    const expected: Record<string, [string, string, string, string]> = {
      // name: [eps, dilutedEps, ronw, nav] as printed in the RHP
      'Beekay Steel Industries Ltd': ['18.94', '18.94', '3.49', '548.18'],
      'Gallant Ispat Limited': ['20.07', '20.07', '14.60', '137.44'],
      'Kamdhenu Limited': ['2.78', '2.72', '19.77', '14.06'],
      'MSP Steel & Power Limited': ['0.60', '0.56', '3.28', '18.18'],
      'VMS TMT Limited': ['4.95', '4.95', '9.22', '45.97'],
    };
    for (const [name, [eps, dil, ronw, nav]] of Object.entries(expected)) {
      const row = byName.get(name);
      expect(row, name).toBeDefined();
      expect(Number(row!.eps), `${name}.eps`).toBeCloseTo(Number(eps), 2);
      expect(Number(row!.dilutedEps), `${name}.dilutedEps`).toBeCloseTo(Number(dil), 2);
      expect(Number(row!.ronw), `${name}.ronw`).toBeCloseTo(Number(ronw), 2);
      expect(Number(row!.nav), `${name}.nav`).toBeCloseTo(Number(nav), 2);
      expect(row!.dataSource).toBe('DRHP');
    }
  });

  it.skipIf(!CHILD_CONSOLIDATION)('#1166 (2): a name-only DOC set files no DOC provenance for a peer it left as Chittorgarh stored it', async () => {
    await seedChittorgarhPeers();
    await persistFilingExtraction(IPO_ID, loadExtraction(), { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);

    const perRow = (
      await db
        .select()
        .from(schema.fieldSources)
        .where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.tableName, 'peer_companies')))
    ).filter((r) => r.fieldName !== 'rows');
    const docKeys = new Set(perRow.filter((r) => r.source === 'DRHP').map((r) => r.rowKey));
    // MSP was stored by Chittorgarh and left untouched: no DOC claim on it.
    expect(docKeys.has(rowKeyForName('MSP Steel and Power Limited') as string)).toBe(false);
    // The two peers the document added do carry DOC provenance.
    expect(docKeys.has(rowKeyForName('Jai Balaji Industries Ltd.') as string)).toBe(true);
    expect(docKeys.has(rowKeyForName('Shyam Metallics and Energy Ltd.') as string)).toBe(true);
  });

  // ------------------------------------------------- OD-156 / OD-157 (#1166 items 1 and 3)
  type PeerList = { value: Record<string, unknown>[] };
  const peersOf = (e: FilingExtraction) => (e.fields.peer_companies as unknown as PeerList).value;
  const CG_ONLY = 'S1166 Chittorgarh Only Peer Ltd';
  const ADMIN_ADDED = 'S1166 Admin Added Peer Ltd';

  async function seedNonDocumentPeers() {
    await db.insert(schema.peerCompanies).values([
      { ipoId: IPO_ID, companyName: CG_ONLY, normalizedName: rowKeyForName(CG_ONLY) as string, isListed: true, peRatio: '12.00', dataSource: 'CHITTORGARH', lastUpdated: new Date() },
      // An admin-added row carries no document type (admin-list-write.ts inserts the admin's values only).
      { ipoId: IPO_ID, companyName: ADMIN_ADDED, normalizedName: rowKeyForName(ADMIN_ADDED) as string, isListed: true, dataSource: 'ADMIN', lastUpdated: new Date() },
    ] as never);
  }

  async function liveSourcesFor(rowKey: string) {
    return db
      .select()
      .from(schema.fieldSources)
      .where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.tableName, 'peer_companies'), eq(schema.fieldSources.rowKey, rowKey)));
  }

  async function retiredFor(rowKey: string) {
    return db
      .select()
      .from(schema.fieldSourcesRetired)
      .where(and(eq(schema.fieldSourcesRetired.ipoId, IPO_ID), eq(schema.fieldSourcesRetired.rowKey, rowKey)));
  }

  it('OD-156: a real DRHP names-only set records its document type on every peer row', async () => {
    const drhp = JSON.parse(drhpJson) as FilingExtraction;
    expect(peersOf(drhp).map((p) => p.name).sort()).toEqual([...EXPECTED_PEERS].sort());
    await persistFilingExtraction(IPO_ID, drhp, { docType: 'DRHP', documentId: DOC_ID, apply: true }, deps);
    const rows = await storedPeers();
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.sourceDocumentType, r.companyName).toBe('DRHP');
  });

  it('OD-156/157: the RHP names-only list drops a DRHP peer; Chittorgarh-only and admin peers stay; its source records are retired, not live', async () => {
    await seedNonDocumentPeers();
    await persistFilingExtraction(IPO_ID, JSON.parse(drhpJson) as FilingExtraction, { docType: 'DRHP', documentId: DOC_ID, apply: true }, deps);
    const dropped = 'Shyam Metallics and Energy Ltd.';
    const droppedKey = rowKeyForName(dropped) as string;
    if (CHILD_CONSOLIDATION) expect((await liveSourcesFor(droppedKey)).length).toBeGreaterThan(0);

    const rhp = loadExtraction();
    (rhp.fields.peer_companies as unknown as PeerList).value = peersOf(rhp).filter((p) => p.name !== dropped);
    expect(peersOf(rhp)).toHaveLength(2);
    const before = Date.now();
    await persistFilingExtraction(IPO_ID, rhp, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);

    const names = (await storedPeers()).map((r) => r.companyName).sort();
    expect(names).toEqual([ADMIN_ADDED, CG_ONLY, 'Jai Balaji Industries Ltd.', 'MSP Steel and Power Limited'].sort());
    expect(await liveSourcesFor(droppedKey)).toHaveLength(0);
    if (CHILD_CONSOLIDATION) {
      const retired = await retiredFor(droppedKey);
      expect(retired.length).toBeGreaterThan(0);
      for (const r of retired) {
        expect(r.tableName).toBe('peer_companies');
        expect(r.retiredAt.getTime()).toBeGreaterThanOrEqual(before - 5 * 60_000);
        expect(r.retiredReason).toContain('RHP');
        expect((r.record as { rowKey?: string }).rowKey).toBe(droppedKey);
      }
    }
  });

  it('OD-156/157: a real peer TABLE with figures (German Green) stored from a DRHP loses the peer the RHP no longer names', async () => {
    await seedNonDocumentPeers();
    const gg = () => JSON.parse(germanGreenJson) as FilingExtraction;
    await persistFilingExtraction(IPO_ID, gg(), { docType: 'DRHP', documentId: DOC_ID, apply: true }, deps);
    expect(await storedPeers()).toHaveLength(7);
    const dropped = 'VMS TMT Limited';
    const droppedKey = rowKeyForName(dropped) as string;

    const rhp = gg();
    (rhp.fields.peer_companies as unknown as PeerList).value = peersOf(rhp).filter((p) => p.name !== dropped);
    await persistFilingExtraction(IPO_ID, rhp, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);

    const after = await storedPeers();
    expect(after.map((r) => r.companyName)).not.toContain(dropped);
    expect(after).toHaveLength(6);
    expect(after.map((r) => r.companyName)).toEqual(expect.arrayContaining([CG_ONLY, ADMIN_ADDED]));
    const cg = after.find((r) => r.companyName === CG_ONLY)!;
    expect(Number(cg.peRatio)).toBeCloseTo(12, 2);
    for (const r of after.filter((x) => x.dataSource === 'DRHP')) expect(r.sourceDocumentType, r.companyName).toBe('RHP');
    expect(await liveSourcesFor(droppedKey)).toHaveLength(0);
    if (CHILD_CONSOLIDATION) expect((await retiredFor(droppedKey)).length).toBeGreaterThan(0);
  });

  it('OD-156: an OLDER document list never removes a peer a newer document stored', async () => {
    await persistFilingExtraction(IPO_ID, loadExtraction(), { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);
    const drhp = JSON.parse(drhpJson) as FilingExtraction;
    (drhp.fields.peer_companies as unknown as PeerList).value = peersOf(drhp).filter((p) => p.name !== 'Jai Balaji Industries Ltd.');
    await persistFilingExtraction(IPO_ID, drhp, { docType: 'DRHP', documentId: DOC_ID, apply: true }, deps);
    expect((await storedPeers()).map((r) => r.companyName).sort()).toEqual([...EXPECTED_PEERS].sort());
  });

  it('OD-156 fail closed: a document peer of UNKNOWN type (written before OD-156) is never removed', async () => {
    await db.insert(schema.peerCompanies).values({
      ipoId: IPO_ID, companyName: 'S1166 Legacy Document Peer Ltd', normalizedName: rowKeyForName('S1166 Legacy Document Peer Ltd') as string,
      isListed: true, dataSource: 'DRHP', lastUpdated: new Date(),
    } as never);
    await persistFilingExtraction(IPO_ID, JSON.parse(germanGreenJson) as FilingExtraction, { docType: 'PROSPECTUS', documentId: DOC_ID, apply: true }, deps);
    expect((await storedPeers()).map((r) => r.companyName)).toContain('S1166 Legacy Document Peer Ltd');
  });
  // ------------------------------------------- OD-156 / OD-157 round 2 (#1166, Tier A findings)
  it('§9.2 item 19: an admin-held value on a DRHP peer survives an RHP names-only list that drops the peer', async () => {
    await persistFilingExtraction(IPO_ID, JSON.parse(drhpJson) as FilingExtraction, { docType: 'DRHP', documentId: DOC_ID, apply: true }, deps);
    const held = 'Shyam Metallics and Energy Ltd.';
    const heldKey = rowKeyForName(held) as string;
    // The admin edited ONE value on this row: a row hold, not a list hold (the list stays scraper-owned).
    await db.update(schema.peerCompanies).set({ peRatio: '22.50' }).where(and(eq(schema.peerCompanies.ipoId, IPO_ID), eq(schema.peerCompanies.normalizedName, heldKey)));
    await db.insert(schema.fieldProtectionMetadata).values({ ipoId: IPO_ID, tableName: `peer_companies:${heldKey}`, fieldName: 'peRatio', isProtected: true } as never);

    const rhp = loadExtraction();
    (rhp.fields.peer_companies as unknown as PeerList).value = peersOf(rhp).filter((p) => p.name !== held);
    await persistFilingExtraction(IPO_ID, rhp, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);

    const row = (await storedPeers()).find((r) => r.normalizedName === heldKey);
    expect(row, 'the held row survives').toBeDefined();
    expect(row!.peRatio).toBe('22.50');
    expect(await retiredFor(heldKey)).toHaveLength(0);
  });

  /** The Chittorgarh path: createPeerCompanies -> replaceForIpo with no document type. */
  async function chittorgarhList(peers: Array<{ companyName: string; peRatio?: number; eps?: number }>, repo = deps.peerCompanies as PeerCompanyRepository) {
    const { createPeerCompanies } = await import('../../src/services/data-persister.js');
    return createPeerCompanies(repo, IPO_ID, peers.map((p) => ({ ...p, isListed: true, dataSource: 'CHITTORGARH' })) as never);
  }

  it('§1.7 / OD-156: a Chittorgarh whole-list replace keeps every document peer, its figures and its stamp; it only adds peers and fills empty cells', async () => {
    await persistFilingExtraction(IPO_ID, JSON.parse(germanGreenJson) as FilingExtraction, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);
    const before = await storedPeers();
    expect(before).toHaveLength(5);
    // One empty figure cell on a document row (the gap rank 2 may fill).
    const gapKey = rowKeyForName('Kamdhenu Limited') as string;
    await db.update(schema.peerCompanies).set({ peRatio: null }).where(and(eq(schema.peerCompanies.ipoId, IPO_ID), eq(schema.peerCompanies.normalizedName, gapKey)));
    const docSourcesBefore = CHILD_CONSOLIDATION
      ? (await db.select().from(schema.fieldSources).where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.tableName, 'peer_companies')))).length
      : 0;

    // Chittorgarh names two document peers (one with a conflicting EPS, one filling the gap) and one new peer.
    await chittorgarhList([
      { companyName: 'Beekay Steel Industries Ltd', eps: 999 },
      { companyName: 'Kamdhenu Limited', peRatio: 31.5 },
      { companyName: 'S1166 Chittorgarh New Peer Ltd', peRatio: 9 },
    ]);

    const after = await storedPeers();
    const byKey = new Map(after.map((r) => [r.normalizedName, r]));
    for (const docRow of before) {
      const row = byKey.get(docRow.normalizedName);
      expect(row, docRow.companyName).toBeDefined();
      expect(row!.dataSource, docRow.companyName).toBe('DRHP');
      expect(row!.sourceDocumentType, docRow.companyName).toBe('RHP');
      for (const col of ['eps', 'dilutedEps', 'ronw', 'nav', 'pbvRatio'] as const) expect(row![col], `${docRow.companyName}.${col}`).toBe(docRow[col]);
    }
    expect(Number(byKey.get(rowKeyForName('Beekay Steel Industries Ltd') as string)!.eps)).toBeCloseTo(18.94, 2);
    expect(Number(byKey.get(gapKey)!.peRatio)).toBeCloseTo(31.5, 2);
    expect(after.find((r) => r.companyName === 'S1166 Chittorgarh New Peer Ltd')?.dataSource).toBe('CHITTORGARH');
    expect(after).toHaveLength(6);
    const retired = await db.select().from(schema.fieldSourcesRetired).where(eq(schema.fieldSourcesRetired.ipoId, IPO_ID));
    expect(retired).toHaveLength(0);
    // Round 3: the filled cell is recorded as Chittorgarh's; every other document cell keeps its document record.
    const cellSources = await liveSourcesFor(gapKey);
    expect(cellSources.find((r) => r.fieldName === 'peRatio')?.source).toBe('CHITTORGARH');
    if (CHILD_CONSOLIDATION) {
      const all = await db.select().from(schema.fieldSources).where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.tableName, 'peer_companies')));
      expect(all.filter((r) => r.source === 'CHITTORGARH').map((r) => `${r.rowKey}.${r.fieldName}`)).toEqual([`${gapKey}.peRatio`]);
      expect(all.length).toBeGreaterThanOrEqual(docSourcesBefore);
    }
  });

  /** A document row with one empty cell that Chittorgarh then fills (kamdhenu.peRatio = 31.5). */
  async function seedChittorgarhFilledCell() {
    await persistFilingExtraction(IPO_ID, JSON.parse(germanGreenJson) as FilingExtraction, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);
    const key = rowKeyForName('Kamdhenu Limited') as string;
    await db.update(schema.peerCompanies).set({ peRatio: null }).where(and(eq(schema.peerCompanies.ipoId, IPO_ID), eq(schema.peerCompanies.normalizedName, key)));
    await db.delete(schema.fieldSources).where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.rowKey, key), eq(schema.fieldSources.fieldName, 'peRatio')));
    await chittorgarhList([{ companyName: 'Kamdhenu Limited', peRatio: 31.5 }]);
    return key;
  }
  const cellOf = async (key: string, col: string) => (await liveSourcesFor(key)).find((r) => r.fieldName === col);
  const kamdhenuIn = (e: FilingExtraction) => peersOf(e).find((p) => p.name === 'Kamdhenu Limited')!;

  it('round 3: a Chittorgarh-filled cell on a document row is recorded as Chittorgarh and its cache keys are dropped', async () => {
    await persistFilingExtraction(IPO_ID, JSON.parse(germanGreenJson) as FilingExtraction, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);
    const key = rowKeyForName('Kamdhenu Limited') as string;
    await db.update(schema.peerCompanies).set({ peRatio: null }).where(and(eq(schema.peerCompanies.ipoId, IPO_ID), eq(schema.peerCompanies.normalizedName, key)));
    const cacheKey = `field-source:${IPO_ID}:peer_companies:${key}:peRatio`;
    await redis.set(cacheKey, '"stale"');
    await chittorgarhList([{ companyName: 'Kamdhenu Limited', peRatio: 31.5 }], new PeerCompanyRepository(db as never, redis as never));
    expect((await cellOf(key, 'peRatio'))?.source).toBe('CHITTORGARH');
    expect(await redis.exists(cacheKey)).toBe(0);
    const row = (await storedPeers()).find((r) => r.normalizedName === key)!;
    expect(row.dataSource).toBe('DRHP');
  });

  it('round 3: a later document read that PRINTS the cell replaces the Chittorgarh value and its record', async () => {
    const key = await seedChittorgarhFilledCell();
    const rhp = JSON.parse(germanGreenJson) as FilingExtraction;
    kamdhenuIn(rhp).pe = '25.50';
    await persistFilingExtraction(IPO_ID, rhp, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);
    const row = (await storedPeers()).find((r) => r.normalizedName === key)!;
    expect(Number(row.peRatio)).toBeCloseTo(25.5, 2);
    if (CHILD_CONSOLIDATION) expect((await cellOf(key, 'peRatio'))?.source).toBe('DRHP');
  });

  it('round 3: a later document read that prints NOTHING in the cell keeps the Chittorgarh value under its Chittorgarh record', async () => {
    const key = await seedChittorgarhFilledCell();
    const rhp = JSON.parse(germanGreenJson) as FilingExtraction;
    for (const k of ['pe', 'pe_basic']) kamdhenuIn(rhp)[k] = null;
    await persistFilingExtraction(IPO_ID, rhp, { docType: 'RHP', documentId: DOC_ID, apply: true }, deps);
    const row = (await storedPeers()).find((r) => r.normalizedName === key)!;
    expect(Number(row.peRatio)).toBeCloseTo(31.5, 2);
    expect((await cellOf(key, 'peRatio'))?.source).toBe('CHITTORGARH');
  });

  it('round 3: an ADMIN peer row with no list hold survives a Chittorgarh list, named or not', async () => {
    await seedNonDocumentPeers();
    const adminKey = rowKeyForName(ADMIN_ADDED) as string;
    await chittorgarhList([{ companyName: 'S1166 Chittorgarh New Peer Ltd', peRatio: 9 }]);
    let admin = (await storedPeers()).find((r) => r.normalizedName === adminKey);
    expect(admin?.dataSource).toBe('ADMIN');
    await chittorgarhList([{ companyName: ADMIN_ADDED, peRatio: 5 }, { companyName: 'S1166 Chittorgarh New Peer Ltd', peRatio: 9 }]);
    admin = (await storedPeers()).find((r) => r.normalizedName === adminKey);
    expect(admin?.dataSource).toBe('ADMIN');
    expect(admin?.peRatio).toBeNull();
  });

  it('round 3: an OLDER document list with DIFFERENT figures never overwrites a newer document figure', async () => {
    await persistFilingExtraction(IPO_ID, JSON.parse(germanGreenJson) as FilingExtraction, { docType: 'PROSPECTUS', documentId: DOC_ID, apply: true }, deps);
    const drhp = JSON.parse(germanGreenJson) as FilingExtraction;
    peersOf(drhp).find((p) => p.name === 'Beekay Steel Industries Ltd')!.eps_basic = '20.00';
    await persistFilingExtraction(IPO_ID, drhp, { docType: 'DRHP', documentId: DOC_ID, apply: true }, deps);
    const row = (await storedPeers()).find((r) => r.companyName === 'Beekay Steel Industries Ltd')!;
    expect(Number(row.eps)).toBeCloseTo(18.94, 2);
    expect(row.sourceDocumentType).toBe('PROSPECTUS');
  });

  it('OD-157: a Chittorgarh list that drops its own peer retires the source records and drops their cache keys', async () => {
    await seedNonDocumentPeers();
    const cgKey = rowKeyForName(CG_ONLY) as string;
    await db.insert(schema.fieldSources).values({ ipoId: IPO_ID, tableName: 'peer_companies', rowKey: cgKey, fieldName: 'peRatio', source: 'CHITTORGARH', confidence: 80 } as never);
    const cached = [`field-source:${IPO_ID}:peer_companies:${cgKey}:peRatio`, `field-sources:table:${IPO_ID}:peer_companies`, `field-sources:ipo:${IPO_ID}:all`];
    for (const k of cached) await redis.set(k, '"stale"');

    await chittorgarhList([{ companyName: 'S1166 Chittorgarh New Peer Ltd', peRatio: 9 }], new PeerCompanyRepository(db as never, redis as never));

    expect((await storedPeers()).map((r) => r.companyName)).not.toContain(CG_ONLY);
    expect(await liveSourcesFor(cgKey)).toHaveLength(0);
    const retired = await retiredFor(cgKey);
    expect(retired).toHaveLength(1);
    expect(retired[0].retiredReason).toMatch(/^replaced by /);
    for (const k of cached) expect(await redis.exists(k), k).toBe(0);
  });

  it('OD-156: a document list WITH figures from an OLDER type keeps the newer stamp on the rows it rewrites', async () => {
    await persistFilingExtraction(IPO_ID, JSON.parse(germanGreenJson) as FilingExtraction, { docType: 'PROSPECTUS', documentId: DOC_ID, apply: true }, deps);
    await persistFilingExtraction(IPO_ID, JSON.parse(germanGreenJson) as FilingExtraction, { docType: 'DRHP', documentId: DOC_ID, apply: true }, deps);
    const rows = await storedPeers();
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r.sourceDocumentType, r.companyName).toBe('PROSPECTUS');
  });

  it('r_child_provenance_orphan: the nightly SQL flags a seeded orphan on ipodhan_test, passes it once the row exists, and the repair retires only orphans', async () => {
    const orphanKey = 's1166 orphan probe';
    await db.insert(schema.fieldSources).values({ ipoId: IPO_ID, tableName: 'peer_companies', rowKey: orphanKey, fieldName: 'peRatio', source: 'CHITTORGARH', confidence: 80 } as never);
    const run = async () => (await pool.query(CHILD_PROVENANCE_ORPHAN_SQL)).rows.filter((r: { ipoId: string }) => r.ipoId === IPO_ID);
    expect((await run()).map((r: { rowKey: string; records: number }) => [r.rowKey, r.records])).toEqual([[orphanKey, 1]]);

    // The repair finds exactly that key (scoped to this IPO) and retires it with the pre-OD-157 reason.
    const found = await findOrphanPeerSourceKeys(db as never, [IPO_ID]);
    expect(found).toEqual([{ ipoId: IPO_ID, rowKey: orphanKey, records: 1 }]);
    const [result] = await retireOrphanPeerSources(db as never, found);
    expect(result.retiredKeys).toEqual([orphanKey]);
    expect(await liveSourcesFor(orphanKey)).toHaveLength(0);
    expect((await retiredFor(orphanKey)).map((r) => r.retiredReason)).toEqual([PRE_OD157_ORPHAN_REASON]);
    expect(await run()).toEqual([]);

    // A clean IPO: a record whose row exists is never flagged, and the repair leaves it live.
    await db.insert(schema.peerCompanies).values({ ipoId: IPO_ID, companyName: 'S1166 Orphan Probe', normalizedName: orphanKey, isListed: true, dataSource: 'CHITTORGARH', lastUpdated: new Date() } as never);
    await db.insert(schema.fieldSources).values({ ipoId: IPO_ID, tableName: 'peer_companies', rowKey: orphanKey, fieldName: 'eps', source: 'CHITTORGARH', confidence: 80 } as never);
    expect(await run()).toEqual([]);
    expect(await findOrphanPeerSourceKeys(db as never, [IPO_ID])).toEqual([]);
    // A stale scan never retires a key that gained a row: the repair re-reads under the lock.
    const [stale] = await retireOrphanPeerSources(db as never, [{ ipoId: IPO_ID, rowKey: orphanKey, records: 1 }]);
    expect(stale.retiredKeys).toEqual([]);
    expect(await liveSourcesFor(orphanKey)).toHaveLength(1);
  });
  }
);
