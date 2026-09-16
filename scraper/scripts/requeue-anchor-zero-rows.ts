/**
 * Re-queue the anchor-allocation documents that #437 slice 2 can now read.
 *
 *     npx tsx scripts/requeue-anchor-zero-rows.ts --expect-db <name> [--apply]
 *
 * WHY THIS TOOL EXISTS
 *
 * 18 production and 16 staging `ANCHOR_ALLOCATION_REPORT` documents sit in
 * `extraction_status = 'MANUAL_REVIEW'`. They are NOT one class:
 *
 *   - The #437 class: the extractor read zero investor rows, or read them and
 *     could not reconcile them, because the sidecar handed the parser a table
 *     it had rebuilt from a pure image scan with the numbers still carrying
 *     the scanner's separator damage. Slice 1 fixed the geometry, slice 2 the
 *     separators. These documents deserve another pass.
 *   - Everything else: a document the validator refused on its own terms (a
 *     wrong document type, a total that contradicts the rows, a letter for a
 *     different IPO). Those refusals are CORRECT and must stay in
 *     MANUAL_REVIEW. Re-running them wastes a cycle and, worse, invites a
 *     later reader to treat "we retried it" as "we fixed it".
 *
 * So this tool does NOT bump the extractor version. Bumping it is the blunt
 * instrument that would revive all 24 blocked documents at once, the six
 * correct refusals included. It resets ONLY the rows whose stored
 * `extraction_error` matches the #437 error classes, one document at a time,
 * and it prints every one of them by IPO name and document id — never a bare
 * count (`signal-ownership.md` R1: a number is not a reading).
 *
 * Dry run by default. `--apply` writes, and is refused against the production
 * database unless `--allow-prod` is given as well (`lib/repair-tool.ts`).
 * `--expect-db <name>` is MANDATORY: the run asks the SAME pool it would write
 * through which database it is actually in, and refuses before any write if
 * that is not the name given.
 */
// Item 1 slice s14 -- FIRST import on purpose (see lib/repair-tool.ts).
import '../../scripts/lib/alias-preflight-auto.mjs';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import path from 'node:path';
import {
  openRepairDb,
  queryCurrentDatabase,
  writeLedgerFile,
  type ExecuteLike,
} from './lib/repair-tool';

/** The document type this tool is allowed to touch. Nothing else, ever. */
export const ANCHOR_DOCUMENT_TYPE = 'ANCHOR_ALLOCATION_REPORT';

/** The status a blocked document sits in, and the one it is reset to. */
export const BLOCKED_STATUS = 'MANUAL_REVIEW';
export const REQUEUED_STATUS = 'PENDING';

/**
 * The #437 error classes, as the extractor actually writes them.
 *
 * Each pattern is anchored on wording the parser emits verbatim, so a refusal
 * from a DIFFERENT cause can never match by accident:
 *
 *   - `zero_rows` / "no investor rows" — the sidecar handed the parser a page
 *     it could not turn into a table at all (slice 1's class).
 *   - "only N investor rows could be read ... (candidate stage)" — rows were
 *     rebuilt but none carried a readable percent cell.
 *   - "only N investor rows survived reconciliation" and "disagreed with the
 *     derived bid price" — rows read, arithmetic refused them (slice 2's).
 *   - "prints X% but holds Y% of the anchor portion" and "percentages add up
 *     to" — the shrunken-denominator shape a doubled percent cell produces.
 *
 * Deliberately NOT here: "not an anchor allocation report", "the investor
 * amounts do not add up to the total allocation" (a contradiction between two
 * INDEPENDENT printed figures, which no separator repair can resolve), and
 * every validation refusal. Those stay in MANUAL_REVIEW.
 */
export const REQUEUE_ERROR_PATTERNS: readonly RegExp[] = [
  /zero_rows/i,
  /no investor rows/i,
  /only \d+ investor rows? could be read/i,
  /only \d+ investor rows? survived reconciliation/i,
  /investor rows? disagreed with the derived bid price/i,
  /prints [\d.]+% but holds [\d.]+% of the anchor portion/i,
  /investor percentages add up to/i,
];

/**
 * Deliberately NOT re-queued, and named so a reader can see the exclusion is a
 * decision rather than an oversight. Checked FIRST: a document whose error
 * matches one of these is never re-queued even if it also matches a pattern
 * above.
 */
export const HOLD_ERROR_PATTERNS: readonly RegExp[] = [
  /not an anchor allocation report/i,
  /the investor amounts do not add up to the total allocation/i,
  /belongs to a different ipo/i,
];

export interface BlockedDocument {
  id: string;
  ipoId: string;
  ipoName: string | null;
  ipoSlug: string | null;
  type: string;
  extractionStatus: string | null;
  extractionError: string | null;
}

export interface RequeueDecision {
  document: BlockedDocument;
  requeue: boolean;
  reason: string;
}

/**
 * The whole selection rule, as a pure function.
 *
 * Pure on purpose: the unit test drives real refusal strings through this
 * without a database, so deleting a guard turns a named test red instead of
 * silently widening what the tool resets. (`defect-fix-contract.md` item 3.)
 */
