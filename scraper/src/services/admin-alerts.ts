/**
 * Admin alerts (spec §9.2 items 16 and 25, OD-112, OD-114, OD-136; same shape as OD-93's missed-slot alert).
 *
 * TWO LEVELS (OD-112):
 *  - INSTANT, only for an UPCOMING or OPEN IPO: the exchange replaced an admin date (OD-106), a new real
 *    disagreement, a newer document disagreeing with an admin value. One alert per IPO, event type and
 *    IST day (item 25), dedupeKey `admin-<type>:<env>:<ipoId>:<istDay>`.
 *  - Everything else goes to ONE daily digest at 09:00 IST, grouped by IPO, live first (OD-136: UPCOMING,
 *    OPEN, CLOSED-not-listed), with counts and a link into each IPO's editor.
 *
 * CHANNEL. The Notifier gateway (owner-notify.ts `sendOwnerAlert`, fail-open, 2 s timeout) delivers to
 * the one IPODhan Telegram chat; the gateway has no per-person recipient (OD-114), so no admin name,
 * email, phone or Telegram id is ever put in a payload.
 *
 * CLAIMS. A claim is written only AFTER the Notifier accepted the alert (OD-93): a failed or
 * unconfigured send is logged at warn with its reason and is retried by the next call or wake.
 *
 * NO NEW CRON. The digest is a step at the end of the data wake (index.ts `adminDigest`), which already
 * runs every 30 minutes; the first data wake at or after 09:00 IST whose claim `admin-digest:<env>:<day>`
 * is absent sends it.
 */
import { sql } from 'drizzle-orm';
import { istDayIso } from '@ipodhan/shared/utils/ist-day';
import { ADMIN_ONLY_CONFLICT_REASONS, WRITER_BOOKKEEPING_FIELDS } from '@ipodhan/shared/utils/conflict-reasons';
import { logger } from '../utils/logger.js';
import { sendOwnerAlert, type OwnerAlertResult } from './owner-notify.js';
import { redisClaims } from './live-slot-miss-monitor.js';

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
/** 09:00 IST, minutes after IST midnight (OD-112). */
export const ADMIN_DIGEST_TIME_IST_MINUTES = 9 * 60;
const DAY_MS = 86_400_000;

export type AdminInstantType = 'od106-exchange-replaced' | 'new-disagreement' | 'newer-document-disagrees';
/** Digest-only event types (never instant): a relaunch clearing admin values (OD-120, §9.2 item 27). */
export type AdminEventType = AdminInstantType | 'relaunch-cleared';

export const ADMIN_EVENT_LABELS: Record<AdminEventType, string> = {
  'od106-exchange-replaced': 'Exchange replaced an admin date',
  'new-disagreement': 'New disagreement',
  'newer-document-disagrees': 'Newer document disagrees with an admin value',
  'relaunch-cleared': 'Relaunch cleared admin values',
};

/**
 * audit_logs.action_type values the digest reads as admin-relevant events. 'Exchange Override' is the
 * OD-106 builder's EXCHANGE_OVERRIDE_AUDIT_ACTION (branch feat/od106-exchange-replaces-admin-date, not on
 * main when this was written). Nothing writes a relaunch-clear audit row yet (OD-120 unbuilt); when it
 * lands, add its action here.
 */
export const DIGEST_AUDIT_ACTIONS: Readonly<Record<string, AdminEventType>> = {
  'Exchange Override': 'od106-exchange-replaced',
};

/** UPCOMING or OPEN: the only statuses that get an instant alert (OD-112). */
export function isInstantStatus(status: string): boolean {
  return status === 'UPCOMING' || status === 'OPEN';
}

/** OD-136 "live first": UPCOMING, OPEN, and CLOSED not yet listed. */
export function isLiveForDigest(status: string): boolean {
  return status === 'UPCOMING' || status === 'OPEN' || status === 'CLOSED';
}

