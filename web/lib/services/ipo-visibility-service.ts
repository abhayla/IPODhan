/**
 * §9.2 item 23 (OD-116 as corrected by OD-118): hide / unhide an IPO row. Never a delete.
 *
 * Hide stamps hidden_at + the written reason + the admin (name and account id) and writes the audit
 * row in the SAME transaction, so a hide without its reason and author cannot exist. The row's data
 * and its identifiers (ipo_source_keys) are untouched: the scraper keeps binding the row, so it is
 * never recreated, and writes nothing to it (IpoHiddenError). Unhide clears all four columns.
 *
 * A true duplicate is NOT hidden: it is merged with the OD-38 merge tool and gets an
 * ipo_slug_redirects row. A genuinely WITHDRAWN IPO keeps OD-8's notice page; an OFS row keeps
 * OD-53's. Hiding is for a row that should not exist for readers at all.
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { auditLogs, ipos } from '../db';
import type * as schema from '@ipodhan/shared/db/schema';

export const IPO_HIDDEN_ACTION = 'IPO Hidden';
export const IPO_UNHIDDEN_ACTION = 'IPO Unhidden';
export const HIDE_REASON_MIN_LENGTH = 5;
export const HIDE_REASON_MAX_LENGTH = 1000;

export interface VisibilityActor {
  adminName: string;
  adminId: string | null;
}

export type VisibilityOutcome =
  | { ok: true; ipoId: string; slug: string; hiddenAt: Date | null }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_HIDDEN' | 'NOT_HIDDEN' | 'REASON_REQUIRED'; message: string };

type Db = NodePgDatabase<typeof schema>;

export async function hideIpo(
  db: Db,
  input: { ipoId: string; reason: string; actor: VisibilityActor; now?: Date }
): Promise<VisibilityOutcome> {
  const reason = input.reason.trim();
  if (reason.length < HIDE_REASON_MIN_LENGTH) {
    return { ok: false, code: 'REASON_REQUIRED', message: `A written reason of at least ${HIDE_REASON_MIN_LENGTH} characters is required` };
  }
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: ipos.id, slug: ipos.slug, hiddenAt: ipos.hiddenAt }).from(ipos).where(eq(ipos.id, input.ipoId)).limit(1);
    if (!row) return { ok: false, code: 'NOT_FOUND', message: 'No such IPO' } as const;
    if (row.hiddenAt) return { ok: false, code: 'ALREADY_HIDDEN', message: 'This IPO is already hidden' } as const;
    const updated = await tx
      .update(ipos)
      .set({
        hiddenAt: now,
        hiddenReason: reason.slice(0, HIDE_REASON_MAX_LENGTH),
        hiddenBy: input.actor.adminName.slice(0, 100),
        hiddenByAdminId: input.actor.adminId,
      })
      .where(and(eq(ipos.id, input.ipoId), isNull(ipos.hiddenAt)))
      .returning({ id: ipos.id });
    if (updated.length !== 1) return { ok: false, code: 'ALREADY_HIDDEN', message: 'This IPO is already hidden' } as const;
    await tx.insert(auditLogs).values({
      adminUser: input.actor.adminName,
      actionType: IPO_HIDDEN_ACTION,
      ipoId: input.ipoId,
      tableName: 'ipos',
      fieldName: 'hidden_at',
      oldValue: null,
      newValue: reason.slice(0, HIDE_REASON_MAX_LENGTH),
      details: { action: 'IPO_HIDDEN', adminId: input.actor.adminId, slug: row.slug, spec: '§9.2 item 23, OD-116/OD-118' },
      success: true,
    });
    return { ok: true, ipoId: row.id, slug: row.slug, hiddenAt: now } as const;
  });
}

export async function unhideIpo(
  db: Db,
  input: { ipoId: string; actor: VisibilityActor; reason?: string }
): Promise<VisibilityOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: ipos.id, slug: ipos.slug, hiddenAt: ipos.hiddenAt, hiddenReason: ipos.hiddenReason })
      .from(ipos)
      .where(eq(ipos.id, input.ipoId))
      .limit(1);
    if (!row) return { ok: false, code: 'NOT_FOUND', message: 'No such IPO' } as const;
    if (!row.hiddenAt) return { ok: false, code: 'NOT_HIDDEN', message: 'This IPO is not hidden' } as const;
    const updated = await tx
      .update(ipos)
      .set({ hiddenAt: null, hiddenReason: null, hiddenBy: null, hiddenByAdminId: null })
      .where(and(eq(ipos.id, input.ipoId), isNotNull(ipos.hiddenAt)))
      .returning({ id: ipos.id });
    if (updated.length !== 1) return { ok: false, code: 'NOT_HIDDEN', message: 'This IPO is not hidden' } as const;
    await tx.insert(auditLogs).values({
      adminUser: input.actor.adminName,
      actionType: IPO_UNHIDDEN_ACTION,
      ipoId: input.ipoId,
      tableName: 'ipos',
      fieldName: 'hidden_at',
      oldValue: row.hiddenReason,
      newValue: null,
      details: { action: 'IPO_UNHIDDEN', adminId: input.actor.adminId, slug: row.slug, reason: input.reason?.trim() || null, spec: '§9.2 item 23' },
      success: true,
    });
    return { ok: true, ipoId: row.id, slug: row.slug, hiddenAt: null } as const;
  });
}
