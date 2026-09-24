/**
 * Item 22 repair (OD-36, F-154; failure class container-unwrapped-to-one-member):
 * give every zip stored BEFORE the member fix its missing member documents.
 *
 * The live fix stores each typed member of a zip the NEXT time the zip is
 * fetched. A zip already stored as FOUND is never fetched again, so without
 * this tool the corrigenda and price-band notices inside the 41 zips already
 * on staging stay invisible (4 IPOs — hy-tech-engineers-ltd, abh-healthcare-ltd,
 * madhur-knit-crafts-ltd, rays-of-belief-ltd — have no corrigendum row at all).
 *
 * ONE path, no copy of the rules:
 *  - re-fetch with the runner's own download headers (`downloadHeadersFor`) and
 *    `defaultFetcher`, verify with the SAME `verifyDownload` the runner uses;
 *  - the chosen member's sha256 must EQUAL the stored document's sha256 — the
 *    proof that this is the archive the runner already verified as this IPO's
 *    (cover check included). A changed archive, or a row stored before sha256
 *    was written (W-1), is reported and HELD, never expanded;
 *  - store members through `storeZipMemberDocuments` (GID / unclassified /
 *    size / volume split / cross-run sha256 dedupe / stable `#member=` key) and
 *    mark each supplied type FOUND through `markTypeFoundFromZip`.
 *
 * Selection: every `documents` row whose url ends in `.zip` (no fragment) and
 * that has no `<url>#member=` sibling yet. Re-runnable: after an apply the
 * expanded zips drop out of the selection, and any still selected (only GIDs or
 * duplicates inside) report 0 to add.
 *
 * WHERE --apply RUNS: the member PDF is written to the document store
 * (`PROSPECTUS_STORE_DIR`), which must be the serving slot's store, or the next
 * cycle's `demoteMissingFiles` finds no file for the FOUND row. `--apply`
 * therefore refuses unless PROSPECTUS_STORE_DIR is set explicitly.
 *
 * Usage (from scraper/):
 *   npx tsx scripts/repair-zip-member-documents.ts --expect-db ipodhan_staging                 # dry run
 *   npx tsx scripts/repair-zip-member-documents.ts --expect-db ipodhan_staging --slug <slug>   # one IPO
 *   PROSPECTUS_STORE_DIR=<slot store> npx tsx scripts/repair-zip-member-documents.ts --expect-db ipodhan_staging --apply
 * Prod is refused without --allow-prod (openRepairDb).
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import { DocumentRepository, DocumentFetchStateRepository } from '@ipodhan/shared/repositories';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRepairDb, queryCurrentDatabase, writeLedgerFile, type ExecuteLike } from './lib/repair-tool';
import {
  defaultFetcher,
  downloadHeadersFor,
  DOWNLOAD_TIMEOUT_MS,
  type HttpFetcher,
} from '../src/services/document-discovery-runner';
import { isVerifyFailure, verifyDownload } from '../src/services/document-download-verifier';
import {
  markTypeFoundFromZip,
  storeZipMemberDocuments,
  type SeenBySha,
  type ZipMemberOutcome,
} from '../src/services/zip-member-documents';
import { DOCUMENT_TYPES, type DocumentType } from '../src/services/document-types';

const TOOL = 'repair-zip-member-documents';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface StoredZip {
  documentId: string;
  ipoId: string;
  slug: string | null;
  type: DocumentType;
  url: string;
  title: string;
  exchange: string;
  sha256: string | null;
}

export interface ZipRepairResult {
  zip: StoredZip;
  /** Set when the zip could not be expanded at all. */
  refused?: string;
  outcomes: ZipMemberOutcome[];
  foundMarked: DocumentType[];
}

type DocumentsLike = Parameters<typeof storeZipMemberDocuments>[0]['documents'];

/**
 * Expand ONE stored zip. Pure of the database choice: the caller passes the
 * sinks, so a unit test drives it with fakes and the real run with the
 * repositories.
 */
