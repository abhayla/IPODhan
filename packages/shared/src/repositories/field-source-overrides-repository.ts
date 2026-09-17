/**
 * Repository for `field_source_overrides` (item 3 slice S4, layer 2 of the three-layer field
 * source policy). Plain CRUD-ish helpers over the table — validation (capable source, S-05,
 * distinct ranks, reason length) lives in the CLI (`scraper/scripts/field-source-override.ts`)
 * and the resolver's precedence rule lives in `scraper/src/config/field-source-policy.ts`, not
 * here. This module's only job is talking to the table, including tolerating its absence.
 */
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.js';
import { fieldSourceOverrides, type FieldSourceOverride, type NewFieldSourceOverride } from '../db/schema.js';

/** Postgres error code for "relation does not exist" (undefined_table). */
const UNDEFINED_TABLE = '42P01';

export function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === UNDEFINED_TABLE;
}

export interface FieldSourceOverridesRepositoryDeps {
  db: NodePgDatabase<typeof schema>;
  /** Called once per process the FIRST time the table is found absent — never per query. */
  onTableAbsent?: (context: string) => void;
}

export class FieldSourceOverridesRepository {
  private warnedAbsent = false;

  constructor(private readonly deps: FieldSourceOverridesRepositoryDeps) {}

  private warnAbsentOnce(context: string): void {
    if (this.warnedAbsent) return;
    this.warnedAbsent = true;
    (this.deps.onTableAbsent ?? ((c: string) => console.warn(
      `field_source_overrides: table absent (${c}) — layer 2 is not migrated in this database; ` +
      `resolving as if no override exists.`
    )))(context);
  }

  /**
   * Every currently-active row (not expired, not administratively expired) for a
   * (table, field) pair, newest `setAt` first — the caller (the resolver) picks the ipo-scoped
   * row over the global one itself (S4 precedence rule), so this returns BOTH candidates.
   * Returns [] (never throws) when the table does not exist — S4's single most important
   * safety property.
   */
  async listActiveFor(tableName: string, fieldName: string, now: Date = new Date()): Promise<FieldSourceOverride[]> {
    try {
      return await this.deps.db
        .select()
        .from(fieldSourceOverrides)
        .where(
          and(
            eq(fieldSourceOverrides.tableName, tableName),
            eq(fieldSourceOverrides.fieldName, fieldName),
            isNull(fieldSourceOverrides.expiredAt),
            sql`${fieldSourceOverrides.expiresAt} > ${now.toISOString()}`
          )
        )
        .orderBy(desc(fieldSourceOverrides.setAt));
    } catch (err) {
      if (isMissingTableError(err)) {
        this.warnAbsentOnce('listActiveFor');
        return [];
      }
      throw err;
    }
  }

  /** Every active override, for the CLI's `list` and the nightly PULL-OVERRIDES check. */
  async listActive(now: Date = new Date()): Promise<FieldSourceOverride[]> {
    try {
      return await this.deps.db
        .select()
        .from(fieldSourceOverrides)
        .where(
          and(
            isNull(fieldSourceOverrides.expiredAt),
            sql`${fieldSourceOverrides.expiresAt} > ${now.toISOString()}`
          )
        )
        .orderBy(desc(fieldSourceOverrides.setAt));
    } catch (err) {
      if (isMissingTableError(err)) {
        this.warnAbsentOnce('listActive');
        return [];
      }
      throw err;
    }
  }

  async set(row: NewFieldSourceOverride): Promise<FieldSourceOverride> {
    const [inserted] = await this.deps.db.insert(fieldSourceOverrides).values(row).returning();
    if (!inserted) {
      throw new Error('field_source_overrides: insert returned no row.');
    }
    return inserted;
  }

  async expire(id: string, now: Date = new Date()): Promise<FieldSourceOverride | null> {
    const [updated] = await this.deps.db
      .update(fieldSourceOverrides)
      .set({ expiredAt: now })
      .where(eq(fieldSourceOverrides.id, id))
      .returning();
    return updated ?? null;
  }

  async findById(id: string): Promise<FieldSourceOverride | null> {
    const [row] = await this.deps.db.select().from(fieldSourceOverrides).where(eq(fieldSourceOverrides.id, id));
    return row ?? null;
  }
}
