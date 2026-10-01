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

const ASSIGNMENT_OPS = (): Set<ts.SyntaxKind> => {
  const ops = new Set<ts.SyntaxKind>();
  for (let k = ts.SyntaxKind.FirstAssignment; k <= ts.SyntaxKind.LastAssignment; k++) ops.add(k);
  return ops;
};

/**
 * Every column write to the three target objects, read from `text` with the compiler API. Fail closed:
 * a shape that is not resolved to a column name is reported in `unresolved` (and the test fails).
 * Shapes covered: `t.col = v` and every compound form (`??=`, `||=`, `&&=`, `+=` ...), `t['col'] = v`,
 * `t[expr] = v` (must be a listed dynamic site), `Object.assign(t, {...})`, an alias of a target
 * (`const dd = t`, `dd = t`, `t as X`) with every write through it, and properties set in the object
 * literal a target is created from. A spread or computed key inside any of those is unresolved.
 */
function enumerateWrites(text: string, file = 'filing-persister.ts'): { written: Set<string>; unresolved: string[]; dynamicSeen: Set<string> } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const written = new Set<string>();
  const unresolved: string[] = [];
  const dynamicSeen = new Set<string>();
  const where = (n: ts.Node) => `line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const assignOps = ASSIGNMENT_OPS();

  // Pass 1: the target names plus every alias of one, to a fixpoint.
  const tables: Record<string, string> = { ...TARGETS };
  const aliasOf = (init: ts.Expression | undefined): string | undefined => {
    if (!init) return undefined;
    const x = unwrap(init);
    return ts.isIdentifier(x) ? tables[x.text] : undefined;
  };
  for (let changed = true; changed; ) {
    changed = false;
    const collect = (node: ts.Node): void => {
      let name: string | undefined;
      let init: ts.Expression | undefined;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        name = node.name.text;
        init = node.initializer;
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(unwrap(node.left))) {
        name = (unwrap(node.left) as ts.Identifier).text;
        init = node.right;
      }
      const table = aliasOf(init);
      if (name && table && !tables[name]) {
        tables[name] = table;
        changed = true;
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);
  }

  const targetOf = (e: ts.Expression): string | undefined => {
    const x = unwrap(e);
    return ts.isIdentifier(x) ? tables[x.text] : undefined;
  };
  const addLiteral = (table: string, lit: ts.ObjectLiteralExpression): void => {
    for (const prop of lit.properties) {
      const key = prop.name;
      if ((ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) && key && (ts.isIdentifier(key) || ts.isStringLiteralLike(key))) {
        written.add(`${table}.${key.text}`);
      } else {
        unresolved.push(`${where(prop)}: object literal for ${table} has a spread or computed key (${prop.getText(sf).slice(0, 40)})`);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && assignOps.has(node.operatorToken.kind)) {
      const left = unwrap(node.left);
      if (ts.isPropertyAccessExpression(left)) {
        const table = targetOf(left.expression);
        if (table) written.add(`${table}.${left.name.text}`);
      } else if (ts.isElementAccessExpression(left)) {
        const table = targetOf(left.expression);
        if (table) {
          const arg = left.argumentExpression;
          if (ts.isStringLiteralLike(arg)) {
            written.add(`${table}.${arg.text}`);
          } else {
            const site = node.getText(sf).replace(/\s+/g, ' ');
            const known = DYNAMIC_SITES[site];
            if (!known) unresolved.push(`${where(node)}: ${site}`);
            else {
              dynamicSeen.add(site);
              for (const c of known.columns) written.add(`${known.table}.${c}`);
            }
          }
        }
      }
      // `t = { ... }` re-creates a target from a literal.
      const direct = ts.isIdentifier(left) ? tables[left.text] : undefined;
      if (direct && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(unwrap(node.right))) {
        addLiteral(direct, unwrap(node.right) as ts.ObjectLiteralExpression);
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && tables[node.name.text] && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(init)) addLiteral(tables[node.name.text], init);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Object' && callee.name.text === 'assign') {
        const table = node.arguments[0] ? targetOf(node.arguments[0]) : undefined;
        if (table) {
          for (const a of node.arguments.slice(1)) {
            const lit = unwrap(a);
            if (ts.isObjectLiteralExpression(lit)) addLiteral(table, lit);
            else unresolved.push(`${where(a)}: Object.assign(${table}, <non-literal>)`);
          }
        }
      }
      if (ts.isIdentifier(callee) && callee.text === 'mark') {
        const a0 = node.arguments[0];
        if (a0 && ts.isStringLiteralLike(a0)) written.add(`ipo_details.${a0.text}`);
        else unresolved.push(`${where(node)}: mark(<non-literal>)`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { written, unresolved, dynamicSeen };
}

describe('#1420 round 3: the filing persister one-to-one map is the re-read clear list', () => {
  const { written, unresolved, dynamicSeen } = enumerateWrites(fs.readFileSync(PERSISTER, 'utf8'));
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

describe('#1420 round 3 (B4c): the column scanner fails closed on shapes a plain assignment scan misses', () => {
  const scan = (body: string) =>
    enumerateWrites(`const iposCandidate: Record<string, unknown> = {};\nconst details: Record<string, unknown> = {};\nconst fd: Record<string, unknown> = {};\n${body}`, 'snippet.ts');

  it('sees a plain property write (control)', () => {
    expect([...scan('details.lotMultiple = 1;').written]).toEqual(['ipo_details.lotMultiple']);
  });
  it('Object.assign(target, { ... }) enumerates its keys', () => {
    expect([...scan("Object.assign(details, { lotMultiple: 1, 'faceValue': 2 });").written].sort()).toEqual(['ipo_details.faceValue', 'ipo_details.lotMultiple']);
  });
  it('Object.assign with a spread or a non-literal source is unresolved', () => {
    expect(scan('Object.assign(details, { ...other });').unresolved).toHaveLength(1);
    expect(scan('Object.assign(details, other);').unresolved).toHaveLength(1);
  });
  it('a logical or compound assignment (??=, ||=, &&=, +=) is a write', () => {
    const w = scan('(details as X).a ??= 1; fd.b ||= 2; iposCandidate.c &&= 3; fd.d += 4;').written;
    expect([...w].sort()).toEqual(['financial_data.b', 'financial_data.d', 'ipo_details.a', 'ipos.c']);
  });
  it('an alias of a target (declaration, assignment, cast, chain) writes the same table', () => {
    expect([...scan('const dd = details; dd.alias1 = 1;').written]).toEqual(['ipo_details.alias1']);
    expect([...scan('let e: any; e = fd as Foo; e.alias2 = 1;').written]).toEqual(['financial_data.alias2']);
    expect([...scan('const a = details; const b = a; b["alias3"] = 1;').written]).toEqual(['ipo_details.alias3']);
  });
  it('a dynamic key through an alias is unresolved', () => {
    expect(scan('const dd = details; dd[k] = 1;').unresolved).toHaveLength(1);
  });
  it('properties set in the literal a target is created from are enumerated; a spread or computed key is unresolved', () => {
    const lit = enumerateWrites("const fd: Record<string, unknown> = { ipoId, nested: 1, 'quoted': 2 };", 's.ts');
    expect([...lit.written].sort()).toEqual(['financial_data.ipoId', 'financial_data.nested', 'financial_data.quoted']);
    expect(enumerateWrites('const details = { ...base };', 's.ts').unresolved).toHaveLength(1);
    expect(enumerateWrites('const iposCandidate = { [k]: 1 };', 's.ts').unresolved).toHaveLength(1);
    expect(enumerateWrites('let fd; fd = { a: 1 };', 's.ts').written.has('financial_data.a')).toBe(true);
  });
});
