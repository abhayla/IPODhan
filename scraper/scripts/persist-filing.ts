/**
 * Persist one filing extraction (walk step G4).
 *
 *   npx tsx scripts/persist-filing.ts --ipo <slug|uuid|name> \
 *     --doc-type PRICE_BAND_AD|RHP|DRHP|PROSPECTUS --json <extraction.json> \
 *     --expect-db <name> [--apply]
 *
 * Dry-run by default: it resolves the IPO, computes the full write plan and
 * prints the summary WITHOUT touching the database. --apply performs the writes.
 *
 * #640: staging and production share a host+port (the same SSH tunnel on
 * 127.0.0.1:15432) — the database NAME is the only thing telling them apart.
 * `--expect-db <name>` is MANDATORY with `--apply`; every run (dry or applied)
 * prints `current_database()`/host/port from the SAME pool that would do the
 * writing and refuses, before any write, if it does not match `--expect-db`.
 *
 * Run from scraper/ (DB creds from ../web/.env.local, override:true - same
 * convention as backfill-financials-pdf.ts).
 *
 * UNIT CONTRACT (read before comparing two market-cap numbers):
 *   ipos.issue_size, ipo_details.fresh_issue / ofs_issue and
 *   ipo_valuation.mcap_at_floor / mcap_at_cap are stored in RUPEES.
 *   financial_data.market_cap is stored in CRORE.
 *   financial_statements keeps its own published unit per row (MILLION | LAKH |
 *   CRORE) and a later filing is converted INTO the stored row's unit.
 * A filing whose `unit` is absent or unrecognised has every unit-dependent
 * write skipped and reported under `skipped_no_unit` — nothing is guessed.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '../web/.env.local', override: true });

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { eq, or, ilike, sql } from 'drizzle-orm';
import {
  db,
  getRedisClient,
  filterProtectedFields,
  IPORepository,
} from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import {
  persistFilingExtraction,
  type FilingDocType,
  type FilingExtraction,
  parseFilingUnit,
} from '../src/services/filing-persister.js';
import { buildFilingPersistDeps } from '../src/services/filing-persist-deps.js';
import { persistAnchorReport } from '../src/services/anchor-persister.js';
import { scrapeAnchorInvestors } from '../src/scrapers/anchor-investors-scraper.js';
import { AnchorInvestorRepository } from '../src/repositories/anchor-investor-repository.js';
import {
  checkCrossDocumentAgreement,
  comparableSeries,
  decidePairedPersist,
  withholdDisagreeingMetrics,
} from '../src/services/cross-document-agreement.js';

/**
 * Injection seam for the wiring test (MAJOR-2). `decidePairedPersist` was tested
 * as a pure function, but nothing proved this script CALLS it before persisting —
 * deleting the refusal branch left every test green. `run()` is importable so a
 * test can drive the paired path with the DB-touching steps replaced.
 */
export interface RunOverrides {
  resolveIpoId?: (needle: string) => Promise<string>;
  persistFiling?: typeof persistFilingExtraction;
  persistAnchor?: typeof persistAnchorReport;
  assertConnectedDatabase?: typeof assertConnectedDatabase;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #640: staging and production are the SAME host and port, reached through the
 * same tunnel — the database NAME is the only thing that tells them apart, and
 * `packages/shared/src/db/index.ts` silently defaults an unset `DATABASE_NAME`
 * to `'ipodhan'` (production). This does not remove that default (see the PR —
 * that is separate follow-up work); it makes THIS write tool prove which
 * database it is actually connected to and refuse to run when the caller did
 * not name one, or named the wrong one.
 *
 * A `--apply` run with no `--expect-db` is refused before anything else runs —
 * no connection is even needed to catch that misuse. Pure, so a test can
 * delete the refusal and watch a named test go red without touching a DB.
 */
export function requireExpectDbForApply(
  apply: boolean,
  expectDb: string | undefined
): { refuse: boolean; reason?: string } {
  if (apply && !expectDb) {
    return {
      refuse: true,
      reason:
        'persist-filing: --apply requires --expect-db <name> naming the database this run must write to; refusing to guess the target.',
    };
  }
  return { refuse: false };
}

/**
 * The exact-match half of the guard: `current_database()` on the pool about to
 * be used MUST equal what the caller named, in every mode (dry run included —
 * that is how an operator catches the mistake before ever adding `--apply`).
 * Pure so the always-true mutant (comparison that never refuses) is caught by
 * a unit test with no DB in the loop.
 */
export function decideDbMismatch(
  expectDb: string | undefined,
  actualDb: string
): { refuse: boolean; reason?: string } {
  if (expectDb && expectDb !== actualDb) {
    return {
      refuse: true,
      reason: `persist-filing: refusing — expected database "${expectDb}" but this connection is to "${actualDb}".`,
    };
  }
  return { refuse: false };
}

/**
 * Runs BEFORE any write path (anchor / paired / single — see `run()`) and on
 * every dry run too. Prints the real target on the SAME connection that would
 * do the writing (never an env var — `initPool()` prefers `DATABASE_HOST` and
 * an env-derived name can lie about which socket actually opened), then
 * refuses via `process.exit` (never "warn and continue") on either violation.
 */
export async function assertConnectedDatabase(
  dbLike: { execute: (query: unknown) => Promise<unknown> },
  expectDb: string | undefined,
  apply: boolean,
  io: {
    log?: (line: string) => void;
    error?: (line: string) => void;
    exit?: (code: number) => void;
  } = {}
): Promise<void> {
  const log = io.log ?? ((l: string) => console.log(l));
  const err = io.error ?? ((l: string) => console.error(l));
  const exit = io.exit ?? ((code: number) => process.exit(code));

  const preflight = requireExpectDbForApply(apply, expectDb);
  if (preflight.refuse) {
    err(preflight.reason!);
    exit(2);
    return;
  }

  const result = await dbLike.execute(
    sql`SELECT current_database() AS db, inet_server_addr() AS host, inet_server_port() AS port`
  );
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: Array<Record<string, unknown>> })?.rows ?? []);
  const row = (rows[0] ?? {}) as Record<string, unknown>;
  const actualDb = String(row.db ?? '');
  log(
    `persist-filing target -> current_database=${actualDb} host=${row.host ?? 'null'} port=${row.port ?? 'null'}`
  );

  const decision = decideDbMismatch(expectDb, actualDb);
  if (decision.refuse) {
    err(decision.reason!);
    exit(2);
  }
}

