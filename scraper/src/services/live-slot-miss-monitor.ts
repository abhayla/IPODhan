/**
 * OD-72 (owner, 2026-09-23, "Facts, no marker"): a scheduled live refresh that
 * misses its OD-19 slot raises an ADMIN alert naming the IPO and the slot --
 * never a label on the public page.
 *
 * THE SLOT. OD-19 lets subscription work run "every hour or even thirty
 * minutes"; spec section 2.1's job table fixes the live-figures job at every 30
 * minutes, 10:00-18:30 IST, on a day an IPO is bidding (OD-28). So a bidding day
 * has 17 half-hour slots, [10:00, 10:30) ... [18:00, 18:30) IST.
 *
 * THE MISS. An IPO that is bidding on the slot's day (open_date <= day <=
 * close_date, a weekday that is not a market holiday) and has NO subscription
 * snapshot whose time falls inside the slot. The snapshot time is the SOURCE's
 * observation time (subscriptions.timestamp, W-38), so a slot counts as covered
 * only when the reader's figure actually advanced in it.
 *
 * HOW OFTEN IT SPEAKS (OD-93, fix round 1 -- the first version sent one alert
 * per slot, 17 a weekday on staging):
 *  - one alert per IPO per IST day, at its FIRST missed slot, dedupeKey
 *    `live-slot-miss:<env>:<slug>:<day>`;
 *  - one end-of-day summary once the 18:00 slot has ended, listing each IPO
 *    with every slot it missed;
 *  - the environment (DEPLOY_SLOT) in every title; severity P2.
 *
 * SKIPPED WAKES. Every wake judges EVERY ended slot of the IST day, not only
 * the last one, so a slot whose wakes were skipped is still judged by the next
 * wake that runs. A live cron dead for the WHOLE day is outside this check (no
 * wake runs it); the data job's freshness SLO `open-ipo-gmp-subscription`
 * (scraper/src/config/freshness-slo.ts, evaluated by triggerDataQualityWatchdog
 * at each data slot) is what sees that. The nightly detection floor has no
 * subscription-freshness check.
 *
 * A claim is written only AFTER the alert was accepted by the Notifier, so a
 * failed or unconfigured send is retried by the next wake and logged at warn
 * with its reason -- never logged as sent.
 */
import { sql } from 'drizzle-orm';
import { istDayIso } from '@ipodhan/shared/utils/ist-day';
import { logger } from '../utils/logger.js';

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const SLOT_MINUTES = 30;
/** Minutes after IST midnight at which each live slot STARTS: 10:00 .. 18:00. */
export const LIVE_SLOT_STARTS_IST_MINUTES: readonly number[] = Array.from(
  { length: 17 },
  (_, i) => 10 * 60 + i * SLOT_MINUTES
);

