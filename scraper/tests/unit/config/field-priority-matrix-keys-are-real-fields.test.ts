/**
 * #1186 structural guard: every FIELD_PRIORITY_MATRIX key is a REAL camelCase field the
 * consolidator looks up. No allow-list.
 *
 * Class: a matrix key whose name is not the camelCase property of a column on a table the
 * consolidator writes. getSourcePriority()/getFieldRules() look a field up as
 * `FIELD_PRIORITY_MATRIX[toCamelKey(fieldName)] || FIELD_PRIORITY_MATRIX[fieldName]`, and every
 * production caller passes the camelCase property name of a schema column
 * (data-consolidation-service.ts, writer-source-ranking.ts, field-plan-walk.ts via
 * fieldNameToColumn). So a key that is not such a name is never reached: its rules never run and
 * the field silently takes the default (or the manifest resolver's) order, while the entry reads
 * like coverage.
 *
 * #754 found 13 of them and pinned them in a KNOWN_DEAD_KEYS list. #1186 deleted them, with the
 * 5 snake_case keys shadowed by a camelCase sibling, `industry` (no such column) and
 * `peer_companies` (a table name, never passed as a field name) — spec §5.5 item 4 and §7 build
 * item 3 ("delete the 13 dead snake_case keys, adopt the manifest"). Measured on staging before the
 * deletion (docs/design/probes/matrix-dead-keys-impact.out.json): no recorded source decision
 * would have changed, and the only rows the camelCase names reach (ipo_details.freshIssue 20,
 * ofsIssue 12) are all DRHP-held and governed by the manifest resolver (the flipped issue-size
 * group).
 *
 * Fail closed: if the schema or a table cannot be parsed, or no call site is found, the
 * suite fails rather than passing an empty comparison.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELD_PRIORITY_MATRIX } from '../../../src/config/field-priority-matrix.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../../..');
const SCHEMA_PATH = path.join(REPO, 'packages/shared/src/db/schema.ts');
const SRC_DIR = path.join(REPO, 'scraper/src');

/** The text between the `{` at/after `from` and its matching `}`; throws when unbalanced. */
function braceBody(text: string, from: number, what: string): string {
  const open = text.indexOf('{', from);
  if (open === -1) throw new Error(`no opening brace for ${what}`);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces in ${what}`);
}

/** camelCase property names of one pgTable's columns, parsed from schema.ts. */
function tableColumns(schema: string, table: string): Set<string> {
  const re = new RegExp(`pgTable\\(\\s*'${table}'`);
  const m = re.exec(schema);
  if (!m) throw new Error(`pgTable('${table}') not found in schema.ts`);
  const body = braceBody(schema, m.index, `pgTable('${table}')`);
  const cols = new Set<string>();
  for (const c of body.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[A-Za-z]+\(\s*'[a-z0-9_]+'/gm)) cols.add(c[1]);
  if (cols.size === 0) throw new Error(`no columns parsed for ${table}`);
  return cols;
}

/** Every .ts file under a directory. */
function tsFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tsFiles(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Tables the merge step actually writes, derived from code: `ipos` (the parent row, written by
 * data-consolidation-service / data-persister) plus every table a persister passes as a literal to
 * the child-row consolidator (`consolidatedUpsertChildRows(ipoId, 'table', ...)`, or the
 * unresolved / threw bookkeeping calls beside it). A `ChildConsolidationTable` member with no such
 * call site is NOT in this list, so a key that only fits an unwired table is reported dead.
 */
export function writtenTables(files: Array<{ file: string; src: string }>): string[] {
  const calls =
    /(?:consolidatedUpsertChildRows|consolidateChildRows|markChildRowsUnresolved|noteConsolidationThrew)\(\s*(?:ipoId,\s*)?'([a-z_]+)'/g;
  const tables = new Set<string>(['ipos']);
  for (const f of files) for (const m of f.src.matchAll(calls)) tables.add(m[1]);
  return [...tables];
}

/**
 * ONE table the code does not route through the child consolidator but whose camelCase keys the matrix
 * still carries: `financial_data` is written by `financialData.upsert(...)` (filing-persister.ts), and
 * 22 matrix keys (revenueFy2022 ... marketCap) name its columns. Whether anything looks them up is
 * UNMEASURED (the #1186 probe covered the 20 keys it deleted, not these), so they are named here, not
 * silently allowed and not deleted blind. Follow-up: measure on staging, then delete or wire.
 */
export const UNROUTED_TABLES_PENDING_MEASUREMENT = ['financial_data'] as const;

function writtenTablesOnDisk(): string[] {
  const routed = writtenTables(tsFiles(SRC_DIR).map((file) => ({ file, src: fs.readFileSync(file, 'utf8') })));
  return [...routed, ...UNROUTED_TABLES_PENDING_MEASUREMENT];
}

/** Matrix keys that are not the camelCase property of a column on a written table. */
export function deadMatrixKeys(keys: string[], schemaSrc: string, tables: string[]): string[] {
  const real = new Set<string>();
  for (const t of tables) for (const c of tableColumns(schemaSrc, t)) real.add(c);
  return keys.filter((k) => k.includes('_') || !real.has(k));
}

describe('#1186: every FIELD_PRIORITY_MATRIX key is a real camelCase field the consolidator looks up', () => {
  const schemaSrc = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const tables = writtenTablesOnDisk();
  // The REAL object's keys: a comment, a spread, a computed key or a quoted key cannot fool this.
  const keys = Object.keys(FIELD_PRIORITY_MATRIX);

  it('reads enough of the matrix, the call sites and the schema to make the comparison meaningful', () => {
    expect(keys.length).toBeGreaterThan(30);
    expect(keys).toContain('issueSize');
    expect(keys).toContain('lotSize');
    expect(tables).toEqual(expect.arrayContaining(['ipos', 'ipo_details', 'financial_statements', 'anchor_investors']));
    expect(tableColumns(schemaSrc, 'ipos').has('lotSize')).toBe(true);
  });

  it('writtenTables is derived from call sites, not from the whole ChildConsolidationTable union', () => {
    const one = [{ file: 'a.ts', src: "await deps.childRowConsolidator.consolidatedUpsertChildRows(\n ipoId,\n 'promoters',\n rows" }];
    expect(writtenTables(one).sort()).toEqual(['ipos', 'promoters']);
    expect(writtenTables([{ file: 'b.ts', src: "type T = 'ipo_details' | 'peer_companies';" }])).toEqual(['ipos']);
  });

  it('has no dead key: no snake_case key, no key that is not a column on a written table', () => {
    const dead = deadMatrixKeys(keys, schemaSrc, tables);
    expect(
      dead,
      `Unreachable FIELD_PRIORITY_MATRIX key(s): ${dead.join(', ')}. Every caller passes the camelCase ` +
        `property of a schema column on a table the merge step writes (${tables.join(', ')}). Rename the ` +
        `key to that property (this switches its rules ON — measure on staging first, #1186) or delete it. ` +
        `There is no allow-list.`
    ).toEqual([]);
  });

  it('detects each dead shape (self-test: the guard can fail)', () => {
    const ok = ['lotSize'];
    expect(deadMatrixKeys(ok, schemaSrc, tables)).toEqual([]);
    expect(deadMatrixKeys([...ok, 'lot_size'], schemaSrc, tables)).toEqual(['lot_size']);
    expect(deadMatrixKeys([...ok, 'industry'], schemaSrc, tables)).toEqual(['industry']);
    expect(deadMatrixKeys([...ok, 'peer_companies'], schemaSrc, tables)).toEqual(['peer_companies']);
    expect(() => deadMatrixKeys(ok, schemaSrc, ['no_such_table'])).toThrow();
  });
});
