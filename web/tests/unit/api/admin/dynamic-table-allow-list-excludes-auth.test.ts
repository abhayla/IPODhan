/**
 * Tier A review C1 regression guard (admin-accounts branch, spec §9.2 item 6): the dynamic admin
 * editor must never resolve the auth tables (admin_users, admin_sessions) — not by their own names,
 * and not under any alias key. The second case checks every table the allow-list can hand out by
 * its real Postgres name, so listing `accounts: schema.adminUsers` fails too.
 */
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { DYNAMIC_TABLE_NAMES, resolveDynamicTable } from '@/lib/admin/dynamic-table-allow-list';

const AUTH_TABLE_NAMES = ['adminUsers', 'admin_users', 'adminSessions', 'admin_sessions', 'AdminUsers', 'adminUsers '];
const AUTH_PG_TABLES = new Set(['admin_users', 'admin_sessions']);

describe('dynamic table allow-list never reaches the auth tables', () => {
  it('resolves no auth table name, for read or write', () => {
    for (const name of AUTH_TABLE_NAMES) {
      expect(resolveDynamicTable(name, 'read')).toBeNull();
      expect(resolveDynamicTable(name, 'write')).toBeNull();
    }
  });

  it('hands out no auth table under any listed key (checked by the real Postgres table name)', () => {
    expect(DYNAMIC_TABLE_NAMES.length).toBeGreaterThan(0);
    for (const key of DYNAMIC_TABLE_NAMES) {
      const table = resolveDynamicTable(key, 'read');
      expect(table, key).not.toBeNull();
      expect(AUTH_PG_TABLES.has(getTableConfig(table!).name), `${key} -> ${getTableConfig(table!).name}`).toBe(false);
    }
  });

  it('refuses prototype keys', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(resolveDynamicTable(name, 'read')).toBeNull();
    }
  });
});