/**
 * S-02: the dependency builder moved to
 * `src/services/filing-persist-deps.ts` so the document cycle can use the SAME
 * write door. It is imported, never re-declared here — a second copy is exactly
 * how the two doors would drift apart.
 */
const buildDeps = buildFilingPersistDeps;

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

export async function run(
  argv: string[] = process.argv,
  overrides: RunOverrides = {}
): Promise<void> {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const persistFiling = overrides.persistFiling ?? persistFilingExtraction;
  const persistAnchor = overrides.persistAnchor ?? persistAnchorReport;
  const assertDb = overrides.assertConnectedDatabase ?? assertConnectedDatabase;

  const ipoArg = arg('ipo');
  const docType = arg('doc-type') as FilingDocType | undefined;
  const jsonPath = arg('json');
  const apply = argv.includes('--apply');
  const expectDb = arg('expect-db');

  const adPath = arg('json-ad');
  const rhpPath = arg('json-rhp');
  const paired = Boolean(adPath && rhpPath);

  // The anchor report is read from the stored PDF, not from an extraction
  // JSON, so it is the one doc type that needs no --json.
  const anchorMode = !paired && docType === 'ANCHOR_ALLOCATION_REPORT';
  if (!ipoArg || (!paired && !anchorMode && (!docType || !jsonPath))) {
    console.error(
      [
        'usage: persist-filing.ts --ipo <slug|uuid|name>',
        '         --doc-type PRICE_BAND_AD|RHP|DRHP|PROSPECTUS|ANCHOR_ALLOCATION_REPORT',
        '         --json <path> [--apply] --expect-db <name> (required with --apply)',
        '   or: persist-filing.ts --ipo <..> --json-ad <ad.json> --json-rhp <rhp.json> [--apply]',
        '       (paired mode runs the W-45 cross-document agreement gate first)',
      ].join('\n')
    );
    process.exit(2);
  }

  // #640: prove which database this run is actually connected to and refuse a
  // mismatch, BEFORE any of the three write paths below (anchor / paired /
  // single) touch the database. Runs on every dry run too, not just --apply.
  await assertDb(db, expectDb, apply);

  const redis = getRedisClient();
  const ipoId = await (overrides.resolveIpoId ?? resolveIpoId)(ipoArg);

  // ------------------------------------------------------------------ W-51
  if (anchorMode) {
    const summary = await persistAnchor(
      ipoId,
      { companyName: arg('company') ?? '', apply },
      {
        scrapeAnchorReport: (id, name) => scrapeAnchorInvestors(db, id, name),
        anchorInvestorRepository: new AnchorInvestorRepository(db),
        // The anchor door reads ipos.scraper_locked through this; without it the
        // CLI could write through an admin lock (it did, until CRITICAL-2).
        ipoRepository: new IPORepository(db, redis),
        protectionFilter: (
          id: string,
          table: string,
          data: Record<string, unknown>,
          scraperName: string
        ) => filterProtectedFields(id, table, data, scraperName, db, redis),
      }
    );
    console.log(`\n=== ${apply ? 'APPLIED' : 'DRY RUN (no writes)'} - ANCHOR_ALLOCATION_REPORT ===`);
    console.log(JSON.stringify(summary, null, 2));
    if (summary.refusedReason) {
      console.error(`\nREFUSED (nothing written): ${summary.refusedReason}`);
      process.exit(1);
    }
    if (!apply) console.log('\nRe-run with --apply to write.');
    return;
  }

  // ------------------------------------------------------------------ W-45
  if (paired) {
    let ad = JSON.parse(readFileSync(adPath as string, 'utf8')) as FilingExtraction;
    let rhp = JSON.parse(readFileSync(rhpPath as string, 'utf8')) as FilingExtraction;

    // MAJOR-3: the two documents need not be printed in the same unit, so the
    // units go in and amounts are converted before comparison.
    const agreement = checkCrossDocumentAgreement(
      comparableSeries(ad),
      comparableSeries(rhp),
      undefined,
      'PRICE_BAND_AD',
      'RHP',
      parseFilingUnit(ad.unit),
      parseFilingUnit(rhp.unit)
    );
    console.log('\n=== CROSS-DOCUMENT AGREEMENT (W-45) ===');
    console.log(JSON.stringify(agreement, null, 2));

    // The decision itself lives in decidePairedPersist so it can be tested
    // without running this script. Printing REFUSED and then persisting anyway
    // is exactly what this used to do.
    const decision = decidePairedPersist(agreement);
    if (!decision.proceed) {
      // Two calls rather than one embedded newline: a patching script turned an
      // escaped-newline sequence into a REAL line break here and esbuild refused
      // the whole file, so the CLI would not start at all. Guarded by
      // tests/unit/scripts/scripts-parse.test.ts.
      console.error('');
      console.error(`REFUSED: ${decision.reason}`);
      process.exit(decision.exitCode);
    }
    if (decision.withhold.length > 0) {
      // Same issuer, same day, same restated accounts - a disagreement means
      // one of the two was mis-parsed and there is no way to tell which, so
      // NEITHER series is written.
      ad = withholdDisagreeingMetrics(ad, decision.withhold);
      rhp = withholdDisagreeingMetrics(rhp, decision.withhold);
    }

    const pairs: Array<[FilingDocType, FilingExtraction]> = [
      ['PRICE_BAND_AD', ad],
      ['RHP', rhp],
    ];
    for (const [dt, ex] of pairs) {
      const summary = await persistFiling(
        ipoId,
        ex,
        {
          docType: dt,
          documentId: arg('document-id') ?? null,
          sourceSha: arg('source-sha') ?? null,
          apply,
        },
        buildDeps(redis)
      );
      console.log(`\n=== ${apply ? 'APPLIED' : 'DRY RUN (no writes)'} - ${dt} (paired) ===`);
      console.log(
        JSON.stringify(
          {
            ...summary,
            skipped_cross_document_disagreement: agreement.disagreements.map(
              (d) =>
                `${d.metric} FY${d.fiscalYear}: ${d.valueA} (PRICE_BAND_AD) vs ${d.valueB} (RHP)`
            ),
          },
          null,
          2
        )
      );
    }
    if (!apply) console.log('\nRe-run with --apply to write.');
    return;
  }

  if (!['PRICE_BAND_AD', 'RHP', 'DRHP', 'PROSPECTUS'].includes(docType as string)) {
    console.error(`unknown --doc-type ${docType}`);
    process.exit(2);
  }

  const extraction = JSON.parse(readFileSync(jsonPath as string, 'utf8')) as FilingExtraction;
  if (extraction.doc_type && extraction.doc_type !== docType) {
    console.error(
      `--doc-type ${docType} disagrees with the extraction's own doc_type ${extraction.doc_type}; refusing.`
    );
    process.exit(2);
  }

  const summary = await persistFiling(
    ipoId,
    extraction,
    {
      docType: docType as FilingDocType,
      documentId: arg('document-id') ?? null,
      sourceSha: arg('source-sha') ?? null,
      apply,
    },
    buildDeps(redis)
  );

  console.log(`\n=== ${apply ? 'APPLIED' : 'DRY RUN (no writes)'} — ${docType} ===`);
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) console.log('\nRe-run with --apply to write.');
}