/** The IPO page editor link (queue-order.ts editorHref convention); absolute when NEXT_PUBLIC_APP_URL is set. */
export function editorLink(slug: string, field?: string, baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''): string {
  const path = `/ipos/${encodeURIComponent(slug)}?edit=${field ? encodeURIComponent(field) : ''}`;
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/** Minutes after IST midnight for `now`. */
export function istMinuteOfDay(now: Date): number {
  const istMs = now.getTime() + IST_OFFSET_MS;
  return Math.floor((istMs - Math.floor(istMs / DAY_MS) * DAY_MS) / 60_000);
}

export interface AdminInstantEvent {
  type: AdminInstantType;
  ipoId: string;
  slug: string;
  status: string;
  /** The field, as `table.field` or a camelCase ipos field. */
  field: string;
  /** Plain facts (the values involved). MUST NOT carry an admin's name or any personal data. */
  detail: string;
  companyName?: string;
}

export interface RecordedAdminEvent {
  at: string;
  type: AdminEventType;
  ipoId: string;
  slug: string;
  status: string;
  field: string;
  detail: string;
  companyName?: string;
}

type Send = (
  severity: 'P2',
  title: string,
  opts: { body?: string; type?: string; dedupeKey?: string }
) => Promise<OwnerAlertResult>;

export interface AdminAlertDeps {
  now?: Date;
  /** DEPLOY_SLOT ('staging' | 'prod'); named in every title and key. */
  env?: string;
  isClaimed(key: string): Promise<boolean>;
  /** Written only after the alert it records was accepted. */
  claim(key: string): Promise<void>;
  send: Send;
  /** The digest store for events that are not instant. */
  record(event: RecordedAdminEvent): Promise<void>;
}

export type AdminInstantOutcome =
  | { outcome: 'sent'; key: string }
  | { outcome: 'already-sent'; key: string }
  | { outcome: 'unsent'; key: string; reason: string }
  | { outcome: 'digest' };

export function instantKey(type: AdminInstantType, env: string, ipoId: string, day: string): string {
  return `admin-${type}:${env}:${ipoId}:${day}`;
}

interface RedisLike {
  exists(key: string): Promise<number>;
  set(...args: unknown[]): Promise<unknown>;
  lpush(key: string, value: string): Promise<unknown>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

export function digestStoreKey(env: string): string {
  return `admin-digest-events:${env}`;
}

/** The Redis-backed digest store: one capped list per environment, three days of life. */
export function redisDigestStore(redis: RedisLike, env: string) {
  const key = digestStoreKey(env);
  return {
    record: async (e: RecordedAdminEvent): Promise<void> => {
      await redis.lpush(key, JSON.stringify(e));
      await redis.ltrim(key, 0, 1999);
      await redis.expire(key, 3 * 86_400);
    },
    readSince: async (since: Date): Promise<RecordedAdminEvent[]> => {
      const raw = await redis.lrange(key, 0, -1);
      const out: RecordedAdminEvent[] = [];
      for (const s of raw) {
        try {
          const e = JSON.parse(s) as RecordedAdminEvent;
          if (Date.parse(e.at) >= since.getTime()) out.push(e);
        } catch {
          // a malformed entry is skipped, never fatal
        }
      }
      return out;
    },
  };
}

async function defaultDeps(): Promise<AdminAlertDeps> {
  const { getRedisClient } = await import('@ipodhan/shared');
  const redis = getRedisClient() as unknown as RedisLike;
  const env = process.env.DEPLOY_SLOT ?? 'unknown-env';
  const claims = redisClaims(redis);
  return { env, isClaimed: claims.isClaimed, claim: claims.claim, send: sendOwnerAlert, record: redisDigestStore(redis, env).record };
}

/**
 * The stable entry point for every admin-alert event (OD-106 builder, disagreement and document paths).
 * UPCOMING/OPEN -> one instant alert per IPO, type and IST day; any other status -> the digest store.
 * Never throws: a failure is logged with its cause and returned as `unsent`.
 */
export async function sendAdminInstant(event: AdminInstantEvent, deps?: AdminAlertDeps): Promise<AdminInstantOutcome> {
  let d: AdminAlertDeps;
  try {
    d = deps ?? (await defaultDeps());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ type: event.type, slug: event.slug, reason }, 'Admin alert: dependencies unavailable - not sent');
    return { outcome: 'unsent', key: '', reason };
  }
  const now = d.now ?? new Date();
  const env = d.env ?? process.env.DEPLOY_SLOT ?? 'unknown-env';
  try {
    if (!isInstantStatus(event.status)) {
      await d.record({ ...event, at: now.toISOString() });
      return { outcome: 'digest' };
    }
    const key = instantKey(event.type, env, event.ipoId, istDayIso(now));
    if (await d.isClaimed(key)) return { outcome: 'already-sent', key };
    const name = event.companyName ?? event.slug;
    const out = await d.send('P2', `[${env}] ${ADMIN_EVENT_LABELS[event.type]}: ${name} (${event.status})`, {
      body: `${name} (${event.slug}), field ${event.field}: ${event.detail}\nEdit: ${editorLink(event.slug, event.field)}`,
      type: `admin-${event.type}`,
      dedupeKey: key,
    });
    if (!out.sent) {
      const reason = out.reason ?? 'unknown';
      logger.warn({ key, reason }, 'Admin alert NOT sent - will retry on the next event or wake');
      return { outcome: 'unsent', key, reason };
    }
    await d.claim(key);
    logger.info({ key }, 'Admin alert sent (OD-112)');
    return { outcome: 'sent', key };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ type: event.type, slug: event.slug, reason }, 'Admin alert failed (non-fatal)');
    return { outcome: 'unsent', key: '', reason };
  }
}

