// implements: #771 real-DB proof — a prospectus extraction lands a current_ratio or a recorded reason
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
// Relative imports, NOT the `@ipodhan/shared` alias — a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout
// (same guard as rhp-promoters-peers-persist.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoPipelineStepsRepository } from '../../../packages/shared/src/repositories/ipo-pipeline-steps-repository';
import { planExtractionSteps } from '../../src/services/step-ledger-recorders.js';
import type { FilingExtraction } from '../../src/services/filing-persister.js';

/**
 * #771 — `issuer_ratio_yield` (scripts/audit-detection-floor.mjs) failed on
 * every COMPLETED RHP/DRHP/PROSPECTUS extracted since 2026-09-16: no
 * current_ratio and no recorded reason. Two breaks, both on this path:
 *   1. the extractor named its cause in a PASSED `not_extractable` check, and
 *      E9 carried only FAILED checks, so the cause never reached the ledger;
 *   2. the ratio reader matched only Prasol's layout, so real prospectuses
 *      that DO print the ratio came back `ratio_row_not_in_note`.
 *
 * This test runs the REAL extractor (`extract_filing.run()`) on two committed
 * real-page fixtures, plans the steps with the real planner, writes them with
 * the real ledger repository into ipodhan_test, and then asks the floor
 * check's own question of the stored rows: current_ratio, or a recorded reason.
 *
 * SKIPS CLEANLY when no database is configured. In CI a missing python is a
 * failure, never a skip.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/prospectus-ratio-reason-ledger.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const PYTHON = ['python3', 'python'].find(
  (bin) => spawnSync(bin, ['--version'], { encoding: 'utf-8' }).status === 0
);
if (!PYTHON && process.env.CI) throw new Error('#771: no python on PATH - the proof needs the real extractor');

const IPO_ID = '00000000-0000-4000-8000-0000000771a1';
const DOC_ID = '00000000-0000-4000-8000-0000000771d1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts');
const FIXTURES = path.join(__dirname, '..', 'fixtures');

/** The floor check's own reason tokens (audit-detection-floor.mjs, issuer_ratio_yield). */
const FLOOR_REASON = /ratio_note_not_in_document|ratio_row_not_in_note|balance_sheet_inputs_absent/;

// `<<<PAGE n>>>` text fixtures (financial-ratios/) or [[n, text], ...] JSON (extractor/).
const EXTRACT_PY = [
  'import io, json, sys',
  'from extract_filing import run',
  'p = sys.argv[1]',
  "raw = io.open(p, encoding='utf-8').read()",
  "if p.endswith('.json'):",
  '    pages = [tuple(x) for x in json.loads(raw)]',
  'else:',
  '    pages = []',
  "    for chunk in raw.split('<<<PAGE '):",
  '        if chunk.strip():',
  "            head, _, body = chunk.partition('>>>')",
  '            pages.append((int(head.strip()), body))',
  "sys.stdout.write(json.dumps(run(pages, 'RHP', 'fixture', 'MAINBOARD')))",
].join('\n');

function realExtraction(fixture: string): FilingExtraction {
  const res = spawnSync(PYTHON as string, ['-c', EXTRACT_PY, path.join(FIXTURES, fixture)], {
    cwd: SCRIPTS_DIR,
    encoding: 'utf-8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`extract_filing.run failed: ${res.stderr}`);
  return JSON.parse(res.stdout) as FilingExtraction;
}

// Redis is only a cache here; the repository swallows cache errors by design.
const redisStub = { del: async () => 0, keys: async () => [] };

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle>;
let steps: IpoPipelineStepsRepository;

async function cleanup(): Promise<void> {
  await db.delete(schema.ipoPipelineSteps).where(eq(schema.ipoPipelineSteps.ipoId, IPO_ID));
  await db.delete(schema.documents).where(eq(schema.documents.id, DOC_ID));
  await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
}

/** The floor check's per-document question, asked of the stored rows. */
async function floorVerdict(): Promise<{ hasRatio: boolean; evidence: string }> {
  const res = await pool!.query(
    `SELECT fd.current_ratio IS NOT NULL AS has_ratio, coalesce(s.evidence::text, '') AS step_evidence
       FROM documents d
       LEFT JOIN financial_data fd ON fd.ipo_id = d.ipo_id
       LEFT JOIN ipo_pipeline_steps s ON s.ipo_id = d.ipo_id AND s.step_id = 'E9'
      WHERE d.id = $1`,
    [DOC_ID]
  );
  expect(res.rows).toHaveLength(1);
  return { hasRatio: res.rows[0].has_ratio, evidence: res.rows[0].step_evidence };
}

async function landSteps(extraction: FilingExtraction): Promise<void> {
  for (const w of planExtractionSteps(extraction, { docType: 'RHP', documentId: DOC_ID, version: 't771' })) {
    await steps.upsertStep({ ipoId: IPO_ID, ...w } as never);
  }
}

describe.skipIf(!DATABASE_URL || !PYTHON)('#771 prospectus ratio: a value or a recorded reason reaches the ledger', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    const cur = (await pool.query('SELECT current_database() AS db')).rows[0].db;
    if (cur !== 'ipodhan_test') throw new Error(`#771 writes only to ipodhan_test, got ${cur}`);
    db = drizzle(pool, { schema });
    steps = new IpoPipelineStepsRepository(db as never, redisStub as never);
    await cleanup();
    await db.insert(schema.ipos).values({
      id: IPO_ID,
      companyName: 'S771 Ratio Fixture Ltd.',
      slug: 's771-ratio-fixture-ltd',
      category: 'MAINBOARD',
      status: 'UPCOMING',
    } as never);
    await db.insert(schema.documents).values({
      id: DOC_ID,
      ipoId: IPO_ID,
      type: 'RHP',
      title: 'RHP',
      url: 'https://example.invalid/s771-rhp.pdf',
      isActive: true,
      extractionStatus: 'COMPLETED',
      extractedAt: new Date(),
    } as never);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup();
      await pool.end();
    }
  });

  it('a real RHP section with no ratio note lands its named cause in E9 (was: silent)', async () => {
    const extraction = realExtraction('extractor/a-one-steels-india-ltd-rhp-cover-pages.json');
    expect(extraction.fields?.current_ratio?.value ?? null).toBeNull();
    await landSteps(extraction);
    const v = await floorVerdict();
    expect(v.hasRatio).toBe(false);
    expect(v.evidence).toMatch(FLOOR_REASON);
    expect(JSON.parse(v.evidence).ratioReasons.current_ratio).toBe('ratio_note_not_in_document');
  });

  it('a real ratio note in a non-Prasol layout is READ, so no reason is recorded for it', async () => {
    const extraction = realExtraction('financial-ratios/a-one-steels-key-financial-ratios.txt');
    // The issuer prints "a) Current ratio (in times) ... 1.34 1.27 5.67%Less than 25%".
    expect(extraction.fields?.current_ratio?.value).toBe(1.34);
    await landSteps(extraction);
    const v = await floorVerdict();
    const reasons = JSON.parse(v.evidence).ratioReasons as Record<string, string>;
    expect('current_ratio' in reasons).toBe(false);
    // quick_ratio is never printed; its cause still reaches the ledger.
    expect(reasons.quick_ratio).toMatch(/^balance_sheet_inputs_absent:/);
  });
});
