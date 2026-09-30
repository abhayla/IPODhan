/**
 * #1298 round 1 (MAJOR-1, MAJOR-2) on the real database (ipodhan_test only): after a relaunch the
 * values §2.9 empties are REFILLED, and the relaunch never wipes its own new terms.
 *
 *   MAJOR-1: postpone -> OD-83 relaunch (BSE 7794 -> 7900, Dhanwel shape, F-131) -> the document plan
 *   (the real `loadCandidateIpos` + the real DocumentFetchStateRepository) asks for the RHP -> the real
 *   DocumentDiscoveryRunner finds it (SEBI listing fixtures, network stubbed) and stores it through the
 *   real DocumentRepository -> the real filing persister writes the relaunch RHP's issue size, lot size
 *   and face value where the relaunch had emptied them. The extraction JSON is supplied (the PDF parser
 *   is not under test here).
 *
 *   MAJOR-2: production order — persistFilingExtraction writes the new RHP's values BEFORE
 *   writeReceiptAndReopen runs the relaunch clear. A value written after the relaunch RHP was
 *   discovered survives that clear.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test REDIS_URL=redis://127.0.0.1:6379/15 \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/postponed-relaunch-refill-1298.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';

process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';

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
import { DocumentRepository, DocumentFetchStateRepository } from '@ipodhan/shared';
import { PeerCompanyRepository } from '../../src/repositories/peer-company-repository.js';
import type { FilingExtraction, FilingPersisterDeps, IpoDetailsWriter } from '../../src/services/filing-persister.js';
// Types only: the runner (and feature-flags.ts behind it) is imported dynamically, after the flags above
// are set, because feature-flags.ts bakes process.env at module load (rhp-promoters-peers-persist does the same).
import type { HttpFetcher, HttpResponse } from '../../src/services/document-discovery-runner.js';
import { NetworkCounter } from '../../src/utils/network-counter.js';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const REFILL = '00000000-0000-4000-8000-00000000a991';
const KEEPNEW = '00000000-0000-4000-8000-00000000a992';
const ALL = [REFILL, KEEPNEW];
const FIXTURES = join(__dirname, '../fixtures/documents');
const fixture = (n: string) => readFileSync(join(FIXTURES, n), 'utf8');
const html = (body: string, url = 'https://x/page'): HttpResponse => ({ status: 200, contentType: 'text/html; charset=utf-8', body: Buffer.from(body), url });
const pdf = (url = 'https://x/doc.pdf'): HttpResponse => ({
  status: 200,
  contentType: 'application/pdf',
  body: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('R'.repeat(80_000))]),
  url,
});
const dead: HttpResponse = { status: 0, contentType: null, body: Buffer.alloc(0), url: 'x' };
const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
  keys: async () => [], scan: async () => ['0', []],
} as never;

let pool: Pool;
let redis: Redis;
let db: ReturnType<typeof drizzle<typeof schema>>;
let deps: FilingPersisterDeps;
let persistFilingExtraction: typeof import('../../src/services/filing-persister.js').persistFilingExtraction;
let storeDir: string;
const rows = (r: any) => (r.rows ?? r) as any[];
const tick = () => new Promise((r) => setTimeout(r, 25));
const docValues = async (ipoId: string) =>
  rows(await db.execute(sql`
    SELECT issue_size::text AS "issueSize", lot_size::text AS "lotSize", face_value::text AS "faceValue" FROM ipos WHERE id = ${ipoId}::uuid`))[0];

/** The relaunch RHP's own terms (Dhanwel relaunch shape: same 2,700,000 shares, new band 100-105). */
const RELAUNCH_EXTRACTION: FilingExtraction = {
  doc_type: 'RHP',
  unit: 'million',
  fields: {
    total_offer_amount_at_cap: { value: 283.5, page: 1, check: { name: 'test_fixture', passed: true } },
    price_band_floor: { value: 100, page: 1, check: { name: 'test_fixture', passed: true } },
    price_band_cap: { value: 105, page: 1, check: { name: 'test_fixture', passed: true } },
    lot_size: { value: 1200, page: 1, check: { name: 'test_fixture', passed: true } },
    face_value: { value: 10, page: 1, check: { name: 'test_fixture', passed: true } },
  },
};