// ---------------------------------------------------------------- digest

/** One IPO's open admin-queue counts. */
export interface QueueCountRow {
  ipoId: string;
  slug: string;
  companyName: string;
  status: string;
  /** The date the IPO is nearest to (OD-136 order within live), ISO day or null. */
  nearest: string | null;
  disagreements: number;
  missing: number;
}

export interface AdminDigestDeps {
  now?: Date;
  env?: string;
  isClaimed(key: string): Promise<boolean>;
  claim(key: string): Promise<void>;
  send: Send;
  loadQueueCounts(): Promise<QueueCountRow[]>;
  /** admin-relevant audit rows and digest-store events since `since`, as RecordedAdminEvent. */
  loadEvents(since: Date): Promise<RecordedAdminEvent[]>;
}

export interface AdminDigestResult {
  due: boolean;
  day: string;
  key: string;
  sent: boolean;
  alreadySent: boolean;
  ipos: number;
  reason?: string;
}

/** Max IPO blocks in one message (a Telegram message is capped at 4096 characters). */
export const DIGEST_MAX_IPOS = 25;

interface IpoBlock {
  slug: string;
  companyName: string;
  status: string;
  nearest: string | null;
  disagreements: number;
  missing: number;
  events: Map<string, number>;
}

/**
 * IST day of an event time: an ISO instant from the digest store, or naive UTC text from audit_logs
 * (`2026-09-29 03:30:00`), which is read AS UTC (ist-timezone rule), never as local time.
 */
export function eventDay(at: string): string {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 'unknown-day' : istDayIso(new Date(ms));
}

