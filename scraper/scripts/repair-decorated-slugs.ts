/**
 * Item 12 repair: rename a SLUG that still carries page-title or page-status
 * decoration (OD-68 S1/S3 — `-o`/`-p`/`-lt`/`-ct` suffixes, `-ipo(-|$)`)
 * although the row's `company_name` is already clean.
 *
 * Class: every `ipos` row the nightly `i_ipo_title_in_name` check
 * (scripts/audit-detection-floor.mjs, predicate `checkIpoTitleInName` in
 * scripts/lib/detection-floor-checks.mjs) flags SOLELY on its slug — the same
 * row's `company_name` carries NO title/status decoration of its own. A row
 * whose `company_name` is ALSO polluted is a different class (name-pollution
 * + duplicate-merge, `repair-name-pollution-and-redirects.ts`) and is left
 * untouched here, listed as skipped-name-polluted.
 *
 * RCA (2026-09-01, recurring): an aggregator's raw name/slug landed on the
 * row before OD-68's stripping existed everywhere it needed to. The write
 * path (computeIpoIdentitySlug, data-persister.ts) now strips decoration on
 * every new/updated row; this tool repairs the rows minted before that held.
 * The Rays of Belief `-o` instance of this class was merged away manually on
 * 2026-09-24; this tool makes the repair re-runnable and class-wide instead
 * of another one-off.
 *
 * Selection reuses the audit's OWN predicate (no third copy):
 * `checkIpoTitleInName` from ../../scripts/lib/detection-floor-checks.mjs,
 * the exact function `i_ipo_title_in_name` calls. A row is IN SCOPE only if
 * that predicate flags it AND the flag is caused by the slug alone (the twin
 * `stripIdentityNameDecoration`/`stripIdentitySlugSuffix` in that same file
 * decide "clean name" vs "decorated slug" — the same functions the nightly
 * check and the TS canonical copy, packages/shared/src/utils/
 * identity-decoration.ts, share via the parity test).
 *
 * New slug: `generateIPOSlug(companyName)` run through the same
 * decoration-stripping the persister's `computeIpoIdentitySlug`
 * (scraper/src/services/data-persister.ts) applies before slugging — since
 * this class's `company_name` is already clean, the two are equivalent; this
 * tool calls `computeIpoIdentitySlug` directly so a future change to that
 * function is inherited automatically rather than re-derived here.
 *
 * A collision (new slug already belongs to a DIFFERENT row) is a duplicate,
 * not a rename: the row is refused and logged by name, never merged here.
 *
 * Write: `ipos.slug` update + an `ipo_slug_redirects` row (old -> new,
 * `DECORATED_SLUG_CLEANUP`) in the SAME transaction, guarded on the row still
 * holding the slug it was read with (never on WHERE id alone). Shadow guard:
 * refuse the redirect if some OTHER live row currently holds the old slug
 * (mirrors repair-name-pollution-and-redirects.ts). Redis: `ipo:slug:<old>`,
 * `ipo:detail:<old>`, `ipo:slug:<new>`, `ipo:detail:<new>`, plus
 * `invalidateIPOCaches` (scraper/src/services/cache-invalidator.ts) for the
 * list/search patterns any renamed row could appear under — refuses to run
 * silently against the wrong Redis when REDIS_URL is unset (F3 pattern,
 * backfill-band-provenance-t276.ts).
 *
 * Usage (from scraper/, tunnel env exported per docs/ops/prod-ops-recipes.md
 * section 5, DATABASE_NAME=ipodhan_staging):
 *   npx tsx scripts/repair-decorated-slugs.ts --expect-db ipodhan_staging            # dry run
 *   npx tsx scripts/repair-decorated-slugs.ts --expect-db ipodhan_staging --apply
 * Prod is refused without --allow-prod (openRepairDb).
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import { computeIpoIdentitySlug } from '../src/services/data-persister.js';
import { invalidateIPOCaches } from '../src/services/cache-invalidator.js';
import { openRepairDb, queryCurrentDatabase, writeLedgerFile, type ExecuteLike } from './lib/repair-tool.js';
// The audit's OWN predicate — one definition, reused, not retyped.
import { checkIpoTitleInName, stripIdentityNameDecoration, stripIdentitySlugSuffix } from '../../scripts/lib/detection-floor-checks.mjs';

const TOOL = 'repair-decorated-slugs';

interface Cli {
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
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
  };
}

interface IpoRow {
  id: string;
  companyName: string;
  slug: string;
  offeringType: string | null;
  status: string | null;
}

/**
 * IN SCOPE only when `checkIpoTitleInName` flags the row AND the row's
 * company_name carries none of the same decoration — a name-clean,
 * slug-decorated row. Reuses the audit's own name-decoration stripper
 * (`stripIdentityNameDecoration`) rather than re-deriving "is the name
 * clean" from scratch.
 */
