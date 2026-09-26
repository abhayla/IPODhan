/**
 * #634 / #676 on the real database (ipodhan_test only).
 *
 * A document that fails three times keeps all three causes, in order, with attempt numbers,
 * through the REAL transactional writer (`writeStatusWithAttempt`, the code
 * `setDocumentExtractionState` calls). Before #634 only the third cause survived, in
 * `documents.extraction_error`. Also: the DB refuses an undeclared extraction_status (#676).
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test REDIS_HOST=127.0.0.1 \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/document-extraction-attempts.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';
import { writeStatusWithAttempt } from '../../src/services/filing-auto-persist';
import { buildExtractionStatePatch } from '../../src/services/extraction-state-patch';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-00000000634a';
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
const rows = (r: any) => (r.rows ?? r) as any[];

describe.skipIf(!DATABASE_URL)('document_extraction_attempts keeps every failed attempt (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, status, segment)
      VALUES (${IPO}::uuid, 'Attempt History Ltd', 'attempt-history-ltd-634', 'UPCOMING', 'MAINBOARD')`);
  });
  afterAll(async () => {
    if (!pool) return;
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
    await pool.end();
  });

  it('three failures keep three causes, in order, numbered 1..3; the column keeps only the last', async () => {
    const doc = rows(await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status)
      VALUES (${IPO}::uuid, 'RHP', 'rhp', ${'https://example.test/634-' + Math.random().toString(36).slice(2) + '.pdf'}, 'PENDING')
      RETURNING id`))[0].id as string;

    const causes = [
      'HARD_FAILURE:1:extractor: spawnSync nice ETIMEDOUT',
      'extractor: extractor exited 1: rapidocr',
      'blocked_after_10_attempts@extract_filing.py@2026-09-03',
    ];
    const outcomes = ['FAILED', 'FAILED', 'MANUAL_REVIEW'] as const;
    for (let n = 1; n <= 3; n++) {
      // The attempt is counted at the IN_PROGRESS stamp (no attempt row), then it fails.
      await db.update(schema.documents).set(buildExtractionStatePatch('IN_PROGRESS', { retryCount: n }) as never)
        .where(sql`id = ${doc}::uuid`);
      const status = outcomes[n - 1];
      const at = new Date(Date.UTC(2026, 8, 26, 5, n));
      const patch = buildExtractionStatePatch(status, { error: causes[n - 1] }, at);
      await writeStatusWithAttempt(db as never, doc, status, causes[n - 1], patch, at);
    }
    // A busy-box revert restores FAILED with no error: NOT an attempt.
    await writeStatusWithAttempt(db as never, doc, 'FAILED', undefined, buildExtractionStatePatch('FAILED', { retryCount: 3 }));

    const attempts = rows(await db.execute(sql`
      SELECT attempt_number, outcome, cause, attempted_at::text AS at
        FROM document_extraction_attempts WHERE document_id = ${doc}::uuid ORDER BY id`));
    expect(attempts.map((a) => a.attempt_number)).toEqual([1, 2, 3]);
    expect(attempts.map((a) => a.cause)).toEqual(causes);
    expect(attempts.map((a) => a.outcome)).toEqual([...outcomes]);
    // Round-trip of a known instant: stored UTC wall-clock, drift 0.
    expect(attempts[0].at).toBe('2026-09-26 05:01:00');

    const d = rows(await db.execute(sql`SELECT extraction_error, retry_count FROM documents WHERE id = ${doc}::uuid`))[0];
    expect(d.extraction_error).toBe(causes[2]);
    expect(d.retry_count).toBe(3);
  });

  it('the database refuses an undeclared extraction_status (#676)', async () => {
    const err = await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status)
      VALUES (${IPO}::uuid, 'DRHP', 'drhp', ${'https://example.test/676-' + Math.random().toString(36).slice(2) + '.pdf'}, 'QUEUED_FOR_REVIEW')`)
      .then(() => null, (e: any) => e);
    // drizzle wraps the pg error; the constraint name is on its cause.
    expect(err?.cause?.constraint ?? err?.constraint).toBe('ck_documents_extraction_status');
  });
});
