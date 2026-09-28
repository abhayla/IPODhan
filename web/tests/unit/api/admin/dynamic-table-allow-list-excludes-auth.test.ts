/**
 * Tier A review C1 regression guard, written on the admin-accounts branch: the dynamic admin editor
 * must never resolve the auth tables (admin_users, admin_sessions) by name.
 *
 * ENABLE AT REBASE: web/lib/admin/dynamic-table-allow-list.ts lands with feat/a2-admin-write-path.
 * Until this branch is rebased onto it, the module is absent and this suite is skipped (runIf); after
 * the rebase it runs with no edit. If it still reports "skipped" after the rebase, the module moved:
 * fix the path, never delete the test.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MODULE_FILE = path.resolve(__dirname, '../../../../lib/admin/dynamic-table-allow-list.ts');
const AUTH_TABLE_NAMES = ['adminUsers', 'admin_users', 'adminSessions', 'admin_sessions', 'AdminUsers', 'adminUsers '];

describe.runIf(existsSync(MODULE_FILE))('dynamic table allow-list never reaches the auth tables', () => {
  it('resolves no auth table name, for read or write', async () => {
    const mod = await import(/* @vite-ignore */ pathToFileURL(MODULE_FILE).href);
    for (const name of AUTH_TABLE_NAMES) {
      expect(mod.resolveDynamicTable(name, 'read')).toBeNull();
      expect(mod.resolveDynamicTable(name, 'write')).toBeNull();
    }
    for (const listed of mod.DYNAMIC_TABLE_NAMES as string[]) {
      expect(listed.toLowerCase()).not.toContain('admin_user');
      expect(listed.toLowerCase()).not.toContain('adminuser');
      expect(listed.toLowerCase()).not.toContain('session');
    }
  });

  it('refuses prototype keys', async () => {
    const mod = await import(/* @vite-ignore */ pathToFileURL(MODULE_FILE).href);
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(mod.resolveDynamicTable(name, 'read')).toBeNull();
    }
  });
});
