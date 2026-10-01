/**
 * Spec §9.2 item 26 ("Editing an identifier keeps the old one", follows from OD-68 and OD-85):
 * when an admin changes a CIN, ISIN, symbol or source record number, the old value is kept as an
 * alias that identity binding still matches, so the next scrape carrying the old value binds to
 * this row instead of creating a second one.
 *
 *  - CIN / ISIN / symbol (company- or share-level, kept on `ipos` per OD-85): the old value goes to
 *    `ipo_identifier_aliases`; `IPORepository.findByCin/findByIsin/findBySymbol` match it, and
 *    `resolveIpoRow` re-checks an alias match against OD-35 (symbols are reused).
 *  - BSE `IPO_NO` (`ipos.bse_ipo_no`, the offering-level source record number of OD-85): the old
 *    key stays in `ipo_source_keys` as SUPERSEDED (binds, never writes) with reason `admin_edit`,
 *    and the new value becomes the ACTIVE key.
 *
 * A new value another live IPO already carries (as a live column, an ACTIVE source key, or a key
 * SUPERSEDED by the OD-83/OD-86 relaunch paths) is refused and the other IPO is named: saving it
 * would bind two rows to one identifier. A value another row keeps ONLY as an admin-removed copy
 * (a key an admin edit SUPERSEDED, or an alias row) MOVES to this row instead (#1290, §9.2 item 26
 * clarified 2026-10-01): the copy is closed and an `ADMIN_IDENTIFIER_MOVED` audit row on that row
 * records it, so the real owner's records stop being held. CIN, ISIN
 * and symbol name the COMPANY or its SHARE, so only another row that could be the SAME offering
 * refuses (not ended, not a different offering type, open dates within OD-35's 180 days): a
 * company's later OFS or rights row legitimately shares them (`resolveByCin`, `ofsIdentityConflict`).
 * A symbol edit also moves the row's NSE source record numbers (SYMBOL|SERIES, OD-85): the old key
 * becomes SUPERSEDED and the new symbol with the same series becomes ACTIVE, attributes carried over,
 * so the next NSE record with the new symbol binds and writes instead of failing OD-83.
 *
 * Runs INSIDE `writeAdminFieldValue`'s transaction, after the `ipos` row lock, so the alias and the
 * value commit or roll back together.
 */