export function classify(row: IpoRow): 'in-scope' | 'name-polluted' | 'clean' {
  const flagged = checkIpoTitleInName(row);
  if (!flagged) return 'clean';
  const nameClean = stripIdentityNameDecoration(row.companyName) === row.companyName.trim();
  return nameClean ? 'in-scope' : 'name-polluted';
}

export async function slugIsLive(slug: string, excludeId: string): Promise<boolean> {
  const rows = await db.select({ id: schema.ipos.id }).from(schema.ipos).where(eq(schema.ipos.slug, slug)).limit(2);
  return rows.some((r) => r.id !== excludeId);
}

interface PlanRow {
  id: string;
  companyName: string;
  oldSlug: string;
  newSlug: string;
  outcome: 'planned' | 'no-op-already-clean' | 'refused-collision' | 'refused-shadow';
  collisionWith?: string;
}

export async function planRow(row: IpoRow): Promise<PlanRow> {
  const newSlug = computeIpoIdentitySlug({ companyName: row.companyName, offeringType: row.offeringType ?? undefined });
  if (newSlug === row.slug) {
    return { id: row.id, companyName: row.companyName, oldSlug: row.slug, newSlug, outcome: 'no-op-already-clean' };
  }
  const collision = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName })
    .from(schema.ipos)
    .where(eq(schema.ipos.slug, newSlug))
    .limit(1);
  if (collision.length > 0 && collision[0].id !== row.id) {
    return {
      id: row.id, companyName: row.companyName, oldSlug: row.slug, newSlug,
      outcome: 'refused-collision', collisionWith: `${collision[0].id} ("${collision[0].companyName}")`,
    };
  }
  // Shadow guard runs at WRITE time (applyRename), not here — a dry-run plan
  // never mutates state a concurrent write could invalidate between plan and apply.
  return { id: row.id, companyName: row.companyName, oldSlug: row.slug, newSlug, outcome: 'planned' };
}

