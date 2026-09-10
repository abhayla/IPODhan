// implements: item 1 slice s8b (issue #506)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq, inArray } from 'drizzle-orm';
// Relative import, NOT the `@ipodhan/shared` package alias -- in a worktree
// checkout with junctioned node_modules the package alias resolves through
// node_modules back to the PRIMARY checkout's source tree, not this
// worktree's schema.ts (see child-table-normalized-name.integration.test.ts
// for the full rationale).
import * as schema from '../../../packages/shared/src/db/schema';
import { rowKeyForName } from '../../../packages/shared/src/utils/company-name-normalizer';

/**
 * Item 1 slice s8b (issue #506) -- derived-key recompute guard.
 *
 * Every column in this repo that PERSISTS the output of a pure function is a
 * cache. Nothing previously noticed when the deriving function changed and
 * the stored value was left stale. This test re-derives each registered
 * (table, storedColumn) pair from its live source column using the CURRENT
 * function and fails, naming the offending rows, the moment they diverge.
 *
 * Registered now: `normalized_name` on promoters / peer_companies /
 * ipo_intermediaries (derived by `rowKeyForName`, NOT the bare
 * `normalizeCompanyNameForMatching` -- see below,
 * packages/shared/src/utils/company-name-normalizer.ts).
 *
 * `rowKeyForName` has THREE outcomes, and the guard has to know all three:
 *   1. a name that normalizes to a non-empty string -> that string
 *   2. a "junk" name (normalizes to '' but has non-whitespace raw content,
 *      e.g. "---" or "123") -> `junk:<sha1 of the trimmed raw name>`
 *   3. null / empty / whitespace-only -> `null` ("no identity" -- the write
 *      path is supposed to SKIP the row, never invent a key)
 * The column is `.notNull().default('')`, so a row with no identity is
 * stored as `''` while `rowKeyForName` recomputes `null` for it -- that is
 * NOT a mismatch, it is the documented no-identity case. The guard below
 * treats `stored === '' && recomputed === null` as OK and fires on every
 * other divergence, junk rows included.
 *
 * NOT registered: `heading_hash` on `ipo_risk_factors` (derived by
 * `normalizeHeading`, packages/shared/src/utils/risk-factor-heading-key.ts).
 * That column and its deriving module ship together in item 1 slice s6
 * (branch feat/pm-item01-s6-risk-factor-heading-key), which is built and
 * held, not merged, as of this slice. Registering the entry now would mean
 * importing a module that does not exist on `main` -- the import itself
 * would fail the build for everyone else on this branch. Add the
 * `ipo_risk_factors` entry to DERIVED_KEY_REGISTRY in the SAME PR that
 * merges s6, not before. (The live `ipodhan_test` database currently has a
 * stray `heading_hash` column from earlier s6 testing on this box -- that is
 * migration-state drift on a shared test DB, not evidence the column is
 * live on `main`; do not key any decision off it.)
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/derived-key-recompute-guard.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'derived-key-recompute-guard: DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-00000008b001';
// Punctuation-only: normalizeCompanyNameForMatching('---') === '' but the
// trimmed raw content is non-empty, so rowKeyForName takes the JUNK path.
const JUNK_PROMOTER_NAME = '---';

interface DerivedKeyEntry {
  label: string;
  /** Live DB table name -- used only for information_schema checks and the
   *  raw re-derive query below, never string-concatenated with row data. */
  tableName: string;
  sourceColumn: string;
  storedColumn: string;
  derive: (source: string) => string | null;
}

/**
 * The registry. Add the next derived column here -- one entry -- rather
 * than a new test. See the file header for what is deliberately absent and
 * why.
 */
export const DERIVED_KEY_REGISTRY: DerivedKeyEntry[] = [
  {
    label: 'promoters.normalized_name',
    tableName: 'promoters',
    sourceColumn: 'name',
    storedColumn: 'normalized_name',
    derive: rowKeyForName,
  },
  {
    label: 'peer_companies.normalized_name',
    tableName: 'peer_companies',
    sourceColumn: 'company_name',
    storedColumn: 'normalized_name',
    derive: rowKeyForName,
  },
  {
    label: 'ipo_intermediaries.normalized_name',
    tableName: 'ipo_intermediaries',
    sourceColumn: 'name',
    storedColumn: 'normalized_name',
    derive: rowKeyForName,
  },
];

interface Mismatch {
  entryLabel: string;
  id: string;
  source: string;
  stored: string;
  currentFunctionOutput: string | null;
}

// Table/column identifiers come only from the static registry above, never
// from row data or external input -- but pg cannot parameterize identifiers,
// so this allowlist is the defense-in-depth check (security-baseline.md)
// that a future registry entry cannot smuggle anything but a bare
// snake_case identifier into the query text.
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertSafeIdentifier(id: string, context: string): void {
  if (!SAFE_IDENTIFIER.test(id)) {
    throw new Error(`derived-key-recompute-guard: unsafe identifier "${id}" in ${context}`);
  }
}