async function seedPostponed(ipoId: string, i: number) {
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, status, segment, offering_type, listing_exchanges, issue_size, lot_size, face_value,
                      open_date, close_date, price_range_min, price_range_max)
    VALUES (${ipoId}::uuid, 'ESDS Software Solution Limited', ${`esds-1298-refill-${i}`}, 'UPCOMING', 'SME', 'IPO', '["BSE"]',
            267300000, 1200, 10, '2026-06-23', '2026-06-25', 95, 99)`);
  for (const f of ['issueSize', 'lotSize', 'faceValue']) {
    await db.execute(sql`
      INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, created_at)
      VALUES (${ipoId}::uuid, 'ipos', '', ${f}, 'DRHP', 95, now() - interval '10 days', now() - interval '10 days')`);
  }
  // The old offer's RHP was read; the postponement (before #1298) closed every other row NOT_APPLICABLE.
  await db.execute(sql`
    INSERT INTO document_fetch_state (ipo_id, doc_type, state, attempts, last_attempt_at)
    VALUES (${ipoId}::uuid, 'RHP', 'EXTRACTED', 1, now() - interval '10 days'),
           (${ipoId}::uuid, 'DRHP', 'EXTRACTED', 1, now() - interval '10 days'),
           (${ipoId}::uuid, 'PRICE_BAND_AD', 'NOT_APPLICABLE', 1, now() - interval '9 days'),
           (${ipoId}::uuid, 'CORRIGENDUM', 'NOT_APPLICABLE', 1, now() - interval '9 days')`);
  await db.execute(sql`UPDATE ipos SET status = 'POSTPONED' WHERE id = ${ipoId}::uuid`);
  await db.execute(sql`
    INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, updated_at)
    VALUES (${ipoId}::uuid, 'ipos', '', 'status', 'BSE', now())`);
  await tick();
}

async function cleanup() {
  for (const id of ALL) {
    await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${id}::uuid`);
    await db.execute(sql`DELETE FROM ipos WHERE id = ${id}::uuid`);
  }
}

