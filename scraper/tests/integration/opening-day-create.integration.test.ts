import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import {
  IPORepository,
  FieldSourcesRepository,
  resolveIpoRow,
  inferBoundVia,
  withSourceKeyLineage,
  createFieldProtectionService,
  SOURCE_KEY_NO_WRITE_ERROR_NAMES,
} from '@ipodhan/shared';
import { DataConflictsRepository } from '@ipodhan/shared/repositories';
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import { createOpeningDayWriter, createProvenanceRecorder, runOpeningDayDiscovery } from '../../src/scheduler/opening-day-discovery';
import { fetchCurrentIssueList } from '../../src/scrapers/nse-api-client';
import { fetchBSEBoard } from '../../src/scrapers/bse-api-scraper';
import { DataConsolidationService } from '../../src/services/data-consolidation-service';
import { normalizeCompanyNameForMatching, computeIpoIdentitySlug } from '../../src/services/data-persister';
import { logger } from '../../src/utils/logger';

/**
 * Item 7 S4 round 5 (spec §2.1 opening-day row, OD-87, OD-88). The CORE proof on
 * Postgres (ipodhan_test): the opening-day check CREATES a brand-new IPO from the
 * NSE list through the REAL `IPORepository.create` (the #860 segment guard runs, not
 * a fake), writes only identity, status, dates and the NSE-stated segment, and
 * writes one `field_sources` row per written column. A BSE-only newcomer is not
 * created and is logged by name with the reason.
 *
 * Inputs are the REAL saved list payloads, served through the REAL list fetchers:
 * - NSE: scraper/tests/fixtures/nse/ipo-current-issue.live-2026-08-22.json
 *   (Augmont Enterprises Limited, series EQ, 21-Aug-2026 to 25-Aug-2026)
 * - BSE: scraper/tests/fixtures/documents/bse-ipo-homepage.json
 *   (Kwick Forensic Solutions Limited IPO_NO 7913 and Lumino Industries Limited
 *   IPO_NO 7910, both open 2026-08-27)
 *
 * To run (from scraper/):
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/opening-day-create.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const FIXTURES = join(__dirname, '..', 'fixtures');
const NSE_LIST = readFileSync(join(FIXTURES, 'nse', 'ipo-current-issue.live-2026-08-22.json'), 'utf8');
const BSE_BOARD = readFileSync(join(FIXTURES, 'documents', 'bse-ipo-homepage.json'), 'utf8');

const NAMES = ['Augmont Enterprises Limited', 'Tempsens Instruments (India) Limited', 'Kwick Forensic Solutions Limited', 'Lumino Industries Limited'];

/** 09:45 IST on the given day. */
const at = (day: string) => new Date(`${day}T04:15:00Z`);

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
  keys: async () => [], scan: async () => ['0', []],
} as never;

async function cleanup() {
  const rows = await db!.select({ id: schema.ipos.id }).from(schema.ipos).where(inArray(schema.ipos.companyName, NAMES));
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;
  await db!.delete(schema.ipoSourceKeys).where(inArray(schema.ipoSourceKeys.ipoId, ids));
  await db!.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, ids));
  await db!.delete(schema.dataConflicts).where(inArray(schema.dataConflicts.ipoId, ids));
  await db!.delete(schema.ipoSlugRedirects).where(inArray(schema.ipoSlugRedirects.ipoId, ids));
  await db!.delete(schema.ipos).where(inArray(schema.ipos.id, ids));
}

function serveRealLists() {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    calls.push(String(u));
    if (String(u).includes('/api/ipo-current-issue')) return new Response(NSE_LIST, { status: 200 });
    if (String(u).includes('IPO_HomePageDetail')) return new Response(BSE_BOARD, { status: 200 });
    return new Response('<html></html>', { status: 200, headers: { 'set-cookie': 'nsit=1; Path=/' } });
  }));
  return calls;
}

