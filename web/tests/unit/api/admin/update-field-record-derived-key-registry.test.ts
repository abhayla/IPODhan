// implements: R-158
/**
 * Guard for the `DERIVED_KEY_FIELDS` registry in
 * `web/app/api/admin/update-field-record/route.ts` (item 01 slice s1b).
 *
 * The route kept `NON_EDITABLE_FIELDS` as a denylist rather than becoming a
 * full allowlist (that table covers three tables with different editable
 * shapes — out of scope for this slice). The blind spot a denylist has is
 * silent: a future editable column whose value another column is DERIVED
 * from (the way `peer_companies.normalizedName` is derived from
 * `companyName`) can be added without anyone updating the recompute logic,
 * quietly reintroducing the stale-key bug this slice fixes.
 *
 * This test closes that blind spot for every table the admin route can
 * write to (`documents`, `peer_companies`, `ipo_reviews` — the
 * `RECORD_TABLE_MAP` keys): any of those tables that gains a
 * `normalized_name` (or `normalizedName`) column in
 * `packages/shared/src/db/schema.ts` MUST have a matching entry in
 * `DERIVED_KEY_FIELDS`, keyed by the same table name. Today only
 * `peer_companies` has such a column, and it does have an entry.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA_PATH = join(__dirname, '../../../../../packages/shared/src/db/schema.ts');
const ROUTE_PATH = join(__dirname, '../../../../app/api/admin/update-field-record/route.ts');

// RECORD_TABLE_MAP keys (route DB-table name -> schema.ts export name).
const ADMIN_WRITABLE_TABLES: Record<string, string> = {
  documents: 'documents',
  peer_companies: 'peerCompanies',
  ipo_reviews: 'ipoReviews',
};

function tableDefinitionSource(schemaSrc: string, exportName: string): string {
  const start = schemaSrc.indexOf(`export const ${exportName} = pgTable(`);
  expect(start, `schema.ts export "${exportName}" not found`).toBeGreaterThan(-1);
  // The next `export const ... = pgTable(` (or EOF) bounds this table's block.
  const nextExportMatch = schemaSrc.slice(start + 1).search(/export const \w+ = pgTable\(/);
  const end = nextExportMatch === -1 ? schemaSrc.length : start + 1 + nextExportMatch;
  return schemaSrc.slice(start, end);
}

describe('admin update-field-record DERIVED_KEY_FIELDS registry stays in lock-step with schema.ts', () => {
  const schemaSrc = readFileSync(SCHEMA_PATH, 'utf-8');
  const routeSrc = readFileSync(ROUTE_PATH, 'utf-8');

  it.each(Object.entries(ADMIN_WRITABLE_TABLES))(
    'table "%s" (schema export %s): a normalized_name column requires a DERIVED_KEY_FIELDS entry',
    (dbTableName, schemaExportName) => {
      const tableSrc = tableDefinitionSource(schemaSrc, schemaExportName);
      const hasNormalizedNameColumn = /normalizedName\s*:\s*varchar\(\s*['"]normalized_name['"]/.test(
        tableSrc
      );

      if (!hasNormalizedNameColumn) {
        // Nothing to guard for this table today.
        return;
      }

      const registryHasEntry = new RegExp(
        `DERIVED_KEY_FIELDS[\\s\\S]*?\\b${dbTableName}\\s*:\\s*\\{`
      ).test(routeSrc);
      expect(
        registryHasEntry,
        `schema.ts added a normalized_name column to "${dbTableName}" but ` +
          `web/app/api/admin/update-field-record/route.ts DERIVED_KEY_FIELDS has no entry for it`
      ).toBe(true);
    }
  );
});
