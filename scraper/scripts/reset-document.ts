/**
 * W-158 — reset one `documents` row's extraction state AND invalidate the
 * Redis cache the document cycle actually reads.
 *
 * WHY THIS SCRIPT EXISTS. A manual
 * `update documents set extraction_status='PENDING'` on staging was invisible
 * to the scraper for three cycles because `DocumentRepository.findByIPO`
 * (packages/shared) is cache-aside in Redis (`documents:<ipoId>`,
 * `CacheTTL.DOCUMENTS` = 3600s) — the cycle's selector and its
 * extraction_failed tally both read the cached list, not the row an operator
 * just changed with SQL. This CLI does both halves of the fix in one command:
 * write the row AND drop the key that would otherwise shadow it for up to an
 * hour, then re-reads the row THROUGH `DocumentRepository` (not raw SQL) so
 * the printed output proves the cache miss served the fresh row.
 *
 * Dry-run by default — it resolves the target document, prints before/after,
 * and writes NOTHING until `--apply` is passed. Modelled on the CLI shape of
 * `scripts/persist-filing.ts` (arg parsing, --apply default off, db/redis
 * wiring via `@ipodhan/shared`, injectable DB-touching seams for the wiring
 * test, exit codes).
 *
 * Usage (from scraper/):
 *   npx tsx scripts/reset-document.ts --document-id <uuid> [--to PENDING|MANUAL_REVIEW] [--apply]
 *   npx tsx scripts/reset-document.ts --ipo <slug|uuid> --doc-type RHP [--apply]
 *
 * Flags:
 *   --to <PENDING|MANUAL_REVIEW>   target extraction_status (default PENDING)
 *   --clear-retries                retry_count=0, extraction_error=null
 *                                   (this ALSO clears any W-137 HARD_FAILURE
 *                                   marker and any MANUAL_REVIEW blocked-version
 *                                   marker, both of which live in extraction_error)
 *   --no-clear-retries             explicitly keep retry_count/extraction_error
 *   --apply                        perform the writes (default: dry run)
 *   --allow-prod                   permit running with NODE_ENV=production
 *
 * Default for --clear-retries: ON when --to PENDING, OFF when --to MANUAL_REVIEW
 * (an operator moving a document back to MANUAL_REVIEW is usually parking it,
 * not resetting its attempt history) — pass the flag explicitly to override.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '../web/.env.local', override: true });

import { eq, and } from 'drizzle-orm';
import { db, getRedisClient, DocumentRepository } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { getDocumentsKey } from '@ipodhan/shared/cache/cache-keys';

export type ResetTarget = 'PENDING' | 'MANUAL_REVIEW';

export interface DocumentRow {
  id: string;
  ipoId: string;
  type: string;
  title: string;
  extractionStatus: string | null;
  extractionError: string | null;
  retryCount: number;
}

export interface DocumentPatch {
  extractionStatus: ResetTarget;
  retryCount?: number;
  extractionError?: null;
}

/**
 * Injection seam for the unit tests (fakes only — never a real DB/Redis
 * connection). Each function is the one place `run()` touches storage, so a
 * test can drive the full CLI (arg parsing, refusal branches, dry-run vs
 * --apply, the exact cache keys deleted) against in-memory fakes.
 */