export async function repairOneZip(
  zip: StoredZip,
  deps: {
    fetcher: HttpFetcher;
    documents: DocumentsLike;
    store?: Parameters<typeof markTypeFoundFromZip>[0];
    apply: boolean;
    storeDir?: string;
    /** sha256 memory for THIS IPO across the zips of one run (shared by the caller). */
    seenBySha?: SeenBySha;
  }
): Promise<ZipRepairResult> {
  const res = await deps.fetcher(zip.url, { headers: downloadHeadersFor(zip.exchange), timeoutMs: DOWNLOAD_TIMEOUT_MS });
  const verdict = verifyDownload(res.body, { status: res.status, contentType: res.contentType, url: res.url }, { wantedType: zip.type });
  if (isVerifyFailure(verdict)) {
    return { zip, refused: `refetch_rejected:${verdict.reason} (http ${res.status})`, outcomes: [], foundMarked: [] };
  }
  if (!verdict.wasZip) return { zip, refused: 'not_a_zip_any_more', outcomes: [], foundMarked: [] };
  if (!zip.sha256) {
    // A row stored before sha256 was written (W-1) cannot prove the archive is
    // the one the runner verified, so it is held rather than trusted.
    return { zip, refused: `no_stored_sha256 (now ${verdict.sha256.slice(0, 8)}) — held, not expanded`, outcomes: [], foundMarked: [] };
  }
  if (verdict.sha256 !== zip.sha256) {
    return {
      zip,
      refused: `archive_changed_since_stored (stored ${zip.sha256.slice(0, 8)}, now ${verdict.sha256.slice(0, 8)}) — held, not expanded`,
      outcomes: [],
      foundMarked: [],
    };
  }
  const seen: SeenBySha = deps.seenBySha ?? new Map();
  seen.set(verdict.sha256, { documentId: zip.documentId, docType: zip.type });
  const outcomes = await storeZipMemberDocuments(
    { documents: deps.documents, storeDir: deps.storeDir },
    {
      ipoId: zip.ipoId,
      zipUrl: zip.url,
      zipTitle: zip.title,
      exchange: zip.exchange,
      mainType: zip.type,
      members: verdict.otherZipMembers ?? [],
      dryRun: !deps.apply,
    },
    seen
  );
  const foundMarked: DocumentType[] = [];
  if (deps.apply && deps.store) {
    for (const o of outcomes) {
      if (!o.suppliesType || !o.documentId || foundMarked.includes(o.suppliesType)) continue;
      if (await markTypeFoundFromZip(deps.store, zip.ipoId, o.suppliesType, o.documentId, zip.url)) foundMarked.push(o.suppliesType);
    }
  }
  return { zip, outcomes, foundMarked };
}

/** One printable line per member, and the counts the summary and the ledger use. */
export function describe(result: ZipRepairResult): { lines: string[]; toAdd: number } {
  const who = `${result.zip.slug ?? result.zip.ipoId} ${result.zip.type} ${result.zip.url}`;
  if (result.refused) return { lines: [`${who}: REFUSED ${result.refused}`], toAdd: 0 };
  const lines = result.outcomes.map((o) => {
    const at = `"${o.member}" (part ${o.position}, ${o.bytes} bytes)`;
    switch (o.action) {
      case 'would_store':
        return `${who}: WOULD ADD ${o.type} ${at}`;
      case 'stored':
        return `${who}: ADDED ${o.type} ${at} -> ${o.documentId}`;
      case 'duplicate':
        return `${who}: SKIP duplicate by sha256 (${o.reason}) ${at}`;
      default:
        return `${who}: SKIP ${o.reason === 'gid' ? 'GID' : o.reason} ${at}`;
    }
  });
  if (lines.length === 0) lines.push(`${who}: no other PDF member`);
  const toAdd = result.outcomes.filter((o) => o.action === 'would_store' || o.action === 'stored').length;
  return { lines, toAdd };
}

interface Cli {
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
  slug: string | null;
}

function valueAfter(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
}

