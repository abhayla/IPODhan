/**
 * Source record keys (OD-85, OD-86) — docs/design/data-sourcing-pull-model.md §2.3.3.2
 * "#### Source record keys", §2.3.3.3 (relaunch exception), OD-83 (a postponement + relaunch is
 * the same IPO), OD-34 / OD-35 / OD-68 / OD-69 / OD-70 (the binding order and refusals this
 * sits in front of), findings F-144..F-149.
 *
 * Each source numbers the SAME offering with its own record number: BSE `IPO_NO` (BSE_IPO_NO),
 * the Chittorgarh page id (CG_PAGE_ID — the slug is ignored, F-148), the NSE issue symbol with its
 * series (NSE_ISSUE = "SYMBOL|SERIES"). Those numbers are stored in `ipo_source_keys`, many per IPO,
 * each with a state (ACTIVE binds + writes, SUPERSEDED binds + never writes, RELEASED and DISPUTED
 * bind nothing).
 *
 * The read rule (§2.3.3.2): try each key the record carries; re-check any hit against the row
 * (offering type, segment, open date within 180 days, known price band, CIN/ISIN where both exist);
 * a failed check writes nothing and holds the record (OD-68 hold path); a CIN/ISIN contradiction
 * marks the key DISPUTED; keys hitting two rows write nothing and report the duplicate; no hit
 * falls back to the existing order (CIN, ISIN, symbol, name, OD-68 hold).
 *
 * The write rule: a key is written in the same transaction as the bind or the row create; a second
 * key of the same source and type supersedes the older one ONLY when OD-83's test holds (same
 * shares, same price band, older record postponed or strictly earlier), otherwise the write is held.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { ipoSourceKeys, ipos } from '../db/schema';
import { normalizeCin } from '../utils/cin';
import { logger } from '../logger';
import { RepositoryError } from '../errors/repository-errors';

export type SourceKeyType = 'BSE_IPO_NO' | 'CG_PAGE_ID' | 'NSE_ISSUE';
export type SourceKeyState = 'ACTIVE' | 'SUPERSEDED' | 'RELEASED' | 'DISPUTED';
export type SourceKeyBoundVia =
  | 'CIN' | 'ISIN' | 'SYMBOL' | 'NAME' | 'HOLD_RESOLUTION' | 'BACKFILL'
  // Two values the spec's list does not name, both needed to record HOW a key arrived:
  // KEY = the record bound by another of its own keys; CREATE = the record created the row.
  | 'KEY' | 'CREATE';

/** What the source record said when its key was read — the OD-83 / OD-86 tests read these. */
export interface SourceKeyAttrs {
  shares?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  /** The exchange's own "issue postponed" flag (BSE Notes/Remarks, OD-83). */
  postponed?: boolean;
  scripCode?: string | null;
  issuePeriod?: string | null;
  series?: string | null;
  [k: string]: unknown;
}

export interface SourceKeyRef {
  source: string;
  keyType: SourceKeyType;
  keyValue: string;
  attrs?: SourceKeyAttrs;
  recordOpenDate?: string | null;
}

export type SourceKeyRow = typeof ipoSourceKeys.$inferSelect;
type Db = NodePgDatabase<typeof schema>;
// A transaction handle exposes the same query surface as the database.
type DbOrTx = Pick<Db, 'select' | 'insert' | 'update' | 'execute'>;

/** OD-35: open dates within this many days are one offering. */
const SAME_OFFERING_WINDOW_DAYS = 180;

/** Statuses whose offering has ended: its keys are RELEASED (OD-85). DELISTED/LAPSED are read as text so the rule holds once §2.3.3.3 adds them. */
export const ENDED_STATUSES: readonly string[] = ['WITHDRAWN', 'DELISTED', 'LAPSED'];

