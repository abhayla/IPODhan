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
import { createHash } from 'node:crypto';
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

/**
 * The public site per slot, so every link in an alert is absolute (a bare `/ipos/...` is not clickable
 * in Telegram). The scraper knows its slot from DEPLOY_SLOT, which scripts/deploy-linux.sh sets on every
 * pm2 start (`DEPLOY_SLOT="$SLOT"`, slot = staging | prod). Neither slot's scraper.env carries a site URL
 * (verified on the box 2026-09-29), so the domains live here: prod = the site's canonical base
 * (web/lib/seo/metadata.ts), staging = the host deploy-linux.yml probes for the served version.
 * `ADMIN_ALERT_BASE_URL` overrides both (release runbook note, PR #1284).
 */
export const PUBLIC_BASE_URL_BY_SLOT: Readonly<Record<string, string>> = {
  prod: 'https://ipodhan.com',
  staging: 'https://staging.ipodhan.com',
};

export function publicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ADMIN_ALERT_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, '');
  return PUBLIC_BASE_URL_BY_SLOT[env.DEPLOY_SLOT?.trim() ?? ''] ?? '';
}

/** The IPO page editor link (queue-order.ts editorHref convention), absolute for a known slot. */
export function editorLink(slug: string, field?: string, baseUrl = publicBaseUrl()): string {
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
  /** The digest store for events that are not instant, and for instant events over the wake cap. */
  record(event: RecordedAdminEvent): Promise<void>;
  /** Instant sends attempted this wake; defaults to the module's wake budget (beginAdminAlertWake). */
  budget?: { sent: number };
  /** Defaults to ADMIN_INSTANT_CAP_PER_WAKE. */
  cap?: number;
}

/**
 * At most this many instant sends per data wake (every emitter together: the disagreement scan and the
 * OD-106 override). A burst (a source reshaping 50 live IPOs at once) must not flood the one owner
 * chat; the rest go to the digest store and reach the owner in the 09:00 IST digest, never dropped.
 */
export const ADMIN_INSTANT_CAP_PER_WAKE = 10;

const wakeBudget = { sent: 0 };

/** Called once at the start of every scraper wake (index.ts main) to reset the instant cap. */
export function beginAdminAlertWake(): void {
  wakeBudget.sent = 0;
}