export async function applyRename(plan: PlanRow, actualDb: string): Promise<'written' | 'skipped-shadow' | 'skipped-raced'> {
  // Shadow guard: never write a redirect for oldSlug if some OTHER live row
  // now holds it (mirrors repair-name-pollution-and-redirects.ts's writeRedirect).
  if (await slugIsLive(plan.oldSlug, plan.id)) {
    logger.warn({ oldSlug: plan.oldSlug, id: plan.id }, `${TOOL}: skip — oldSlug is LIVE on a different row (shadow guard)`);
    return 'skipped-shadow';
  }
  const result = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.ipos)
      .set({ slug: plan.newSlug })
      .where(sql`${schema.ipos.id} = ${plan.id} AND ${schema.ipos.slug} = ${plan.oldSlug}`)
      .returning({ id: schema.ipos.id });
    if (updated.length === 0) return 'raced';
    await tx
      .insert(schema.ipoSlugRedirects)
      .values({ oldSlug: plan.oldSlug, ipoId: plan.id, reason: 'DECORATED_SLUG_CLEANUP' })
      .onConflictDoNothing({ target: schema.ipoSlugRedirects.oldSlug });
    return 'ok';
  });
  if (result === 'raced') {
    logger.warn({ id: plan.id, oldSlug: plan.oldSlug }, `${TOOL}: skip — row's slug changed since it was read (raced)`);
    return 'skipped-raced';
  }

  if (!process.env.REDIS_URL) {
    console.log(`  NOTE: REDIS_URL is unset — cache invalidation for ${plan.oldSlug} -> ${plan.newSlug} was SKIPPED (would silently`);
    console.log('        target redis://localhost:6379, not the real cache — same class as the manual-db-reset gotcha).');
  } else {
    try {
      const redis = getRedisClient();
      await redis.del(`ipo:slug:${plan.oldSlug}`, `ipo:detail:${plan.oldSlug}`, `ipo:slug:${plan.newSlug}`, `ipo:detail:${plan.newSlug}`);
      await invalidateIPOCaches(redis, plan.newSlug);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, `${TOOL}: cache invalidation failed (non-fatal, DB write already committed)`);
    }
  }
  return 'written';
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  console.log('='.repeat(80));
  console.log(`${TOOL} (item 12) — ${cli.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

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

  const rows = (await db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      slug: schema.ipos.slug,
      offeringType: schema.ipos.offeringType,
      status: schema.ipos.status,
    })
    .from(schema.ipos)) as unknown as IpoRow[];

  const inScope: IpoRow[] = [];
  let namePolluted = 0;
  let clean = 0;
  for (const row of rows) {
    const c = classify(row);
    if (c === 'in-scope') inScope.push(row);
    else if (c === 'name-polluted') namePolluted++;
    else clean++;
  }

  console.log(`\n${rows.length} ipos row(s) in "${actual}": ${inScope.length} in-scope (decorated slug, clean name), ${namePolluted} name-polluted (different class, skipped), ${clean} clean.`);

  const plans: PlanRow[] = [];
  for (const row of inScope) plans.push(await planRow(row));

  const planned = plans.filter((p) => p.outcome === 'planned');
  const noop = plans.filter((p) => p.outcome === 'no-op-already-clean');
  const collisions = plans.filter((p) => p.outcome === 'refused-collision');

  console.log(`\nplanned renames: ${planned.length} | no-op (already clean): ${noop.length} | refused-collision (duplicate, needs merge review): ${collisions.length}`);
  for (const p of plans) {
    if (p.outcome === 'planned') console.log(`  RENAME "${p.companyName}": ${p.oldSlug} -> ${p.newSlug}`);
    if (p.outcome === 'refused-collision') console.log(`  REFUSED (collision) "${p.companyName}": ${p.oldSlug} -> ${p.newSlug} already held by ${p.collisionWith}`);
  }

  let written = 0, skippedShadow = 0, skippedRaced = 0;
  if (cli.apply) {
    for (const p of planned) {
      const outcome = await applyRename(p, actual);
      if (outcome === 'written') written++;
      else if (outcome === 'skipped-shadow') skippedShadow++;
      else skippedRaced++;
    }
  }

  writeLedgerFile(
    `evidence/${TOOL}-${cli.apply ? 'applied' : 'dryrun'}-${Date.now()}.json`,
    {
      tool: TOOL,
      database: actual,
      apply: cli.apply,
      at: new Date().toISOString(),
      totalIpoRows: rows.length,
      inScope: inScope.length,
      namePolluted,
      planned: planned.map((p) => ({ id: p.id, companyName: p.companyName, oldSlug: p.oldSlug, newSlug: p.newSlug })),
      collisions: collisions.map((p) => ({ id: p.id, companyName: p.companyName, oldSlug: p.oldSlug, newSlug: p.newSlug, collisionWith: p.collisionWith })),
      written: cli.apply ? written : null,
      skippedShadow: cli.apply ? skippedShadow : null,
      skippedRaced: cli.apply ? skippedRaced : null,
    }
  );

  if (cli.apply) {
    console.log(`\nAPPLIED: written ${written} | skipped-shadow ${skippedShadow} | skipped-raced ${skippedRaced}`);
  } else {
    console.log('\nDRY-RUN: re-run with --apply to write.');
  }
  console.log('='.repeat(80));
  process.exit(0);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, `${TOOL} crashed`);
    console.error(e);
    process.exit(1);
  });
}
