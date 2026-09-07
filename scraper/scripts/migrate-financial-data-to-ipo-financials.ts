/**
 * Migration/repair: financial_data -> ipo_financials (T-477, issue #224).
 *
 * WHY (round-2 correction, N3 — say this plainly): `web/components/ipo/
 * FinancialTable.tsx` reads `financialData` (the `financial_data` table) for
 * the visible revenue/profit/PE/ROE/debt-to-equity table — that content
 * already renders today and this migration changes NOTHING about it.
 * `ipo_financials` has a web consumer for exactly FIVE fields: `pbRatio`,
 * `rocePercentage`, `industryPe`, `peerCompanies` (all gated behind the
 * "Enhanced Metrics" section, `hasEnhancedMetrics()` in FinancialTable.tsx —
 * only rendered when at least one is present, T-477 round 2 N1) and
 * `financialYearEnd` (`FinancialYearEndDisplay`). This migration copies
 * `revenueFy1..debtToEquity` into `ipo_financials` too (they exist on the
 * table and downstream/future consumers may read them), but as of this PR
 * **none of those copied fields have a web consumer** — this run is a DATA
 * BRIDGE (populates the table so it is no longer empty and future readers
 * have something to read), not a visible site fix. The only user-visible
 * effect of running this migration today is that the "Enhanced Metrics"
 * section stays correctly HIDDEN (N1) rather than showing an N/A-filled
 * heading, because the row now truthy-exists. The five enhanced fields
 * themselves (the ones that WOULD be visible) are not populated here — see
 * the NULL-fields paragraph below.
 *
 * An unused draft of this migration lived at
 * `web/scripts/migrate-financial-data-to-ipo-financials.ts` (Story 4.10) —
 * this is that script productised per the repair-tool convention
 * (`backfill-issue-size-chittorgarh-detail.ts`): dry-run default, --apply
 * required, --allow-prod + database-name guard, idempotent (skips IPOs that
 * already have an ipo_financials row; onConflictDoNothing on ipo_id also
 * protects a concurrent writer race, N4), source-backed (copies the
 * financial_data row's own `field_sources` provenance FILTERED to
 * table_name='financial_data', N2 — never an unrelated field's source —
 * defaulting to DRHP, the C3b extractor's source, when no matching
 * field_sources row exists), RETURNING-checked, and cache-dropping.
 *
 * Fields ipo_financials has that financial_data lacks (pbRatio,
 * rocePercentage, industryPe, peerCompanies, financialYearEnd) are left NULL
 * by this migration — a named follow-up (issue #224 comment), never
 * back-filled by guesswork here.
 *
 * Unit note: both tables store revenue/profit in INR CRORES (schema.ts
 * comments on financial_data ~516-524 and ipo_financials ~579-587) — no
 * currency-unit conversion is needed. Precision DOES differ: financial_data's
 * pe_ratio/debt_to_equity are numeric(10,2), ipo_financials' are (8,2) — a
 * narrower column. A value whose magnitude would overflow numeric(8,2)
 * (>= 10^6) is refused for THAT field (left NULL, logged), never silently
 * truncated by Postgres.
 *
 * Usage (from scraper/, tunnel env exported as DATABASE_URL):
 *   npx tsx scripts/migrate-financial-data-to-ipo-financials.ts                # dry-run, all IPOs
 *   npx tsx scripts/migrate-financial-data-to-ipo-financials.ts --slug a,b,c   # dry-run, scoped
 *   npx tsx scripts/migrate-financial-data-to-ipo-financials.ts --apply                 # staging
 *   npx tsx scripts/migrate-financial-data-to-ipo-financials.ts --apply --allow-prod     # prod (owner word only)
 */
import { db, closePool, getRedisClient } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';

const { financialData, ipoFinancials, ipos, fieldSources } = schema;

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');

/** The one database name this CLI refuses to WRITE to without --allow-prod. */
export const PRODUCTION_DATABASE_NAME = 'ipodhan';

