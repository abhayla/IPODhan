/**
 * Persist one filing extraction (walk step G4).
 *
 *   npx tsx scripts/persist-filing.ts --ipo <slug|uuid|name> \
 *     --doc-type PRICE_BAND_AD|RHP|DRHP|PROSPECTUS --json <extraction.json> [--apply]
 *
 * Dry-run by default: it resolves the IPO, computes the full write plan and
 * prints the summary WITHOUT touching the database. --apply performs the writes.
 *
 * Run from scraper/ (DB creds from ../web/.env.local, override:true - same
 * convention as backfill-financials-pdf.ts).
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '../web/.env.local', override: true });

import { readFileSync } from 'fs';
import { eq, or, ilike } from 'drizzle-orm';
import {
  db,
  getRedisClient,
  IPORepository,
  FinancialStatementsRepository,
  IpoValuationRepository,
  PromotersRepository,
  IpoIntermediariesRepository,
  BrlmTrackRecordRepository,
  FinancialDataRepository,
  FieldSourcesRepository,
} from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { PeerCompanyRepository } from '../src/repositories/peer-company-repository.js';
import {
  persistFilingExtraction,
  type FilingDocType,
  type FilingExtraction,
  type IpoDetailsWriter,
} from '../src/services/filing-persister.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ipo_details has no repository - this is the single write path for it. */
function makeIpoDetailsWriter(): IpoDetailsWriter {
  return {
    async upsert(ipoId, values) {
      await db
        .insert(schema.ipoDetails)
        .values({ ipoId, ...values, updatedAt: new Date() } as never)
        .onConflictDoUpdate({
          target: schema.ipoDetails.ipoId,
          set: { ...values, updatedAt: new Date() } as never,
        });
    },
  };
}

async function resolveIpoId(needle: string): Promise<string> {
  if (UUID_RE.test(needle)) return needle;
  const rows = await db
    .select({ id: schema.ipos.id, name: schema.ipos.companyName, slug: schema.ipos.slug })
    .from(schema.ipos)
    .where(
      or(
        eq(schema.ipos.slug, needle),
        ilike(schema.ipos.companyName, `%${needle}%`),
        ilike(schema.ipos.slug, `%${needle.toLowerCase()}%`)
      )
    )
    .limit(5);
  if (rows.length === 0) throw new Error(`No IPO matched --ipo "${needle}"`);
  if (rows.length > 1) {
    throw new Error(
      `--ipo "${needle}" is ambiguous: ${rows.map((r) => `${r.slug} (${r.id})`).join(', ')}`
    );
  }
  console.log(`Resolved --ipo "${needle}" -> ${rows[0].name} [${rows[0].id}]`);
  return rows[0].id;
}

async function main(): Promise<void> {
  const ipoArg = arg('ipo');
  const docType = arg('doc-type') as FilingDocType | undefined;
  const jsonPath = arg('json');
  const apply = process.argv.includes('--apply');

  if (!ipoArg || !docType || !jsonPath) {
    console.error(
      'usage: persist-filing.ts --ipo <slug|uuid|name> --doc-type PRICE_BAND_AD|RHP|DRHP|PROSPECTUS --json <path> [--apply]'
    );
    process.exit(2);
  }
  if (!['PRICE_BAND_AD', 'RHP', 'DRHP', 'PROSPECTUS'].includes(docType)) {
    console.error(`unknown --doc-type ${docType}`);
    process.exit(2);
  }

  const extraction = JSON.parse(readFileSync(jsonPath, 'utf8')) as FilingExtraction;
  if (extraction.doc_type && extraction.doc_type !== docType) {
    console.error(
      `--doc-type ${docType} disagrees with the extraction's own doc_type ${extraction.doc_type}; refusing.`
    );
    process.exit(2);
  }

  const redis = getRedisClient();
  const ipoId = await resolveIpoId(ipoArg);

  const summary = await persistFilingExtraction(
    ipoId,
    extraction,
    {
      docType,
      documentId: arg('document-id') ?? null,
      sourceSha: arg('source-sha') ?? null,
      apply,
    },
    {
      ipoRepository: new IPORepository(db, redis),
      financialStatements: new FinancialStatementsRepository(db, redis),
      ipoValuation: new IpoValuationRepository(db, redis),
      promoters: new PromotersRepository(db, redis),
      intermediaries: new IpoIntermediariesRepository(db, redis),
      brlmTrackRecord: new BrlmTrackRecordRepository(db, redis),
      peerCompanies: new PeerCompanyRepository(db),
      financialData: new FinancialDataRepository(db, redis),
      fieldSources: new FieldSourcesRepository(db, redis),
      ipoDetailsWriter: makeIpoDetailsWriter(),
    }
  );

  console.log(`\n=== ${apply ? 'APPLIED' : 'DRY RUN (no writes)'} — ${docType} ===`);
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) console.log('\nRe-run with --apply to write.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