export function parseArgs(argv: readonly string[]): Cli {
  return {
    apply: argv.includes('--apply'),
    allowProd: argv.includes('--allow-prod'),
    expectDb: valueAfter(argv, '--expect-db'),
    slug: valueAfter(argv, '--slug'),
  };
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return ((result as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
}

async function readUnexpandedZips(slug: string | null): Promise<StoredZip[]> {
  const result = await (db as any).execute(sql`
    SELECT d.id, d.ipo_id, i.slug, d.type::text AS type, d.url, d.title, d.exchange, d.sha256
      FROM documents d
      JOIN ipos i ON i.id = d.ipo_id
     WHERE lower(d.url) LIKE '%.zip'
       AND strpos(d.url, '#') = 0
       AND NOT EXISTS (
         SELECT 1 FROM documents m WHERE starts_with(m.url, d.url || '#member=')
       )
       AND (${slug}::text IS NULL OR i.slug = ${slug})
     ORDER BY i.slug, d.url
  `);
  return rowsOf(result)
    .filter((r) => (DOCUMENT_TYPES as readonly string[]).includes(String(r.type)))
    .map((r) => ({
      documentId: String(r.id),
      ipoId: String(r.ipo_id),
      slug: (r.slug as string) ?? null,
      type: String(r.type) as DocumentType,
      url: String(r.url),
      title: String(r.title ?? ''),
      exchange: String(r.exchange ?? 'NSE'),
      sha256: r.sha256 ? String(r.sha256).trim() : null,
    }));
}

const NO_CACHE = { get: async () => null, set: async () => 'OK', del: async () => 0, keys: async () => [] };

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.expectDb) {
    console.error(`${TOOL}: --expect-db <name> is required on every run (dry or applied); refusing to guess the target database.`);
    process.exit(1);
  }
  const actual = await queryCurrentDatabase(db as ExecuteLike);
  if (actual.toLowerCase() !== cli.expectDb.toLowerCase()) {
    console.error(`${TOOL}: --expect-db said "${cli.expectDb}" but this pool is connected to "${actual}" — refusing before any read or write.`);
    process.exit(1);
  }
  await openRepairDb(db as ExecuteLike, { apply: cli.apply, allowProd: cli.allowProd, toolName: TOOL });
  const storeDir = process.env.PROSPECTUS_STORE_DIR?.trim();
  if (cli.apply && !storeDir) {
    console.error(`${TOOL}: --apply needs PROSPECTUS_STORE_DIR set to the SERVING slot's document store; a member PDF written anywhere else is demoted as missing on the next cycle.`);
    process.exit(1);
  }

  const documents = new DocumentRepository(db as never, NO_CACHE as never);
  const store = new DocumentFetchStateRepository(db as never, NO_CACHE as never);
  const zips = await readUnexpandedZips(cli.slug);
  console.log(`${TOOL}: ${zips.length} stored zip(s) without member rows in "${actual}"${cli.slug ? ` (slug ${cli.slug})` : ''}.`);

  const results: ZipRepairResult[] = [];
  let toAdd = 0;
  const seenByIpo = new Map<string, SeenBySha>();
  for (const zip of zips) {
    let seenBySha = seenByIpo.get(zip.ipoId);
    if (!seenBySha) seenByIpo.set(zip.ipoId, (seenBySha = new Map()));
    const r = await repairOneZip(zip, { fetcher: defaultFetcher, documents, store, apply: cli.apply, storeDir, seenBySha });
    results.push(r);
    const d = describe(r);
    toAdd += d.toAdd;
    for (const line of d.lines) console.log(`  ${line}`);
  }
  const ipos = new Set(results.filter((r) => describe(r).toAdd > 0).map((r) => r.zip.slug ?? r.zip.ipoId));
  console.log(
    `${TOOL}: ${cli.apply ? 'added' : 'would add'} ${toAdd} member row(s) across ${ipos.size} IPO(s): ${[...ipos].join(', ') || '-'}; refused ${results.filter((r) => r.refused).length} zip(s).`
  );

  const ledgerPath = writeLedgerFile(
    path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${cli.apply ? 'applied' : 'dryrun'}-${Date.now()}.json`),
    {
      tool: TOOL,
      database: actual,
      apply: cli.apply,
      at: new Date().toISOString(),
      storeDir: storeDir ?? null,
      toAdd,
      // Before-image: the zip rows had no member siblings (the selection).
      // After-image: exactly the rows written and the fetch-state types moved.
      zips: results.map((r) => ({
        documentId: r.zip.documentId,
        slug: r.zip.slug,
        type: r.zip.type,
        url: r.zip.url,
        refused: r.refused ?? null,
        foundMarked: r.foundMarked,
        members: r.outcomes.map((o) => ({
          member: o.member,
          position: o.position,
          bytes: o.bytes,
          sha256: o.sha256,
          action: o.action,
          reason: o.reason,
          type: o.type ?? null,
          documentId: o.documentId ?? null,
          url: o.url ?? null,
        })),
      })),
    }
  );
  console.log(`${TOOL}: ledger written to ${ledgerPath}`);
  if (!cli.apply) console.log(`${TOOL}: DRY RUN — nothing was written.`);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`${TOOL}: ${e?.message ?? e}`);
      process.exit(1);
    });
}
