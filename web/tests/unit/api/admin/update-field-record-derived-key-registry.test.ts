// implements: R-158
/**
 * Guard for the row-key derivation registry of the ONE admin write
 * (`packages/shared/src/services/admin-field-write.ts`, `ROW_TABLES[*].derived`, read through
 * `rowTableDerivedKey`). Round 3 of contract 2 item A2 moved update-field-record onto that
 * function, so the registry the route used to keep (`DERIVED_KEY_FIELDS`) now lives there.
 *
 * Two checks for every table the admin may edit row by row (`ADMIN_ROW_TABLES`) and for the
 * retired ipo_reviews table:
 * 1. Registry presence: a table with a `normalized_name` DB column in schema.ts (any Drizzle
 *    helper, matched by the quoted DB column name) MUST derive it (`derivedField: normalizedName`).
 * 2. Wiring: the derivation is applied by the function itself — a rename of the source field to a
 *    name with no identity is refused before any database access (behavioural, not a text match),
 *    and the derived column itself is not editable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ADMIN_ROW_TABLES,
  rowTableDerivedKey,
  writeAdminFieldValue,
} from '@ipodhan/shared/services/admin-field-write';

const SCHEMA_PATH = join(__dirname, '../../../../../packages/shared/src/db/schema.ts');
const SCHEMA_EXPORT: Record<string, string> = {
  documents: 'documents',
  peer_companies: 'peerCompanies',
  ipo_reviews: 'ipoReviews',
};

function tableDefinitionSource(schemaSrc: string, exportName: string): string {
  const start = schemaSrc.indexOf(`export const ${exportName} = pgTable(`);
  expect(start, `schema.ts export "${exportName}" not found`).toBeGreaterThan(-1);
  const next = schemaSrc.slice(start + 1).search(/export const \w+ = pgTable\(/);
  return schemaSrc.slice(start, next === -1 ? schemaSrc.length : start + 1 + next);
}

const hasNormalizedNameDbColumn = (src: string) => /:\s*\w+\(\s*['"]normalized_name['"]/.test(src);

const untouchable = new Proxy({}, {
  get: () => {
    throw new Error('db touched before validation finished');
  },
}) as never;

describe('admin row-table key derivation registry stays in lock-step with schema.ts', () => {
  const schemaSrc = readFileSync(SCHEMA_PATH, 'utf-8');

  it('ADMIN_ROW_TABLES is exactly documents + peer_companies (ipo_reviews retired, OD-125)', () => {
    expect([...ADMIN_ROW_TABLES].sort()).toEqual(['documents', 'peer_companies']);
  });

  it.each(Object.entries(SCHEMA_EXPORT))(
    'table "%s" (schema export %s): a normalized_name column requires a derivation entry',
    (dbTableName, exportName) => {
      const has = hasNormalizedNameDbColumn(tableDefinitionSource(schemaSrc, exportName));
      if (!has || !ADMIN_ROW_TABLES.includes(dbTableName)) return;
      expect(rowTableDerivedKey(dbTableName)).toEqual(expect.objectContaining({ derivedField: 'normalizedName' }));
    }
  );

  it('peer_companies has a normalized_name column and derives it (the guard is not vacuous)', () => {
    expect(hasNormalizedNameDbColumn(tableDefinitionSource(schemaSrc, 'peerCompanies'))).toBe(true);
    expect(rowTableDerivedKey('peer_companies')).toEqual({ sourceField: 'companyName', derivedField: 'normalizedName' });
  });

  it.each(ADMIN_ROW_TABLES.filter((t) => rowTableDerivedKey(t)))(
    'the derivation for "%s" is applied: a no-identity rename is refused before any db access',
    async (tableName) => {
      const { sourceField, derivedField } = rowTableDerivedKey(tableName)!;
      const common = {
        ipoId: 'i',
        tableName,
        row: { recordId: 'r' },
        mode: { kind: 'typed' as const, sourceNote: 'RHP p1' },
        expectedVersion: 'v',
        actor: { name: 'a', adminId: 'admin-t1' },
        entryPoint: 't',
      };
      const r = await writeAdminFieldValue(untouchable, { ...common, fieldName: sourceField, value: '   ' });
      expect(r.kind).toBe('INVALID');
      expect((r as { reason: string }).reason).toContain('identity');
      const direct = await writeAdminFieldValue(untouchable, { ...common, fieldName: derivedField, value: 'x' });
      expect((direct as { reason: string }).reason).toContain('not editable');
    }
  );
});