describe.skipIf(!DATABASE_URL)('#1298 a relaunch refills what it emptied, and never wipes its own new terms (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
    redis = new Redis(REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
    await redis.connect();
    storeDir = await fsp.mkdtemp(join(os.tmpdir(), 'c4-1298-'));
    ({ persistFilingExtraction } = await import('../../src/services/filing-persister.js'));
    const { DataConsolidationOrchestrator } = await import('../../src/services/data-consolidation-orchestrator.js');
    const ipoRepository = new IPORepository(db as never, redis as never);
    const fieldSources = new FieldSourcesRepository(db as never, redis as never);
    const ipoDetailsWriter: IpoDetailsWriter = {
      async upsert(ipoId, values) {
        await db.insert(schema.ipoDetails).values({ ipoId, ...values, updatedAt: new Date() } as never)
          .onConflictDoUpdate({ target: schema.ipoDetails.ipoId, set: { ...values, updatedAt: new Date() } as never });
      },
      async insertIfMissing(ipoId, values) {
        const r = await db.insert(schema.ipoDetails).values({ ipoId, ...values } as never).onConflictDoNothing({ target: schema.ipoDetails.ipoId });
        return (r.rowCount ?? 0) > 0;
      },
    };
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
      childRowConsolidator: new DataConsolidationOrchestrator(
        ipoRepository, fieldSources, new DataConflictsRepository(db as never, redis as never), redis as never,
        new ListingPerformanceRepository(db as never, redis as never)
      ),
    } as never;
    await cleanup();
  }, 60_000);
  afterAll(async () => {
    if (pool) {
      await cleanup();
      await pool.end();
    }
    await redis?.quit();
    if (storeDir) await fsp.rm(storeDir, { recursive: true, force: true });
  });

  it('MAJOR-1: postpone -> OD-83 relaunch -> the plan asks for the RHP -> the real discovery path stores it -> the emptied values are refilled', async () => {
    await seedPostponed(REFILL, 0);
    const { clearAdminValuesOnSourceKeyRelaunch } = await import('../../src/services/relaunch-clear.js');
    const repo = new IPORepository(db as never, noRedis);
    const attrs = { shares: 2_700_000, priceMin: 95, priceMax: 99 };
    // 7794 was bound before the postponement; bind it with an old change time.
    await repo.bindSourceKeys(REFILL, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '97794', attrs: { ...attrs, postponed: true }, recordOpenDate: '2026-06-23' }] as never, {
      boundVia: 'BACKFILL', boundBy: 'c4-1298.test',
    });
    await repo.bindSourceKeys(REFILL, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '97900', attrs, recordOpenDate: '2026-08-19' }] as never, {
      boundVia: 'BACKFILL', boundBy: 'c4-1298.test',
      onSupersede: async (tx, id, superseded) => void (await clearAdminValuesOnSourceKeyRelaunch(tx, id, superseded)),
    });
    expect(await docValues(REFILL)).toEqual({ issueSize: null, lotSize: null, faceValue: null });
    const plan = Object.fromEntries(
      rows(await db.execute(sql`SELECT doc_type::text AS t, state::text AS s FROM document_fetch_state WHERE ipo_id = ${REFILL}::uuid`)).map((r) => [r.t, r.s])
    );
    expect(plan).toEqual({ RHP: 'WANTED', DRHP: 'EXTRACTED', PRICE_BAND_AD: 'WANTED', CORRIGENDUM: 'WANTED' });

    // The exchange's relaunch record: status UPCOMING, the new window 3 days out (the IPO's DB clock).
    await db.execute(sql`
      UPDATE ipos SET status = 'UPCOMING', open_date = (now() + interval '3 days')::date, close_date = (now() + interval '5 days')::date
       WHERE id = ${REFILL}::uuid`);

    // The real document plan: the candidate loader and the fetch-state repository.
    const store = new DocumentFetchStateRepository(db as never, redis as never);
    const documents = new DocumentRepository(db as never, redis as never);
    const { loadCandidateIpos } = await import('../../src/services/document-cycle.js');
    const { candidates } = await loadCandidateIpos({ store, documents } as never);
    const candidate = candidates.find((c) => c.id === REFILL);
    expect(candidate?.stage).toBe('PRE_OPEN');

    const fetcher: HttpFetcher = async (url) => {
      const routes: Record<string, HttpResponse> = {
        IPO_HomePageDetail: dead,
        GetMkt_ISSUE_BBS_IPO: dead,
        'ipo-detail': dead,
        'smid=11': html(fixture('sebi-rhp-listing.html')),
        'esds-software-solution-limited-rhp': html(fixture('sebi-detail-esds.html')),
        'attachdocs/aug-2026/1787651434841.pdf': pdf(url),
      };
      for (const [needle, res] of Object.entries(routes)) if (url.includes(needle)) return res;
      return { status: 404, contentType: 'text/html', body: Buffer.from('x'), url };
    };
    const { DocumentDiscoveryRunner, toStateRow } = await import('../../src/services/document-discovery-runner.js');
    const runner = new DocumentDiscoveryRunner({
      fetcher, store, documents, counter: new NetworkCounter(), storeDir,
      sleep: async () => undefined,
      resolveIsPrivate: async () => false,
      extractCoverText: async () => ({ usable: true, text: 'ESDS Software Solution Limited red herring prospectus' }),
    } as never);
    const stateRows = (await store.listForIpo(REFILL)).map(toStateRow as never);
    const result = await runner.runIpo(candidate!, stateRows as never);
    expect(result.due).toContain('RHP');
    expect(result.found).toContain('RHP');
    const rhp = rows(await db.execute(sql`SELECT id FROM documents WHERE ipo_id = ${REFILL}::uuid AND type = 'RHP'`));
    expect(rhp).toHaveLength(1);

    const out = await persistFilingExtraction(REFILL, RELAUNCH_EXTRACTION, { docType: 'RHP', documentId: rhp[0].id, apply: true }, deps);
    expect(await docValues(REFILL), JSON.stringify(out).slice(0, 1500)).toEqual({ issueSize: '283500000.00', lotSize: '1200', faceValue: '10' });
  }, 180_000);

  it('MAJOR-2: production order - relaunch detected against the values stored BEFORE the document writes, invalidation first, then the persist refills; the post-persist clear keeps the new terms', async () => {
    await seedPostponed(KEEPNEW, 1);
    await db.execute(sql`UPDATE field_sources SET updated_at = now() - interval '1 minute' WHERE ipo_id = ${KEEPNEW}::uuid AND field_name = 'status'`);
    // Discovered 30 s ago on the DB clock (after the postponement, before extraction).
    const docId = rows(await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status, sequence_number, created_at)
      VALUES (${KEEPNEW}::uuid, 'RHP', 'relaunch RHP', 'https://example.test/c4-1298-keepnew.pdf', 'COMPLETED', 1, now() - interval '30 seconds')
      RETURNING id`))[0].id;
    const { relaunchClearBeforePersist, writeReceiptAndReopen } = await import('../../src/services/filing-auto-persist.js');
    const pre = await relaunchClearBeforePersist(db as never, KEEPNEW, { id: docId, type: 'RHP' }, RELAUNCH_EXTRACTION, deps);
    expect(pre?.documentType).toBe('RHP');
    expect((pre?.invalidated ?? []).map((v) => v.fieldName).sort()).toEqual(['faceValue', 'issueSize', 'lotSize']);
    expect(await docValues(KEEPNEW)).toEqual({ issueSize: null, lotSize: null, faceValue: null });

    const persisted = await persistFilingExtraction(KEEPNEW, RELAUNCH_EXTRACTION, { docType: 'RHP', documentId: docId, apply: true }, deps);
    expect(await docValues(KEEPNEW)).toEqual({ issueSize: '283500000.00', lotSize: '1200', faceValue: '10' });

    // Second layer: the COMPLETED transaction's clear still sees a relaunch filing (through the band's
    // previous value), and the values this document wrote after it was discovered are kept.
    const receipt = (persisted.receipt_fields ?? []).map((f: any) => ({
      tableName: f.tableName, rowKey: f.rowKey ?? '', fieldName: f.fieldName, value: f.value == null ? null : String(f.value),
    }));
    const done = await writeReceiptAndReopen(db as never, { id: docId, ipoId: KEEPNEW, type: 'RHP', filingDate: '2026-08-10', sha256: null }, receipt);
    expect(done.relaunchCleared).not.toBeNull();
    expect(done.relaunchCleared?.invalidated ?? []).toEqual([]);
    expect(await docValues(KEEPNEW)).toEqual({ issueSize: '283500000.00', lotSize: '1200', faceValue: '10' });
  }, 180_000);
});