export function decideRequeue(doc: BlockedDocument): RequeueDecision {
  if (doc.type !== ANCHOR_DOCUMENT_TYPE) {
    return { document: doc, requeue: false, reason: `not an ${ANCHOR_DOCUMENT_TYPE}` };
  }
  if (doc.extractionStatus !== BLOCKED_STATUS) {
    return { document: doc, requeue: false, reason: `status is ${doc.extractionStatus}, not ${BLOCKED_STATUS}` };
  }
  const error = doc.extractionError ?? '';
  if (!error.trim()) {
    // No stored reason is not evidence of the #437 class. A document that got
    // here with an empty error was put there by something this tool has not
    // read, so it is left alone.
    return { document: doc, requeue: false, reason: 'no extraction_error recorded' };
  }
  const held = HOLD_ERROR_PATTERNS.find((p) => p.test(error));
  if (held) {
    return { document: doc, requeue: false, reason: `held: a correct refusal (${held.source})` };
  }
  const matched = REQUEUE_ERROR_PATTERNS.find((p) => p.test(error));
  if (!matched) {
    return { document: doc, requeue: false, reason: 'error is outside the #437 classes' };
  }
  return { document: doc, requeue: true, reason: `#437 class (${matched.source})` };
}

/** One printable identity line per document — never a bare count (R1). */
export function formatDecision(d: RequeueDecision): string {
  const doc = d.document;
  const who = doc.ipoName ?? doc.ipoSlug ?? doc.ipoId;
  const mark = d.requeue ? 'REQUEUE' : 'HOLD   ';
  const error = (doc.extractionError ?? '').replace(/\s+/g, ' ').slice(0, 110);
  return `${mark} ${who} [doc ${doc.id}] ${d.reason} :: ${error}`;
}

interface Cli {
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
}

export function parseArgs(argv: readonly string[]): Cli {
  const at = argv.indexOf('--expect-db');
  return {
    apply: argv.includes('--apply'),
    allowProd: argv.includes('--allow-prod'),
    expectDb: at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null,
  };
}

const TOOL = 'requeue-anchor-zero-rows';

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.expectDb) {
    console.error(
      `${TOOL}: --expect-db <name> is required on every run (dry or applied); refusing to guess the target database.`
    );
    process.exit(1);
  }

  const { db, closePool } = await import('./lib/db-handle.js').catch(async () => {
    const shared = await import('@ipodhan/shared/db');
    return { db: (shared as any).db, closePool: async (): Promise<void> => {} };
  });

  try {
    const actual = await queryCurrentDatabase(db as ExecuteLike);
    if (actual.toLowerCase() !== cli.expectDb.toLowerCase()) {
      console.error(
        `${TOOL}: --expect-db said "${cli.expectDb}" but this pool is connected to "${actual}" — refusing before any read or write.`
      );
      process.exit(1);
    }

    await openRepairDb(db as ExecuteLike, {
      apply: cli.apply,
      allowProd: cli.allowProd,
      toolName: TOOL,
    });

    const rows = await (db as any)
      .select({
        id: schema.documents.id,
        ipoId: schema.documents.ipoId,
        ipoName: schema.ipos.name,
        ipoSlug: schema.ipos.slug,
        type: schema.documents.type,
        extractionStatus: schema.documents.extractionStatus,
        extractionError: schema.documents.extractionError,
      })
      .from(schema.documents)
      .leftJoin(schema.ipos, eq(schema.ipos.id, schema.documents.ipoId))
      .where(
        and(
          eq(schema.documents.type, ANCHOR_DOCUMENT_TYPE as any),
          eq(schema.documents.extractionStatus, BLOCKED_STATUS)
        )
      );

    const decisions = (rows as BlockedDocument[]).map(decideRequeue);
    for (const d of decisions) console.log(formatDecision(d));

    const requeue = decisions.filter((d) => d.requeue);
    const held = decisions.filter((d) => !d.requeue);
    console.log(
      `\n${TOOL}: ${requeue.length} to re-queue, ${held.length} held, of ${decisions.length} ${BLOCKED_STATUS} ${ANCHOR_DOCUMENT_TYPE} documents in "${actual}".`
    );

    const ledger = {
      tool: TOOL,
      database: actual,
      apply: cli.apply,
      at: new Date().toISOString(),
      // The BACKUP: each document's prior status and error, so an applied run
      // can be reversed from this file alone.
      requeued: requeue.map((d) => ({
        documentId: d.document.id,
        ipoId: d.document.ipoId,
        ipoName: d.document.ipoName,
        previousStatus: d.document.extractionStatus,
        previousError: d.document.extractionError,
        matchedClass: d.reason,
      })),
      held: held.map((d) => ({
        documentId: d.document.id,
        ipoName: d.document.ipoName,
        reason: d.reason,
      })),
    };
    const ledgerPath = writeLedgerFile(
      path.join(
        process.cwd(),
        'scripts',
        'state',
        `${TOOL}-${cli.apply ? 'applied' : 'dryrun'}-${Date.now()}.json`
      ),
      ledger
    );
    console.log(`${TOOL}: ledger written to ${ledgerPath}`);

    if (!cli.apply) {
      console.log(`${TOOL}: DRY RUN — nothing was written. Re-run with --apply to reset the ${requeue.length} listed above.`);
      return;
    }
    if (requeue.length === 0) {
      console.log(`${TOOL}: nothing to re-queue.`);
      return;
    }

    // The extractor version is deliberately NOT touched — see the header.
    await (db as any)
      .update(schema.documents)
      .set({ extractionStatus: REQUEUED_STATUS, extractionError: null })
      .where(inArray(schema.documents.id, requeue.map((d) => d.document.id)));

    console.log(`${TOOL}: reset ${requeue.length} documents to ${REQUEUED_STATUS}:`);
    for (const d of requeue) console.log(`  ${d.document.ipoName ?? d.document.ipoId} [doc ${d.document.id}]`);
  } finally {
    await closePool?.();
  }
}

// Only run when invoked directly, so the unit test can import the pure parts.
if (process.argv[1] && process.argv[1].includes('requeue-anchor-zero-rows')) {
  main().catch((e) => {
    console.error(`${TOOL}: ${e?.message ?? e}`);
    process.exit(1);
  });
}
