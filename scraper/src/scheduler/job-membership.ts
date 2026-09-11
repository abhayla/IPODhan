/**
 * Item 7 part B — which steps each wake runs, and which of them the
 * market-hours gate may switch off.
 *
 * WHY THIS FILE EXISTS (and why membership is not just an `if` in index.ts)
 * -----------------------------------------------------------------------
 * Until now a wake ran "the cycle", and each step decided for itself whether
 * it was due. The three-job cadence (OD-19 §2.1) makes the WAKE carry a name,
 * so the membership question — does this wake run GMP? — has to be answerable
 * somewhere a test can read it. That question is not academic: it is the exact
 * question two dated owner decisions answered differently.
 *
 * THE CONTRADICTION, AND HOW IT WAS SETTLED
 * -----------------------------------------
 * Finding F-41 (owner-approved 2026-09-08) took grey-market premium OUT of the
 * market-hours gate: GMP is most active in the evenings and at the weekend,
 * exactly when the gate is shut, and it had been measured going ~65 hours
 * stale over a single weekend. OD-19's job table, dated one day later, listed
 * GMP inside the gated live-figures job again, without mentioning F-41. The
 * build card surfaced this and deliberately did not resolve it (F-76).
 *
 * The owner resolved it on 2026-09-11:
 *
 *   "GMP keeps the off-hours cadence plus one evening pull on Saturday and
 *    Sunday; the 09-09 in-hours rule applies to subscription and demand only;
 *    item 7 proceeds."
 *
 * So F-41 wins for GMP. `MARKET_HOURS_GATED_STEPS` holds exactly the two steps
 * the in-hours rule applies to, and `JOB_STEPS.live` does not contain `gmp`.
 */

export const SCRAPER_JOBS = ['data', 'live', 'documents', 'closed', 'gmp'] as const;
export type ScraperJob = (typeof SCRAPER_JOBS)[number];

export const CYCLE_STEPS = [
  'discovery',
  'documents',
  'aggregators',
  'gmp',
  'live:subscription',
  'live:demandGraph',
  'closedBacklog',
] as const;
export type CycleStep = (typeof CYCLE_STEPS)[number];

/**
 * The in-hours rule (OD-19: "Live figures only during bidding") applies to
 * these steps and ONLY these steps. `gmp` is deliberately absent — see the
 * header. Anything added here becomes invisible every evening and every
 * weekend, so adding to this list is a data-freshness decision, not a tidy-up.
 */
export const MARKET_HOURS_GATED_STEPS: readonly CycleStep[] = [
  'live:subscription',
  'live:demandGraph',
];

/**
 * Job -> steps. The cron lines that fire these live in
 * `scripts/scraper-wake.crontab`; `scraper/tests/unit/scheduler/job-membership.test.ts`
 * reads that file and holds the two in agreement.
 *
 *  - `data`   00:00 / 08:00 / 14:00 IST — discovery, aggregators and GMP.
 *  - `documents` 01:00 / 19:00 IST — the document pass, on its OWN lock and
 *             deliberately outside market hours (owner, 2026-09-11).
 *  - `live`   every 30 min 10:00-18:30 IST — subscription and demand graph
 *             only, still gated on market hours AND on a non-zero OPEN count.
 *  - `closed` 22:00 IST — item 17's closed-IPO backlog (not implemented here;
 *             this job accepts the flag and carries GMP's late-evening pull).
 *  - `gmp`    20:00 IST Saturday and Sunday — the owner's weekend evening pull.
 */
export const JOB_STEPS: Record<ScraperJob, readonly CycleStep[]> = {
  data: ['discovery', 'aggregators', 'gmp'],
  live: ['live:subscription', 'live:demandGraph'],
  documents: ['documents'],
  closed: ['closedBacklog', 'gmp'],
  gmp: ['gmp'],
};

/**
 * The owner, 2026-09-11: "the document job is its own job with its own lock and
 * never delays the live-figure job".
 *
 * The whole-cycle Redis lock is what makes one wake wait for another. If the
 * document job took THAT lock, a document pass would hold every other job out
 * for as long as it ran — which, under the same decision, is unbounded. So the
 * document job takes its own resource. Everything else keeps sharing
 * `scraper:cycle`, because those jobs DO share the wake budget and must not
 * overlap each other on a 2-vCPU box (W-178: two extractors at once starved
 * nginx into Cloudflare 522s).
 *
 * Consequence, stated rather than hidden: a document pass and a live-figures
 * pass CAN now run at the same time. That is the point of the decision, and it
 * is also the thing to watch on the box.
 */
export const DEFAULT_CYCLE_LOCK_RESOURCE = 'scraper:cycle';
export const DOCUMENT_CYCLE_LOCK_RESOURCE = 'scraper:cycle:documents';

export function cycleLockResourceForJob(job: ScraperJob | undefined): string {
  return job === 'documents' ? DOCUMENT_CYCLE_LOCK_RESOURCE : DEFAULT_CYCLE_LOCK_RESOURCE;
}

export function isMarketHoursGated(step: CycleStep): boolean {
  return MARKET_HOURS_GATED_STEPS.includes(step);
}

/**
 * `undefined` job = run everything, the shape every caller has today (local
 * `--source=all`, the existing tests, and any wake that has not been updated).
 * Fail OPEN, per the build card: an un-named wake doing the whole cycle is the
 * behaviour that exists now; an un-named wake doing nothing would be a silent
 * scraper.
 */
export function runsStep(job: ScraperJob | undefined, step: CycleStep): boolean {
  if (job === undefined) return true;
  return JOB_STEPS[job].includes(step);
}

function isScraperJob(value: string): value is ScraperJob {
  return (SCRAPER_JOBS as readonly string[]).includes(value);
}

/**
 * Read the job from `--job=<name>` (argv wins) or `SCRAPER_JOB` (what
 * `scripts/scraper-wake.sh` sets, because pm2 re-reads the environment on
 * `pm2 start --update-env` but cannot be handed new argv for an already
 * registered app).
 *
 * An unknown name THROWS rather than falling back to "run everything": a
 * misspelled weekend GMP wake silently turning into a full discovery and
 * document cycle is the failure this refuses.
 */
export function parseJob(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): ScraperJob | undefined {
  const fromArgv = argv.find((a) => a.startsWith('--job='))?.slice('--job='.length);
  const raw = (fromArgv ?? env.SCRAPER_JOB ?? '').trim();
  if (raw === '') return undefined;
  if (!isScraperJob(raw)) {
    throw new Error(
      `unknown --job/SCRAPER_JOB value "${raw}" — expected one of ${SCRAPER_JOBS.join(', ')}`
    );
  }
  return raw;
}