export type AdminInstantOutcome =
  | { outcome: 'sent'; key: string }
  | { outcome: 'already-sent'; key: string }
  | { outcome: 'unsent'; key: string; reason: string }
  | { outcome: 'capped'; key: string }
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
export async function sendAdminInstant(
  event: AdminInstantEvent,
  deps?: AdminAlertDeps,
  opts: { digestIfAlreadySent?: boolean } = {}
): Promise<AdminInstantOutcome> {
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
    if (await d.isClaimed(key)) {
      // The day's instant for this IPO and type is used. A caller whose event is a DIFFERENT fact (a
      // changed disagreement) asks for it to reach the owner through the digest instead of vanishing.
      if (opts.digestIfAlreadySent) await d.record({ ...event, at: now.toISOString() });
      return { outcome: 'already-sent', key };
    }
    const budget = d.budget ?? wakeBudget;
    const cap = d.cap ?? ADMIN_INSTANT_CAP_PER_WAKE;
    if (budget.sent >= cap) {
      await d.record({ ...event, at: now.toISOString() });
      logger.warn({ key, cap }, 'Admin alert over the per-wake cap - recorded for the digest instead');
      return { outcome: 'capped', key };
    }
    budget.sent++;
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
    // The Notifier accepted it: a claim write that fails now must not turn a delivered alert into
    // 'unsent' (the caller would think the owner never heard). The Notifier's dedupeKey is the
    // backstop against a repeat on the next event or wake.
    try {
      await d.claim(key);
    } catch (err) {
      logger.warn({ key, reason: err instanceof Error ? err.message : String(err) }, 'Admin alert sent, but its claim write FAILED - the Notifier dedupeKey guards a repeat');
    }
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
  /** When the last digest was accepted by the Notifier (null: never). The window starts there. */
  lastSentAt?(): Promise<Date | null>;
  markSent?(at: Date): Promise<void>;
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
  opts: { env: string; day: string; windowLabel?: string }
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
    `${ordered.length} IPO(s) need attention (${liveCount} live): ${totalDis} disagreement(s), ${totalMiss} missing value(s), ${totalEvents} event(s) ${opts.windowLabel ?? 'in the last 24 h'}.`,
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
    lines.push(`... and ${rest.length} more IPO(s); full list: ${publicBaseUrl()}/admin/conflicts`);
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
  // The window starts at the last digest the Notifier accepted, so a late send (a Notifier outage, a
  // missed wake) never drops the events between the two; the first digest ever looks back 24 h.
  let last: Date | null = null;
  try {
    last = deps.lastSentAt ? await deps.lastSentAt() : null;
  } catch (err) {
    logger.warn({ reason: err instanceof Error ? err.message : String(err) }, 'Admin digest: last-sent read failed - using 24 h');
  }
  const since = last && last.getTime() < now.getTime() ? last : new Date(now.getTime() - DAY_MS);
  const [counts, events] = await Promise.all([deps.loadQueueCounts(), deps.loadEvents(since)]);
  const digest = buildAdminDigest(counts, events, {
    env,
    day,
    windowLabel: last ? `since the last digest (${since.toISOString()})` : undefined,
  });
  const out = await deps.send('P2', digest.title, { body: digest.body, type: 'admin-digest', dedupeKey: key });
  if (!out.sent) {
    logger.warn({ key, reason: out.reason }, 'Admin digest NOT sent - will retry on the next data wake');
    return { ...base, due: true, ipos: digest.ipos, reason: out.reason ?? 'unknown' };
  }
  try {
    await deps.claim(key);
    if (deps.markSent) await deps.markSent(now);
  } catch (err) {
    logger.warn({ key, reason: err instanceof Error ? err.message : String(err) }, 'Admin digest sent, but its claim / last-sent write FAILED - the Notifier dedupeKey guards a repeat');
  }
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

// ------------------------------------------------ instant emitter: new disagreements

/** One data_conflicts row created since the last scan, joined to its IPO. */
export interface NewConflictRow {
  conflictId: string;
  ipoId: string;
  slug: string;
  companyName: string | null;
  status: string;
  tableName: string;
  fieldName: string;
  source1: string;
  value1: string | null;
  source2: string;
  value2: string | null;
  /** Set on an OD-90 corrigendum suggestion: the newer document the value was read from. */
  documentId: string | null;
  /** detected_at as naive UTC text (reset by every upsertConflict refresh); informational. */
  detectedAt?: string;
}

/** No mark and no digest send on record: look back this far (two data wakes). */
export const NEW_CONFLICT_FIRST_LOOKBACK_MS = 60 * 60_000;

/**
 * The scan rereads this far BEFORE its mark. A writer stamps detected_at from its own clock when its
 * statement runs, and commits later; a row stamped just before a mark but committed after that scan
 * would otherwise never be read. The per-conflict pair hash absorbs every repeat the overlap causes.
 */
export const NEW_CONFLICT_OVERLAP_MS = 15 * 60_000;

/**
 * The identity of a disagreement: the two sources and their two values (plus the document for an OD-90
 * suggestion). A row refreshed in place with the same pair is the same disagreement; any change is new.
 * null and '' hash differently (an empty value and a missing one are different facts).
 */
export function conflictPairHash(r: Pick<NewConflictRow, 'source1' | 'value1' | 'source2' | 'value2' | 'documentId'>): string {
  return createHash('sha256')
    .update(JSON.stringify([r.source1, r.value1, r.source2, r.value2, r.documentId]))
    .digest('hex')
    .slice(0, 16);
}

export interface NewDisagreementScanDeps {
  now?: Date;
  /** Open real-disagreement rows whose detected_at is at or after `since`. */
  loadNewConflicts(since: Date): Promise<NewConflictRow[]>;
  /** The scan's high-water mark (never expires). */
  getMark(): Promise<Date | null>;
  setMark(at: Date): Promise<void>;
  /** The value-pair hash last alerted for a conflict row (null: never alerted). */
  getPairHash(conflictId: string): Promise<string | null>;
  setPairHash(conflictId: string, hash: string): Promise<void>;
  /** Fallback start when the mark is missing: the last digest the Notifier accepted. */
  getLastDigestAt?(): Promise<Date | null>;
  /** Passed through to sendAdminInstant (tests); production uses its default deps. */
  alert?: AdminAlertDeps;
}

export interface NewDisagreementScanResult {
  scanned: number;
  /** Rows re-read (refresh or overlap) whose value pair was already alerted: nothing sent. */
  unchanged: number;
  outcomes: Record<AdminInstantOutcome['outcome'], number>;
  markAdvanced: boolean;
}

/**
 * The instant emitter for §9.2 item 16's "a new real disagreement" and "a newer document disagrees
 * with an admin value".
 *
 * A NEW DISAGREEMENT IS A NEW VALUE PAIR, NOT A NEW ROW. Most disagreements arrive through
 * DataConflictsRepository.upsertConflict, which updates the open row for the field IN PLACE (new
 * sources and values, detected_at reset) and never moves created_at; logConflict inserts with
 * detected_at, and the OD-90 corrigendum insert takes detected_at's default. So the scan reads rows by
 * detected_at (from the mark minus NEW_CONFLICT_OVERLAP_MS), and each row is compared with the pair
 * hash last alerted for that conflict id: a changed or first-seen pair is one event, an unchanged
 * refresh is nothing.
 *
 * An event goes through sendAdminInstant: UPCOMING/OPEN within the wake cap -> one instant alert (one
 * per IPO, type and IST day, item 25); over the cap, not live, or the day's instant already used -> one
 * digest entry. The pair hash is stored only after the event reached the owner or the digest store, so
 * a Notifier outage leaves it unstored and the mark unadvanced, and the next wake retries.
 *
 * It reads rows every writer path has already committed, so it runs outside every write transaction
 * and a rolled-back write can never alert. A corrigendum suggestion (document_id set) whose stored
 * value is ADMIN is `newer-document-disagrees`; every other row is `new-disagreement`.
 */
export async function scanNewDisagreements(deps: NewDisagreementScanDeps): Promise<NewDisagreementScanResult> {
  const now = deps.now ?? new Date();
  const mark = await deps.getMark();
  let since: Date;
  if (mark) {
    since = new Date(mark.getTime() - NEW_CONFLICT_OVERLAP_MS);
  } else {
    let last: Date | null = null;
    try {
      last = deps.getLastDigestAt ? await deps.getLastDigestAt() : null;
    } catch (err) {
      logger.warn({ reason: err instanceof Error ? err.message : String(err) }, 'Admin instant scan: last-digest read failed - using 60 min');
    }
    since = last && last.getTime() < now.getTime() ? last : new Date(now.getTime() - NEW_CONFLICT_FIRST_LOOKBACK_MS);
  }
  const rows = await deps.loadNewConflicts(since);
  const outcomes: Record<AdminInstantOutcome['outcome'], number> = { sent: 0, 'already-sent': 0, unsent: 0, capped: 0, digest: 0 };
  let unchanged = 0;
  for (const r of rows) {
    const hash = conflictPairHash(r);
    if ((await deps.getPairHash(r.conflictId)) === hash) {
      unchanged++;
      continue;
    }
    const newerDocument = r.documentId !== null && r.source1 === 'ADMIN';
    const event: AdminInstantEvent = {
      type: newerDocument ? 'newer-document-disagrees' : 'new-disagreement',
      ipoId: r.ipoId,
      slug: r.slug,
      status: r.status,
      field: `${r.tableName}.${r.fieldName}`,
      detail: newerDocument
        ? `admin value ${r.value1 ?? '(empty)'}; a newer document says ${r.value2 ?? '(no value, see its quote)'}`
        : `${r.source1} ${r.value1 ?? '(empty)'} vs ${r.source2} ${r.value2 ?? '(empty)'}`,
      companyName: r.companyName ?? undefined,
    };
    const out = await sendAdminInstant(event, deps.alert, { digestIfAlreadySent: true });
    outcomes[out.outcome]++;
    if (out.outcome === 'unsent') continue;
    try {
      await deps.setPairHash(r.conflictId, hash);
    } catch (err) {
      // The event reached the owner or the digest; a lost hash only risks one repeat next wake.
      logger.warn({ conflictId: r.conflictId, reason: err instanceof Error ? err.message : String(err) }, 'Admin instant scan: pair-hash write FAILED');
    }
  }
  const markAdvanced = outcomes.unsent === 0;
  if (markAdvanced) await deps.setMark(now);
  return { scanned: rows.length, unchanged, outcomes, markAdvanced };
}

/** A conflict's last alerted pair lives this long (data_conflicts rows are pruned well before). */
export const CONFLICT_PAIR_TTL_SECONDS = 90 * 86_400;

export const conflictPairKey = (env: string, conflictId: string): string => `admin-conflict-pair:${env}:${conflictId}`;

/** Redis-backed per-conflict pair hashes. */
export function redisConflictPairs(redis: { get(key: string): Promise<string | null>; set(...args: unknown[]): Promise<unknown> }, env: string) {
  return {
    get: async (conflictId: string): Promise<string | null> => redis.get(conflictPairKey(env, conflictId)),
    set: async (conflictId: string, hash: string): Promise<void> => {
      await redis.set(conflictPairKey(env, conflictId), hash, 'EX', CONFLICT_PAIR_TTL_SECONDS);
    },
  };
}

/**
 * Redis-backed timestamps (the scan mark, the last digest send), one key each. `ttlSeconds` null writes
 * no expiry: the scan mark must never lapse (a lapsed mark silently narrows the next scan).
 */
export function redisTimestamp(
  redis: { get(key: string): Promise<string | null>; set(...args: unknown[]): Promise<unknown> },
  key: string,
  ttlSeconds: number | null = 7 * 86_400
) {
  return {
    get: async (): Promise<Date | null> => {
      const v = await redis.get(key);
      const ms = v ? Date.parse(v) : NaN;
      return Number.isNaN(ms) ? null : new Date(ms);
    },
    set: async (at: Date): Promise<void> => {
      if (ttlSeconds === null) await redis.set(key, at.toISOString());
      else await redis.set(key, at.toISOString(), 'EX', ttlSeconds);
    },
  };
}

export const newConflictMarkKey = (env: string): string => `admin-new-conflict-mark:${env}`;
export const digestLastSentKey = (env: string): string => `admin-digest-last-sent:${env}`;

/**
 * data_conflicts rows DETECTED since `since` that are real disagreements the admin must see: open,
 * two different sources (or an OD-90 corrigendum suggestion, which may carry the same label twice),
 * not an OD-75 admin-only record, not a writer bookkeeping field (F-181). detected_at, not created_at:
 * upsertConflict refreshes an open row in place and resets only detected_at. detected_at is a naive
 * `timestamp` holding UTC (drizzle writes new Date() as an ISO string; the pool runs timezone=UTC), and
 * this raw sql template binds `since` as an ISO string (ist-timezone rule: raw parameters take strings).
 */
export function dbNewConflictsLoader(db: Db) {
  return async (since: Date): Promise<NewConflictRow[]> => {
    const od75 = `{${ADMIN_ONLY_CONFLICT_REASONS.map((x) => `"${x}"`).join(',')}}`;
    const bookkeeping = `{${WRITER_BOOKKEEPING_FIELDS.map((x) => `"${x}"`).join(',')}}`;
    const result = await db.execute(sql`
      SELECT c.id::text AS conflict_id, c.ipo_id::text AS ipo_id, i.slug, i.company_name, i.status::text AS status,
             c.table_name, c.field_name, c.source1::text AS source1, c.value1, c.source2::text AS source2, c.value2,
             c.document_id::text AS document_id, c.detected_at::text AS detected_at
        FROM data_conflicts c JOIN ipos i ON i.id = c.ipo_id
       WHERE c.resolved_at IS NULL
         AND c.detected_at >= ${since.toISOString()}::timestamp
         AND (c.source1::text <> c.source2::text OR c.document_id IS NOT NULL)
         AND (c.resolution_reason IS NULL OR NOT (c.resolution_reason = ANY(${od75}::text[])))
         AND NOT (c.field_name = ANY(${bookkeeping}::text[]))
       ORDER BY c.detected_at, c.id
    `);
    return rowsOf(result).map((r) => ({
      conflictId: String(r.conflict_id),
      ipoId: String(r.ipo_id),
      slug: String(r.slug),
      companyName: (r.company_name as string | null) ?? null,
      status: String(r.status),
      tableName: String(r.table_name),
      fieldName: String(r.field_name),
      source1: String(r.source1),
      value1: (r.value1 as string | null) ?? null,
      source2: String(r.source2),
      value2: (r.value2 as string | null) ?? null,
      documentId: (r.document_id as string | null) ?? null,
      detectedAt: String(r.detected_at),
    }));
  };
}
