// implements: item 17 (#717) -- the closed-IPO job must extract the stuck
// document it selected an IPO for, and must never record DONE while that
// document is still PENDING.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
// Relative import, NOT the alias -- see field-plan-walk-real-writer.integration.test.ts.
import * as schema from '../../../packages/shared/src/db/schema';

/**
 * Staging, 2026-09-23 (#717): ten closed IPOs were selected because each holds
 * a PENDING PROSPECTUS; the job ran only the field-plan walk, those IPOs have
 * zero plan rows, the walk returned NO_DUE_FIELDS, and all ten were written
 * DONE -- never to be re-picked. PROSPECTUS PENDING: 74 before, 74 after.
 *
 * This file runs the REAL `runClosedIpoJob` against ipodhan_test with the REAL
 * extraction entry point (`processPendingFilings` via `buildAutoPersistDeps`:
 * real document-state writes, real persist door). The document text is REAL:
 * the Deepa Jewellers RHP page text captured from the live document
 * (tests/fixtures/extractor/deepa-rhp-pages.json, used by extract-filing.test.ts),
 * fed to the real extract_filing.py through its --texts seam. The only seam is
 * that the runner reads that captured text instead of a PDF on disk, because
 * no PDF is committed to the repository.
 *
 * The IPO has ZERO ipo_field_plan rows -- the exact shape that produced the
 * false DONE.
 *
 * To run:
 *   npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/closed-ipo-job-extracts-documents.integration.test.ts
 */

process.env.ENABLE_FILING_AUTO_PERSIST = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'item-17: SKIPPED -- DATABASE_URL not set';

const IPO_OK = '00000000-0000-4000-8000-00000000717a';
const IPO_FAIL = '00000000-0000-4000-8000-00000000717b';
const SHA_OK = 'a717'.repeat(16);
const SHA_FAIL = 'b717'.repeat(16);
const VERSION = 'closed-ipo-job@integration-717';

type RunJob = typeof import('../../src/scheduler/closed-ipo-job.js').runClosedIpoJob;
type ExtractDocs = typeof import('../../src/scheduler/closed-ipo-job.js').extractClosedIpoDocuments;
type ClassifyPass = typeof import('../../src/scheduler/closed-ipo-job.js').classifyExtractionPass;
type BuildDeps = typeof import('../../src/services/filing-auto-persist.js').buildAutoPersistDeps;

function runRealExtractorOnCapturedText(): unknown {
  const scraperDir = path.resolve(__dirname, '../..');
  const res = spawnSync(
    process.env.PYTHON_BIN?.trim() || 'python',
    [
      'scripts/extract_filing.py',
      '--texts',
      'tests/fixtures/extractor/deepa-rhp-pages.json',
      '--doc-type',
      'PROSPECTUS',
    ],
    { cwd: scraperDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 }
  );
  if (res.status !== 0) throw new Error(`extract_filing.py exited ${res.status}: ${res.stderr?.slice(-400)}`);
  return JSON.parse(res.stdout);
}