function realWriter() {
  const repo = new IPORepository(db as never, noRedis);
  const fieldSources = new FieldSourcesRepository(db as never, noRedis);
  const recorder = createProvenanceRecorder(fieldSources);
  const decision = new DataConsolidationService(
    recorder.repo,
    new DataConflictsRepository(db as never, noRedis),
    new ListingPerformanceRepository(db as never, noRedis)
  );
  const createSpy = vi.spyOn(repo, 'create');
  const ledger: Array<{ ipoId: string; info: any }> = [];
  const writeRow = createOpeningDayWriter({
    ipoRepository: repo as any,
    resolveIpoRow: resolveIpoRow as any,
    inferBoundVia: inferBoundVia as any,
    withSourceKeyLineage,
    noWriteErrorNames: SOURCE_KEY_NO_WRITE_ERROR_NAMES,
    fieldProtection: createFieldProtectionService(db as never, null) as any,
    consolidateFields: (input) => decision.consolidateIPOData(input as any) as any,
    fieldSources: fieldSources as any,
    sourceTrackingEnabled: true,
    decisionProvenance: recorder,
    afterWrite: async (ipoId, info) => { ledger.push({ ipoId, info }); },
    normalizeName: normalizeCompanyNameForMatching,
    identitySlug: computeIpoIdentitySlug as any,
  });
  return { writeRow, createSpy, ledger };
}

