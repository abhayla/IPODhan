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
 * Fail closed: if the matrix, the schema, a table or the child-table union cannot be parsed, the
 * suite fails rather than passing an empty comparison.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../../..');
const MATRIX_PATH = path.join(REPO, 'scraper/src/config/field-priority-matrix.ts');
const SCHEMA_PATH = path.join(REPO, 'packages/shared/src/db/schema.ts');
const ORCHESTRATOR_PATH = path.join(REPO, 'scraper/src/services/data-consolidation-orchestrator.ts');
const MANIFEST_PATH = path.join(REPO, 'scraper/config/field-manifest.json');

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

/** Top-level keys of `FIELD_PRIORITY_MATRIX`, parsed from the source file. */
export function extractMatrixKeys(src: string): string[] {
  const start = src.indexOf('export const FIELD_PRIORITY_MATRIX');
  if (start === -1) throw new Error('FIELD_PRIORITY_MATRIX not found — matrix file restructured');
  const body = braceBody(src, start, 'FIELD_PRIORITY_MATRIX');
  const keys: string[] = [];
  // Any `name: {` OR quoted `'name': {` OR a spread / computed key at depth 0. A shape this
  // parser cannot read as a plain identifier is reported as UNRESOLVED (fail closed), never skipped.
  const re = /(?:^|[,{\n])\s*(\.\.\.[^,\n]+|\[[^\]]*\]\s*:|['"]?[A-Za-z_$][A-Za-z0-9_$]*['"]?\s*:)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const tokenAt = m.index + m[0].indexOf(m[1]);
    let depth = 0;
    for (let j = 0; j < tokenAt; j++) {
      if (body[j] === '{' || body[j] === '[' || body[j] === '(') depth++;
      else if (body[j] === '}' || body[j] === ']' || body[j] === ')') depth--;
    }
    if (depth !== 0) continue;
    const tok = m[1].replace(/\s*:$/, '');
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tok)) keys.push(tok);
    else keys.push(`UNRESOLVED<${tok}>`);
  }
  return keys;
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

/** Tables the consolidator writes: ipos, every ChildConsolidationTable member, every manifest table. */
function consolidatedTables(): string[] {
  const orch = fs.readFileSync(ORCHESTRATOR_PATH, 'utf8');
  const at = orch.indexOf('export type ChildConsolidationTable');
  if (at === -1) throw new Error('ChildConsolidationTable union not found');
  const union = orch.slice(at, orch.indexOf(';', at));
  const members = [...union.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  if (members.length === 0) throw new Error('ChildConsolidationTable union parsed empty');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as { fields: Record<string, unknown> };
  const manifestTables = Object.keys(manifest.fields).map((k) => k.split('.')[0]);
  return [...new Set(['ipos', ...members, ...manifestTables])];
}

/** Matrix keys that are not the camelCase property of a column on a consolidated table. */
export function deadMatrixKeys(matrixSrc: string, schemaSrc: string, tables: string[]): string[] {
  const real = new Set<string>();
  for (const t of tables) for (const c of tableColumns(schemaSrc, t)) real.add(c);
  return extractMatrixKeys(matrixSrc).filter((k) => k.includes('_') || !real.has(k));
}

describe('#1186: every FIELD_PRIORITY_MATRIX key is a real camelCase field the consolidator looks up', () => {
  const matrixSrc = fs.readFileSync(MATRIX_PATH, 'utf8');
  const schemaSrc = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const tables = consolidatedTables();

  it('parses enough of the matrix and the schema to make the comparison meaningful', () => {
    const keys = extractMatrixKeys(matrixSrc);
    expect(keys.length).toBeGreaterThan(30);
    expect(keys).toContain('issueSize');
    expect(keys).toContain('lotSize');
    expect(tables).toEqual(expect.arrayContaining(['ipos', 'ipo_details', 'financial_statements']));
    expect(tableColumns(schemaSrc, 'ipos').has('lotSize')).toBe(true);
  });

  it('has no dead key: no snake_case key, no key that is not a column on a consolidated table', () => {
    const dead = deadMatrixKeys(matrixSrc, schemaSrc, tables);
    expect(
      dead,
      `Unreachable FIELD_PRIORITY_MATRIX key(s): ${dead.join(', ')}. Every caller passes the camelCase ` +
        `property of a schema column on a table the consolidator writes (${tables.join(', ')}). Rename the ` +
        `key to that property (this switches its rules ON — measure on staging first, #1186) or delete it. ` +
        `There is no allow-list.`
    ).toEqual([]);
  });

  it('detects each dead shape (self-test: the guard can fail)', () => {
    const fake = (body: string) => `export const FIELD_PRIORITY_MATRIX: Record<string, FieldRules> = {\n${body}\n};`;
    const ok = "  lotSize: { sources: ['ADMIN'] },\n";
    expect(deadMatrixKeys(fake(ok), schemaSrc, tables)).toEqual([]);
    expect(deadMatrixKeys(fake(ok + "  lot_size: { sources: ['ADMIN'] },"), schemaSrc, tables)).toEqual(['lot_size']);
    expect(deadMatrixKeys(fake(ok + "  industry: { sources: ['ADMIN'] },"), schemaSrc, tables)).toEqual(['industry']);
    expect(deadMatrixKeys(fake(ok + "  'lotSize2': { sources: ['ADMIN'] },"), schemaSrc, tables)).toEqual(["UNRESOLVED<'lotSize2'>"]);
    expect(deadMatrixKeys(fake(ok + '  ...EXTRA,'), schemaSrc, tables)).toEqual(['UNRESOLVED<...EXTRA>']);
    expect(deadMatrixKeys(fake(ok + "  ['lotSize']: { sources: ['ADMIN'] },"), schemaSrc, tables).length).toBe(1);
    // nested keys (validation blocks) are not top-level entries
    expect(deadMatrixKeys(fake("  lotSize: { sources: ['ADMIN'], validation: { min_x: 1 } },"), schemaSrc, tables)).toEqual([]);
    expect(() => deadMatrixKeys('no matrix here', schemaSrc, tables)).toThrow();
    expect(() => deadMatrixKeys(fake(ok), schemaSrc, ['no_such_table'])).toThrow();
  });
});
