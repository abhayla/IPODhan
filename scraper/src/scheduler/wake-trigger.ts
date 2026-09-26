/**
 * #698: what launched this scraper run, written onto every scraper_steps row.
 *
 * scripts/scraper-wake.sh exports SCRAPER_WAKE_TRIGGER: `schedule` from the
 * crontab lines deploy-linux.sh installs, `deploy` from the deploy's own
 * `pm2 start`. scripts/assert-repair-held.mjs counts only `schedule` cycles,
 * because a deploy restart is not the scheduled cycle a repair must survive.
 * The wrapper already validates the value; this re-validates it for a run that
 * did not come through the wrapper (a manual `tsx src/index.ts`), so anything
 * other than an exact label is recorded as `unknown`, which is never counted.
 */
export const WAKE_TRIGGERS = ['schedule', 'deploy', 'unknown'] as const;
export type WakeTrigger = (typeof WAKE_TRIGGERS)[number];

export function readWakeTrigger(env: Record<string, string | undefined> = process.env): WakeTrigger {
  const value = env.SCRAPER_WAKE_TRIGGER;
  return (WAKE_TRIGGERS as readonly string[]).includes(value ?? '') ? (value as WakeTrigger) : 'unknown';
}