// Only the CLI entry point runs; importing this module (the wiring test does)
// must not start a run.
//
// MINOR-3: `path.resolve` returns the OS's native casing, and on Windows
// argv[1] can carry a different drive-letter case than `import.meta.url`
// (`d:\...` vs `D:\...`) — a case-sensitive `===` then fails even though both
// paths name the same file, silently no-op'ing the CLI. Compare
// case-insensitively on win32 only (POSIX paths are case-sensitive by design).
const resolvedArgv1 = typeof process.argv[1] === 'string' ? path.resolve(process.argv[1]) : null;
const resolvedModuleUrl = fileURLToPath(import.meta.url);
const normalizeForCompare = (p: string): string =>
  process.platform === 'win32' ? p.toLowerCase() : p;
const invokedDirectly =
  resolvedArgv1 !== null &&
  normalizeForCompare(resolvedArgv1) === normalizeForCompare(resolvedModuleUrl);

if (invokedDirectly) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else if (resolvedArgv1 !== null && resolvedArgv1.endsWith('persist-filing.ts')) {
  // The guard did not match while argv[1] is clearly this script — never fail
  // silently; a mismatch here (e.g. an unhandled case/path quirk) must be
  // visible, not a no-op CLI.
  console.error(
    `persist-filing.ts: main-guard did not match (argv[1]=${resolvedArgv1}, module=${resolvedModuleUrl}) — CLI not started.`
  );
}
