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
 * A new value another live IPO already carries (as a live column or an ACTIVE/SUPERSEDED source key)
 * is refused and the other IPO is named: saving it would bind two rows to one identifier. For CIN,
 * which names the COMPANY, only another row that could be the SAME offering refuses (not ended, not
 * a different offering type, open dates within OD-35's 180 days) — a company's later OFS or rights
 * row legitimately shares its CIN (`resolveByCin`).
 *
 * Runs INSIDE `writeAdminFieldValue`'s transaction, after the `ipos` row lock, so the alias and the
 * value commit or roll back together.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { ipoIdentifierAliases, ipoSourceKeys, ipos } from '../db/schema';
import { normalizeCin } from '../utils/cin';
import { ENDED_STATUSES } from '../repositories/ipo-source-keys';

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
  | { ok: true; aliasId: string | null; supersededKeyIds: string[]; activeKeyId: string | null }
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

/** Another live IPO that already carries `value` for this identifier, or null. */
async function holderElsewhere(tx: Db, input: IdentifierEditInput, value: string): Promise<string | null> {
  const { ipoId, fieldName } = input;
  const notEnded = sql`${ipos.status}::text NOT IN (${sql.join(ENDED_STATUSES.map((s) => sql`${s}`), sql`, `)})`;

  if (fieldName === 'bseIpoNo') {
    const keys = await tx
      .select({ ipoId: ipoSourceKeys.ipoId, slug: ipos.slug, state: ipoSourceKeys.state })
      .from(ipoSourceKeys)
      .innerJoin(ipos, eq(ipos.id, ipoSourceKeys.ipoId))
      .where(
        and(
          eq(ipoSourceKeys.keyType, 'BSE_IPO_NO'),
          eq(ipoSourceKeys.bindingValue, value),
          inArray(ipoSourceKeys.state, ['ACTIVE', 'SUPERSEDED']),
          ne(ipoSourceKeys.ipoId, ipoId)
        )
      )
      .limit(1);
    if (keys[0]) return `${keys[0].slug} (${keys[0].state} source key BSE_IPO_NO ${value})`;
    const rows = await tx
      .select({ slug: ipos.slug })
      .from(ipos)
      .where(and(eq(ipos.bseIpoNo, Number(value)), ne(ipos.id, ipoId), notEnded))
      .limit(1);
    return rows[0] ? `${rows[0].slug} (bse_ipo_no ${value})` : null;
  }

  if (fieldName === 'cin') {
    const [self] = await tx
      .select({ offeringType: ipos.offeringType, openDate: ipos.openDate })
      .from(ipos)
      .where(eq(ipos.id, ipoId))
      .limit(1);
    const others = await tx
      .select({ slug: ipos.slug, offeringType: ipos.offeringType, openDate: ipos.openDate })
      .from(ipos)
      .where(and(sql`upper(trim(${ipos.cin})) = ${value}`, ne(ipos.id, ipoId), notEnded, sql`${ipos.status}::text <> 'WITHDRAWN'`));
    const selfDay = dayOf(self?.openDate);
    const sameOffering = others.find((o) => {
      if (self?.offeringType && o.offeringType && self.offeringType !== o.offeringType) return false;
      const d = dayOf(o.openDate);
      return !(selfDay && d && daysApart(selfDay, d) > SAME_OFFERING_WINDOW_DAYS);
    });
    return sameOffering ? `${sameOffering.slug} (cin ${value}, same offering type and within ${SAME_OFFERING_WINDOW_DAYS} days)` : null;
  }

  const column = fieldName === 'isin' ? ipos.isin : ipos.symbol;
  const rows = await tx
    .select({ slug: ipos.slug })
    .from(ipos)
    .where(and(sql`upper(trim(${column})) = ${value}`, ne(ipos.id, ipoId), notEnded))
    .limit(1);
  if (rows[0]) return `${rows[0].slug} (${fieldName} ${value})`;
  if (fieldName === 'symbol') {
    const keys = await tx
      .select({ slug: ipos.slug, bindingValue: ipoSourceKeys.bindingValue })
      .from(ipoSourceKeys)
      .innerJoin(ipos, eq(ipos.id, ipoSourceKeys.ipoId))
      .where(
        and(
          eq(ipoSourceKeys.keyType, 'NSE_ISSUE'),
          eq(ipoSourceKeys.state, 'ACTIVE'),
          sql`split_part(${ipoSourceKeys.bindingValue}, '|', 1) = ${value}`,
          ne(ipoSourceKeys.ipoId, ipoId)
        )
      )
      .limit(1);
    if (keys[0]) return `${keys[0].slug} (ACTIVE source key NSE_ISSUE ${keys[0].bindingValue})`;
  }
  return null;
}

/**
 * Validate the new value and keep the old one. Returns `{ ok: false }` (caller refuses INVALID)
 * when another live IPO already carries the new value. A no-op when the value did not change.
 */
export async function keepReplacedIdentifier(tx: Db, input: IdentifierEditInput): Promise<IdentifierEditOutcome> {
  const { ipoId, fieldName, adminId, adminName } = input;
  const oldNorm = normalizeIdentifier(fieldName, input.oldValue);
  const newNorm = normalizeIdentifier(fieldName, input.newValue);
  const out = { ok: true as const, aliasId: null as string | null, supersededKeyIds: [] as string[], activeKeyId: null as string | null };
  if (oldNorm === newNorm) return out;

  if (newNorm !== null) {
    const holder = await holderElsewhere(tx, input, newNorm);
    if (holder) {
      return {
        ok: false,
        reason: `ipos.${fieldName} ${newNorm} is already carried by another IPO: ${holder}; merge the two rows (OD-38) instead of giving both the same identifier`,
      };
    }
  }
  const reason = `admin_edit: ${fieldName} ${oldNorm ?? '(empty)'} -> ${newNorm ?? '(empty)'} by ${adminName}`;

  if (fieldName === 'bseIpoNo') {
    const now = new Date();
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
