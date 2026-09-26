/**
 * Item 22 repair (OD-36, F-154; failure class container-unwrapped-to-one-member):
 * give every zip stored BEFORE the member fix its missing member documents.
 *
 * The same work runs INSIDE the pipeline (round 3): the data-slot document
 * cycle expands up to 3 unexamined stored zips per wake
 * (`stored-zip-expansion-pass.ts`), so staging and prod are repaired by the
 * normal deploy, never by a manual run on the serving host. This CLI is for a
 * dry run (what would be added) and for manual use; it calls the SAME function.
 *
 * ONE path, no copy of the rules: `DocumentDiscoveryRunner.expandStoredZip`
 *  - fetches through the runner's own `request()` (OD-37 resolved-address
 *    refusal, the network counter, the NSE ladder) and `verifyDownload` with
 *    the cover-page company check;
 *  - proves identity: a stored sha256 must equal the chosen member's; a row
 *    with NO sha256 (W-1) is expanded only when the cover check PASSED, and
 *    its sha256 is backfilled;
 *  - stores members through `storeZipMemberDocuments`;
 *  - writes the durable marker `documents.zip_members_checked_at` (migration
 *    0055) for every definite verdict, so a zip is examined once. Types are
 *    closed FOUND by the next cycle's `runIpo`, which reads the member rows and
 *    applies the MAJOR 1 rule (only when the exchanges list no link of their own).
 *
 * Selection: `DocumentRepository.listZipsWithUncheckedMembers` - every `.zip`
 * row (no fragment) whose marker is NULL. Re-runnable: an examined zip leaves
 * the selection.
 *
 * WHERE --apply RUNS: member PDFs go to the document store
 * (`PROSPECTUS_STORE_DIR`), which must be the serving slot's store, so
 * `--apply` refuses unless it is set explicitly. On a serving host, prefer the
 * in-pipeline pass; a manual --apply there is an ad-hoc host run.
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
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRepairDb, queryCurrentDatabase, writeLedgerFile, type ExecuteLike } from './lib/repair-tool';
import { DocumentDiscoveryRunner, defaultFetcher } from '../src/services/document-discovery-runner';
import { NetworkCounter } from '../src/utils/network-counter';
import type { SeenBySha, StoredZip, StoredZipExpansion } from '../src/services/zip-member-documents';
import { toStoredZip } from '../src/services/stored-zip-expansion-pass';

export type { StoredZip, StoredZipExpansion };

const TOOL = 'repair-zip-member-documents';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Expand ONE stored zip through the runner (the one implementation). */
export function repairOneZip(
  zip: StoredZip,
  deps: {
    runner: Pick<DocumentDiscoveryRunner, 'expandStoredZip'>;
    apply: boolean;
    /** sha256 memory for THIS IPO across the zips of one run (shared by the caller). */
    seenBySha?: SeenBySha;
  }
): Promise<StoredZipExpansion> {
  return deps.runner.expandStoredZip(zip, { apply: deps.apply, seenBySha: deps.seenBySha });
}

/** One printable line per member, and the counts the summary and the ledger use. */
export function describe(result: StoredZipExpansion): { lines: string[]; toAdd: number } {
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
  if (result.backfilledSha256) lines.push(`${who}: identity by cover check; sha256 ${result.backfilledSha256.slice(0, 8)} backfilled`);
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
  const runner = new DocumentDiscoveryRunner({
    fetcher: defaultFetcher,
    store,
    documents,
    counter: new NetworkCounter(),
    ...(storeDir ? { storeDir } : {}),
  });
  const zips = (await documents.listZipsWithUncheckedMembers({ slug: cli.slug }))
    .map(toStoredZip)
    .filter((z): z is StoredZip => z !== null);
  console.log(`${TOOL}: ${zips.length} stored zip(s) whose members were never examined in "${actual}"${cli.slug ? ` (slug ${cli.slug})` : ''}.`);

  const results: StoredZipExpansion[] = [];
  let toAdd = 0;
  const seenByIpo = new Map<string, SeenBySha>();
  for (const zip of zips) {
    let seenBySha = seenByIpo.get(zip.ipoId);
    if (!seenBySha) seenByIpo.set(zip.ipoId, (seenBySha = new Map()));
    const r = await repairOneZip(zip, { runner, apply: cli.apply, seenBySha });
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
      mode: cli.apply ? 'apply' : 'dry-run',
      generatedAt: new Date().toISOString(),
      // Inserts only — `before` is null (no prior document row for a new zip member).
      changes: results.flatMap((r) =>
        r.outcomes
          .filter((o) => o.action === 'would_store' || o.action === 'stored' || o.documentId)
          .map((o) => ({
            table: 'documents',
            rowKey: o.documentId ?? `${r.zip.documentId}:${o.member}`,
            field: '(row)',
            before: null,
            after: { member: o.member, sha256: o.sha256, type: o.type ?? null },
          }))
      ),
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
        identity: r.identity ?? null,
        backfilledSha256: r.backfilledSha256 ?? null,
        checked: r.checked,
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
