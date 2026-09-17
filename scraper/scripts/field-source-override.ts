/**
 * Item 3, slice S4 — the `field_source_overrides` CLI (layer 2 of the field source policy).
 * `set` writes an override for a (table, field[, ipo]) after refusing any invalid candidate
 * (rule 1: capable-only sources; S-05: no document source on an E-1 timetable field; distinct
 * ranks; a reason >= 20 chars). `list` prints every active override. `expire` marks one row
 * expired (never deletes it — the row stays as history, per the card's rollback plan).
 *
 * This is a repair-class tool (it writes rows) — it goes through `openRepairDb` for the SAME
 * db-name + prod-write guard every other `scraper/scripts/*.ts` repair tool uses
 * (`scripts/ci/require-repair-tool-module.mjs` enforces the import).
 *
 *   npx tsx scraper/scripts/field-source-override.ts set --table ipos --column issue_size \
 *     --ranks CHITTORGARH,DOC --reason "..." --expect-db ipodhan_staging --apply
 *   npx tsx scraper/scripts/field-source-override.ts list --expect-db ipodhan_staging
 *   npx tsx scraper/scripts/field-source-override.ts expire <id> --expect-db ipodhan_staging --apply
 *
 * Exit codes: 0 success (including a dry run and a `list`); 1 usage error, validation refusal,
 * wrong database, or prod write refused without --allow-prod.
 */
// Item 1 slice s14 -- FIRST import on purpose (see lib/repair-tool.ts).
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import { FieldSourceOverridesRepository } from '@ipodhan/shared/repositories/field-source-overrides-repository';
import type { NewFieldSourceOverride } from '@ipodhan/shared/db/schema';
import { loadFieldManifest } from '../src/config/field-manifest-loader.js';
import type { SourceCode } from '../src/config/field-manifest-schema.js';
import { validateOverrideCandidate } from '../src/config/field-source-override-validation.js';
import { openRepairDb, type ExecuteLike } from './lib/repair-tool.js';

const TOOL = 'field-source-override';
const DEFAULT_EXPIRES_IN_DAYS = 30;

export type Subcommand = 'set' | 'list' | 'expire';

export interface SetCli {
  subcommand: 'set';
  table: string | null;
  column: string | null;
  ipo: string | null;
  ranks: string[];
  reason: string | null;
  expiresInDays: number;
  setBy: string;
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
}

export interface ListCli {
  subcommand: 'list';
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
}

export interface ExpireCli {
  subcommand: 'expire';
  id: string | null;
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
}

export type Cli = SetCli | ListCli | ExpireCli | { subcommand: null };

/**
 * CI type-check fix (PR #760 follow-up): this project's `tsconfig.scripts.json` extends the base
 * `strict: false` config (no `strictNullChecks`), under which TS does NOT narrow a 4+ member
 * discriminated union via `if (cli.subcommand === null) return;` at the call site — reproduced
 * standalone (a minimal 4-member union with a shared field fails the same way; a 2-3 member union
 * narrows fine, matching the SAME class of non-strict-mode narrowing gap already documented at
 * `field-plan-walk.ts`'s `resolvePolicyForPlan`). An explicit type PREDICATE is not a cast or an
 * `any` — it is a function whose declared return type IS the narrowing, checked by TS against the
 * body (`cli.subcommand !== null`), and callers get real narrowing regardless of union size.
 */
function isParsedCli(cli: Cli): cli is SetCli | ListCli | ExpireCli {
  return cli.subcommand !== null;
}

function flagValue(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
}