async function columnExists(pool: Pool, tableName: string, columnName: string): Promise<boolean> {
  const res = await pool.query(
    `select 1 from information_schema.columns where table_name = $1 and column_name = $2`,
    [tableName, columnName]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Re-derives every registered column for the given ipoId and returns every
 * row whose stored value no longer matches what the current function
 * produces from the current source value.
 *
 * Throws (does not silently skip) when a registry entry names a table or
 * column absent from the live schema -- a registry entry that checks
 * nothing is a defective guard, not an empty pass.
 */
export async function findDerivedKeyMismatches(
  pool: Pool,
  entries: DerivedKeyEntry[],
  ipoId: string
): Promise<Mismatch[]> {
  const mismatches: Mismatch[] = [];
  for (const entry of entries) {
    assertSafeIdentifier(entry.tableName, entry.label);
    assertSafeIdentifier(entry.sourceColumn, entry.label);
    assertSafeIdentifier(entry.storedColumn, entry.label);

    const [tableHasStored, tableHasSource] = await Promise.all([
      columnExists(pool, entry.tableName, entry.storedColumn),
      columnExists(pool, entry.tableName, entry.sourceColumn),
    ]);
    if (!tableHasStored || !tableHasSource) {
      throw new Error(
        `derived-key-recompute-guard: registry entry "${entry.label}" points at ` +
          `${entry.tableName}.${entry.storedColumn} (source: ${entry.tableName}.${entry.sourceColumn}), ` +
          `but that column is absent from the live schema. A registry entry for an ` +
          `absent column would silently check nothing -- fix or remove the entry ` +
          `instead of letting it pass.`
      );
    }

    const res = await pool.query(
      `select id, ${entry.sourceColumn} as source, ${entry.storedColumn} as stored ` +
        `from ${entry.tableName} where ipo_id = $1`,
      [ipoId]
    );
    for (const row of res.rows as Array<{ id: string; source: string; stored: string }>) {
      const currentFunctionOutput = entry.derive(row.source);
      // "No identity" case: rowKeyForName returns null for a blank/whitespace
      // name, but the column default is '' -- that pairing is the documented
      // no-identity state, never a stale-value mismatch.
      const isNoIdentity = row.stored === '' && currentFunctionOutput === null;
      if (!isNoIdentity && row.stored !== currentFunctionOutput) {
        mismatches.push({
          entryLabel: entry.label,
          id: row.id,
          source: row.source,
          stored: row.stored,
          currentFunctionOutput,
        });
      }
    }
  }
  return mismatches;
}

function describeMismatches(mismatches: Mismatch[]): string {
  if (mismatches.length === 0) return '';
  return (
    'derived-key-recompute-guard: stale stored values (id / source / stored / current-function):\n' +
    mismatches
      .map(
        (m) =>
          `  ${m.entryLabel} id=${m.id} source="${m.source}" stored="${m.stored}" ` +
          `current=${m.currentFunctionOutput === null ? 'null' : `"${m.currentFunctionOutput}"`}`
      )
      .join('\n')
  );
}

let pool: Pool | null = null;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  const db = drizzle(pool, { schema });

  await db.delete(schema.promoters).where(eq(schema.promoters.ipoId, IPO_ID));
  await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
  await db.delete(schema.ipoIntermediaries).where(eq(schema.ipoIntermediaries.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
    VALUES (${IPO_ID}::uuid, 'S8B Fixture Ltd.', 's8b-fixture-ltd', 'MAINBOARD', 'OPEN', '2026-09-08', '2026-09-10')
  `);

  const promoterName = 'Sunil Sharma Promoter Group';
  const peerName = 'ABC (India) Peer Ltd';
  const intermediaryName = 'JM Financial Services Intermediary Ltd';

  await db.insert(schema.promoters).values({
    ipoId: IPO_ID,
    name: promoterName,
    normalizedName: rowKeyForName(promoterName) as string,
    sharesHeld: null,
    waca: null,
    wacaLastYear: null,
    isPromoterGroup: false,
  } as never);

  await db.insert(schema.peerCompanies).values({
    ipoId: IPO_ID,
    companyName: peerName,
    normalizedName: rowKeyForName(peerName) as string,
    isListed: true,
  } as never);

  await db.insert(schema.ipoIntermediaries).values({
    ipoId: IPO_ID,
    role: 'BRLM',
    name: intermediaryName,
    normalizedName: rowKeyForName(intermediaryName) as string,
    sebiRegNo: null,
    contactPerson: null,
    phone: null,
    email: null,
    grievanceEmail: null,
  } as never);

  // Junk-name row: punctuation-only, normalizes to '' but has non-whitespace
  // raw content -- rowKeyForName's JUNK path (`junk:<sha1 of trimmed raw>`),
  // not the "no identity" null path. Untested until now; a real junk row in
  // prod would otherwise be the first thing that trips a false alarm.
  await db.insert(schema.promoters).values({
    ipoId: IPO_ID,
    name: JUNK_PROMOTER_NAME,
    normalizedName: rowKeyForName(JUNK_PROMOTER_NAME) as string,
    sharesHeld: null,
    waca: null,
    wacaLastYear: null,
    isPromoterGroup: false,
  } as never);
});

afterAll(async () => {
  if (!pool) return;
  const db = drizzle(pool, { schema });
  await db.delete(schema.promoters).where(eq(schema.promoters.ipoId, IPO_ID));
  await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO_ID));
  await db.delete(schema.ipoIntermediaries).where(eq(schema.ipoIntermediaries.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  await pool.end();
});

describe.skipIf(!DATABASE_URL)(`derived-key recompute guard (${SKIP_REASON})`, () => {
  it('MUTATION 3: a registry entry pointing at a nonexistent column fails loudly, not silently', async () => {
    const phantomEntry: DerivedKeyEntry = {
      label: 'promoters.phantom_column',
      tableName: 'promoters',
      sourceColumn: 'name',
      storedColumn: 'phantom_column_that_does_not_exist',
      derive: rowKeyForName,
    };
    await expect(findDerivedKeyMismatches(pool!, [phantomEntry], IPO_ID)).rejects.toThrow(
      /absent from the live schema/
    );
  });

  it('registry covers exactly the derived columns this slice guards', () => {
    expect(DERIVED_KEY_REGISTRY.map((e) => e.label)).toEqual([
      'promoters.normalized_name',
      'peer_companies.normalized_name',
      'ipo_intermediaries.normalized_name',
    ]);
  });

  it('every seeded row\'s stored value matches what the CURRENT function produces from its source', async () => {
    const mismatches = await findDerivedKeyMismatches(pool!, DERIVED_KEY_REGISTRY, IPO_ID);
    expect(mismatches, describeMismatches(mismatches)).toEqual([]);
  });

  it('a stored value produced by a DIFFERENT (stale) function is caught and named', async () => {
    const db = drizzle(pool!, { schema });
    // Simulate a row written by an older deriving function: hand-write a
    // stored value that does NOT match what the current normalizer produces
    // from the same source name.
    const staleName = 'Stale Function Peer Co';
    const [staleRow] = await db
      .insert(schema.peerCompanies)
      .values({
        ipoId: IPO_ID,
        companyName: staleName,
        normalizedName: 'stale-function-output-not-current', // wrong on purpose
        isListed: true,
      } as never)
      .returning();

    try {
      const mismatches = await findDerivedKeyMismatches(pool!, DERIVED_KEY_REGISTRY, IPO_ID);
      expect(mismatches.length).toBeGreaterThan(0);
      const found = mismatches.find((m) => m.id === (staleRow as { id: string }).id);
      expect(found, describeMismatches(mismatches)).toBeDefined();
      expect(found!.stored).toBe('stale-function-output-not-current');
      expect(found!.currentFunctionOutput).toBe(rowKeyForName(staleName));
    } finally {
      await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.id, (staleRow as { id: string }).id));
    }
  });

  it('a junk name (normalizes to empty, non-blank raw) stores the junk: sha1 key and the guard passes', async () => {
    const db = drizzle(pool!, { schema });
    const junkRows = await db
      .select({ id: schema.promoters.id, normalizedName: schema.promoters.normalizedName })
      .from(schema.promoters)
      .where(eq(schema.promoters.name, JUNK_PROMOTER_NAME));
    expect(junkRows.length).toBe(1);
    expect(junkRows[0].normalizedName).toBe(rowKeyForName(JUNK_PROMOTER_NAME));
    expect(junkRows[0].normalizedName?.startsWith('junk:')).toBe(true);

    const mismatches = await findDerivedKeyMismatches(pool!, DERIVED_KEY_REGISTRY, IPO_ID);
    expect(mismatches.find((m) => m.id === junkRows[0].id), describeMismatches(mismatches)).toBeUndefined();
  });

  it('a stale stored key on the junk row is caught and named (proves the junk path is not exempt)', async () => {
    const db = drizzle(pool!, { schema });
    const junkRows = await db
      .select({ id: schema.promoters.id })
      .from(schema.promoters)
      .where(eq(schema.promoters.name, JUNK_PROMOTER_NAME));
    expect(junkRows.length).toBe(1);
    const junkId = junkRows[0].id;
    const correctKey = rowKeyForName(JUNK_PROMOTER_NAME) as string;

    await db
      .update(schema.promoters)
      .set({ normalizedName: 'junk:0000000000000000000000000000000000000000' })
      .where(eq(schema.promoters.id, junkId));

    try {
      const mismatches = await findDerivedKeyMismatches(pool!, DERIVED_KEY_REGISTRY, IPO_ID);
      const found = mismatches.find((m) => m.id === junkId);
      expect(found, describeMismatches(mismatches)).toBeDefined();
      expect(found!.stored).toBe('junk:0000000000000000000000000000000000000000');
      expect(found!.currentFunctionOutput).toBe(correctKey);
    } finally {
      await db.update(schema.promoters).set({ normalizedName: correctKey }).where(eq(schema.promoters.id, junkId));
    }
  });
});
