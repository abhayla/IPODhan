/**
 * READ-ONLY probe: calls the REAL field-plan-walk DOC fetcher
 * (`buildDocFetcher`, field-plan-walk-doc-fetcher.ts) against a live database
 * and prints what it answers and WHY (which documents it saw, which
 * field_sources row it read). Item 6 / F-161.
 *
 * It never writes: the pool opens every transaction read-only
 * (`default_transaction_read_only=on`) and the Redis passed to the
 * repositories is an in-memory no-op, so no cache key is written anywhere.
 *
 * Usage (from scraper/):
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_staging \
 *     npx tsx scripts/probe-doc-fetcher.ts --slug axiom-gas-engineering-ltd --field ipos.issue_size
 *   ... npx tsx scripts/probe-doc-fetcher.ts --class
 *     (every ipo_field_plan row with rank1 DOC whose last rank-1 answer was
 *      NOT_AVAILABLE_YET while the IPO holds a COMPLETED offer document;
 *      prints the outcome tally the fetcher gives NOW, with the gap reason)
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
// Side-effect import: @ipodhan/shared/db calls configureUtcTimestampParsing() at load (UTC timestamp parser).
import '@ipodhan/shared/db';
import { IPORepository } from '@ipodhan/shared/repositories';
import { FieldSourcesRepository } from '@ipodhan/shared/repositories/field-sources-repository';
import { buildDocFetcher, docTypeFamily } from '../src/services/field-plan-walk-doc-fetcher.js';
import { loadFieldManifest } from '../src/config/field-manifest-loader.js';

const noopRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({
    connectionString: url,
    options: '-c timezone=UTC -c default_transaction_read_only=on',
    max: 2,
  });
  const db = drizzle(pool, { schema });
  const manifest = loadFieldManifest();
  const entry = (t: string, f: string) => manifest.fields[`${t}.${f}`];
  // The real DocumentRepository selects every schema.ts column; a staging DB one
  // migration behind main (e.g. documents.zip_members_checked_at) refuses that
  // SELECT. The fetcher reads only these five fields, so the probe reads them
  // by name (same rows, same filter: documents.ipo_id = $1).
  const documentRepository = {
    async findByIPO(ipoId: string) {
      const { rows } = await pool.query(
        `select id, type, extraction_status as "extractionStatus", is_active as "isActive", sha256
           from documents where ipo_id = $1`,
        [ipoId]
      );
      return rows;
    },
  };
  const deps = {
    fieldSources: new FieldSourcesRepository(db as never, noopRedis as never),
    ipoRepository: new IPORepository(db as never, noopRedis as never),
    documentRepository,
    manifestDocumentType: (t: string, f: string) => entry(t, f)?.documentType,
    isDocCapable: (t: string, f: string) => entry(t, f)?.capability?.DOC?.capable === true,
    ipoDetailsReader: {
      async findByIpoId(ipoId: string) {
        const rows = await db.select().from(schema.ipoDetails).where(eq(schema.ipoDetails.ipoId, ipoId)).limit(1);
        return (rows[0] as unknown as Record<string, unknown>) ?? null;
      },
    },
  };
  const fetcher = buildDocFetcher(deps as never);

  try {
    if (process.argv.includes('--class')) {
      const { rows } = await pool.query(`
        select p.ipo_id, i.slug, p.table_name, p.field_name, coalesce(p.row_key,'') row_key
          from ipo_field_plan p join ipos i on i.id = p.ipo_id
         where p.rank1_source = 'DOC' and p.cause like 'rank1:DOC:NOT_AVAILABLE_YET%'
           and exists (select 1 from documents d where d.ipo_id = p.ipo_id
                        and d.extraction_status = 'COMPLETED' and d.is_active is not false
                        and d.type in ('RHP','DRHP','PROSPECTUS','PRICE_BAND_AD'))`);
      const tally = new Map<string, number>();
      const ipos = new Set<string>();
      for (const r of rows) {
        ipos.add(r.ipo_id);
        const a = await fetcher(r.ipo_id, r.table_name, r.row_key, r.field_name);
        const key = a.outcome === 'CHECK_FAILED' ? `CHECK_FAILED:${(a as { gap?: string }).gap ?? 'read-error'}` : a.outcome;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      console.log(`class rows=${rows.length} ipos=${ipos.size}`);
      for (const [k, n] of [...tally.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${k}: ${n}`);
      return;
    }

    const slug = arg('--slug');
    const field = arg('--field');
    if (!slug || !field) throw new Error('--slug and --field (table.field) are required, or --class');
    const [tableName, fieldName] = field.split('.');
    const { rows: ipoRows } = await pool.query('select id from ipos where slug = $1', [slug]);
    if (ipoRows.length !== 1) throw new Error(`slug ${slug}: ${ipoRows.length} rows`);
    const ipoId = ipoRows[0].id as string;
    const docType = deps.manifestDocumentType(tableName, fieldName);
    const docs = (await documentRepository.findByIPO(ipoId)) as unknown as Array<Record<string, unknown>>;
    console.log(`ipo=${slug} (${ipoId}) field=${field} manifest.documentType=${docType} family=${JSON.stringify(docType ? docTypeFamily(docType) : null)}`);
    for (const d of docs) console.log(`  document ${d.id} type=${d.type} extraction=${d.extractionStatus} active=${d.isActive}`);
    const { rows: prov } = await pool.query(
      `select source, row_key, data_lineage from field_sources where ipo_id=$1 and table_name=$2 and field_name=$3`,
      [ipoId, tableName, fieldName.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())]
    );
    for (const p of prov) console.log(`  field_sources source=${p.source} row_key='${p.row_key}' lineage=${JSON.stringify(p.data_lineage)}`);
    const answer = await fetcher(ipoId, tableName, '', fieldName);
    console.log(`ANSWER ${JSON.stringify(answer)}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('probe failed:', e instanceof Error ? e.message : e, (e as { cause?: unknown })?.cause ?? '');
  process.exit(1);
});
