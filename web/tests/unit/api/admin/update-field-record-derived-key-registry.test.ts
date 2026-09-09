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
 * This test closes that blind spot two ways for every table the admin route
 * can write to (`documents`, `peer_companies`, `ipo_reviews` — the
 * `RECORD_TABLE_MAP` keys):
 *
 * 1. Registry presence: any of those tables that gains a `normalized_name`
 *    DB column in `packages/shared/src/db/schema.ts` — under ANY Drizzle
 *    column helper (`varchar`, `text`, or a future one), matched by the
 *    quoted DB column name rather than by helper name so a new helper can't
 *    reopen this hole — MUST have a matching entry in `DERIVED_KEY_FIELDS`.
 * 2. Wiring: every entry that IS in `DERIVED_KEY_FIELDS` must actually be
 *    applied by that table's branch in the route's update `.set({...})`
 *    call (spreading `...derivedFieldUpdate`). A registry entry with no
 *    schema column, or a registry entry whose branch never spreads the
 *    derived update, proves nothing about correctness — the PATCH handler
 *    is what has to apply it. Checked by reading the route source and
 *    verifying the `if (tableName === '<table>')` branch text contains the
 *    spread; a behavioural test per table is the alternative but would
 *    require seeding real rows for all three record tables through
 *    `withAdminAuth`, which is materially heavier for the same guarantee.
 *
 * Today only `peer_companies` has a `normalized_name` column, it has a
 * registry entry, and that entry is wired into the `peer_companies` branch.
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

// Matches a `normalized_name` DB column regardless of the Drizzle column
// helper used to declare it (varchar, text, or any future helper) — keys
// on the quoted DB column name, which is what the migration and the DB
// actually see, not on the TypeScript helper name.
function hasNormalizedNameDbColumn(tableSrc: string): boolean {
  return /:\s*\w+\(\s*['"]normalized_name['"]/.test(tableSrc);
}

// Extracts the top-level table keys of the `DERIVED_KEY_FIELDS` object
// literal (2-space-indented `tableName: {` lines) — independent of the
// hardcoded ADMIN_WRITABLE_TABLES list, so an entry for any table is found.
function derivedKeyFieldsTables(routeSrc: string): string[] {
  const marker = '> = {';
  const declStart = routeSrc.indexOf('const DERIVED_KEY_FIELDS');
  expect(declStart, 'route.ts has no DERIVED_KEY_FIELDS declaration').toBeGreaterThan(-1);
  const literalStart = routeSrc.indexOf(marker, declStart);
  expect(literalStart, 'DERIVED_KEY_FIELDS object literal start not found').toBeGreaterThan(-1);
  const braceStart = literalStart + marker.length - 1; // index of the `{`

  let depth = 0;
  let i = braceStart;
  for (; i < routeSrc.length; i++) {
    if (routeSrc[i] === '{') depth++;
    else if (routeSrc[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = routeSrc.slice(braceStart + 1, i);

  const tables: string[] = [];
  const keyRe = /^\s{2}(\w+):\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(body)) !== null) {
    tables.push(m[1]);
  }
  return tables;
}

// Bounds the `if (tableName === '<dbTableName>') { ... }` (or `else if`)
// branch text in the route's update block, by brace-matching from the
// first `{` after the condition.
function routeBranchSource(routeSrc: string, dbTableName: string): string {
  const marker = `tableName === '${dbTableName}'`;
  const condIdx = routeSrc.indexOf(marker);
  expect(condIdx, `route.ts has no "${marker}" branch condition`).toBeGreaterThan(-1);
  const braceStart = routeSrc.indexOf('{', condIdx);
  expect(braceStart, `no branch body found after "${marker}"`).toBeGreaterThan(-1);

  let depth = 0;
  let i = braceStart;
  for (; i < routeSrc.length; i++) {
    if (routeSrc[i] === '{') depth++;
    else if (routeSrc[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return routeSrc.slice(braceStart, i + 1);
}

describe('admin update-field-record DERIVED_KEY_FIELDS registry stays in lock-step with schema.ts', () => {
  const schemaSrc = readFileSync(SCHEMA_PATH, 'utf-8');
  const routeSrc = readFileSync(ROUTE_PATH, 'utf-8');

  it.each(Object.entries(ADMIN_WRITABLE_TABLES))(
    'table "%s" (schema export %s): a normalized_name column requires a DERIVED_KEY_FIELDS entry',
    (dbTableName, schemaExportName) => {
      const tableSrc = tableDefinitionSource(schemaSrc, schemaExportName);

      if (!hasNormalizedNameDbColumn(tableSrc)) {
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

  const registeredTables = derivedKeyFieldsTables(routeSrc);

  it('DERIVED_KEY_FIELDS has at least one entry to check wiring for', () => {
    // Sanity check that extraction itself works — if this goes empty while
    // peer_companies still has a real entry, the extractor regressed and
    // the wiring test below would silently check nothing.
    expect(registeredTables.length).toBeGreaterThan(0);
  });

  it.each(registeredTables)(
    'DERIVED_KEY_FIELDS entry for table "%s" is applied by its route branch (spreads ...derivedFieldUpdate)',
    (dbTableName) => {
      const branchSrc = routeBranchSource(routeSrc, dbTableName);
      const appliesDerivedUpdate = /\.\.\.derivedFieldUpdate/.test(branchSrc);
      expect(
        appliesDerivedUpdate,
        `DERIVED_KEY_FIELDS has an entry for "${dbTableName}" but the ` +
          `tableName === '${dbTableName}' branch in ` +
          `web/app/api/admin/update-field-record/route.ts never spreads ` +
          `...derivedFieldUpdate into its .set({...}) call — the derived ` +
          `column would go stale`
      ).toBe(true);
    }
  );
});