async function rowsNamed(name: string) {
  return db!.select().from(schema.ipos).where(eq(schema.ipos.companyName, name));
}
async function provenanceOf(ipoId: string) {
  return db!.select().from(schema.fieldSources).where(eq(schema.fieldSources.ipoId, ipoId));
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
  db = drizzle(pool, { schema });
});
beforeEach(async () => { if (db) await cleanup(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
afterAll(async () => { if (db) await cleanup(); await pool?.end(); });

describe.skipIf(!DATABASE_URL)('opening-day check creates from the NSE list through the real create path (OD-87, OD-88)', () => {
  it('CORE: Augmont (NSE list, opens 2026-08-21) is created with identity, status, dates and segment, and one field_sources row per column', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-08-21'));
    const calls = serveRealLists();
    const { writeRow, createSpy, ledger } = realWriter();

    const summary = await runOpeningDayDiscovery(
      { fetchNseList: fetchCurrentIssueList, fetchBseList: fetchBSEBoard, storedOpeningOn: async () => [], writeRow },
      at('2026-08-21')
    );

    expect(summary.failures).toEqual([]);
    expect(summary.written).toEqual([{ source: 'NSE', companyName: 'Augmont Enterprises Limited', key: expect.any(String), outcome: 'inserted' }]);
    expect(createSpy).toHaveBeenCalledTimes(1);

    // The exact insert payload: identity (name, slug), status, the two dates, the NSE-stated segment, offeringType.
    expect(Object.keys(createSpy.mock.calls[0][0]).sort()).toEqual(
      ['closeDate', 'companyName', 'offeringType', 'openDate', 'segment', 'slug', 'status']
    );

    const [row] = await rowsNamed('Augmont Enterprises Limited');
    expect(row).toBeDefined();
    expect(row.segment).toBe('MAINBOARD');
    expect(row.offeringType).toBe('IPO');
    expect(String(row.openDate).slice(0, 10)).toBe('2026-08-21');
    expect(String(row.closeDate).slice(0, 10)).toBe('2026-08-25');
    expect(row.status).toBe('OPEN');
    // Nothing else the NSE list carries was written.
    expect(row.priceRangeMin).toBeNull();
    expect(row.priceRangeMax).toBeNull();
    expect(row.issueSize).toBeNull();
    expect(row.lotSize).toBeNull();
    expect(row.listingExchanges ?? null).toBeNull();

    // Provenance: exactly one row per written column (slug is derived, not stated).
    const prov = await provenanceOf(row.id);
    expect(prov.map((p) => p.fieldName).sort()).toEqual(['closeDate', 'companyName', 'offeringType', 'openDate', 'segment', 'status']);
    expect(prov.every((p) => p.source === 'NSE' && p.tableName === 'ipos')).toBe(true);

    // The step ledger claims exactly the rows written.
    expect(ledger).toHaveLength(1);
    expect(ledger[0].info.created).toBe(true);
    expect(ledger[0].info.fieldSources.slice().sort()).toEqual(prov.map((p) => p.fieldName).sort());

    // The OD-85 source key was bound in the create transaction.
    const keys = await db!.select().from(schema.ipoSourceKeys).where(eq(schema.ipoSourceKeys.ipoId, row.id));
    expect(keys.map((k) => k.keyType)).toContain('NSE_ISSUE');

    // Two list calls, nothing per row (§7.4).
    const apiCalls = calls.filter((u) => u.includes('/api/') || u.includes('bseindia'));
    expect(apiCalls).toHaveLength(2);
  });

  it('an update of a stored row writes a field_sources row for every column it SETs, and the ledger count equals the rows in the table', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-08-21'));
    serveRealLists();
    const first = realWriter();
    await runOpeningDayDiscovery(
      { fetchNseList: fetchCurrentIssueList, fetchBseList: fetchBSEBoard, storedOpeningOn: async () => [], writeRow: first.writeRow },
      at('2026-08-21')
    );
    const [row] = await rowsNamed('Augmont Enterprises Limited');
    // Stored state drifts: status still UPCOMING, and no provenance at all.
    await db!.update(schema.ipos).set({ status: 'UPCOMING' }).where(eq(schema.ipos.id, row.id));
    await db!.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, row.id));

    const second = realWriter();
    const summary = await runOpeningDayDiscovery(
      { fetchNseList: fetchCurrentIssueList, fetchBseList: fetchBSEBoard, storedOpeningOn: async () => [], writeRow: second.writeRow },
      at('2026-08-21')
    );
    expect(summary.written.map((w) => w.outcome)).toEqual(['updated']);
    expect(second.createSpy).not.toHaveBeenCalled();
    const [after] = await rowsNamed('Augmont Enterprises Limited');
    expect(after.status).toBe('OPEN');
    expect(after.segment).toBe('MAINBOARD');

    const prov = await provenanceOf(row.id);
    expect(second.ledger).toHaveLength(1);
    expect(second.ledger[0].info.fields).toEqual(['status']);
    expect(prov.map((p) => p.fieldName).sort()).toEqual(second.ledger[0].info.fieldSources.slice().sort());
    expect(prov.map((p) => p.fieldName)).toContain('status');
  });

  it('BSE-only newcomers (Kwick Forensic 7913, Lumino 7910, open 2026-08-27) are NOT created, and each is logged by name with the reason', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-08-27'));
    serveRealLists();
    const info = vi.spyOn(logger, 'info');
    const { writeRow, createSpy, ledger } = realWriter();

    const summary = await runOpeningDayDiscovery(
      { fetchNseList: fetchCurrentIssueList, fetchBseList: fetchBSEBoard, storedOpeningOn: async () => [], writeRow },
      at('2026-08-27')
    );

    expect(summary.written.map((w) => [w.companyName, w.outcome]).sort()).toEqual([
      ['Kwick Forensic Solutions Limited', 'deferred'],
      ['Lumino Industries Limited', 'deferred'],
    ]);
    expect(createSpy).not.toHaveBeenCalled();
    expect(ledger).toHaveLength(0);
    expect(await rowsNamed('Kwick Forensic Solutions Limited')).toHaveLength(0);
    expect(await rowsNamed('Lumino Industries Limited')).toHaveLength(0);
    const lines = info.mock.calls.map((c) => String(c[1] ?? ''));
    for (const name of ['Kwick Forensic Solutions Limited', 'Lumino Industries Limited']) {
      expect(lines.some((l) => l.includes(`"${name}" not created`) && l.includes('BSE list only') && l.includes('OD-88'))).toBe(true);
    }
  });
});