export interface RunDeps {
  resolveIpoId: (needle: string) => Promise<string>;
  getDocumentById: (id: string) => Promise<DocumentRow | null>;
  listDocumentsForIpo: (ipoId: string, docType: string) => Promise<DocumentRow[]>;
  updateDocument: (id: string, patch: DocumentPatch) => Promise<DocumentRow>;
  invalidateKeys: (keys: string[]) => Promise<void>;
  /** Reads the row back THROUGH the repository cache-aside path. */
  rereadDocuments: (ipoId: string) => Promise<DocumentRow[]>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toDocumentRow(row: {
  id: string;
  ipoId: string;
  type: string;
  title: string;
  extractionStatus: string | null;
  extractionError: string | null;
  retryCount: number;
}): DocumentRow {
  return {
    id: row.id,
    ipoId: row.ipoId,
    type: row.type,
    title: row.title,
    extractionStatus: row.extractionStatus,
    extractionError: row.extractionError,
    retryCount: row.retryCount,
  };
}

/** Real (non-test) implementation — wired to `@ipodhan/shared`'s db/redis. */
export function buildDefaultDeps(): RunDeps {
  const redis = getRedisClient();

  return {
    async resolveIpoId(needle: string): Promise<string> {
      if (UUID_RE.test(needle)) return needle;
      const { or, ilike } = await import('drizzle-orm');
      const rows = await db
        .select({ id: schema.ipos.id, slug: schema.ipos.slug, name: schema.ipos.companyName })
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
      return rows[0].id;
    },

    async getDocumentById(id: string): Promise<DocumentRow | null> {
      const rows = await db
        .select({
          id: schema.documents.id,
          ipoId: schema.documents.ipoId,
          type: schema.documents.type,
          title: schema.documents.title,
          extractionStatus: schema.documents.extractionStatus,
          extractionError: schema.documents.extractionError,
          retryCount: schema.documents.retryCount,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, id))
        .limit(1);
      return rows[0] ? toDocumentRow(rows[0]) : null;
    },

    async listDocumentsForIpo(ipoId: string, docType: string): Promise<DocumentRow[]> {
      const rows = await db
        .select({
          id: schema.documents.id,
          ipoId: schema.documents.ipoId,
          type: schema.documents.type,
          title: schema.documents.title,
          extractionStatus: schema.documents.extractionStatus,
          extractionError: schema.documents.extractionError,
          retryCount: schema.documents.retryCount,
        })
        .from(schema.documents)
        .where(and(eq(schema.documents.ipoId, ipoId), eq(schema.documents.type, docType as never)));
      return rows.map(toDocumentRow);
    },

    async updateDocument(id: string, patch: DocumentPatch): Promise<DocumentRow> {
      const [row] = await db
        .update(schema.documents)
        .set({
          extractionStatus: patch.extractionStatus,
          ...(patch.retryCount !== undefined ? { retryCount: patch.retryCount } : {}),
          ...(patch.extractionError !== undefined ? { extractionError: patch.extractionError } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.documents.id, id))
        .returning({
          id: schema.documents.id,
          ipoId: schema.documents.ipoId,
          type: schema.documents.type,
          title: schema.documents.title,
          extractionStatus: schema.documents.extractionStatus,
          extractionError: schema.documents.extractionError,
          retryCount: schema.documents.retryCount,
        });
      return toDocumentRow(row);
    },

    async invalidateKeys(keys: string[]): Promise<void> {
      if (keys.length === 0) return;
      await redis.del(...keys);
    },

    async rereadDocuments(ipoId: string): Promise<DocumentRow[]> {
      const repo = new DocumentRepository(db, redis);
      const rows = await repo.findByIPO(ipoId);
      return rows.map((r) =>
        toDocumentRow({
          id: r.id,
          ipoId: r.ipoId,
          type: String(r.type),
          title: r.title,
          extractionStatus: r.extractionStatus,
          extractionError: r.extractionError,
          retryCount: r.retryCount,
        })
      );
    },
  };
}

function printRow(label: string, row: DocumentRow | null): void {
  console.log(`${label}:`, JSON.stringify(row, null, 2));
}

export async function run(argv: string[] = process.argv, overrides: Partial<RunDeps> = {}): Promise<void> {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const isProd = process.env.NODE_ENV === 'production';
  const allowProd = argv.includes('--allow-prod');
  if (isProd && !allowProd) {
    console.error(
      'reset-document: refusing to run with NODE_ENV=production — pass --allow-prod to override.'
    );
    process.exit(1);
  }
  if (isProd && allowProd) {
    console.log('ALLOW-PROD: running with NODE_ENV=production (--allow-prod given).');
  }

  const documentId = arg('document-id');
  const ipoNeedle = arg('ipo');
  const docType = arg('doc-type');
  const toArg = (arg('to') ?? 'PENDING').toUpperCase();
  const apply = argv.includes('--apply');
  const clearRetriesExplicit = argv.includes('--clear-retries')
    ? true
    : argv.includes('--no-clear-retries')
      ? false
      : undefined;

  if (!documentId && !(ipoNeedle && docType)) {
    console.error(
      [
        'usage: reset-document.ts --document-id <uuid> [--to PENDING|MANUAL_REVIEW] [--apply]',
        '   or: reset-document.ts --ipo <slug|uuid> --doc-type <TYPE> [--to PENDING|MANUAL_REVIEW] [--apply]',
        'flags: --clear-retries | --no-clear-retries, --allow-prod',
      ].join('\n')
    );
    process.exit(2);
  }

  if (toArg !== 'PENDING' && toArg !== 'MANUAL_REVIEW') {
    console.error(`unknown --to ${toArg} (expected PENDING or MANUAL_REVIEW)`);
    process.exit(2);
  }
  const to = toArg as ResetTarget;
  const clearRetries = clearRetriesExplicit ?? to === 'PENDING';

  const deps: RunDeps = { ...buildDefaultDepsLazy(overrides), ...overrides };

  let doc: DocumentRow;
  if (documentId) {
    const found = await deps.getDocumentById(documentId);
    if (!found) {
      console.error(`REFUSED: no document found for --document-id ${documentId}`);
      process.exit(1);
    }
    doc = found;
  } else {
    const ipoId = await deps.resolveIpoId(ipoNeedle as string);
    const candidates = await deps.listDocumentsForIpo(ipoId, docType as string);
    if (candidates.length === 0) {
      console.error(`REFUSED: no ${docType} document found for --ipo ${ipoNeedle}`);
      process.exit(1);
    }
    if (candidates.length > 1) {
      console.error(
        `REFUSED: --ipo ${ipoNeedle} --doc-type ${docType} is ambiguous: ${candidates
          .map((c) => c.id)
          .join(', ')}`
      );
      process.exit(1);
    }
    doc = candidates[0];
  }

  printRow('BEFORE', doc);

  const patch: DocumentPatch = {
    extractionStatus: to,
    ...(clearRetries ? { retryCount: 0, extractionError: null } : {}),
  };
  const plannedAfter: DocumentRow = {
    ...doc,
    extractionStatus: patch.extractionStatus,
    ...(clearRetries ? { retryCount: 0, extractionError: null } : {}),
  };
  printRow(apply ? 'APPLYING' : 'PLANNED (dry run)', plannedAfter);
  console.log(`clear-retries: ${clearRetries}${clearRetries ? ' (also clears any W-137 HARD_FAILURE / MANUAL_REVIEW version marker in extraction_error)' : ''}`);

  const keys = [getDocumentsKey(doc.ipoId)];
  console.log(`cache keys to invalidate: ${keys.join(', ')}`);

  if (!apply) {
    console.log('\nDRY RUN — no writes, no cache invalidation. Re-run with --apply.');
    return;
  }

  await deps.updateDocument(doc.id, patch);
  await deps.invalidateKeys(keys);

  const freshRows = await deps.rereadDocuments(doc.ipoId);
  const fresh = freshRows.find((r) => r.id === doc.id) ?? null;
  printRow('AFTER (re-read through DocumentRepository — proves the cache miss served the fresh row)', fresh);
}

/**
 * Builds the real deps only when at least one function isn't already
 * overridden by the caller — the unit tests override every function, so this
 * never touches `@ipodhan/shared`'s live db/redis in a test run.
 */
function buildDefaultDepsLazy(overrides: Partial<RunDeps>): RunDeps {
  const allProvided =
    overrides.resolveIpoId &&
    overrides.getDocumentById &&
    overrides.listDocumentsForIpo &&
    overrides.updateDocument &&
    overrides.invalidateKeys &&
    overrides.rereadDocuments;
  if (allProvided) return overrides as RunDeps;
  return buildDefaultDeps();
}

const isMain = /reset-document[.]ts$/.test(String(process.argv[1] ?? '').split(/[/\\]/).pop() ?? '');
if (isMain) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