export function parseArgs(argv: readonly string[]): Cli {
  const [sub, ...rest] = argv;
  const apply = rest.includes('--apply');
  const allowProd = rest.includes('--allow-prod');
  const expectDb = flagValue(rest, '--expect-db');

  if (sub === 'set') {
    const ranksRaw = flagValue(rest, '--ranks');
    const expiresRaw = flagValue(rest, '--expires-in-days');
    return {
      subcommand: 'set',
      table: flagValue(rest, '--table'),
      column: flagValue(rest, '--column'),
      ipo: flagValue(rest, '--ipo'),
      ranks: ranksRaw ? ranksRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
      reason: flagValue(rest, '--reason'),
      expiresInDays: expiresRaw ? Number(expiresRaw) : DEFAULT_EXPIRES_IN_DAYS,
      setBy: flagValue(rest, '--set-by') ?? 'cli',
      apply,
      allowProd,
      expectDb,
    };
  }
  if (sub === 'list') {
    return { subcommand: 'list', apply, allowProd, expectDb };
  }
  if (sub === 'expire') {
    return { subcommand: 'expire', id: rest[0]?.startsWith('--') ? null : (rest[0] ?? null), apply, allowProd, expectDb };
  }
  return { subcommand: null };
}

export interface RunDeps {
  dbLike: ExecuteLike;
  repo: FieldSourceOverridesRepository;
  loadManifest: typeof loadFieldManifest;
  /** Resolve an `--ipo` value (slug or uuid) to an ipo_id, or null if not found/not given. */
  resolveIpoId: (value: string) => Promise<string | null>;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export interface RunResult {
  exitCode: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function run(cli: Cli, deps: RunDeps): Promise<RunResult> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const err = deps.error ?? ((l: string) => console.error(l));

  if (!isParsedCli(cli)) {
    err(`${TOOL}: usage: set --table T --column C --ranks R1,R2 --reason "..." --expect-db DB [--ipo SLUG] [--apply] | list --expect-db DB | expire <id> --expect-db DB [--apply]`);
    return { exitCode: 1 };
  }

  if (!cli.expectDb) {
    err(`${TOOL}: --expect-db <name> is mandatory.`);
    return { exitCode: 1 };
  }

  let refused = false;
  const opened = await openRepairDb(deps.dbLike, {
    apply: cli.apply,
    allowProd: cli.allowProd,
    toolName: TOOL,
    log,
    error: err,
    // `run()` reports its own exit code via the return value — the process must never exit
    // out from under a caller that wants to inspect the result (tests; a future non-CLI caller).
    onRefuse: () => {
      refused = true;
    },
  });
  if (refused) {
    return { exitCode: 1 };
  }
  if (opened.dbName !== cli.expectDb) {
    err(`${TOOL}: refusing — connected to "${opened.dbName}", expected "${cli.expectDb}" (--expect-db).`);
    return { exitCode: 1 };
  }

  if (cli.subcommand === 'list') {
    const active = await deps.repo.listActive();
    if (active.length === 0) {
      log(`${TOOL}: no active overrides on "${opened.dbName}".`);
      return { exitCode: 0 };
    }
    for (const row of active) {
      const ranks = [row.rank1Source, row.rank2Source, row.rank3Source].filter(Boolean).join(',');
      log(
        `${row.id} | ${row.tableName}.${row.fieldName} | ipo=${row.ipoId ?? '(all)'} | ranks=[${ranks}] | ` +
          `expiresAt=${row.expiresAt.toISOString()} | setBy=${row.setBy} | reason="${row.reason}"`
      );
    }
    return { exitCode: 0 };
  }

  if (cli.subcommand === 'expire') {
    if (!cli.id) {
      err(`${TOOL}: expire requires an <id> argument.`);
      return { exitCode: 1 };
    }
    if (!UUID_RE.test(cli.id)) {
      err(`${TOOL}: "${cli.id}" is not a valid override id.`);
      return { exitCode: 1 };
    }
    if (!cli.apply) {
      const existing = await deps.repo.findById(cli.id);
      if (!existing) {
        err(`${TOOL}: no override found with id "${cli.id}".`);
        return { exitCode: 1 };
      }
      log(`DRY RUN — would expire ${cli.id} (${existing.tableName}.${existing.fieldName}). Re-run with --apply.`);
      return { exitCode: 0 };
    }
    const updated = await deps.repo.expire(cli.id);
    if (!updated) {
      err(`${TOOL}: no override found with id "${cli.id}".`);
      return { exitCode: 1 };
    }
    log(`${TOOL}: expired ${cli.id} (${updated.tableName}.${updated.fieldName}) on "${opened.dbName}".`);
    return { exitCode: 0 };
  }

  // subcommand === 'set'
  if (!cli.table || !cli.column || cli.ranks.length === 0 || !cli.reason) {
    err(`${TOOL}: set requires --table, --column, --ranks, and --reason.`);
    return { exitCode: 1 };
  }
  if (!Number.isFinite(cli.expiresInDays) || cli.expiresInDays <= 0) {
    err(`${TOOL}: --expires-in-days must be a positive number (got "${cli.expiresInDays}").`);
    return { exitCode: 1 };
  }

  const manifest = deps.loadManifest();
  const failure = validateOverrideCandidate(
    { table: cli.table, column: cli.column, ranks: cli.ranks as SourceCode[], reason: cli.reason },
    manifest
  );
  if (failure) {
    err(`${TOOL}: refused — ${failure.message}`);
    return { exitCode: 1 };
  }

  let ipoId: string | null = null;
  if (cli.ipo) {
    ipoId = await deps.resolveIpoId(cli.ipo);
    if (!ipoId) {
      err(`${TOOL}: refused — no IPO found for "${cli.ipo}".`);
      return { exitCode: 1 };
    }
  }

  const expiresAt = new Date(Date.now() + cli.expiresInDays * 24 * 60 * 60 * 1000);
  const newRow: NewFieldSourceOverride = {
    tableName: cli.table,
    fieldName: cli.column,
    ipoId,
    rank1Source: cli.ranks[0],
    rank2Source: cli.ranks[1] ?? null,
    rank3Source: cli.ranks[2] ?? null,
    reason: cli.reason,
    setBy: cli.setBy,
    expiresAt,
  };

  if (!cli.apply) {
    log(
      `DRY RUN — would set override for ${cli.table}.${cli.column} (ipo=${cli.ipo ?? '(all)'}) ` +
        `ranks=[${cli.ranks.join(',')}] expiresAt=${expiresAt.toISOString()}. Re-run with --apply.`
    );
    return { exitCode: 0 };
  }

  const inserted = await deps.repo.set(newRow);
  log(
    `${TOOL}: set override ${inserted.id} for ${cli.table}.${cli.column} (ipo=${cli.ipo ?? '(all)'}) ` +
      `ranks=[${cli.ranks.join(',')}] expiresAt=${inserted.expiresAt.toISOString()} on "${opened.dbName}".`
  );
  return { exitCode: 0 };
}

async function resolveIpoIdBySlugOrId(value: string): Promise<string | null> {
  if (UUID_RE.test(value)) return value;
  const { ipos } = await import('@ipodhan/shared/db/schema');
  const { eq } = await import('drizzle-orm');
  const rows = await (db as never as { select: (...a: unknown[]) => { from: (...a: unknown[]) => { where: (...a: unknown[]) => Promise<{ id: string }[]> } } })
    .select({ id: ipos.id })
    .from(ipos)
    .where(eq(ipos.slug, value));
  return rows[0]?.id ?? null;
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  const repo = new FieldSourceOverridesRepository({ db: db as never });
  const result = await run(cli, {
    dbLike: db as ExecuteLike,
    repo,
    loadManifest: loadFieldManifest,
    resolveIpoId: resolveIpoIdBySlugOrId,
  });
  process.exit(result.exitCode);
}

const isMain = import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  main().catch((e) => {
    console.error(`${TOOL}: ${(e as Error)?.message ?? e}`);
    process.exit(1);
  });
}
