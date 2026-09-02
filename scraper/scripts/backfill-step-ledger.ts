/**
 * S-01 — backfill per-IPO pipeline ledger rows from an out-of-band source
 * (today: the DEEPA walk, docs/walks/2026-09-02-deepa-pipeline-walk.md).
 *
 * The walk established real verdicts for steps that were run by hand. Without
 * this script those verdicts live only in a markdown table, so the ledger the
 * admin grid reads would show every step as NOT_DUE and the grid would lie
 * about what has actually been proven.
 *
 * Usage:
 *   npx tsx scraper/scripts/backfill-step-ledger.ts \
 *     --ipo DEEPA \
 *     --set B1=DONE,B2=DONE,B7=FAILED \
 *     --source WALK \
 *     --evidence-file evidence.json \
 *     [--error "W-16/W-17/W-18 open"] \
 *     [--ipo-id <uuid>]
 *
 * `--ipo` is matched on symbol first, then company name. `--ipo-id` skips the
 * lookup entirely. initForIpo runs first, so every catalogue step exists at
 * NOT_DUE before the named ones are set.
 *
 * Over the dev SSH tunnel the shared pool's 2s default connect timeout is too
 * tight for a 15-connection burst; set PG_CONNECTION_TIMEOUT_MS=20000 and
 * SHARED_DB_POOL_MAX=3 (T-433) or initForIpo times out on the first insert.
 */
import { readFileSync } from 'node:fs';
import { db, getRedisClient, IpoPipelineStepsRepository } from '@ipodhan/shared';
import type { IpoStepStatus } from '@ipodhan/shared';
import { isPipelineStepId } from '@ipodhan/shared/pipeline/step-catalogue';
import * as schema from '@ipodhan/shared/db/schema';
import { eq, or } from 'drizzle-orm';
import logger from '../src/utils/logger.js';

// Read off the pgEnum, never hand-copied -- a hand-written list silently rots
// the moment a status is added to or removed from the schema.
const VALID_STATUSES: readonly IpoStepStatus[] = schema.ipoStepStatusEnum.enumValues;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseSet(raw: string): Array<{ stepId: string; status: IpoStepStatus }> {
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [stepId, status] = pair.split('=').map((p) => p.trim());
      if (!stepId || !status) {
        throw new Error(`Bad --set entry "${pair}" (expected STEP=STATUS)`);
      }
      if (!isPipelineStepId(stepId)) {
        throw new Error(
          `Unknown step id "${stepId}" in "${pair}" -- not in the catalogue ` +
            '(packages/shared/src/pipeline/step-catalogue.ts)'
        );
      }
      if (!VALID_STATUSES.includes(status as IpoStepStatus)) {
        throw new Error(`Bad status "${status}" in "${pair}" (one of ${VALID_STATUSES.join(', ')})`);
      }
      return { stepId, status: status as IpoStepStatus };
    });
}

async function resolveIpoId(identifier: string): Promise<string> {
  const rows = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName })
    .from(schema.ipos)
    .where(or(eq(schema.ipos.symbol, identifier), eq(schema.ipos.companyName, identifier)))
    .limit(2);

  if (rows.length === 0) throw new Error(`No IPO found for "${identifier}"`);
  if (rows.length > 1) throw new Error(`"${identifier}" matched more than one IPO — pass --ipo-id`);
  return rows[0].id;
}

async function main(): Promise<void> {
  const ipoArg = argValue('--ipo');
  const ipoIdArg = argValue('--ipo-id');
  const setArg = argValue('--set');
  const source = argValue('--source') ?? null;
  const evidenceFile = argValue('--evidence-file');
  const error = argValue('--error') ?? null;

  if (!setArg || (!ipoArg && !ipoIdArg)) {
    console.error('Usage: --ipo <symbol> (or --ipo-id <uuid>) --set B1=DONE,B2=DONE [--source X] [--evidence-file f.json] [--error "..."]');
    process.exit(1);
  }

  // Parsed (and fully validated) BEFORE any DB work, so one bad pair aborts
  // the whole run rather than leaving a half-applied ledger.
  const pairs = parseSet(setArg);
  const evidence = evidenceFile ? JSON.parse(readFileSync(evidenceFile, 'utf8')) : undefined;
  const ipoId = ipoIdArg ?? (await resolveIpoId(ipoArg as string));

  const repo = new IpoPipelineStepsRepository(db, getRedisClient());
  await repo.initForIpo(ipoId);

  for (const { stepId, status } of pairs) {
    await repo.upsertStep({
      ipoId,
      stepId,
      status,
      source,
      evidence,
      // Only a failing step carries the error; upsertStep clears it on DONE anyway.
      error: status === 'FAILED' ? error : null,
    });
    logger.info({ ipoId, stepId, status, source }, '[backfill-step-ledger] step recorded');
  }

  const rows = await repo.findByIpo(ipoId);
  const touched = rows.filter((r) => r.status !== 'NOT_DUE');
  console.log(`\nipo_id ${ipoId} — ${rows.length} ledger rows, ${touched.length} not NOT_DUE:\n`);
  console.log('step  status  attempts  source  last_run_at                error');
  for (const r of touched) {
    console.log(
      [
        r.stepId.padEnd(5),
        r.status.padEnd(7),
        String(r.attempts).padEnd(9),
        (r.source ?? '-').padEnd(7),
        (r.lastRunAt ? new Date(r.lastRunAt).toISOString() : '-').padEnd(26),
        r.error ?? '-',
      ].join(' ')
    );
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      '[backfill-step-ledger] failed'
    );
    process.exit(1);
  });
