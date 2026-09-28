/**
 * The ONLY tables the dynamic admin editor may address, by name (Tier A review C1 on the
 * admin-accounts branch). The dynamic routes used to resolve `(schema as any)[tableName]`, which
 * would hand any admin the auth tables (admin_users, admin_sessions: is_owner, disabled_at,
 * password_hash) the moment they exist. A name not listed here resolves to nothing -> 404.
 *
 * READ_ONLY tables may be listed and read but never written through the dynamic editor:
 * field_protection_metadata holds admin holds (spec §9.2 item 11, OD-121 — never released by a
 * row edit) and audit_logs is the audit trail.
 */
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@ipodhan/shared/db/schema';

const WRITABLE: Record<string, PgTable> = {
  ipos: schema.ipos,
  subscriptions: schema.subscriptions,
  gmpRecords: schema.gmpRecords,
  financialData: schema.financialData,
  documents: schema.documents,
  listingPerformance: schema.listingPerformance,
  marketHolidays: schema.marketHolidays,
  registrars: schema.registrars,
  peerCompanies: schema.peerCompanies,
  brokerAffiliates: schema.brokerAffiliates,
  affiliateClicks: schema.affiliateClicks,
  scraperLogs: schema.scraperLogs,
  extractionLogs: schema.extractionLogs,
} as never;

const READ_ONLY: Record<string, PgTable> = {
  fieldProtectionMetadata: schema.fieldProtectionMetadata,
  auditLogs: schema.auditLogs,
} as never;

export const DYNAMIC_TABLE_NAMES: readonly string[] = [...Object.keys(WRITABLE), ...Object.keys(READ_ONLY)];

/** The table for a URL name, or null (-> 404). `write` excludes the read-only tables. */
export function resolveDynamicTable(name: string, mode: 'read' | 'write'): PgTable | null {
  if (typeof name !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(WRITABLE, name)) return WRITABLE[name] ?? null;
  if (mode === 'read' && Object.prototype.hasOwnProperty.call(READ_ONLY, name)) return READ_ONLY[name] ?? null;
  return null;
}