export interface LiveSlot {
  /** IST calendar day, YYYY-MM-DD. */
  day: string;
  /** "10:00" .. "18:00", IST: the slot's start. */
  label: string;
  /** "10:30" .. "18:30", IST: the slot's end. */
  endLabel: string;
  startUtc: Date;
  endUtc: Date;
  /** Stable id for dedupe: "2026-09-24T10:00". */
  key: string;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function slotOf(dayStartIstMs: number, day: string, start: number): LiveSlot {
  const startUtc = new Date(dayStartIstMs + start * 60_000 - IST_OFFSET_MS);
  return {
    day,
    label: hhmm(start),
    endLabel: hhmm(start + SLOT_MINUTES),
    startUtc,
    endUtc: new Date(startUtc.getTime() + SLOT_MINUTES * 60_000),
    key: `${day}T${hhmm(start)}`,
  };
}

/** Every live slot of `now`'s IST day that has fully ENDED, in order (empty before 10:30 IST). */
export function completedLiveSlotsToday(now: Date): LiveSlot[] {
  const istMs = now.getTime() + IST_OFFSET_MS;
  const dayStartIstMs = Math.floor(istMs / 86_400_000) * 86_400_000;
  const minuteOfDay = Math.floor((istMs - dayStartIstMs) / 60_000);
  const day = istDayIso(now);
  return LIVE_SLOT_STARTS_IST_MINUTES.filter((s) => s + SLOT_MINUTES <= minuteOfDay).map((s) => slotOf(dayStartIstMs, day, s));
}

/** The most recent live slot of today that has fully ENDED; null before 10:30 IST. */
export function lastCompletedLiveSlot(now: Date): LiveSlot | null {
  const all = completedLiveSlotsToday(now);
  return all.length ? all[all.length - 1] : null;
}

export interface BiddingIpo {
  id: string;
  slug: string;
  companyName: string;
}

export interface SlotCoverage extends BiddingIpo {
  slotKey: string;
  covered: boolean;
}

export interface AlertOutcome {
  sent: boolean;
  reason?: string;
}

/** Everything the check reads and writes, injected so the rule is testable without a database. */
export interface LiveSlotMissDeps {
  now?: Date;
  /** DEPLOY_SLOT: 'staging' | 'prod'; named in every title and key. */
  env?: string;
  /** One row per (bidding IPO, ended slot) for the IST day of the given slots. */
  loadDayCoverage(slots: LiveSlot[]): Promise<SlotCoverage[]>;
  isClaimed(key: string): Promise<boolean>;
  /** Written only after the alert it records was accepted. */
  claim(key: string): Promise<void>;
  send(
    severity: 'P2',
    title: string,
    opts: { body?: string; type?: string; dedupeKey?: string }
  ): Promise<AlertOutcome>;
}

export interface LiveSlotMissResult {
  day: string | null;
  slotsJudged: number;
  missedIpos: string[];
  alertsSent: number;
  summarySent: boolean;
  unsent: string[];
}

export async function checkLiveSlotMisses(deps: LiveSlotMissDeps): Promise<LiveSlotMissResult> {
  const now = deps.now ?? new Date();
  const env = deps.env ?? process.env.DEPLOY_SLOT ?? 'unknown-env';
  const slots = completedLiveSlotsToday(now);
  const result: LiveSlotMissResult = { day: null, slotsJudged: slots.length, missedIpos: [], alertsSent: 0, summarySent: false, unsent: [] };
  if (slots.length === 0) return result;
  const day = slots[0].day;
  result.day = day;
  const byKey = new Map(slots.map((sl) => [sl.key, sl]));

  const rows = await deps.loadDayCoverage(slots);
  const missed = new Map<string, { ipo: BiddingIpo; slots: LiveSlot[] }>();
  for (const r of rows) {
    if (r.covered) continue;
    const slot = byKey.get(r.slotKey);
    if (!slot) continue;
    const entry = missed.get(r.slug) ?? { ipo: { id: r.id, slug: r.slug, companyName: r.companyName }, slots: [] };
    entry.slots.push(slot);
    missed.set(r.slug, entry);
  }
  for (const e of missed.values()) e.slots.sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  result.missedIpos = Array.from(missed.keys()).sort();

  const deliver = async (key: string, title: string, body: string, type: string): Promise<boolean> => {
    if (await deps.isClaimed(key)) return false;
    const out = await deps.send('P2', title, { body, type, dedupeKey: key });
    if (!out.sent) {
      result.unsent.push(key);
      logger.warn({ key, reason: out.reason }, 'Live-slot miss: admin alert NOT sent - will retry on the next wake');
      return false;
    }
    await deps.claim(key);
    logger.info({ key }, 'Live-slot miss: admin alert sent (OD-72)');
    return true;
  };

  for (const slug of result.missedIpos) {
    const { ipo, slots: its } = missed.get(slug)!;
    const first = its[0];
    const ok = await deliver(
      `live-slot-miss:${env}:${slug}:${day}`,
      `[${env}] Live refresh missed: ${ipo.companyName} at ${first.label} IST on ${day}`,
      `${ipo.companyName} (${slug}) had no subscription figure dated inside the ${first.label}-${first.endLabel} IST slot on ${day} ` +
        '(the source listed no newer figure, the fetch failed, or the write was refused). ' +
        'Later misses of this IPO today are listed in the end-of-day summary.',
      'live-slot-miss'
    );
    if (ok) result.alertsSent += 1;
  }

  if (slots.length === LIVE_SLOT_STARTS_IST_MINUTES.length && result.missedIpos.length > 0) {
    const lines = result.missedIpos.map((slug) => {
      const e = missed.get(slug)!;
      return `${e.ipo.companyName} (${slug}): ${e.slots.length} of ${slots.length} slots missed - ${e.slots.map((x) => x.label).join(', ')}`;
    });
    result.summarySent = await deliver(
      `live-slot-summary:${env}:${day}`,
      `[${env}] Live refresh summary ${day}: ${result.missedIpos.length} IPO(s) missed slots`,
      lines.join('\n'),
      'live-slot-summary'
    );
  }
  return result;
}

/**
 * The database half, one query for the whole day: every IPO bidding on the
 * slots' IST day, crossed with every ended slot, and whether a subscription
 * snapshot dated inside that slot exists. A weekend or a market holiday
 * returns no IPO -- nothing bids, so nothing can be missed. Timestamps are
 * bound as ISO strings (ist-timezone rule: never a Date object to a naive column).
 */
export function dbCoverageLoader(db: { execute(q: ReturnType<typeof sql>): Promise<unknown> }) {
  return async (slots: LiveSlot[]): Promise<SlotCoverage[]> => {
    if (slots.length === 0) return [];
    const day = slots[0].day;
    const values = sql.join(
      slots.map((sl) => sql`(${sl.key}, ${sl.startUtc.toISOString()}::timestamptz, ${sl.endUtc.toISOString()}::timestamptz)`),
      sql`, `
    );
    const result = await db.execute(sql`
      WITH slot(key, s, e) AS (VALUES ${values})
      SELECT i.id, i.slug, i.company_name, slot.key AS slot_key,
             EXISTS (
               SELECT 1 FROM subscriptions x
               WHERE x.ipo_id = i.id AND x.timestamp >= slot.s AND x.timestamp < slot.e
             ) AS covered
      FROM ipos i CROSS JOIN slot
      WHERE i.status IN ('OPEN', 'CLOSED')
        AND i.open_date <= ${day}::date
        AND i.close_date >= ${day}::date
        AND EXTRACT(ISODOW FROM ${day}::date) < 6
        AND NOT EXISTS (SELECT 1 FROM market_holidays h WHERE h.date = ${day}::date)
      ORDER BY i.slug, slot.key
    `);
    const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    return rows.map((r) => ({
      id: r.id as string,
      slug: r.slug as string,
      companyName: (r.company_name as string) ?? (r.slug as string),
      slotKey: r.slot_key as string,
      covered: r.covered === true,
    }));
  };
}

/** Redis-backed claims, two days: long enough to outlive every wake of the day. */
export function redisClaims(redis: { exists(key: string): Promise<number>; set(...args: unknown[]): Promise<unknown> }) {
  return {
    isClaimed: async (key: string): Promise<boolean> => (await redis.exists(key)) > 0,
    claim: async (key: string): Promise<void> => {
      await redis.set(key, '1', 'EX', 172_800);
    },
  };
}