/** Default, reversible, in configuration (§2.3.3.2): an NSE key is RELEASED this many days after listing. */
export function nseKeyReleaseDays(): number {
  const raw = Number(process.env.NSE_SOURCE_KEY_RELEASE_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
}

/** Trimmed, upper-cased, inner whitespace collapsed ("MOMSBELIEF " -> "MOMSBELIEF", F-133). */
export function normalizeSourceKeyValue(value: unknown): string | null {
  if (value == null) return null;
  const v = String(value).replace(/\s+/g, ' ').trim().toUpperCase();
  return v.length > 0 && v.length <= 64 ? v : null;
}

/** NSE_ISSUE = SYMBOL|SERIES. No series means no key: a symbol alone cannot tell an IPO from a later OFS (scenario 9). */
export function nseIssueKeyValue(symbol: unknown, series: unknown): string | null {
  const s = normalizeSourceKeyValue(symbol);
  const ser = normalizeSourceKeyValue(series);
  return s && ser ? `${s}|${ser}` : null;
}

/** The Chittorgarh page id from a page URL "/ipo/<slug>/<id>/" — the slug is ignored (F-148). */
export function chittorgarhPageId(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = url.match(/\/ipo\/[^/?#]+\/(\d+)(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/** Drops malformed refs and normalises every value; duplicates (same source/type/value) collapse. */
export function normalizeSourceKeyRefs(refs: readonly SourceKeyRef[] | null | undefined): SourceKeyRef[] {
  const out = new Map<string, SourceKeyRef>();
  for (const ref of refs ?? []) {
    const keyValue = normalizeSourceKeyValue(ref?.keyValue);
    if (!ref?.source || !ref.keyType || !keyValue) continue;
    out.set(`${ref.source}\u0000${ref.keyType}\u0000${keyValue}`, { ...ref, keyValue });
  }
  return [...out.values()];
}

export class SourceKeyDuplicateError extends RepositoryError {
  constructor(message: string, public readonly ipoIds: string[], public readonly keys: SourceKeyRef[]) {
    super(message);
    this.name = 'SourceKeyDuplicateError';
    Object.setPrototypeOf(this, SourceKeyDuplicateError.prototype);
  }
}

/** A record whose key is SUPERSEDED binds its row but writes nothing (OD-85). Not a failure. */
export class SourceKeySupersededError extends RepositoryError {
  constructor(message: string, public readonly ipoId: string, public readonly keyIds: string[]) {
    super(message);
    this.name = 'SourceKeySupersededError';
    Object.setPrototypeOf(this, SourceKeySupersededError.prototype);
  }
}

/** Every error name that means "this record writes nothing this cycle, by decision" — never retried. */
export const SOURCE_KEY_NO_WRITE_ERROR_NAMES: ReadonlySet<string> = new Set([
  'IdentityHeldForReviewError',
  'SourceKeyDuplicateError',
  'SourceKeySupersededError',
]);

function toDay(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function knownNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface KeyRecheckIdentity {
  offeringType?: string | null;
  segment?: string | null;
  openDate?: string | Date | null;
  priceRangeMin?: number | null;
  cin?: string | null;
  isin?: string | null;
}

export interface KeyRecheckRow {
  offeringType?: unknown;
  segment?: unknown;
  openDate?: unknown;
  priceRangeMin?: unknown;
  cin?: unknown;
  isin?: unknown;
}

// Not a discriminated union: shared compiles without strictNullChecks, where `!r.ok` does not narrow.
export interface KeyRecheckResult {
  ok: boolean;
  identifierContradiction?: boolean;
  reason?: string;
}

/**
 * The re-check on every key bind (§2.3.3.2 read rule, step 2). A value unknown on either side
 * neither proves nor refutes. A CIN or ISIN that differs is an identifier contradiction: the key
 * itself is wrong (DISPUTED), not merely this record.
 */
export function recheckKeyBind(identity: KeyRecheckIdentity, row: KeyRecheckRow): KeyRecheckResult {
  const inCin = normalizeCin(identity.cin ?? null);
  const rowCin = normalizeCin(typeof row.cin === 'string' ? row.cin : null);
  if (inCin && rowCin && inCin !== rowCin) {
    return { ok: false, identifierContradiction: true, reason: `CIN differs (${inCin} vs ${rowCin})` };
  }
  const inIsin = normalizeSourceKeyValue(identity.isin);
  const rowIsin = normalizeSourceKeyValue(row.isin);
  if (inIsin && rowIsin && inIsin !== rowIsin) {
    return { ok: false, identifierContradiction: true, reason: `ISIN differs (${inIsin} vs ${rowIsin})` };
  }
  const inType = identity.offeringType ?? null;
  const rowType = (row.offeringType as string | null | undefined) ?? null;
  if (inType && rowType && inType !== rowType) {
    return { ok: false, identifierContradiction: false, reason: `offering type differs (${inType} vs ${rowType})` };
  }
  const inSeg = identity.segment ?? null;
  const rowSeg = (row.segment as string | null | undefined) ?? null;
  if (inSeg && rowSeg && inSeg !== rowSeg) {
    return { ok: false, identifierContradiction: false, reason: `segment differs (${inSeg} vs ${rowSeg})` };
  }
  const inDay = toDay(identity.openDate);
  const rowDay = toDay(row.openDate);
  if (inDay && rowDay) {
    const gap = Math.abs(Date.parse(inDay) - Date.parse(rowDay)) / 86_400_000;
    if (gap > SAME_OFFERING_WINDOW_DAYS) {
      return { ok: false, identifierContradiction: false, reason: `open date ${Math.round(gap)} days away (${inDay} vs ${rowDay}), beyond ${SAME_OFFERING_WINDOW_DAYS}` };
    }
  }
  const inPrice = knownNumber(identity.priceRangeMin);
  const rowPrice = knownNumber(row.priceRangeMin);
  if (inPrice != null && rowPrice != null && inPrice !== rowPrice) {
    return { ok: false, identifierContradiction: false, reason: `price band differs (${inPrice} vs ${rowPrice})` };
  }
  return { ok: true };
}

/**
 * OD-83's test, used for a second key of the same source and type: the SAME offering relaunched
 * under a new record number. Same number of shares and same price band, both KNOWN on both sides,
 * and the older record either marked postponed by the exchange or strictly earlier.
 */
export function od83Supersedes(
  older: { attrs?: unknown; recordOpenDate?: unknown },
  newer: { attrs?: SourceKeyAttrs; recordOpenDate?: string | null }
): { ok: boolean; reason: string } {
  const oa = (older.attrs ?? {}) as SourceKeyAttrs;
  const na = newer.attrs ?? {};
  const oShares = knownNumber(oa.shares);
  const nShares = knownNumber(na.shares);
  if (oShares == null || nShares == null) return { ok: false, reason: 'share count unknown on one side' };
  if (oShares !== nShares) return { ok: false, reason: `shares differ (${oShares} vs ${nShares})` };
  const oMin = knownNumber(oa.priceMin);
  const nMin = knownNumber(na.priceMin);
  const oMax = knownNumber(oa.priceMax);
  const nMax = knownNumber(na.priceMax);
  if (oMin == null || nMin == null || oMax == null || nMax == null) return { ok: false, reason: 'price band unknown on one side' };
  if (oMin !== nMin || oMax !== nMax) return { ok: false, reason: `price band differs (${oMin}-${oMax} vs ${nMin}-${nMax})` };
  if (oa.postponed === true) return { ok: true, reason: 'older record marked postponed by the exchange' };
  const oDay = toDay(older.recordOpenDate);
  const nDay = toDay(newer.recordOpenDate);
  if (oDay && nDay && oDay < nDay) return { ok: true, reason: `older record strictly earlier (${oDay} < ${nDay})` };
  return { ok: false, reason: 'older record neither postponed nor strictly earlier' };
}

// ---------------------------------------------------------------------------------------------
// Database half
// ---------------------------------------------------------------------------------------------

/** Every ACTIVE/SUPERSEDED key matching one of the refs (by the unique binding value). */
export async function findSourceKeyHits(db: DbOrTx, refs: readonly SourceKeyRef[]): Promise<SourceKeyRow[]> {
  const norm = normalizeSourceKeyRefs(refs);
  if (norm.length === 0) return [];
  const values = [...new Set(norm.map((r) => r.keyValue))];
  const rows = await db
    .select()
    .from(ipoSourceKeys)
    .where(and(inArray(ipoSourceKeys.bindingValue, values), inArray(ipoSourceKeys.state, ['ACTIVE', 'SUPERSEDED'])));
  return rows.filter((row) =>
    norm.some((r) => r.source === row.source && r.keyType === row.keyType && r.keyValue === row.bindingValue)
  );
}

/** Keys (any state) of one IPO. */
export async function findSourceKeysForIpo(db: DbOrTx, ipoId: string): Promise<SourceKeyRow[]> {
  return db.select().from(ipoSourceKeys).where(eq(ipoSourceKeys.ipoId, ipoId));
}

export async function setSourceKeyState(
  db: DbOrTx,
  keyIds: readonly string[],
  state: 'RELEASED' | 'DISPUTED',
  reason: string
): Promise<number> {
  if (keyIds.length === 0) return 0;
  const res = await db
    .update(ipoSourceKeys)
    .set({ state, bindingValue: null, stateReason: reason, stateChangedAt: new Date() })
    .where(and(inArray(ipoSourceKeys.id, [...keyIds]), inArray(ipoSourceKeys.state, ['ACTIVE', 'SUPERSEDED'])))
    .returning({ id: ipoSourceKeys.id });
  return res.length;
}

export type SourceKeyResolution =
  | { kind: 'miss' }
  | { kind: 'bound'; ipoId: string; keyIds: string[] }
  | { kind: 'superseded'; ipoId: string; keyIds: string[] }
  | { kind: 'held'; ipoId: string; reason: string; disputedKeyIds: string[] }
  | { kind: 'duplicate'; ipoIds: string[]; keyIds: string[] };

/**
 * The read rule, steps 1–4. Returns what the key table says about this record; the caller
 * (`resolveIpoRow`) turns `held` / `duplicate` / `superseded` into "write nothing".
 *
 * A hit on a row whose offering has ended (WITHDRAWN / DELISTED / LAPSED) is RELEASED on the spot
 * and does not bind — the release job does the same in bulk; this makes the read rule hold even
 * before the job has run (the Hero Motors shape, scenario 4).
 */
export async function resolveBySourceKeys(
  db: DbOrTx,
  identity: KeyRecheckIdentity & { companyName?: string },
  refs: readonly SourceKeyRef[]
): Promise<SourceKeyResolution> {
  const hits = await findSourceKeyHits(db, refs);
  if (hits.length === 0) return { kind: 'miss' };

  const ipoIds = [...new Set(hits.map((h) => h.ipoId))];
  const rows = await db
    .select({
      id: ipos.id, slug: ipos.slug, status: ipos.status, offeringType: ipos.offeringType, segment: ipos.segment,
      openDate: ipos.openDate, priceRangeMin: ipos.priceRangeMin, cin: ipos.cin, isin: ipos.isin,
    })
    .from(ipos)
    .where(inArray(ipos.id, ipoIds));

  const ended = rows.filter((r) => ENDED_STATUSES.includes(String(r.status)));
  if (ended.length > 0) {
    const endedIds = new Set(ended.map((r) => r.id));
    const toRelease = hits.filter((h) => endedIds.has(h.ipoId)).map((h) => h.id);
    await setSourceKeyState(db, toRelease, 'RELEASED', 'offering ended (read-time release, OD-85)');
    logger.info({ companyName: identity.companyName, released: toRelease }, '[OD-85] key hit an ended offering - RELEASED, not bound');
  }
  const live = rows.filter((r) => !ENDED_STATUSES.includes(String(r.status)));
  const liveHits = hits.filter((h) => live.some((r) => r.id === h.ipoId));
  if (liveHits.length === 0) return { kind: 'miss' };

  const liveIds = [...new Set(liveHits.map((h) => h.ipoId))];
  if (liveIds.length > 1) {
    logger.warn(
      { companyName: identity.companyName, ipoIds: liveIds, keys: liveHits.map((h) => `${h.source}:${h.keyType}:${h.keyValue}`) },
      '[OD-85] source_key_duplicate: this record\'s keys point at two different rows - nothing written'
    );
    return { kind: 'duplicate', ipoIds: liveIds, keyIds: liveHits.map((h) => h.id) };
  }

  const row = live.find((r) => r.id === liveIds[0])!;
  const check = recheckKeyBind(identity, row);
  if (!check.ok) {
    let disputed: string[] = [];
    if (check.identifierContradiction) {
      disputed = liveHits.map((h) => h.id);
      await setSourceKeyState(db, disputed, 'DISPUTED', `key_contradiction: ${check.reason}`);
    }
    logger.warn(
      { companyName: identity.companyName, ipoId: row.id, slug: row.slug, reason: check.reason, disputed },
      '[OD-85] key_contradiction: key hit failed the re-check - nothing written, record held'
    );
    return { kind: 'held', ipoId: row.id, reason: check.reason, disputedKeyIds: disputed };
  }

  if (liveHits.some((h) => h.state === 'SUPERSEDED')) {
    return { kind: 'superseded', ipoId: row.id, keyIds: liveHits.map((h) => h.id) };
  }
  return { kind: 'bound', ipoId: row.id, keyIds: liveHits.map((h) => h.id) };
}

/**
 * Before a record bound by the FALLBACK order writes into a row: would its keys be accepted?
 * A ref whose (source, type) already has a different ACTIVE value on that row is accepted only
 * under OD-83's test; otherwise the write is held rather than guessed.
 */
export async function planSourceKeyWrite(
  db: DbOrTx,
  ipoId: string,
  refs: readonly SourceKeyRef[]
): Promise<{ ok: boolean; reason?: string }> {
  const norm = normalizeSourceKeyRefs(refs);
  if (norm.length === 0) return { ok: true };
  const existing = await findSourceKeysForIpo(db, ipoId);
  for (const ref of norm) {
    const active = existing.filter(
      (k) => k.state === 'ACTIVE' && k.source === ref.source && k.keyType === ref.keyType && k.keyValue !== ref.keyValue
    );
    for (const old of active) {
      const test = od83Supersedes(old, ref);
      if (!test.ok) {
        return { ok: false, reason: `${ref.source} ${ref.keyType} ${ref.keyValue} would replace ACTIVE ${old.keyValue}: ${test.reason}` };
      }
    }
  }
  return { ok: true };
}

/**
 * The write rule. Runs INSIDE the caller's transaction (the bind or the row create). For each ref:
 * already on this row -> kept (attrs refreshed while ACTIVE); on another row -> duplicate (throws,
 * so the caller's transaction rolls back); a different ACTIVE value of the same source/type on this
 * row -> superseded under OD-83, else nothing is written for that ref; otherwise inserted ACTIVE.
 * A concurrent writer that inserted the same value first surfaces as a unique violation (23505),
 * which also rolls the caller's transaction back — that is what keeps two concurrent binds to one row.
 */
export async function recordSourceKeys(
  tx: DbOrTx,
  ipoId: string,
  refs: readonly SourceKeyRef[],
  opts: { boundVia: SourceKeyBoundVia; boundBy: string }
): Promise<{ insertedIds: string[]; keptIds: string[]; supersededIds: string[]; heldReasons: string[] }> {
  const out = { insertedIds: [] as string[], keptIds: [] as string[], supersededIds: [] as string[], heldReasons: [] as string[] };
  const norm = normalizeSourceKeyRefs(refs);
  if (norm.length === 0) return out;

  const hits = await findSourceKeyHits(tx, norm);
  const elsewhere = hits.filter((h) => h.ipoId !== ipoId);
  if (elsewhere.length > 0) {
    throw new SourceKeyDuplicateError(
      `recordSourceKeys: ${elsewhere.map((h) => `${h.source}:${h.keyType}:${h.keyValue}`).join(', ')} already bound to another row - not written (OD-85)`,
      [ipoId, ...new Set(elsewhere.map((h) => h.ipoId))],
      norm
    );
  }
  const existing = await findSourceKeysForIpo(tx, ipoId);
  // A record one of whose keys is already on this row was bound BY that key (the read rule tries
  // keys first), so its other keys arrive via KEY, not via the fallback step the caller inferred.
  const boundViaForNew: SourceKeyBoundVia =
    opts.boundVia !== 'CREATE' && hits.some((h) => h.ipoId === ipoId) ? 'KEY' : opts.boundVia;

  for (const ref of norm) {
    const same = hits.find((h) => h.ipoId === ipoId && h.source === ref.source && h.keyType === ref.keyType && h.keyValue === ref.keyValue);
    if (same) {
      out.keptIds.push(same.id);
      if (same.state === 'ACTIVE' && ref.attrs) {
        await tx
          .update(ipoSourceKeys)
          .set({ attrs: { ...((same.attrs as object) ?? {}), ...ref.attrs }, recordOpenDate: ref.recordOpenDate ?? same.recordOpenDate })
          .where(eq(ipoSourceKeys.id, same.id));
      }
      continue;
    }
    const olderActive = existing.filter(
      (k) => k.state === 'ACTIVE' && k.source === ref.source && k.keyType === ref.keyType && k.keyValue !== ref.keyValue
    );
    const failing = olderActive
      .map((old) => ({ old, test: od83Supersedes(old, ref) }))
      .filter((x) => !x.test.ok);
    if (failing.length > 0) {
      const reason = `${ref.source} ${ref.keyType} ${ref.keyValue} vs ACTIVE ${failing.map((f) => f.old.keyValue).join(',')}: ${failing.map((f) => f.test.reason).join('; ')}`;
      out.heldReasons.push(reason);
      logger.warn({ ipoId, reason }, '[OD-85] key_contradiction: second key of one source failed OD-83 - key not written, held');
      continue;
    }
    const [inserted] = await tx
      .insert(ipoSourceKeys)
      .values({
        ipoId,
        source: ref.source,
        keyType: ref.keyType,
        keyValue: ref.keyValue,
        bindingValue: ref.keyValue,
        state: 'ACTIVE',
        attrs: ref.attrs ?? null,
        recordOpenDate: toDay(ref.recordOpenDate),
        boundVia: boundViaForNew,
        boundBy: opts.boundBy.slice(0, 64),
      })
      .returning({ id: ipoSourceKeys.id });
    out.insertedIds.push(inserted.id);
    for (const old of olderActive) {
      await tx
        .update(ipoSourceKeys)
        .set({
          state: 'SUPERSEDED',
          supersededBy: inserted.id,
          stateChangedAt: new Date(),
          stateReason: `OD-83 relaunch: superseded by ${ref.keyValue} (${od83Supersedes(old, ref).reason})`,
        })
        .where(eq(ipoSourceKeys.id, old.id));
      out.supersededIds.push(old.id);
      logger.info({ ipoId, older: old.keyValue, newer: ref.keyValue }, '[OD-83] relaunch - older source key SUPERSEDED');
    }
  }
  return out;
}

/** `record, row` -> which step of the existing order bound it (for `bound_via`). */
export function inferBoundVia(
  record: { cin?: string | null; isin?: string | null; symbol?: string | null },
  row: { cin?: unknown; isin?: unknown; symbol?: unknown }
): SourceKeyBoundVia {
  const rc = normalizeCin(record.cin ?? null);
  if (rc && rc === normalizeCin(typeof row.cin === 'string' ? row.cin : null)) return 'CIN';
  const ri = normalizeSourceKeyValue(record.isin);
  if (ri && ri === normalizeSourceKeyValue(row.isin)) return 'ISIN';
  const rs = normalizeSourceKeyValue(record.symbol);
  if (rs && rs === normalizeSourceKeyValue(row.symbol)) return 'SYMBOL';
  return 'NAME';
}

/**
 * RELEASE (OD-85): keys of ended offerings (WITHDRAWN / DELISTED / LAPSED) and NSE_ISSUE keys
 * N days after listing (default 30, `NSE_SOURCE_KEY_RELEASE_DAYS`). Idempotent.
 */
export async function releaseEndedSourceKeys(
  db: DbOrTx,
  opts: { nseDaysAfterListing?: number } = {}
): Promise<{ endedReleased: number; nseReleased: number }> {
  const days = opts.nseDaysAfterListing ?? nseKeyReleaseDays();
  const ended = await db.execute(sql`
    update ipo_source_keys k
       set state = 'RELEASED', binding_value = null, state_changed_at = now(),
           state_reason = 'offering ended: ' || i.status::text
      from ipos i
     where i.id = k.ipo_id
       and k.state in ('ACTIVE', 'SUPERSEDED')
       and i.status::text in ('WITHDRAWN', 'DELISTED', 'LAPSED')
    returning k.id
  `);
  const nse = await db.execute(sql`
    update ipo_source_keys k
       set state = 'RELEASED', binding_value = null, state_changed_at = now(),
           state_reason = 'NSE key released ' || ${days}::int || ' days after listing'
      from ipos i
     where i.id = k.ipo_id
       and k.key_type = 'NSE_ISSUE'
       and k.state in ('ACTIVE', 'SUPERSEDED')
       and i.listing_date is not null
       and i.listing_date < (current_date - ${days}::int)
    returning k.id
  `);
  const count = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? []).length;
  return { endedReleased: count(ended), nseReleased: count(nse) };
}

/**
 * F-145 class (the IC Electricals ICEL/ICELCO flip): `ipos.symbol` follows the row's ACTIVE
 * NSE_ISSUE key, never the record read last. Returns that key's symbol (the part before "|"), or
 * null when the row has no ACTIVE NSE key — then the incoming symbol is written unchanged.
 */
export async function activeNseIssueSymbol(db: DbOrTx, ipoId: string): Promise<string | null> {
  const rows = await db
    .select({ keyValue: ipoSourceKeys.keyValue })
    .from(ipoSourceKeys)
    .where(and(eq(ipoSourceKeys.ipoId, ipoId), eq(ipoSourceKeys.keyType, 'NSE_ISSUE'), eq(ipoSourceKeys.state, 'ACTIVE')));
  if (rows.length !== 1) return null; // none, or (never expected) two ACTIVE: do not guess
  const symbol = rows[0].keyValue.split('|')[0];
  return symbol || null;
}

/**
 * OD-86 + OD-83 at merge time: after a relaunch merge the survivor holds the keys of BOTH records,
 * so one source can have two ACTIVE keys (Dhanwel BSE 7794 and 7900). The older row's key of each
 * (source, key_type) that the newer row also carries is SUPERSEDED by the newer one — the older
 * record is the postponed one by OD-86's own condition. Runs inside the merge transaction.
 */
export async function supersedeOlderKeysOnRelaunchMerge(
  tx: DbOrTx,
  olderKeys: readonly SourceKeyRow[],
  newerKeys: readonly SourceKeyRow[],
  reason: string
): Promise<string[]> {
  const superseded: string[] = [];
  for (const old of olderKeys) {
    if (old.state !== 'ACTIVE') continue;
    const newer = newerKeys.find(
      (k) => k.state === 'ACTIVE' && k.source === old.source && k.keyType === old.keyType && k.keyValue !== old.keyValue
    );
    if (!newer) continue;
    await tx
      .update(ipoSourceKeys)
      .set({ state: 'SUPERSEDED', supersededBy: newer.id, stateChangedAt: new Date(), stateReason: `OD-86 relaunch merge: superseded by ${newer.keyValue} (${reason})` })
      .where(and(eq(ipoSourceKeys.id, old.id), eq(ipoSourceKeys.state, 'ACTIVE')));
    superseded.push(old.id);
    logger.info({ older: old.keyValue, newer: newer.keyValue }, '[OD-86] relaunch merge - older source key SUPERSEDED');
  }
  return superseded;
}
