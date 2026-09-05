import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, isNull, eq, and } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { DataConflictsRepository } from '@ipodhan/shared/repositories/data-conflicts-repository';

/**
 * W-161: empirically determine whether `DataConflictsRepository.upsertConflict`
 * itself refuses (or silently swallows) the exact Kanohar-Electricals-shaped
 * HOLD-conflict tuple the live-IPO hold branch in `data-consolidation-service.ts`
 * writes — `existingSource: CHITTORGARH` vs `incomingSource: NSE`, different
 * sources (the W-79 same-source guard does NOT apply), severity CRITICAL,
 * resolutionReason HELD_DISPUTED_HIGH_VALUE_LIVE.
 *
 * SKIPS CLEANLY when no database is configured (pattern: T-403,
 * document-fetch-state-repository.integration.test.ts).
 *
 * To run:
 *   DATABASE_URL=postgresql://user:pass@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/data-conflicts-repository-hold.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'W-161: DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-0000000161a1';

let pool: Pool | null = null;
let repo: DataConflictsRepository | null = null;

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  const db = drizzle(pool, { schema });
  repo = new DataConflictsRepository(db as never, noRedis);

  await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
    VALUES (${IPO_ID}::uuid, 'W161 Kanohar Electricals Ltd.', 'w161-kanohar-electricals', 'SME', 'OPEN', '2026-09-08', '2026-09-10')
  `);
});

afterAll(async () => {
  if (!pool) return;
  const db = drizzle(pool, { schema });
  await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await pool.end();
});

describe.skipIf(!DATABASE_URL)(`DataConflictsRepository.upsertConflict — HOLD write (${SKIP_REASON})`, () => {
  it('writes the exact Kanohar-shaped HELD_DISPUTED_HIGH_VALUE_LIVE tuple (CHITTORGARH vs NSE, openDate)', async () => {
    const result = await repo!.upsertConflict({
      ipoId: IPO_ID,
      tableName: 'ipos',
      fieldName: 'openDate',
      source1: 'CHITTORGARH',
      value1: '2026-12-09',
      source2: 'NSE',
      value2: '2026-09-08',
      resolvedSource: 'CHITTORGARH',
      resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
      severity: 'CRITICAL',
    });

    // If the repository refused the write, it returns { skipped: true, reason }
    // instead of the inserted row — surface that reason instead of a bare
    // "expected object, got object" assertion failure.
    if ((result as { skipped?: boolean }).skipped) {
      throw new Error(
        `upsertConflict REFUSED the write: ${JSON.stringify(result)}`
      );
    }

    const db = drizzle(pool!, { schema });
    const rows = await db
      .select()
      .from(schema.dataConflicts)
      .where(
        and(
          eq(schema.dataConflicts.ipoId, IPO_ID),
          eq(schema.dataConflicts.fieldName, 'openDate'),
          isNull(schema.dataConflicts.resolvedAt)
        )
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].source1).toBe('CHITTORGARH');
    expect(rows[0].source2).toBe('NSE');
    expect(rows[0].resolutionReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
    expect(rows[0].severity).toBe('CRITICAL');
  });
});
