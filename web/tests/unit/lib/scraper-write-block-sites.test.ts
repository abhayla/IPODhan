/**
 * §9.2 item 23 (OD-116, OD-118, OD-150) detection for failure class `hand-listed-coverage-drifts`:
 * the scraper lock (`ipos.scraper_locked`) is read in ONE place, the predicate module
 * packages/shared/src/services/scraper-write-block.ts (`scraperWriteBlocked` = locked OR hidden).
 * Any other source file that reads it by name fails here, so a new lock reader cannot forget the
 * hidden half. Parsed with the TypeScript compiler (comments are not reads; a hand-rolled lexer
 * misses regex literals and templates). The only other files allowed to name the flag are the
 * schema and the admin surfaces that SHOW or SET it, each with its reason; an allowance whose
 * file no longer names the flag fails too.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SCAN_ROOTS = ['packages/shared/src', 'scraper/src', 'scraper/scripts', 'web/app', 'web/lib', 'web/components', 'web/scripts', 'web/middleware.ts'];
const HELPER = 'packages/shared/src/services/scraper-write-block.ts';

/** Files that name the flag without deciding a scraper write — each with its reason. */
const NOT_A_LOCK_READER: Record<string, string> = {
  'packages/shared/src/db/schema.ts': 'the column definition',
  'packages/shared/src/services/admin-field-write.ts': 'the admin value writer refuses the flag as an editable value',
  'web/app/api/admin/protection/ipo/[ipoId]/route.ts': 'the admin route that SETS the flag',
  'web/app/admin/(protected)/page.tsx': 'admin list shows / filters the flag',
  'web/app/admin/(protected)/edit/[slug]/page.tsx': 'admin editor shows the flag',
  'web/components/admin/ipo-editor/IpoPageEditor.tsx': 'admin editor toggle for the flag',
  'web/lib/admin/field-labels.ts': 'admin label for the flag',
  'web/lib/admin/ipo-editor-fields.ts': 'admin setting field list',
  'web/scripts/apply-manual-data-management-migration.ts': 'one-off migration script that printed the column name',
};

const NAMES_THE_FLAG = /scraper_locked|scraperLocked/;

function walk(target: string, out: string[]): void {
  const full = path.join(REPO_ROOT, target);
  const st = statSync(full);
  if (st.isFile()) {
    out.push(full);
    return;
  }
  for (const name of readdirSync(full)) {
    if (name === 'node_modules' || name === 'dist' || name === '.next' || name === '__tests__') continue;
    const child = path.join(full, name);
    if (statSync(child).isDirectory()) walk(path.relative(REPO_ROOT, child), out);
    else if (/\.(ts|tsx|mts|cts)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(child);
  }
}

const rel = (f: string) => path.relative(REPO_ROOT, f).split(path.sep).join('/');

/** Every place the source code (not a comment) names the flag: identifiers, property names, strings, templates. */
export function flagReads(fileName: string, src: string): number[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = new Set<number>();
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) text = node.text;
    else if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.text;
    if (text !== null && NAMES_THE_FLAG.test(text)) lines.add(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...lines].sort((a, b) => a - b);
}

function scan(): Map<string, number[]> {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(root, files);
  const hits = new Map<string, number[]>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (!NAMES_THE_FLAG.test(src)) continue;
    const lines = flagReads(f, src);
    if (lines.length) hits.set(rel(f), lines);
  }
  return hits;
}

describe('§9.2 item 23: the scraper lock is read only through scraperWriteBlocked', () => {
  const hits = scan();

  it('the scan works (fails closed): it finds the helper and the schema', () => {
    expect(hits.has(HELPER)).toBe(true);
    expect(hits.has('packages/shared/src/db/schema.ts')).toBe(true);
  });

  it('no source file outside the helper and the named admin surfaces reads scraper_locked / scraperLocked', () => {
    const offenders = [...hits.entries()]
      .filter(([f]) => f !== HELPER && !NOT_A_LOCK_READER[f])
      .map(([f, lines]) => `${f}:${lines.join(',')}`);
    expect(offenders).toEqual([]);
  });

  it('every allowance still names the flag (no stale allowance)', () => {
    expect(Object.keys(NOT_A_LOCK_READER).filter((f) => !hits.has(f))).toEqual([]);
  });

  it('the parser ignores comments and catches identifiers, property access, raw SQL strings and templates', () => {
    const src = [
      '// scraper_locked in a comment is not a read',
      'const a = row.scraperLocked;',
      "const b = sql`SELECT scraper_locked FROM ipos WHERE id = ${id}`;",
      "const c = 'scraper_locked';",
      '/* scraperLocked */ const d = 1;',
    ].join('\n');
    expect(flagReads('x.ts', src)).toEqual([2, 3, 4]);
  });

  it('every lock-reading scraper and web site imports the predicate from the helper module', () => {
    const readers = [
      'packages/shared/src/admin/field-protection-checker.ts',
      'packages/shared/src/services/field-hold.ts',
      'scraper/src/services/anchor-persister.ts',
      'scraper/src/services/filing-persister.ts',
      'web/lib/services/status-updater-service.ts',
    ];
    const importsHelper = /from ['"](?:\.{1,2}\/(?:services\/)?|@ipodhan\/shared\/services\/)scraper-write-block['"]/;
    expect(readers.filter((f) => !importsHelper.test(readFileSync(path.join(REPO_ROOT, f), 'utf8')))).toEqual([]);
  });
});
