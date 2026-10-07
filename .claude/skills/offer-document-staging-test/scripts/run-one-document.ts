// Laptop run of the REAL document step (processPendingFilings + buildAutoPersistDeps, the path the
// scheduled document cycle uses) for ONE document, saving into ipodhan_test only.
//
// Usage (DB tunnel open; env DATABASE_HOST/PORT/USER/PASSWORD set, DATABASE_NAME=ipodhan_test, plus
// staging's ENABLE_* flags so the save path behaves like staging):
//   npx tsx run-one-document.ts --repo <checkout under test> --ipo <ipo uuid> --doc <document uuid> \
//     --pdf <local copy of the stored PDF> [--apply]
// --repo is the checkout whose code is tested (a fix branch worktree); this script only drives it.
// Refuses any database other than ipodhan_test, and a PDF whose sha256 differs from the stored row.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const repo = path.resolve(arg('--repo') ?? '.');
  const ipoId = arg('--ipo');
  const docId = arg('--doc');
  const pdf = arg('--pdf');
  const apply = process.argv.includes('--apply');
  if (!ipoId || !docId || !pdf) throw new Error('usage: --repo <dir> --ipo <uuid> --doc <uuid> --pdf <file> [--apply]');
  if (process.env.DATABASE_NAME !== 'ipodhan_test') throw new Error('refusing: DATABASE_NAME must be ipodhan_test');
  // The app's db module may prefer DATABASE_URL; never let a stray one point elsewhere.
  delete process.env.DATABASE_URL;
  // An empty cache db: a laptop Redis can hold stale copies of rows from other runs.
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/15';

  const mod = (p: string) => import(pathToFileURL(path.join(repo, p)).href);
  const pg = await mod('scripts/lib/pg-utc.mjs');
  const params = await mod('scripts/lib/pg-connection-params.mjs');
  pg.installUtcTimestampParsing();
  const guard = pg.createUtcPool({ ...params.resolveDiscreteDbParams(process.env), ssl: false, max: 1 });
  const dbName = (await guard.query('select current_database() d')).rows[0].d;
  console.log('database:', dbName, '| code under test:', repo);
  if (dbName !== 'ipodhan_test') throw new Error(`refusing: connected to ${dbName}`);

  const fa = await mod('scraper/src/services/filing-auto-persist.ts');
  const store = await mod('scraper/src/services/document-store.ts');
  // The scratch cache (db 15) is emptied before every run: a cached document list from an earlier
  // run would hide the rows as they are now (2026-10-04: a stale list kept a bad sha256 alive).
  if (!/\/15$/.test(process.env.REDIS_URL ?? '')) throw new Error('refusing: REDIS_URL must be the scratch db 15');
  const { default: IORedis } = await import('ioredis');
  const scratch = new IORedis(process.env.REDIS_URL as string);
  await scratch.flushdb();
  await scratch.quit();
  const deps = fa.buildAutoPersistDeps();
  const docs = (await deps.loadDocuments(ipoId)).filter((d: { id: string }) => d.id === docId);
  if (docs.length !== 1) throw new Error(`document ${docId} not found for IPO ${ipoId} in ipodhan_test (seed it first)`);
  const doc = docs[0];
  const sha = crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
  console.log('document', doc.type, doc.extractionStatus, '| stored sha', doc.sha256, '| local sha', sha);
  if (sha !== doc.sha256) throw new Error('refusing: the local PDF is not the stored document');

  const storeDir = fs.mkdtempSync(path.join(path.dirname(pdf), '.run-store-'));
  try {
    const target = store.documentPath(ipoId, doc.type, sha, storeDir);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(pdf, target);
    if (!apply) {
      console.log('DRY RUN: would read and save', doc.id);
      return;
    }
    // A test run always reads the document again: earlier runs' record is cleared first.
    await guard.query('delete from document_field_receipts where document_id=$1', [docId]);
    await guard.query(
      "update documents set extraction_status='PENDING', retry_count=0, extraction_error=null where id=$1",
      [docId]
    );
    // The row is PENDING now; build it directly rather than through the cached document list.
    const fresh = [{ ...doc, extractionStatus: 'PENDING', retryCount: 0, extractionError: null }];
    const ipo = (await deps.persisterDeps.ipoRepository.findById(ipoId)) as Record<string, unknown>;
    const result = await fa.processPendingFilings(
      { id: ipoId, companyName: ipo.companyName, slug: ipo.slug, segment: ipo.segment },
      { ...deps, storeDir, loadDocuments: async () => fresh }
    );
    const { considered, extracted, persisted, failed, skipped } = result;
    console.log(JSON.stringify({ considered, extracted, persisted, failed, skipped }));
  } finally {
    fs.rmSync(storeDir, { recursive: true, force: true });
    await guard.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e?.message ?? e);
    process.exit(1);
  });
