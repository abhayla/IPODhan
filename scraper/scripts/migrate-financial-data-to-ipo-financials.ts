/**
 * Migration/repair: financial_data -> ipo_financials (T-477, issue #224).
 *
 * WHY: the site's detail-page components (FinancialTable.tsx,
 * PeerCompaniesList.tsx, ComparisonTable.tsx via
 * web/lib/repositories/ipo-repository.ts ~415-422) read `ipo_financials`,
 * which no scraper ever writes — it sat at 0 rows for all 242 IPOs (issue
 * #224) while the DRHP/pdfplumber extractor (C3b) has been filling
 * `financial_data` (168 rows on staging 2026-09-07). An unused draft of this
 * migration lived at `web/scripts/migrate-financial-data-to-ipo-financials.ts`
 * (Story 4.10) — this is that script productised per the repair-tool
 * convention (`backfill-issue-size-chittorgarh-detail.ts`): dry-run default,
 * --apply required, --allow-prod + database-name guard, idempotent (skips
 * IPOs that already have an ipo_financials row), source-backed (copies the
 * financial_data row's own `field_sources` provenance, defaulting to DRHP —
 * the C3b extractor's source — when no field_sources row exists),
 * RETURNING-checked, and cache-dropping.
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
import { eq, inArray, sql } from 'drizzle-orm';
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
  const provenanceRows = await db
    .select({ ipoId: fieldSources.ipoId, source: fieldSources.source })
    .from(fieldSources)
    .where(
      inArray(fieldSources.ipoId, rows.map((r) => r.ipoId))
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
  const migratedSlugs: string[] = [];
  for (const w of writes) {
    const returning = await db.insert(ipoFinancials).values(w.insert).returning({ ipoId: ipoFinancials.ipoId });
    if (returning.length !== 1) {
      console.error(`  [WRITE FAILED] ${w.slug}: expected 1 row RETURNING, got ${returning.length}`);
      continue;
    }
    written++;
    migratedSlugs.push(w.slug);

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

  console.log(`\nwritten: ${written}/${toWrite}`);

  // Drop web cache keys for migrated IPOs.
  try {
    const redis = getRedisClient();
    for (const slug of migratedSlugs) {
      const keys = [`ipo:detail:${slug}`, `ipo:slug:${slug}`];
      await redis.del(...keys);
    }
    console.log(`cache: deleted ipo:detail:*/ipo:slug:* for ${migratedSlugs.length} migrated slug(s)`);
    redis.disconnect();
  } catch (e) {
    console.log(`cache: REDIS_URL not reachable (${e instanceof Error ? e.message : String(e)}) — keys to drop manually: ${migratedSlugs.map((s) => `ipo:detail:${s}, ipo:slug:${s}`).join('; ')}`);
  }

  await closePool();
  process.exit(written === toWrite ? 0 : 1);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