import { and, eq, inArray, ne, not, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { readDatabaseNow } from '../db/database-clock';
import { auditLogs, ipoIdentifierAliases, ipoSourceKeys, ipos } from '../db/schema';
import { normalizeCin } from '../utils/cin';
import { ADMIN_EDIT_REASON_PREFIX, ENDED_STATUSES } from '../repositories/ipo-source-keys';

type Db = NodePgDatabase<typeof schema>;

/** `ipos` fields whose admin edit keeps the old value (§9.2 item 26). */
export const IDENTIFIER_ALIAS_FIELDS = {
  cin: 'CIN',
  isin: 'ISIN',
  symbol: 'SYMBOL',
  bseIpoNo: 'BSE_IPO_NO',
} as const;

export type IdentifierAliasField = keyof typeof IDENTIFIER_ALIAS_FIELDS;

export function isIdentifierAliasField(fieldName: string): fieldName is IdentifierAliasField {
  return Object.prototype.hasOwnProperty.call(IDENTIFIER_ALIAS_FIELDS, fieldName);
}

const SAME_OFFERING_WINDOW_DAYS = 180;

/** The form binding compares: CIN via normalizeCin, the others trimmed + upper-cased. */
export function normalizeIdentifier(fieldName: IdentifierAliasField, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (fieldName === 'cin') return normalizeCin(String(value));
  const v = String(value).trim().toUpperCase();
  return v === '' ? null : v;
}

export interface IdentifierEditInput {
  ipoId: string;
  fieldName: IdentifierAliasField;
  oldValue: unknown;
  newValue: unknown;
  adminId: string;
  adminName: string;
}

export type IdentifierEditOutcome =
  | { ok: true; aliasId: string | null; supersededKeyIds: string[]; activeKeyId: string | null; moved: IdentifierMove[] }
  | { ok: false; reason: string };

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

function dayOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

interface Holder { label: string; offeringType: string | null }

/** Of `others`, the first that could be the same offering as `self` (OD-35 type + 180-day window). */
function sameOfferingAs(
  self: { offeringType: string | null; openDate: unknown } | undefined,
  others: { slug: string; offeringType: string | null; openDate: unknown }[]
) {
  const selfDay = dayOf(self?.openDate);
  return others.find((o) => {
    if (self?.offeringType && o.offeringType && self.offeringType !== o.offeringType) return false;
    const d = dayOf(o.openDate);
    return !(selfDay && d && daysApart(selfDay, d) > SAME_OFFERING_WINDOW_DAYS);
  });
}

/** The `state_reason` filter for a key an admin edit removed (`isAdminRemovedSourceKey`, in SQL). */
const adminRemovedReason = () => sql`${ipoSourceKeys.stateReason} LIKE ${ADMIN_EDIT_REASON_PREFIX + '%'}`;

/**
 * A key that still binds its row on its own account: ACTIVE, or SUPERSEDED by anything but an admin
 * edit (the OD-83 / OD-86 relaunch paths). Such a key is never moved to another row (#1290).
 */
function bindsForItsRow() {
  return or(
    eq(ipoSourceKeys.state, 'ACTIVE'),
    and(eq(ipoSourceKeys.state, 'SUPERSEDED'), or(sql`${ipoSourceKeys.stateReason} IS NULL`, not(adminRemovedReason())))
  )!;
}

export interface IdentifierMove {
  fromIpoId: string;
  releasedKeyIds: string[];
  closedAliasIds: string[];
}

/**
 * #1290, §9.2 item 26 (clarified 2026-10-01): the admin types `value` into THIS row's editor while
 * another row keeps it only as an admin-removed copy (a source key an admin edit SUPERSEDED, or an
 * `ipo_identifier_aliases` row). The value moves here: each such key is RELEASED (its binding value
 * is freed, so this row's key can take it under the unique index), each such alias row is closed
 * (deleted), and one audit row per losing IPO records what was closed and where the value went.
 * Called only after `holderElsewhere` found no row that binds the value on its own account, so an
 * ACTIVE key, a live column or an OD-83 supersede is never touched here.
 */
async function moveAdminRemovedCopies(
  tx: Db,
  input: IdentifierEditInput,
  value: string,
  selfSlug: string,
): Promise<IdentifierMove[]> {
  const { ipoId, fieldName, adminName } = input;
  const byIpo = new Map<string, IdentifierMove>();
  const entry = (id: string) => {
    let e = byIpo.get(id);
    if (!e) byIpo.set(id, (e = { fromIpoId: id, releasedKeyIds: [], closedAliasIds: [] }));
    return e;
  };
  const now = await readDatabaseNow(tx);
  const reason = `${ADMIN_EDIT_REASON_PREFIX} ${fieldName} ${value} moved to ${selfSlug} by ${adminName} (#1290)`;

  if (fieldName === 'bseIpoNo' || fieldName === 'symbol') {
    const keyMatch = fieldName === 'bseIpoNo'
      ? and(eq(ipoSourceKeys.keyType, 'BSE_IPO_NO'), eq(ipoSourceKeys.bindingValue, value))
      : and(eq(ipoSourceKeys.keyType, 'NSE_ISSUE'), sql`split_part(${ipoSourceKeys.bindingValue}, '|', 1) = ${value}`);
    const released = await tx
      .update(ipoSourceKeys)
      .set({ state: 'RELEASED', bindingValue: null, stateChangedAt: now, stateReason: reason })
      .where(and(keyMatch, eq(ipoSourceKeys.state, 'SUPERSEDED'), adminRemovedReason(), ne(ipoSourceKeys.ipoId, ipoId)))
      .returning({ id: ipoSourceKeys.id, ipoId: ipoSourceKeys.ipoId });
    for (const k of released) entry(k.ipoId).releasedKeyIds.push(k.id);
  }
  if (fieldName !== 'bseIpoNo') {
    const kind = IDENTIFIER_ALIAS_FIELDS[fieldName];
    const closed = await tx
      .delete(ipoIdentifierAliases)
      .where(and(eq(ipoIdentifierAliases.kind, kind), eq(ipoIdentifierAliases.value, value), ne(ipoIdentifierAliases.ipoId, ipoId)))
      .returning({ id: ipoIdentifierAliases.id, ipoId: ipoIdentifierAliases.ipoId });
    for (const a of closed) entry(a.ipoId).closedAliasIds.push(a.id);
  }

  const moves = [...byIpo.values()];
  for (const m of moves) {
    await tx.insert(auditLogs).values({
      timestamp: now,
      adminUser: adminName,
      actionType: IDENTIFIER_MOVED_AUDIT_ACTION,
      ipoId: m.fromIpoId,
      tableName: 'ipos',
      fieldName,
      oldValue: value,
      newValue: null,
      details: { movedToIpoId: ipoId, movedToSlug: selfSlug, releasedKeyIds: m.releasedKeyIds, closedAliasIds: m.closedAliasIds, reason },
      success: true,
      createdAt: now,
    });
  }
  return moves;
}

/** The audit action of an identifier moved off a row by an admin edit of another row (#1290). */
export const IDENTIFIER_MOVED_AUDIT_ACTION = 'ADMIN_IDENTIFIER_MOVED';

/** Another live IPO that already carries `value` for this identifier, or null. */
async function holderElsewhere(
  tx: Db,
  input: IdentifierEditInput,
  value: string,
  self: { offeringType: string | null; openDate: unknown } | undefined
): Promise<Holder | null> {
  const { ipoId, fieldName } = input;
  const notEnded = sql`${ipos.status}::text NOT IN (${sql.join(ENDED_STATUSES.map((s) => sql`${s}`), sql`, `)})`;

  if (fieldName === 'bseIpoNo') {
    const keys = await tx
      .select({ ipoId: ipoSourceKeys.ipoId, slug: ipos.slug, state: ipoSourceKeys.state, offeringType: ipos.offeringType })
      .from(ipoSourceKeys)
      .innerJoin(ipos, eq(ipos.id, ipoSourceKeys.ipoId))
      .where(
        and(
          eq(ipoSourceKeys.keyType, 'BSE_IPO_NO'),
          eq(ipoSourceKeys.bindingValue, value),
          bindsForItsRow(),
          ne(ipoSourceKeys.ipoId, ipoId)
        )
      )
      .limit(1);
    if (keys[0]) return { label: `${keys[0].slug} (${keys[0].state} source key BSE_IPO_NO ${value})`, offeringType: keys[0].offeringType };
    const rows = await tx
      .select({ slug: ipos.slug, offeringType: ipos.offeringType })
      .from(ipos)
      .where(and(eq(ipos.bseIpoNo, Number(value)), ne(ipos.id, ipoId), notEnded))
      .limit(1);
    return rows[0] ? { label: `${rows[0].slug} (bse_ipo_no ${value})`, offeringType: rows[0].offeringType } : null;
  }

  // CIN, ISIN, symbol (Tier A review MAJOR-1): shared legitimately by a company's IPO and its later
  // OFS / rights row, so only a row that could be the SAME offering refuses.
  const column = fieldName === 'cin' ? ipos.cin : fieldName === 'isin' ? ipos.isin : ipos.symbol;
  const others = await tx
    .select({ slug: ipos.slug, offeringType: ipos.offeringType, openDate: ipos.openDate })
    .from(ipos)
    .where(and(sql`upper(trim(${column})) = ${value}`, ne(ipos.id, ipoId), notEnded, sql`${ipos.status}::text <> 'WITHDRAWN'`));
  const same = sameOfferingAs(self, others);
  if (same) {
    return {
      label: `${same.slug} (${fieldName} ${value}, same offering type and within ${SAME_OFFERING_WINDOW_DAYS} days)`,
      offeringType: same.offeringType,
    };
  }
  if (fieldName === 'symbol') {
    // An NSE source record number (SYMBOL|SERIES) is offering-level (OD-85): an ACTIVE or a
    // SUPERSEDED one on another row still binds that row, so it refuses (Tier A review MAJOR-2).
    const keys = await tx
      .select({ slug: ipos.slug, bindingValue: ipoSourceKeys.bindingValue, state: ipoSourceKeys.state, offeringType: ipos.offeringType })
      .from(ipoSourceKeys)
      .innerJoin(ipos, eq(ipos.id, ipoSourceKeys.ipoId))
      .where(
        and(
          eq(ipoSourceKeys.keyType, 'NSE_ISSUE'),
          bindsForItsRow(),
          sql`split_part(${ipoSourceKeys.bindingValue}, '|', 1) = ${value}`,
          ne(ipoSourceKeys.ipoId, ipoId)
        )
      )
      .limit(1);
    if (keys[0]) return { label: `${keys[0].slug} (${keys[0].state} source key NSE_ISSUE ${keys[0].bindingValue})`, offeringType: keys[0].offeringType };
  }
  return null;
}

/**
 * Tier A review MAJOR-2: a symbol edit moves the row's ACTIVE NSE keys (OLD|SERIES) to NEW|SERIES.
 * The old key becomes SUPERSEDED (still binds, never writes, OD-85) and points at the new ACTIVE key,
 * which carries the old key's attributes and record open date, so OD-83 sees the same offering.
 */
async function moveNseKeys(
  tx: Db, ipoId: string, oldSymbol: string, newSymbol: string, adminName: string, reason: string
): Promise<string[]> {
  const mine = await tx
    .select()
    .from(ipoSourceKeys)
    .where(and(eq(ipoSourceKeys.ipoId, ipoId), eq(ipoSourceKeys.keyType, 'NSE_ISSUE')));
  const moved: string[] = [];
  const now = await readDatabaseNow(tx);
  for (const k of mine) {
    if (k.state !== 'ACTIVE') continue;
    const [sym, ...rest] = k.keyValue.split('|');
    if (sym !== oldSymbol || rest.length === 0) continue;
    const newValue = [newSymbol, ...rest].join('|');
    const existing = mine.find((m) => m.keyValue === newValue && m.id !== k.id);
    let activeId: string;
    if (existing) {
      await tx
        .update(ipoSourceKeys)
        .set({ state: 'ACTIVE', bindingValue: newValue, supersededBy: null, stateChangedAt: now, stateReason: reason })
        .where(eq(ipoSourceKeys.id, existing.id));
      activeId = existing.id;
    } else {
      const [ins] = await tx
        .insert(ipoSourceKeys)
        .values({
          ipoId,
          source: k.source,
          keyType: 'NSE_ISSUE',
          keyValue: newValue,
          bindingValue: newValue,
          attrs: k.attrs,
          recordOpenDate: k.recordOpenDate,
          state: 'ACTIVE',
          boundVia: 'ADMIN_EDIT',
          boundBy: adminName.slice(0, 64),
          stateReason: reason,
        })
        .returning({ id: ipoSourceKeys.id });
      activeId = ins.id;
    }
    await tx
      .update(ipoSourceKeys)
      .set({ state: 'SUPERSEDED', supersededBy: activeId, stateChangedAt: now, stateReason: reason })
      .where(eq(ipoSourceKeys.id, k.id));
    moved.push(k.id);
  }
  return moved;
}

/**
 * Validate the new value and keep the old one. Returns `{ ok: false }` (caller refuses INVALID)
 * when another live IPO already carries the new value. A no-op when the value did not change.
 */
export async function keepReplacedIdentifier(tx: Db, input: IdentifierEditInput): Promise<IdentifierEditOutcome> {
  const { ipoId, fieldName, adminId, adminName } = input;
  const oldNorm = normalizeIdentifier(fieldName, input.oldValue);
  const newNorm = normalizeIdentifier(fieldName, input.newValue);
  const out = {
    ok: true as const, aliasId: null as string | null, supersededKeyIds: [] as string[], activeKeyId: null as string | null, moved: [] as IdentifierMove[],
  };
  if (oldNorm === newNorm) return out;

  if (newNorm !== null) {
    const [self] = await tx
      .select({ offeringType: ipos.offeringType, openDate: ipos.openDate, slug: ipos.slug })
      .from(ipos)
      .where(eq(ipos.id, ipoId))
      .limit(1);
    const holder = await holderElsewhere(tx, input, newNorm, self);
    if (holder) {
      // Two rows of different offering types are never merged (OD-35), so the merge advice is
      // given only when they could be one offering (Tier A review MAJOR-1).
      const typesDiffer = !!self?.offeringType && !!holder.offeringType && self.offeringType !== holder.offeringType;
      const advice = typesDiffer
        ? `check which offering the identifier belongs to (${self?.offeringType} vs ${holder.offeringType}; different offering types are never merged, OD-35)`
        : 'merge the two rows (OD-38) instead of giving both the same identifier';
      return { ok: false, reason: `ipos.${fieldName} ${newNorm} is already carried by another IPO: ${holder.label}; ${advice}` };
    }
    // #1290: no row binds the value on its own account; any admin-removed copy elsewhere moves here.
    out.moved = await moveAdminRemovedCopies(tx, input, newNorm, self?.slug ?? ipoId);
  }
  const reason = `${ADMIN_EDIT_REASON_PREFIX} ${fieldName} ${oldNorm ?? '(empty)'} -> ${newNorm ?? '(empty)'} by ${adminName}`;

  if (fieldName === 'bseIpoNo') {
    const now = await readDatabaseNow(tx);
    const mine = await tx
      .select()
      .from(ipoSourceKeys)
      .where(and(eq(ipoSourceKeys.ipoId, ipoId), eq(ipoSourceKeys.keyType, 'BSE_IPO_NO')));
    let activeId: string | null = null;
    if (newNorm !== null) {
      const existing = mine.find((k) => k.bindingValue === newNorm);
      if (existing) {
        await tx
          .update(ipoSourceKeys)
          .set({ state: 'ACTIVE', supersededBy: null, stateChangedAt: now, stateReason: reason })
          .where(eq(ipoSourceKeys.id, existing.id));
        activeId = existing.id;
      } else {
        const [ins] = await tx
          .insert(ipoSourceKeys)
          .values({
            ipoId,
            source: 'BSE',
            keyType: 'BSE_IPO_NO',
            keyValue: newNorm,
            bindingValue: newNorm,
            state: 'ACTIVE',
            boundVia: 'ADMIN_EDIT',
            boundBy: adminName.slice(0, 64),
            stateReason: reason,
          })
          .returning({ id: ipoSourceKeys.id });
        activeId = ins.id;
      }
    }
    for (const k of mine) {
      if (k.state !== 'ACTIVE' || k.id === activeId) continue;
      await tx
        .update(ipoSourceKeys)
        .set({ state: 'SUPERSEDED', supersededBy: activeId, stateChangedAt: now, stateReason: reason })
        .where(eq(ipoSourceKeys.id, k.id));
      out.supersededKeyIds.push(k.id);
    }
    // The old number was on the row but never keyed (a row older than the key backfill): key it now
    // as SUPERSEDED so a record still carrying it binds here, unless another row holds it.
    if (oldNorm !== null && !mine.some((k) => k.bindingValue === oldNorm)) {
      const heldElsewhere = await tx
        .select({ id: ipoSourceKeys.id })
        .from(ipoSourceKeys)
        .where(and(eq(ipoSourceKeys.keyType, 'BSE_IPO_NO'), eq(ipoSourceKeys.source, 'BSE'), eq(ipoSourceKeys.bindingValue, oldNorm)))
        .limit(1);
      if (heldElsewhere.length === 0) {
        const [ins] = await tx
          .insert(ipoSourceKeys)
          .values({
            ipoId,
            source: 'BSE',
            keyType: 'BSE_IPO_NO',
            keyValue: oldNorm,
            bindingValue: oldNorm,
            state: 'SUPERSEDED',
            supersededBy: activeId,
            boundVia: 'ADMIN_EDIT',
            boundBy: adminName.slice(0, 64),
            stateReason: reason,
          })
          .returning({ id: ipoSourceKeys.id });
        out.supersededKeyIds.push(ins.id);
      }
    }
    out.activeKeyId = activeId;
    return out;
  }

  if (fieldName === 'symbol' && oldNorm !== null && newNorm !== null) {
    out.supersededKeyIds.push(...(await moveNseKeys(tx, ipoId, oldNorm, newNorm, adminName, reason)));
  }
  if (oldNorm === null) return out;
  const kind = IDENTIFIER_ALIAS_FIELDS[fieldName];
  const already = await tx
    .select({ id: ipoIdentifierAliases.id })
    .from(ipoIdentifierAliases)
    .where(and(eq(ipoIdentifierAliases.ipoId, ipoId), eq(ipoIdentifierAliases.kind, kind), eq(ipoIdentifierAliases.value, oldNorm)))
    .limit(1);
  if (already[0]) {
    out.aliasId = already[0].id;
    return out;
  }
  const [alias] = await tx
    .insert(ipoIdentifierAliases)
    .values({ ipoId, kind, value: oldNorm, replacedByAdminId: adminId.slice(0, 64), reason })
    .returning({ id: ipoIdentifierAliases.id });
  out.aliasId = alias.id;
  return out;
}
