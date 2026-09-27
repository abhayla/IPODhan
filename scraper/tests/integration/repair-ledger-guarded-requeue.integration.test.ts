/**
 * #457 round 3 on ipodhan_test: the three re-queue/readmit tools write only rows STILL in the
 * state they were selected in (locked in the same statement), and their ledger holds every
 * column the UPDATE set with the value it actually replaced. A row that changed between the
 * tool's read and its write is neither overwritten nor ledgered.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/repair-ledger-guarded-requeue.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../../packages/shared/src/db/schema';
import type { ExecuteLike, RepairLedgerFieldChange } from '../../scripts/lib/repair-tool';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = {
  readmit: '00000000-0000-4000-8457-0000000000a1',
  anchor: '00000000-0000-4000-8457-0000000000a2',
  exhausted: '00000000-0000-4000-8457-0000000000a3',
  supplied: '00000000-0000-4000-8457-0000000000a4',
};
const DOC = {
  readmitWritten: '00000000-0000-4000-8457-0000000000d1',
  readmitRaced: '00000000-0000-4000-8457-0000000000d2',
  anchorWritten: '00000000-0000-4000-8457-0000000000d3',
  anchorRaced: '00000000-0000-4000-8457-0000000000d4',
};
const PLAN = {
  exhaustedWritten: '00000000-0000-4000-8457-0000000000b1',
  exhaustedRaced: '00000000-0000-4000-8457-0000000000b2',
  suppliedWritten: '00000000-0000-4000-8457-0000000000b3',
  suppliedRaced: '00000000-0000-4000-8457-0000000000b4',
};
const ALL_IPOS = Object.values(IPO);
const STAMP = '2026-09-01 08:00:00';

let pool: Pool | null = null;

async function cleanup(p: Pool) {
  await p.query('DELETE FROM ipo_field_plan WHERE ipo_id = ANY($1::uuid[])', [ALL_IPOS]);
  await p.query('DELETE FROM field_sources WHERE ipo_id = ANY($1::uuid[])', [ALL_IPOS]);
  await p.query('DELETE FROM documents WHERE ipo_id = ANY($1::uuid[])', [ALL_IPOS]);
  await p.query('DELETE FROM ipos WHERE id = ANY($1::uuid[])', [ALL_IPOS]);
}

async function seedIpo(p: Pool, id: string, slug: string) {
  await p.query(
    `INSERT INTO ipos (id, company_name, slug, category, status, segment, listing_exchanges, updated_at)
     VALUES ($1, $2, $3, 'MAINBOARD', 'UPCOMING', 'MAINBOARD', '["NSE"]', $4)`,
    [id, `Repair 457 r3 ${slug}`, slug, STAMP]
  );
}

async function seedDoc(p: Pool, id: string, ipoId: string, type: string, status: string, error: string, retries: number) {
  await p.query(
    `INSERT INTO documents (id, ipo_id, type, title, url, extraction_status, extraction_error, retry_count, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, ipoId, type, `doc ${id}`, `https://x/${id}.pdf`, status, error, retries, STAMP]
  );
}

async function seedPlan(p: Pool, id: string, ipoId: string, field: string, state: string, chosen: string | null, attempts: number) {
  await p.query(
    `INSERT INTO ipo_field_plan (id, ipo_id, table_name, row_key, field_name, rank1_source, state, cause, last_attempt_at,
                                 manifest_version, chosen_source, attempts, next_due_at, updated_at)
     VALUES ($1, $2, 'ipos', '', $3, 'DOC', $4, 'seed', $5, 1, $6, $7, NULL, $5)`,
    [id, ipoId, field, state, STAMP, chosen, attempts]
  );
}

const db = () => drizzle(pool!, { schema }) as unknown as ExecuteLike;
const byField = (changes: RepairLedgerFieldChange[], rowKey: string) =>
  Object.fromEntries(changes.filter((c) => c.rowKey === rowKey).map((c) => [c.field, c]));

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 3, options: '-c timezone=UTC' });
  const currentDb = (await pool.query('select current_database()')).rows[0].current_database as string;
  if (currentDb !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${currentDb}', not 'ipodhan_test'.`);
  await cleanup(pool);
  await seedIpo(pool, IPO.readmit, 'repair-457-r3-readmit');
  await seedIpo(pool, IPO.anchor, 'repair-457-r3-anchor');
  await seedIpo(pool, IPO.exhausted, 'repair-457-r3-exhausted');
  await seedIpo(pool, IPO.supplied, 'repair-457-r3-supplied');
}, 30000);

afterAll(async () => {
  if (!pool) return;
  await cleanup(pool);
  await pool.end();
}, 30000);

describe.skipIf(!DATABASE_URL)('#457 round 3: guarded re-queue writes ledger every changed column with its true prior value', () => {
  it('repair-readmit-stranded-documents: every column the UPDATE sets, prior error text kept; a raced row is untouched', async () => {
    const p = pool!;
    await seedDoc(p, DOC.readmitWritten, IPO.readmit, 'RHP', 'NOT_EXTRACTABLE', 'no extractor for RHP', 3);
    await seedDoc(p, DOC.readmitRaced, IPO.readmit, 'DRHP', 'NOT_EXTRACTABLE', 'no extractor for DRHP', 2);
    // The raced row is extracted by a live cycle between the tool's read and its write.
    await p.query(`UPDATE documents SET extraction_status = 'COMPLETED', extraction_error = 'live cycle note' WHERE id = $1`, [DOC.readmitRaced]);

    const { readmitStrandedDocuments } = await import('../../scripts/repair-readmit-stranded-documents.js');
    const r = await readmitStrandedDocuments(db(), [DOC.readmitWritten, DOC.readmitRaced], new Date('2026-09-27T10:00:00Z'));

    expect(r.writtenIds).toEqual([DOC.readmitWritten]);
    expect(r.changes.every((c) => c.rowKey === DOC.readmitWritten)).toBe(true);
    const f = byField(r.changes, DOC.readmitWritten);
    expect(Object.keys(f).sort()).toEqual(['extraction_error', 'extraction_status', 'retry_count', 'updated_at']);
    expect(f.extraction_status).toMatchObject({ before: 'NOT_EXTRACTABLE', after: 'PENDING' });
    expect(f.extraction_error).toMatchObject({ before: 'no extractor for RHP', after: null });
    expect(f.retry_count).toMatchObject({ before: '3', after: '0' });
    expect(f.updated_at.before).toBe(STAMP);

    const raced = (await p.query(`SELECT extraction_status, extraction_error, retry_count FROM documents WHERE id = $1`, [DOC.readmitRaced])).rows[0];
    expect(raced).toEqual({ extraction_status: 'COMPLETED', extraction_error: 'live cycle note', retry_count: 2 });
    console.log(`#457 PROOF readmit ledger: ${JSON.stringify(r.changes)}`);
  });

  it('requeue-anchor-zero-rows: status AND the prior error text; a row whose error changed since the read is untouched', async () => {
    const p = pool!;
    const err = 'only 2 investor rows survived reconciliation';
    await seedDoc(p, DOC.anchorWritten, IPO.anchor, 'ANCHOR_ALLOCATION_REPORT', 'MANUAL_REVIEW', err, 1);
    await seedDoc(p, DOC.anchorRaced, IPO.anchor, 'ANCHOR_ALLOCATION_REPORT', 'MANUAL_REVIEW', err, 1);
    // Re-extracted between read and write: now a correct refusal the tool must never re-queue.
    await p.query(`UPDATE documents SET extraction_error = 'not an anchor allocation report' WHERE id = $1`, [DOC.anchorRaced]);

    const { requeueAnchorDocuments } = await import('../../scripts/requeue-anchor-zero-rows.js');
    const r = await requeueAnchorDocuments(db(), [
      { id: DOC.anchorWritten, extractionError: err },
      { id: DOC.anchorRaced, extractionError: err }, // the error as the tool READ it
    ]);

    expect(r.writtenIds).toEqual([DOC.anchorWritten]);
    const f = byField(r.changes, DOC.anchorWritten);
    expect(Object.keys(f).sort()).toEqual(['extraction_error', 'extraction_status']);
    expect(f.extraction_status).toMatchObject({ before: 'MANUAL_REVIEW', after: 'PENDING' });
    expect(f.extraction_error).toMatchObject({ before: err, after: null });
    expect(r.changes.some((c) => c.rowKey === DOC.anchorRaced)).toBe(false);

    const raced = (await p.query(`SELECT extraction_status, extraction_error FROM documents WHERE id = $1`, [DOC.anchorRaced])).rows[0];
    expect(raced).toEqual({ extraction_status: 'MANUAL_REVIEW', extraction_error: 'not an anchor allocation report' });
    console.log(`#457 PROOF anchor ledger: ${JSON.stringify(r.changes)}`);
  });

  it('requeue-exhausted-plan-rows: state, next_due_at and updated_at with their prior values; a raced row is untouched', async () => {
    const p = pool!;
    await seedPlan(p, PLAN.exhaustedWritten, IPO.exhausted, 'issue_size', 'EXHAUSTED', null, 1);
    await seedPlan(p, PLAN.exhaustedRaced, IPO.exhausted, 'lot_size', 'EXHAUSTED', null, 1);
    // A walk settles the raced row between the tool's read and its write.
    await p.query(`UPDATE ipo_field_plan SET state = 'SUPPLIED', chosen_source = 'NSE' WHERE id = $1`, [PLAN.exhaustedRaced]);

    const { requeueExhaustedPlanRows } = await import('../../scripts/requeue-exhausted-plan-rows.js');
    const r = await requeueExhaustedPlanRows(db(), [PLAN.exhaustedWritten, PLAN.exhaustedRaced]);

    expect(r.writtenIds).toEqual([PLAN.exhaustedWritten]);
    const f = byField(r.changes, PLAN.exhaustedWritten);
    expect(Object.keys(f).sort()).toEqual(['next_due_at', 'state', 'updated_at']);
    expect(f.state).toMatchObject({ before: 'EXHAUSTED', after: 'PENDING' });
    expect(f.next_due_at.before).toBeNull();
    expect(f.next_due_at.after).not.toBeNull();
    expect(f.updated_at.before).toBe(STAMP);

    const raced = (await p.query(`SELECT state::text AS state, chosen_source FROM ipo_field_plan WHERE id = $1`, [PLAN.exhaustedRaced])).rows[0];
    expect(raced).toEqual({ state: 'SUPPLIED', chosen_source: 'NSE' });
    console.log(`#457 PROOF exhausted ledger: ${JSON.stringify(r.changes)}`);
  });

  it('requeue-exhausted-plan-rows --false-supplied: the real prior state (never a typed SUPPLIED); a row whose provenance changed is untouched', async () => {
    const p = pool!;
    await seedPlan(p, PLAN.suppliedWritten, IPO.supplied, 'issue_size', 'SUPPLIED', 'CHITTORGARH', 1);
    await seedPlan(p, PLAN.suppliedRaced, IPO.supplied, 'lot_size', 'SUPPLIED', 'CHITTORGARH', 1);
    for (const field of ['issueSize', 'lotSize']) {
      await p.query(
        `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, updated_by)
         VALUES ($1, 'ipos', '', $2, 'BSE', 100, $3, 'seed')`,
        [IPO.supplied, field, STAMP]
      );
    }
    // The raced row's provenance now agrees with chosen_source — no longer the false-supplied shape.
    await p.query(
      `UPDATE field_sources SET source = 'CHITTORGARH' WHERE ipo_id = $1 AND field_name = 'lotSize'`,
      [IPO.supplied]
    );

    const { requeueFalseSuppliedPlanRows } = await import('../../scripts/requeue-exhausted-plan-rows.js');
    const r = await requeueFalseSuppliedPlanRows(db(), [
      { id: PLAN.suppliedWritten, chosenSource: 'CHITTORGARH', provenanceSource: 'BSE', fieldName: 'issue_size' },
      { id: PLAN.suppliedRaced, chosenSource: 'CHITTORGARH', provenanceSource: 'BSE', fieldName: 'lot_size' },
    ]);

    expect(r.writtenIds).toEqual([PLAN.suppliedWritten]);
    const f = byField(r.changes, PLAN.suppliedWritten);
    expect(Object.keys(f).sort()).toEqual(['next_due_at', 'state', 'updated_at']);
    expect(f.state).toMatchObject({ before: 'SUPPLIED', after: 'PENDING' });
    expect(f.updated_at.before).toBe(STAMP);

    const raced = (await p.query(`SELECT state::text AS state FROM ipo_field_plan WHERE id = $1`, [PLAN.suppliedRaced])).rows[0];
    expect(raced).toEqual({ state: 'SUPPLIED' });
    console.log(`#457 PROOF false-supplied ledger: ${JSON.stringify(r.changes)}`);
  });
});
