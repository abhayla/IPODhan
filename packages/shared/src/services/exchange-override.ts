/**
 * OD-106 / OD-117 / §2.7 ("the only system releases of an admin hold are a relaunch (OD-120) and a
 * newer E-1 exchange value (OD-106, OD-117)") / §9.2 items 7 and 28(a).
 *
 * `applyExchangeOverride` is the ONE system path that replaces an admin-held value. In one
 * transaction, under the `ipos` row lock `writeAdminFieldValue` takes first (so an admin save and
 * this release serialise, §9.2 item 19), it:
 *   1. re-reads the hold and the admin's provenance row (a hold released or re-saved since the walk
 *      read the sources is judged on what is stored NOW);
 *   2. decides with `decideExchangeOverride` (exchange-override-rule.ts): the exchange's answer
 *      must differ from the admin value AND from what that exchange said at the admin's save. A
 *      hold saved before `exchangeAtSave` was recorded has an UNKNOWN baseline: it is rebuilt from
 *      the ADMIN row's `previous_value` when `previous_source` is that exchange, otherwise this
 *      held read's answer is stored as the baseline (no replacement on this read). Either is
 *      written to the ADMIN row's lineage in THIS transaction, so the next read compares with it;
 *   3. writes the exchange value, with the exchange as its `field_sources` source (the keep-ADMIN
 *      rule of FieldSourcesRepository is bypassed deliberately, for this path only); the admin's
 *      value stays as `previous_value` and in the audit row;
 *   4. releases the hold (is_protected = false; the row and its edit note are kept);
 *   5. writes an audit row, actor SYSTEM, reason OD-106, with the admin and exchange values.
 * The alert is NOT sent here: a rolled-back release must not alert. The caller sends it after
 * commit from the returned facts (`scraper/src/services/exchange-override-hook.ts`).
 */