/** Pure: the digest's title and body, grouped by IPO, live first. */
export function buildAdminDigest(
  counts: QueueCountRow[],
  events: RecordedAdminEvent[],
  opts: { env: string; day: string }
): { title: string; body: string; ipos: number } {
  const blocks = new Map<string, IpoBlock>();
  const blockFor = (slug: string, companyName: string, status: string, nearest: string | null): IpoBlock => {
    let b = blocks.get(slug);
    if (!b) {
      b = { slug, companyName, status, nearest, disagreements: 0, missing: 0, events: new Map() };
      blocks.set(slug, b);
    }
    return b;
  };
  for (const c of counts) {
    if (c.disagreements + c.missing === 0) continue;
    const b = blockFor(c.slug, c.companyName, c.status, c.nearest);
    b.disagreements += c.disagreements;
    b.missing += c.missing;
  }
  const seen = new Set<string>();
  for (const e of events) {
    // One IPO + type + field (+ IST day) is one event even when both the digest store and the audit
    // trail hold it; the two name a field as `table.field` or bare, so only the field part is compared.
    const k = `${e.ipoId}|${e.type}|${e.field.split('.').pop()}|${eventDay(e.at)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const b = blockFor(e.slug, e.companyName ?? e.slug, e.status, null);
    const label = `${ADMIN_EVENT_LABELS[e.type]} (${e.field})`;
    b.events.set(label, (b.events.get(label) ?? 0) + 1);
  }
  const ordered = [...blocks.values()].sort((a, b) => {
    const la = isLiveForDigest(a.status) ? 0 : 1;
    const lb = isLiveForDigest(b.status) ? 0 : 1;
    if (la !== lb) return la - lb;
    if (la === 0 && a.nearest !== b.nearest) {
      if (a.nearest === null) return 1;
      if (b.nearest === null) return -1;
      return a.nearest < b.nearest ? -1 : 1;
    }
    if (la === 1 && a.nearest !== b.nearest) {
      // Listed and other IPOs: newest first (OD-136).
      if (a.nearest === null) return 1;
      if (b.nearest === null) return -1;
      return a.nearest > b.nearest ? -1 : 1;
    }
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const totalDis = ordered.reduce((s, b) => s + b.disagreements, 0);
  const totalMiss = ordered.reduce((s, b) => s + b.missing, 0);
  const totalEvents = ordered.reduce((s, b) => s + [...b.events.values()].reduce((x, y) => x + y, 0), 0);
  const liveCount = ordered.filter((b) => isLiveForDigest(b.status)).length;
  const lines: string[] = [
    `${ordered.length} IPO(s) need attention (${liveCount} live): ${totalDis} disagreement(s), ${totalMiss} missing value(s), ${totalEvents} event(s) in the last 24 h.`,
  ];
  for (const b of ordered.slice(0, DIGEST_MAX_IPOS)) {
    const parts: string[] = [];
    if (b.disagreements) parts.push(`${b.disagreements} disagreement(s)`);
    if (b.missing) parts.push(`${b.missing} missing`);
    for (const [label, n] of b.events) parts.push(`${label} x${n}`);
    lines.push(`- ${b.companyName} (${b.status}): ${parts.join('; ')} - ${editorLink(b.slug)}`);
  }
  if (ordered.length > DIGEST_MAX_IPOS) {
    const rest = ordered.slice(DIGEST_MAX_IPOS);
    lines.push(`... and ${rest.length} more IPO(s); full list: ${(process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')}/admin/conflicts`);
  }
  return {
    title: `[${opts.env}] Admin digest ${opts.day}: ${ordered.length} IPO(s), ${liveCount} live`,
    body: lines.join('\n'),
    ipos: ordered.length,
  };
}

/**
 * Called at the end of every data wake. Sends the day's digest once, at the first wake at or after
 * 09:00 IST; the claim is written only after the Notifier accepted it. An empty digest (nothing open,
 * no event) is still sent: a silent day and a broken digest must not look the same.
 */
export async function runAdminDigest(deps: AdminDigestDeps): Promise<AdminDigestResult> {
  const now = deps.now ?? new Date();
  const env = deps.env ?? process.env.DEPLOY_SLOT ?? 'unknown-env';
  const day = istDayIso(now);
  const key = `admin-digest:${env}:${day}`;
  const base = { day, key, sent: false, alreadySent: false, ipos: 0 };
  if (istMinuteOfDay(now) < ADMIN_DIGEST_TIME_IST_MINUTES) return { ...base, due: false };
  if (await deps.isClaimed(key)) return { ...base, due: true, alreadySent: true };
  const [counts, events] = await Promise.all([
    deps.loadQueueCounts(),
    deps.loadEvents(new Date(now.getTime() - DAY_MS)),
  ]);
  const digest = buildAdminDigest(counts, events, { env, day });
  const out = await deps.send('P2', digest.title, { body: digest.body, type: 'admin-digest', dedupeKey: key });
  if (!out.sent) {
    logger.warn({ key, reason: out.reason }, 'Admin digest NOT sent - will retry on the next data wake');
    return { ...base, due: true, ipos: digest.ipos, reason: out.reason ?? 'unknown' };
  }
  await deps.claim(key);
  logger.info({ key, ipos: digest.ipos }, 'Admin digest sent (OD-112)');
  return { ...base, due: true, sent: true, ipos: digest.ipos };
}

type Db = { execute(q: ReturnType<typeof sql>): Promise<unknown> };

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

/**
 * Per-IPO open counts: unresolved disagreements (OD-75 admin-only reasons and F-181 bookkeeping fields
 * excluded, as the queue does) and plan rows in NOT_AVAILABLE_YET / CHECK_FAILED / EXHAUSTED.
 *
 * TODO(admin-queue SSOT): the exact queue is web/lib/repositories/admin-queue-page-repository.ts
 * (queueCte), which also drops admin-held fields, classifies conflicts by the JS rule check
 * (ruleFilterFor) and adds values the shared field check refuses. The scraper cannot import web/, so
 * these counts can be a little higher than /admin/conflicts; move queueCte into @ipodhan/shared to make
 * them identical.
 */
export function dbQueueCountsLoader(db: Db) {
  return async (): Promise<QueueCountRow[]> => {
    const od75 = `{${ADMIN_ONLY_CONFLICT_REASONS.map((x) => `"${x}"`).join(',')}}`;
    const bookkeeping = `{${WRITER_BOOKKEEPING_FIELDS.map((x) => `"${x}"`).join(',')}}`;
    const result = await db.execute(sql`
      WITH d AS (
        SELECT c.ipo_id, count(*)::int AS n FROM data_conflicts c
         WHERE c.resolved_at IS NULL AND c.source1::text <> c.source2::text
           AND (c.resolution_reason IS NULL OR NOT (c.resolution_reason = ANY(${od75}::text[])))
           AND NOT (c.field_name = ANY(${bookkeeping}::text[]))
         GROUP BY c.ipo_id),
      m AS (
        SELECT p.ipo_id, count(*)::int AS n FROM ipo_field_plan p
         WHERE p.state IN ('NOT_AVAILABLE_YET', 'CHECK_FAILED', 'EXHAUSTED')
         GROUP BY p.ipo_id)
      SELECT i.id::text AS ipo_id, i.slug, i.company_name, i.status::text AS status,
             (CASE i.status WHEN 'UPCOMING' THEN coalesce(i.open_date, i.close_date)
                            WHEN 'OPEN' THEN coalesce(i.close_date, i.open_date)
                            WHEN 'CLOSED' THEN coalesce(i.listing_date, i.close_date)
                            ELSE coalesce(i.listing_date, i.close_date) END)::text AS nearest,
             coalesce(d.n, 0) AS disagreements, coalesce(m.n, 0) AS missing
        FROM ipos i LEFT JOIN d ON d.ipo_id = i.id LEFT JOIN m ON m.ipo_id = i.id
       WHERE d.n IS NOT NULL OR m.n IS NOT NULL
    `);
    return rowsOf(result).map((r) => ({
      ipoId: String(r.ipo_id),
      slug: String(r.slug),
      companyName: (r.company_name as string | null) ?? String(r.slug),
      status: String(r.status),
      nearest: (r.nearest as string | null) ?? null,
      disagreements: Number(r.disagreements ?? 0),
      missing: Number(r.missing ?? 0),
    }));
  };
}

/** admin-relevant audit rows since `since` (bound as an ISO string: audit_logs.timestamp is naive UTC). */
export function dbAuditEventsLoader(db: Db) {
  return async (since: Date): Promise<RecordedAdminEvent[]> => {
    const actions = Object.keys(DIGEST_AUDIT_ACTIONS);
    if (actions.length === 0) return [];
    const list = `{${actions.map((x) => `"${x}"`).join(',')}}`;
    const result = await db.execute(sql`
      SELECT a.timestamp::text AS at, a.action_type, a.ipo_id::text AS ipo_id, a.table_name, a.field_name,
             a.old_value, a.new_value, i.slug, i.company_name, i.status::text AS status
        FROM audit_logs a JOIN ipos i ON i.id = a.ipo_id
       WHERE a.action_type = ANY(${list}::text[]) AND a.timestamp >= ${since.toISOString()}::timestamp
    `);
    return rowsOf(result).map((r) => ({
      at: String(r.at),
      type: DIGEST_AUDIT_ACTIONS[String(r.action_type)],
      ipoId: String(r.ipo_id),
      slug: String(r.slug),
      status: String(r.status),
      field: r.table_name ? `${String(r.table_name)}.${String(r.field_name ?? '')}` : String(r.field_name ?? ''),
      detail: `${String(r.old_value ?? '')} -> ${String(r.new_value ?? '')}`,
      companyName: (r.company_name as string | null) ?? undefined,
    }));
  };
}