describe.skipIf(!DATABASE_URL)(`closed-IPO job extracts the documents it selected (${RUN_LABEL})`, () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let runClosedIpoJob: RunJob;
  let extractClosedIpoDocuments: ExtractDocs;
  let classifyExtractionPass: ClassifyPass;
  let buildAutoPersistDeps: BuildDeps;
  let storeDir: string;
  let extraction: unknown;

  async function cleanup(): Promise<void> {
    for (const id of [IPO_OK, IPO_FAIL]) {
      await db.execute(sql`DELETE FROM closed_ipo_resourcing WHERE ipo_id = ${id}::uuid`);
      await db.execute(sql`DELETE FROM document_pages WHERE document_id IN (SELECT id FROM documents WHERE ipo_id = ${id}::uuid)`);
      await db.delete(schema.documents).where(eq(schema.documents.ipoId, id));
      await db.execute(sql`DELETE FROM ipos WHERE id = ${id}::uuid`);
    }
  }

  async function seed(id: string, slug: string, name: string, sha: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, segment, status, open_date, close_date)
      VALUES (${id}::uuid, ${name}, ${slug}, 'MAINBOARD', 'MAINBOARD', 'LISTED', '2026-06-10', '2026-06-12')
    `);
    await db.insert(schema.documents).values({
      ipoId: id,
      type: 'PROSPECTUS',
      title: `${name} Prospectus`,
      url: `https://example.test/${slug}-prospectus.pdf`,
      sha256: sha,
      extractionStatus: 'PENDING',
    } as never);
  }

  async function docStatus(id: string): Promise<string> {
    const r = await pool.query('SELECT extraction_status FROM documents WHERE ipo_id = $1', [id]);
    return String(r.rows[0]?.extraction_status);
  }

  async function ledger(id: string): Promise<Record<string, unknown> | undefined> {
    const r = await pool.query(
      'SELECT outcome::text, cause_class::text, cause_detail FROM closed_ipo_resourcing WHERE ipo_id = $1',
      [id]
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 3, options: '-c timezone=UTC' });
    const cur = await pool.query('select current_database()');
    if (cur.rows[0].current_database !== 'ipodhan_test') {
      throw new Error(`Refusing to run against ${cur.rows[0].current_database}; ipodhan_test only`);
    }
    db = drizzle(pool, { schema });
    ({ runClosedIpoJob, extractClosedIpoDocuments, classifyExtractionPass } = await import(
      '../../src/scheduler/closed-ipo-job.js'
    ));
    ({ buildAutoPersistDeps } = await import('../../src/services/filing-auto-persist.js'));

    extraction = runRealExtractorOnCapturedText();
    storeDir = mkdtempSync(path.join(os.tmpdir(), 'closed-ipo-717-'));
    await cleanup();
    await seed(IPO_OK, 'item17-closed-ipo-extract-ok', 'Item17 Closed Extract Ok Ltd.', SHA_OK);
    await seed(IPO_FAIL, 'item17-closed-ipo-extract-fail', 'Item17 Closed Extract Fail Ltd.', SHA_FAIL);
    const plan = await pool.query(
      'SELECT count(*)::int AS n FROM ipo_field_plan WHERE ipo_id = ANY($1::uuid[])',
      [[IPO_OK, IPO_FAIL]]
    );
    expect(plan.rows[0].n).toBe(0);
  }, 180_000);

  afterAll(async () => {
    if (!pool) return;
    await cleanup();
    await pool.end();
  });

  function resourcer(mode: 'real-text' | 'extractor-fails') {
    return async (_id: string, candidate: Parameters<ExtractDocs>[0]) => {
      const deps = buildAutoPersistDeps();
      deps.storeDir = storeDir;
      deps.fileExists = () => true;
      deps.runExtractor = () =>
        mode === 'real-text'
          ? ({ ok: true, extraction } as never)
          : { ok: false, error: 'integration-717: extractor made to fail' };
      const pass = await extractClosedIpoDocuments(candidate, deps);
      return { ...classifyExtractionPass(pass), fieldsWritten: 0, fieldsLeftEmpty: 0 };
    };
  }

  it('a zero-plan-row IPO with a PENDING PROSPECTUS ends with the document read, not left PENDING', async () => {
    expect(await docStatus(IPO_OK)).toBe('PENDING');
    const summary = await runClosedIpoJob({
      db: db as never,
      isCycleLockHeld: async () => false,
      resourceIpo: resourcer('real-text'),
      resourcedAtVersion: VERSION,
      restrictToIpoIds: [IPO_OK],
    });
    expect(summary.attempted).toBe(1);
    const status = await docStatus(IPO_OK);
    expect(status).not.toBe('PENDING');
    const row = await ledger(IPO_OK);
    // eslint-disable-next-line no-console
    console.log(`[717-proof] OK doc=${status} ledger=${JSON.stringify(row)}`);
    // The real extractor read the real text and the real persist door took it.
    expect(status).toBe('COMPLETED');
    expect(row?.outcome).toBe('DONE');
  }, 180_000);

  it('the same shape with the extraction made to fail is FAILED with a cause, never DONE', async () => {
    await runClosedIpoJob({
      db: db as never,
      isCycleLockHeld: async () => false,
      resourceIpo: resourcer('extractor-fails'),
      resourcedAtVersion: VERSION,
      restrictToIpoIds: [IPO_FAIL],
    });
    const row = await ledger(IPO_FAIL);
    // eslint-disable-next-line no-console
    console.log(`[717-proof] FAIL doc=${await docStatus(IPO_FAIL)} ledger=${JSON.stringify(row)}`);
    expect(row?.outcome).not.toBe('DONE');
    expect(row?.cause_class).toBeTruthy();
    expect(String(row?.cause_detail)).toMatch(/failed/);
  }, 180_000);

  it('a worker that does nothing while the document is still PENDING is PARTIAL, never DONE (the staging shape)', async () => {
    await db.execute(sql`DELETE FROM closed_ipo_resourcing WHERE ipo_id = ${IPO_FAIL}::uuid`);
    await db.execute(sql`UPDATE documents SET extraction_status = 'PENDING' WHERE ipo_id = ${IPO_FAIL}::uuid`);
    await runClosedIpoJob({
      db: db as never,
      isCycleLockHeld: async () => false,
      // Exactly what production's worker returned on 2026-09-23: NO_DUE_FIELDS -> DONE.
      resourceIpo: async () => ({ outcome: 'DONE', fieldsWritten: 0, fieldsLeftEmpty: 0 }),
      resourcedAtVersion: VERSION,
      restrictToIpoIds: [IPO_FAIL],
    });
    const row = await ledger(IPO_FAIL);
    expect(row?.outcome).toBe('PARTIAL');
    expect(String(row?.cause_detail)).toMatch(/still PENDING/);
  }, 180_000);
});