/** Same resolution order as reset-document.ts / backfill-issue-size-chittorgarh-detail.ts. */
export function resolveDatabaseName(env: NodeJS.ProcessEnv): string {
  const raw = env.DATABASE_URL || '';
  const fromUrl = raw
    ? (() => {
        try {
          return new URL(raw).pathname.replace(/^\//, '');
        } catch {
          return '';
        }
      })()
    : '';
  return fromUrl || env.DATABASE_NAME || env.PGDATABASE || '';
}

export function parseSlugArg(argv: string[]): { slugs: string[] | null; error?: string } {
  const idx = argv.indexOf('--slug');
  if (idx < 0) return { slugs: null };
  const next = argv[idx + 1];
  if (next === undefined || next.startsWith('--')) {
    return {
      slugs: null,
      error:
        'migrate-financial-data: --slug requires a comma-separated value, e.g. --slug abc-ipo,xyz-ipo',
    };
  }
  return { slugs: next.split(',').map((s) => s.trim()).filter(Boolean) };
}

/** numeric(8,2) column max magnitude — anything at/above this would overflow. */
const NUMERIC_8_2_MAX = 999999.99;

export interface FinancialDataRow {
  ipoId: string;
  revenueFy2024: string | null;
  revenueFy2023: string | null;
  revenueFy2022: string | null;
  profitFy2024: string | null;
  profitFy2023: string | null;
  profitFy2022: string | null;
  peRatio: string | null;
  roe: string | null;
  debtToEquity: string | null;
}

export interface MappedIpoFinancials {
  ipoId: string;
  revenueFy1: string | null;
  revenueFy2: string | null;
  revenueFy3: string | null;
  profitFy1: string | null;
  profitFy2: string | null;
  profitFy3: string | null;
  peRatio: string | null;
  roePercentage: string | null;
  debtToEquity: string | null;
}

/**
 * Pure mapping function — unit-tested (red-then-green) with a fixture row.
 * MUST NOT throw on a NULL field (a NULL market-cap-adjacent value is a
 * normal partial extraction, not an error). A numeric(8,2)-overflowing
 * peRatio/debtToEquity is refused for that field only (returned null,
 * caller logs the refusal) rather than converted or silently dropped.
 */
export function mapToIpoFinancials(
  row: FinancialDataRow
): { mapped: MappedIpoFinancials; refusedFields: string[] } {
  const refusedFields: string[] = [];
  const clamp8_2 = (field: string, value: string | null): string | null => {
    if (value === null) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || Math.abs(n) >= NUMERIC_8_2_MAX) {
      refusedFields.push(field);
      return null;
    }
    return value;
  };

  return {
    mapped: {
      ipoId: row.ipoId,
      revenueFy1: row.revenueFy2024,
      revenueFy2: row.revenueFy2023,
      revenueFy3: row.revenueFy2022,
      profitFy1: row.profitFy2024,
      profitFy2: row.profitFy2023,
      profitFy3: row.profitFy2022,
      peRatio: clamp8_2('peRatio', row.peRatio),
      roePercentage: row.roe,
      debtToEquity: clamp8_2('debtToEquity', row.debtToEquity),
    },
    refusedFields,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log(`FINANCIAL_DATA -> IPO_FINANCIALS MIGRATION (T-477, #224) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const slugParse = parseSlugArg(process.argv);
  if (slugParse.error) {
    console.error(slugParse.error);
    process.exit(1);
  }

  const dbName = resolveDatabaseName(process.env);
  const dbInfo = await db.execute(sql`SELECT current_database() AS db`);
  console.log(`resolved database name: ${dbName || '(unresolved)'}`);
  console.log(`current_database(): ${(dbInfo.rows[0] as any)?.db}`);

  const isProdDb = dbName === PRODUCTION_DATABASE_NAME;
  if (APPLY && isProdDb && !ALLOW_PROD) {
    console.error(
      `migrate-financial-data: refusing to APPLY writes against the production database "${PRODUCTION_DATABASE_NAME}" — pass --allow-prod to override.`
    );
    process.exit(1);
  }
  if (APPLY && isProdDb && ALLOW_PROD) {
    console.log(`ALLOW-PROD: writing against "${PRODUCTION_DATABASE_NAME}" (--allow-prod given).`);
  }

  // Source rows: financial_data joined to ipos for slug scoping + reporting.
  let rows = await db
    .select({
      ipoId: financialData.ipoId,
      slug: ipos.slug,
      companyName: ipos.companyName,
      revenueFy2024: financialData.revenueFy2024,
      revenueFy2023: financialData.revenueFy2023,
      revenueFy2022: financialData.revenueFy2022,
      profitFy2024: financialData.profitFy2024,
      profitFy2023: financialData.profitFy2023,
      profitFy2022: financialData.profitFy2022,
      peRatio: financialData.peRatio,
      roe: financialData.roe,
      debtToEquity: financialData.debtToEquity,
    })
    .from(financialData)
    .innerJoin(ipos, eq(ipos.id, financialData.ipoId));

  if (slugParse.slugs) {
    const slugSet = new Set(slugParse.slugs);
    rows = rows.filter((r) => slugSet.has(r.slug));
  }

  console.log(`financial_data candidate rows: ${rows.length}`);

  if (rows.length === 0) {
    console.log('Nothing to migrate. Exiting.');
    await closePool();
    process.exit(0);
  }

  // Idempotency: skip IPOs that already have an ipo_financials row — a re-run
  // must write 0.
  const existing = await db
    .select({ ipoId: ipoFinancials.ipoId })
    .from(ipoFinancials)
    .where(inArray(ipoFinancials.ipoId, rows.map((r) => r.ipoId)));
  const existingSet = new Set(existing.map((r) => r.ipoId));

  // Provenance: source per ipoId from field_sources(table_name='financial_data'),
  // defaulting to DRHP (the C3b extractor's documented source) when absent.
  // T-477 round 2 (N2): MUST filter on table_name='financial_data' — field_sources
  // is shared across every table (ipos, documents, ...), so an un-scoped ipoId-only
  // lookup can copy an unrelated field's source (e.g. a 'registrar' or 'lot_size'
  // provenance row) onto ipo_financials.
  const provenanceRows = await db
    .select({ ipoId: fieldSources.ipoId, source: fieldSources.source })
    .from(fieldSources)
    .where(
      and(
        inArray(fieldSources.ipoId, rows.map((r) => r.ipoId)),
        eq(fieldSources.tableName, 'financial_data')
      )
    );
  const provenanceByIpo = new Map<string, string>();
  for (const p of provenanceRows) {
    if (!provenanceByIpo.has(p.ipoId)) provenanceByIpo.set(p.ipoId, p.source as string);
  }

  let toWrite = 0;
  let skippedExisting = 0;
  let refusedFieldCount = 0;
  const sample: string[] = [];
  const writes: { insert: MappedIpoFinancials; slug: string; source: string }[] = [];

  for (const row of rows) {
    if (existingSet.has(row.ipoId)) {
      skippedExisting++;
      continue;
    }
    const { mapped, refusedFields } = mapToIpoFinancials(row as FinancialDataRow);
    if (refusedFields.length > 0) {
      refusedFieldCount += refusedFields.length;
      console.warn(
        `  [REFUSED FIELD] ${row.slug}: ${refusedFields.join(', ')} would overflow numeric(8,2) — left NULL`
      );
    }
    const source = provenanceByIpo.get(row.ipoId) || 'DRHP';
    writes.push({ insert: mapped, slug: row.slug, source });
    toWrite++;
    if (sample.length < 3) {
      sample.push(
        `  ${row.slug}: revenueFy1=${mapped.revenueFy1} profitFy1=${mapped.profitFy1} peRatio=${mapped.peRatio} debtToEquity=${mapped.debtToEquity} roePercentage=${mapped.roePercentage} source=${source}`
      );
    }
  }

  console.log(`\nplanned: ${toWrite} row(s) to write, ${skippedExisting} already present (skip), ${refusedFieldCount} field(s) refused (overflow)`);
  console.log('\nsample mapping (up to 3):');
  for (const s of sample) console.log(s);

  if (!APPLY) {
    console.log('\nDRY-RUN: re-run with --apply to write.');
    await closePool();
    process.exit(0);
  }

  if (toWrite === 0) {
    console.log('\nNothing new to write (idempotent no-op). Exiting.');
    await closePool();
    process.exit(0);
  }

  let written = 0;
  let skippedConflict = 0;
  const migratedSlugs: string[] = [];
  const migratedIpoIds: string[] = [];
  for (const w of writes) {
    // T-477 round 2 (N4): onConflictDoNothing on ipo_id — a concurrent writer
    // (another run, or a future scraper-side writer) inserting the same
    // ipo_id between our existence check and this insert must not abort the
    // whole run; it is a benign race, not a write failure.
    const returning = await db
      .insert(ipoFinancials)
      .values(w.insert)
      .onConflictDoNothing({ target: ipoFinancials.ipoId })
      .returning({ ipoId: ipoFinancials.ipoId });
    if (returning.length === 0) {
      console.log(`  [SKIP] ${w.slug}: ipo_financials row already exists (concurrent writer) — not overwritten`);
      skippedConflict++;
      continue;
    }
    if (returning.length !== 1) {
      console.error(`  [WRITE FAILED] ${w.slug}: expected 1 row RETURNING, got ${returning.length}`);
      continue;
    }
    written++;
    migratedSlugs.push(w.slug);
    migratedIpoIds.push(w.insert.ipoId);

    // Provenance note per copied field.
    const copiedFields: [string, unknown][] = [
      ['revenue_fy1', w.insert.revenueFy1],
      ['revenue_fy2', w.insert.revenueFy2],
      ['revenue_fy3', w.insert.revenueFy3],
      ['profit_fy1', w.insert.profitFy1],
      ['profit_fy2', w.insert.profitFy2],
      ['profit_fy3', w.insert.profitFy3],
      ['pe_ratio', w.insert.peRatio],
      ['roe_percentage', w.insert.roePercentage],
      ['debt_to_equity', w.insert.debtToEquity],
    ];
    for (const [fieldName, value] of copiedFields) {
      if (value === null) continue;
      await db.insert(fieldSources).values({
        ipoId: w.insert.ipoId,
        tableName: 'ipo_financials',
        fieldName,
        source: w.source as (typeof schema.scraperSourceEnum.enumValues)[number],
        confidence: 90,
        dataLineage: {
          method: 'MIGRATION',
          script: 'scraper/scripts/migrate-financial-data-to-ipo-financials.ts',
          copiedFrom: 'financial_data',
        },
        updatedBy: 'MIGRATION_SCRIPT',
      });
    }
  }

  console.log(`\nwritten: ${written}/${toWrite} (skipped-concurrent-conflict: ${skippedConflict})`);

  // Drop web cache keys for migrated IPOs. Addendum (round 2 follow-up):
  // `financials:enhanced:<ipoId>` (getIpoFinancialsKey, web/lib/cache/cache-keys.ts
  // ~151) backs IpoFinancialsRepository.findByIPO — the /api/tools/compare consumer
  // of the migrated value columns — and is never invalidated by anything else.
  try {
    const redis = getRedisClient();
    for (const slug of migratedSlugs) {
      const keys = [`ipo:detail:${slug}`, `ipo:slug:${slug}`];
      await redis.del(...keys);
    }
    for (const ipoId of migratedIpoIds) {
      await redis.del(`financials:enhanced:${ipoId}`);
    }
    console.log(`cache: deleted ipo:detail:*/ipo:slug:* for ${migratedSlugs.length} migrated slug(s), financials:enhanced:* for ${migratedIpoIds.length} ipoId(s)`);
    redis.disconnect();
  } catch (e) {
    console.log(`cache: REDIS_URL not reachable (${e instanceof Error ? e.message : String(e)}) — keys to drop manually: ${migratedSlugs.map((s) => `ipo:detail:${s}, ipo:slug:${s}`).join('; ')}; ${migratedIpoIds.map((id) => `financials:enhanced:${id}`).join('; ')}`);
  }

  await closePool();
  process.exit(written + skippedConflict === toWrite ? 0 : 1);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
