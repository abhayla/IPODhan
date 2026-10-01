// implements: #1420 round 3 (B8) -- spec data-sourcing-pull-model.md §6 rule 4, OD-153/OD-158/OD-160.
// Every scalar column the filing persister writes to ipos / ipo_details / financial_data is either on the
// persister's one-to-one map (so the re-read clear covers it by construction) or named with the reason it
// is not. Read from filing-persister.ts with the TypeScript compiler API; any write site whose column
// cannot be resolved fails the test (fail closed).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { getTableColumns } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import {
  FILING_CLEARABLE_COLUMNS,
  NOT_ONE_TO_ONE_COLUMNS,
  clearableIposSqlColumn,
  mappedField,
} from '../../../src/services/filing-clearable-columns.js';
import { REREAD_CLEARABLE_FIELDS } from '../../../src/services/reread-answer-clear.js';

const PERSISTER = path.resolve(__dirname, '../../../src/services/filing-persister.ts');

/**
 * The persister's dynamic write sites, each named by its write expression's text and the columns it can
 * write. A dynamic site not listed here fails the test, and so does a listed site that is gone.
 */
const DYNAMIC_SITES: Record<string, { table: string; columns: string[] }> = {
  // putCrore(`revenueFy${fy}` ...) for fy 2022..2024
  'fd[col] = c.toString()': {
    table: 'financial_data',
    columns: [2022, 2023, 2024].flatMap((fy) => ['revenueFy', 'profitFy', 'ebitdaFy', 'totalIncomeFy'].map((p) => `${p}${fy}`)),
  },
  // the issuer-ratio loop
  '(fd as Record<string, unknown>)[column] = rounded.toString()': {
    table: 'financial_data',
    columns: ['currentRatio', 'quickRatio', 'inventoryTurnover'],
  },
  // the body of mark(): its columns are the literal mark('<col>', ...) calls, enumerated separately
  'details[col] = v': { table: 'ipo_details', columns: [] },
};

const TARGETS: Record<string, string> = { iposCandidate: 'ipos', fd: 'financial_data', details: 'ipo_details' };

function unwrap(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  return x;
}

function enumerateWrites(): { written: Set<string>; unresolved: string[]; dynamicSeen: Set<string> } {
  const text = fs.readFileSync(PERSISTER, 'utf8');
  const sf = ts.createSourceFile(PERSISTER, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const written = new Set<string>();
  const unresolved: string[] = [];
  const dynamicSeen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left;
      if (ts.isPropertyAccessExpression(left)) {
        const obj = unwrap(left.expression);
        if (ts.isIdentifier(obj) && TARGETS[obj.text]) written.add(`${TARGETS[obj.text]}.${left.name.text}`);
      } else if (ts.isElementAccessExpression(left)) {
        const obj = unwrap(left.expression);
        if (ts.isIdentifier(obj) && TARGETS[obj.text]) {
          const arg = left.argumentExpression;
          if (ts.isStringLiteralLike(arg)) {
            written.add(`${TARGETS[obj.text]}.${arg.text}`);
          } else {
            const site = node.getText(sf).replace(/\s+/g, ' ');
            const known = DYNAMIC_SITES[site];
            if (!known) unresolved.push(`line ${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${site}`);
            else {
              dynamicSeen.add(site);
              for (const c of known.columns) written.add(`${known.table}.${c}`);
            }
          }
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'mark') {
      const a0 = node.arguments[0];
      if (a0 && ts.isStringLiteralLike(a0)) written.add(`ipo_details.${a0.text}`);
      else unresolved.push(`line ${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}: mark(<non-literal>)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { written, unresolved, dynamicSeen };
}

describe('#1420 round 3: the filing persister one-to-one map is the re-read clear list', () => {
  const { written, unresolved, dynamicSeen } = enumerateWrites();
  const mapped = new Set(FILING_CLEARABLE_COLUMNS.map((c) => `${c.tableName}.${c.column}`));

  it('every write site resolves to a column (fail closed on a dynamic site nobody listed)', () => {
    expect(unresolved).toEqual([]);
    expect([...dynamicSeen].sort()).toEqual(Object.keys(DYNAMIC_SITES).sort());
  });

  it('enumerates the write sites at all (the scan is not blind)', () => {
    expect(written.size).toBeGreaterThan(40);
    expect(written.has('ipos.priceRangeMin')).toBe(true);
    expect(written.has('ipo_details.complianceOfficerEmail')).toBe(true);
    expect(written.has('financial_data.revenueFy2024')).toBe(true);
  });

  it('every column the persister writes is on the map or named as not one-to-one', () => {
    const unclassified = [...written].filter((k) => !mapped.has(k) && !(k in NOT_ONE_TO_ONE_COLUMNS)).sort();
    expect(unclassified).toEqual([]);
  });

  it('every map entry and every not-one-to-one entry is a column the persister really writes', () => {
    expect([...mapped].filter((k) => !written.has(k)).sort()).toEqual([]);
    expect(Object.keys(NOT_ONE_TO_ONE_COLUMNS).filter((k) => !written.has(k)).sort()).toEqual([]);
    expect([...mapped].filter((k) => k in NOT_ONE_TO_ONE_COLUMNS)).toEqual([]);
  });

  it('every mapped column is clearable: nullable in the schema, SQL name from drizzle', () => {
    const tables = { ipos: schema.ipos, ipo_details: schema.ipoDetails, financial_data: schema.financialData } as const;
    for (const c of FILING_CLEARABLE_COLUMNS) {
      const col = (getTableColumns(tables[c.tableName]) as Record<string, { name: string; notNull: boolean }>)[c.column];
      expect(col, `${c.tableName}.${c.column}`).toBeDefined();
      expect(col.notNull, `${c.tableName}.${c.column} must be nullable to be cleared`).toBe(false);
      expect(c.sqlColumn).toBe(col.name);
    }
  });

  it('the re-read clear and the ipos clear door are the map itself, not copies', () => {
    expect(REREAD_CLEARABLE_FIELDS).toBe(FILING_CLEARABLE_COLUMNS);
    for (const c of FILING_CLEARABLE_COLUMNS.filter((x) => x.tableName === 'ipos')) expect(clearableIposSqlColumn(c.column)).toBe(c.sqlColumn);
    expect(clearableIposSqlColumn('issueSize')).toBeNull();
    expect(clearableIposSqlColumn('companyName')).toBeNull();
  });

  it('mappedField throws for a column off the map', () => {
    expect(mappedField('ipos', 'lotSize')).toBe('lot_size');
    expect(() => mappedField('ipos', 'issueSize')).toThrow();
  });
});
