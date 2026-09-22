/**
 * repair-not-extractable-documents.ts — #869 step 2: restamp the documents that
 * were admitted as PENDING but whose type has no extractor.
 *
 * WHY THIS EXISTS. `extraction_status = 'PENDING'` meant two opposite things —
 * "queued, will be processed" and "can never be processed" — and nothing told
 * them apart. Step 1 of #869 (this PR) fixes ADMISSION: a document whose type is
 * outside `AUTO_PERSIST_DOC_TYPES` is now stamped `NOT_EXTRACTABLE` when it
 * arrives. That stops the tap. It does nothing for rows already written, which
 * keep claiming to be queued forever.
 *
 * MEASURED on ipodhan_staging 2026-09-23:
 *
 *   type                          total  pending  completed
 *   RATIOS_BASIS_ISSUE_PRICE         49       49          0
 *   SAMPLE_APPLICATION_FORMS          6        6          0
 *   SECURITY_PARAMS_PRE_ANCHOR        6        6          0
 *   SECURITY_PARAMS_POST_ANCHOR       3        3          0
 *   BIDDING_CENTERS                   3        3          0
 *   CORRIGENDUM                       2        2          0
 *   BASIS_OF_ALLOTMENT_AD             1        1          0
 *   ADDENDUM                          1        1          0
 *                                    71       71          0
 *
 * 100% PENDING with ZERO ever COMPLETED across 8 types is the signature of "no
 * handler exists", not of load.
 *
 * THE CLASS IT REPAIRS, as a data filter (defect-fix-contract.md item 2): every
 * `documents` row, on any slot, of any IPO status or segment, whose
 * `extraction_status = 'PENDING'` AND whose `type` fails `isExtractableDocType`.
 * NOT a list of the eight types measured above — the filter is evaluated per row
 * against the same predicate the consumer dispatches on, so a ninth type is
 * repaired by the same run with no code change.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH:
 *   - a row in any status other than PENDING. COMPLETED, FAILED and
 *     MANUAL_REVIEW are outcomes somebody or something reached; overwriting one
 *     would destroy that information.
 *   - a PENDING row whose type DOES have an extractor. Those are genuinely
 *     queued and are item 17's problem, not this one.
 *
 * REVERSIBLE by design. If an extractor is ever written for one of these types,
 * `--undo` puts its rows back to PENDING so they re-enter the queue.
 *
 * Usage:
 *   tsx scraper/scripts/repair-not-extractable-documents.ts                # dry run
 *   tsx scraper/scripts/repair-not-extractable-documents.ts --apply
 *   tsx scraper/scripts/repair-not-extractable-documents.ts --undo --type CORRIGENDUM --apply
 *
 * Dry run is the DEFAULT: it prints the per-type counts it would change and writes
 * nothing. The production guard is the SHARED one (openRepairDb, T-490): an --apply
 * against `ipodhan` is refused unless --allow-prod is given.
 *
 * Exit 0 clean · 1 a write failed.
 */
import { db } from '@ipodhan/shared';
import { sql } from 'drizzle-orm';
import { openRepairDb } from './lib/repair-tool.js';
import {
  isExtractableDocType,
  NOT_EXTRACTABLE_STATUS,
} from '../src/services/filing-auto-persist.js';

interface Args {
  apply: boolean;
  undo: boolean;
  type: string | null;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { apply: false, undo: false, type: null, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') a.apply = true;
    else if (argv[i] === '--undo') a.undo = true;
    else if (argv[i] === '--type') a.type = argv[++i] ?? null;
    else if (argv[i] === '--allow-prod') a.allowProd = true;
  }
  return a;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  // T-490: the SHARED guard, not a hand-rolled one. It asks the same connection
  // (never an env var) which database it is in, prints `current_database(): <name>`,
  // and refuses a production --apply without --allow-prod. Three repair tools each
  // re-typed this pattern on 2026-09-07 and each got a different part wrong, which is
  // why re-implementing it is a CI failure rather than a style note — and why my first
  // version of this file, which did exactly that, was correctly refused.
  const { dbName } = await openRepairDb(db, {
    apply: args.apply,
    allowProd: args.allowProd,
    toolName: 'repair-not-extractable-documents',
  });
  console.log(`mode: ${args.apply ? 'APPLY' : 'DRY RUN'}${args.undo ? ' (undo)' : ''}
`);

  try {
    // Read candidates by STATUS only, then filter by the shared predicate in JS.
    // Doing the type test in SQL would mean a second, hand-maintained copy of the
    // extractable set — exactly the drift this fix exists to prevent.
    const fromStatus = args.undo ? NOT_EXTRACTABLE_STATUS : 'PENDING';
    const toStatus = args.undo ? 'PENDING' : NOT_EXTRACTABLE_STATUS;

    const read = await db.execute(
      sql`SELECT id, type::text AS type FROM documents WHERE extraction_status = ${fromStatus}`
    );
    const rows = (read as unknown as { rows: { id: string; type: string }[] }).rows ?? [];

    const candidates = rows.filter((r) => {
      if (args.type && r.type.toUpperCase() !== args.type.toUpperCase()) return false;
      // Going TO not-extractable: only types with no extractor.
      // Coming BACK: only types that now HAVE one — that is what makes an undo
      // meaningful; a row whose type still has no extractor stays put.
      return args.undo ? isExtractableDocType(r.type) : !isExtractableDocType(r.type);
    });

    const byType = new Map<string, number>();
    for (const r of candidates) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);

    console.log(`${rows.length} row(s) in ${fromStatus}; ${candidates.length} match the class:`);
    if (byType.size === 0) {
      console.log('  (none — nothing to do)');
      return 0;
    }
    for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${t.padEnd(30)} ${String(n).padStart(4)}`);
    }

    if (!args.apply) {
      console.log(`
DRY RUN — nothing written. Re-run with --apply to set these to ${toStatus}.`);
      return 0;
    }

    // Filtered by the id list the predicate produced, so the write can never be
    // wider than what was just reported.
    const ids = candidates.map((r) => r.id);
    // NOTE: drizzle's sql`` expands a JS array into a parameter LIST — `${ids}` becomes
    // ($2, $3, ...) — so `ANY(${ids}::uuid[])` produces `ANY(($2,$3)::uuid[])`, which
    // Postgres rejects. Caught by re-running the apply proof after this file was
    // rewritten onto the shared repair-tool module: the DRY RUN still passed and only
    // the write failed. Bind the array as ONE parameter via sql.param().
    const updated = await db.execute(
      sql`UPDATE documents SET extraction_status = ${toStatus}, updated_at = now()
          WHERE id = ANY(${sql.param(ids)}::uuid[])`
    );
    const changed = (updated as unknown as { rowCount?: number }).rowCount ?? 0;
    console.log(`
APPLIED — ${changed} row(s) set to ${toStatus} on ${dbName}.`);

    // Read back rather than trust rowCount: the count says the statement ran, not
    // that the rows hold what was intended.
    const verify = await db.execute(
      sql`SELECT count(*)::int AS n FROM documents
          WHERE id = ANY(${sql.param(ids)}::uuid[]) AND extraction_status = ${toStatus}`
    );
    const held = ((verify as unknown as { rows: { n: number }[] }).rows ?? [{ n: 0 }])[0].n;
    console.log(`read-back: ${held} of ${ids.length} row(s) hold ${toStatus}.`);
    return held === ids.length ? 0 : 1;
  } catch (err) {
    console.error('FAILED:', err instanceof Error ? err.message : String(err));
    return 1;
  }
}

main().then((code) => {
  process.exitCode = code;
});
