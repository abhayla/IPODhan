// implements: #545 real-DB persist proof — RHP promoters + peers with DOC provenance
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray, and } from 'drizzle-orm';
import { Redis } from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
// Relative imports, NOT the `@ipodhan/shared` alias — a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout
// (same guard as field-plan-walk-real-writer.integration.test.ts and
// peer-company-replace-atomicity.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';
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
 * The extraction payload is never hand-typed. It is the RECORDED output of
 * `extract_filing.run()` (the Python extractor `filing-persister.ts` is fed
 * from in production) called against pages taken from TWO real, committed
 * fixtures for the same issuer's RHP — `a-one-steels-india-ltd-rhp-cover-
 * pages.json` (promoters, `test_extract_filing_rhp_promoters.py`) and
 * `a-one-steels-india-ltd-rhp-peer-pages.json` (peers,
 * `test_extract_filing_rhp_peers.py`) — concatenated so one `FilingExtraction`
 * envelope carries both fields from one real document, exactly as
 * `a-one-steels-india-ltd-rhp-promoters-peers-extraction.json` records
 * (regeneration command in its sibling `.meta.json`).
 *
 * Follows the REAL-orchestrator pattern of
 * field-plan-walk-real-writer.integration.test.ts (real Pool + real ioredis +
 * dynamic import of the feature-flag-baked modules AFTER env vars are set)
 * and the delete-then-insert seeding pattern of
 * peer-company-replace-atomicity.integration.test.ts.
 *
 * SKIPS CLEANLY when no database is configured.
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *   REDIS_URL=redis://localhost:6379/15 \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/rhp-promoters-peers-persist.integration.test.ts
 */

// Baked at module-eval time by feature-flags.ts — set BEFORE any static
// import of filing-persister.js / data-consolidation-orchestrator.js, same
// reasoning as field-plan-walk-real-writer.integration.test.ts's top-of-file
// comment. This file only ever imports those two modules dynamically, in
// beforeAll, after these lines run.
process.env.ENABLE_CHILD_TABLE_CONSOLIDATION = 'true';
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const SKIP_REASON = '#545: DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-0000000545a1';
const DOC_ID = '00000000-0000-4000-8000-0000000545d1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(
  __dirname,
  '..',
  'fixtures',
  'extractor',
  'a-one-steels-india-ltd-rhp-promoters-peers-extraction.json'
);

/** The recorded, real extractor output — loaded fresh per test so a mutation never leaks. */
function loadExtraction(): FilingExtraction {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf-8');
  return JSON.parse(raw) as FilingExtraction;
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
  await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
  await db.delete(schema.promoters).where(eq(schema.promoters.ipoId, IPO_ID));
  await db.delete(schema.documents).where(eq(schema.documents.id, DOC_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
}

describe.skipIf(!DATABASE_URL)(`#545 RHP promoters + peers persist with provenance (${SKIP_REASON})`, () => {
  beforeAll(async () => {
    if (!DATABASE_URL) return;
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
      peerCompanies: new PeerCompanyRepository(db as never),
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

  it('field_sources rows record source DOC (the offer document — scraperSourceForDocType) with the promoters/peer_companies table_name and row_key', async () => {
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
});