import { and, eq, getTableColumns, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema';
import { auditLogs, fieldProtectionMetadata, fieldSources, ipoDetails } from '../db/schema';
import { protectionTableName } from './field-hold';
import {
  decideExchangeOverride,
  isExchangeOverrideField,
  normalizeExchangeValue,
  resolveExchangeBaseline,
  type ExchangeAnswer,
  type ExchangeBaseline,
  type ExchangeBaselineOrigin,
  type ExchangeOverrideSource,
} from './exchange-override-rule';

type Db = NodePgDatabase<typeof schema>;

export const EXCHANGE_OVERRIDE_ACTOR = 'SYSTEM';
export const EXCHANGE_OVERRIDE_AUDIT_ACTION = 'Exchange Override';

export interface ExchangeOverrideInput {
  ipoId: string;
  tableName: string;
  /** '' on a one-row table (the only kind this path writes). */
  rowKey: string;
  /** camelCase, as field_sources and field_protection_metadata store it. */
  fieldName: string;
  /** This pass's ranked answers (witness shape). */
  answers: readonly ExchangeAnswer[];
  now?: Date;
}

export type ExchangeOverrideResult =
  | {
      kind: 'REPLACED';
      ipoId: string;
      slug: string;
      companyName: string;
      status: string;
      tableName: string;
      fieldName: string;
      source: ExchangeOverrideSource;
      adminValue: unknown;
      exchangeValue: unknown;
      exchangeAtSave: ExchangeBaseline | null;
      auditId: string;
    }
  | { kind: 'SKIPPED'; reason: string; baselineRecorded?: ExchangeBaseline };

function stringify(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function tableOf(tableName: string): (PgTable & Record<string, unknown>) | null {
  if (tableName === 'ipos') return schema.ipos as never;
  if (tableName === 'ipo_details') return ipoDetails as never;
  return null;
}

export async function applyExchangeOverride(db: Db, input: ExchangeOverrideInput): Promise<ExchangeOverrideResult> {
  const { ipoId, tableName, fieldName } = input;
  const rowKey = input.rowKey ?? '';
  if (rowKey !== '' || !isExchangeOverrideField(tableName, fieldName)) {
    return { kind: 'SKIPPED', reason: `${tableName}.${fieldName}${rowKey ? ` row ${rowKey}` : ''} is not an OD-106 override field` };
  }
  const table = tableOf(tableName)!;
  const cols = getTableColumns(table) as unknown as Record<string, { columnType: string; name: string }>;
  const column = cols[fieldName];
  if (!column) return { kind: 'SKIPPED', reason: `${tableName} has no field ${fieldName}` };
  const now = input.now ?? new Date();

  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const locked = await tx.execute(
      sql`SELECT slug, company_name, status::text AS status FROM ipos WHERE id = ${ipoId}::uuid FOR NO KEY UPDATE`
    );
    const ipo = locked.rows[0] as { slug?: string; company_name?: string; status?: string } | undefined;
    if (!ipo?.slug) return { kind: 'SKIPPED', reason: `IPO ${ipoId} not found` } as const;

    const holdTable = protectionTableName(tableName, rowKey);
    const [hold] = await tx
      .select({ id: fieldProtectionMetadata.id })
      .from(fieldProtectionMetadata)
      .where(
        and(
          eq(fieldProtectionMetadata.ipoId, ipoId),
          eq(fieldProtectionMetadata.tableName, holdTable),
          eq(fieldProtectionMetadata.fieldName, fieldName),
          eq(fieldProtectionMetadata.isProtected, true)
        )
      )
      .limit(1);
    if (!hold) return { kind: 'SKIPPED', reason: 'no admin hold on the field any more' } as const;

    const [provenance] = await tx
      .select({
        id: fieldSources.id,
        source: fieldSources.source,
        lineage: fieldSources.dataLineage,
        previousSource: fieldSources.previousSource,
        previousValue: fieldSources.previousValue,
      })
      .from(fieldSources)
      .where(
        and(
          eq(fieldSources.ipoId, ipoId),
          eq(fieldSources.tableName, tableName),
          eq(fieldSources.rowKey, rowKey),
          eq(fieldSources.fieldName, fieldName)
        )
      )
      .limit(1);
    const resolved = provenance ? resolveExchangeBaseline(provenance) : null;
    if (!resolved) return { kind: 'SKIPPED', reason: 'NO_ADMIN_PROVENANCE' } as const;
    const priorOrigin = ((provenance!.lineage ?? {}) as { exchangeBaselineOrigin?: Record<string, ExchangeBaselineOrigin> })
      .exchangeBaselineOrigin;

    const rowWhere = tableName === 'ipos' ? eq((cols as never as { id: never }).id, ipoId as never) : eq((cols as never as { ipoId: never }).ipoId, ipoId as never);
    const current = (await tx.select({ v: cols[fieldName] as never }).from(table as never).where(rowWhere).limit(1)) as Array<{ v: unknown }>;
    if (current.length === 0) return { kind: 'SKIPPED', reason: `${tableName} has no row for IPO ${ipoId}` } as const;
    const adminValue = current[0].v ?? null;

    const decision = decideExchangeOverride({ adminValue, exchangeAtSave: resolved.baseline, answers: input.answers });
    const recorded = decision.kind === 'KEEP' ? decision.baseline ?? {} : {};
    const exchangeAtSave: ExchangeBaseline = { ...resolved.baseline, ...recorded };
    const origin: Record<string, ExchangeBaselineOrigin> = { ...(priorOrigin ?? {}) };
    for (const src of resolved.rebuilt) origin[src] = 'PREVIOUS_VALUE';
    for (const src of Object.keys(recorded)) origin[src] = 'FIRST_HELD_READ';

    if (decision.kind === 'KEEP') {
      // A baseline that was unknown and is now known (rebuilt or first-read) is stored on the ADMIN
      // row in this transaction, under the same lock as the read, so the next held read compares
      // with it. `exchangeAtSave` is replaced whole by the admin's next save (jsonb ||).
      if (resolved.rebuilt.length > 0 || Object.keys(recorded).length > 0) {
        await tx
          .update(fieldSources)
          .set({
            dataLineage: sql`COALESCE(${fieldSources.dataLineage}, '{}'::jsonb) || ${JSON.stringify({
              exchangeAtSave,
              exchangeBaselineOrigin: origin,
              exchangeBaselineAt: now.toISOString(),
            })}::jsonb`,
          })
          .where(and(eq(fieldSources.id, provenance!.id), eq(fieldSources.source, 'ADMIN')));
      }
      return {
        kind: 'SKIPPED',
        reason: decision.reason,
        ...(Object.keys(recorded).length > 0 ? { baselineRecorded: recorded } : {}),
      } as const;
    }

    // Every OD-106 field is a date column; it takes the IST day as YYYY-MM-DD (a Date's own
    // .toISOString() day is the UTC one, ist-timezone.md). Not imported from admin-field-write so
    // the scraper's walk deps do not load the admin module's table map.
    const isDateColumn = column.columnType === 'PgDateString' || column.columnType === 'PgDate';
    const exchangeValue = normalizeExchangeValue(decision.value);
    if (!isDateColumn || exchangeValue === null || !/^\d{4}-\d{2}-\d{2}$/.test(exchangeValue)) {
      return {
        kind: 'SKIPPED',
        reason: `${decision.source}'s value ${JSON.stringify(decision.value)} for ${tableName}.${fieldName} is not a date this path writes`,
      } as const;
    }

    await tx
      .update(table as never)
      .set({ [fieldName]: exchangeValue, updatedAt: now } as never)
      .where(rowWhere);

    const overrideLineage = {
      method: 'EXCHANGE_OVERRIDE',
      rule: 'OD-106',
      source: decision.source,
      exchangeValue: stringify(exchangeValue),
      adminValue: stringify(adminValue),
      exchangeAtSave,
      ...(resolved.rebuilt.length > 0 ? { exchangeBaselineOrigin: origin } : {}),
      releasedHoldAt: now.toISOString(),
    };
    // Deliberately a direct upsert: FieldSourcesRepository keeps an ADMIN row's attribution against
    // every other writer (§9.2 item 19); OD-106 is the one case the exchange takes it back.
    await tx
      .insert(fieldSources)
      .values({
        ipoId,
        tableName,
        rowKey,
        fieldName,
        source: decision.source,
        confidence: 100,
        previousValue: stringify(adminValue),
        previousSource: provenance?.source ?? null,
        dataLineage: overrideLineage,
        updatedBy: EXCHANGE_OVERRIDE_ACTOR,
        updatedAt: now,
        createdAt: now,
      } as never)
      .onConflictDoUpdate({
        target: [fieldSources.ipoId, fieldSources.tableName, fieldSources.rowKey, fieldSources.fieldName],
        set: {
          source: decision.source,
          confidence: 100,
          previousValue: stringify(adminValue),
          previousSource: provenance?.source ?? null,
          dataLineage: sql`COALESCE(${fieldSources.dataLineage}, '{}'::jsonb) || ${JSON.stringify(overrideLineage)}::jsonb`,
          updatedBy: EXCHANGE_OVERRIDE_ACTOR,
          updatedAt: now,
        } as never,
      });

    await tx
      .update(fieldProtectionMetadata)
      .set({
        isProtected: false,
        autoProtected: false,
        editNote: `Released by OD-106: ${decision.source} now says ${stringify(exchangeValue)} (admin had ${stringify(adminValue) ?? 'empty'})`,
        updatedAt: now,
      })
      .where(eq(fieldProtectionMetadata.id, hold.id));

    const [audit] = await tx
      .insert(auditLogs)
      .values({
        timestamp: now,
        adminUser: EXCHANGE_OVERRIDE_ACTOR,
        actionType: EXCHANGE_OVERRIDE_AUDIT_ACTION,
        ipoId,
        tableName,
        fieldName,
        oldValue: stringify(adminValue),
        newValue: stringify(exchangeValue),
        details: { reason: 'OD-106', ...overrideLineage, rowKey },
        success: true,
        createdAt: now,
      })
      .returning({ id: auditLogs.id });

    return {
      kind: 'REPLACED',
      ipoId,
      slug: ipo.slug,
      companyName: ipo.company_name ?? ipo.slug,
      status: ipo.status ?? 'UNKNOWN',
      tableName,
      fieldName,
      source: decision.source,
      adminValue,
      exchangeValue,
      exchangeAtSave,
      auditId: audit.id,
    } as const;
  });
}
