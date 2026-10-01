import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { mergeLoser, MERGED_BY } from '../../../scripts/repair-name-pollution-and-redirects.js';

/**
 * #1051 (class: any code path that merges or removes an `ipos` row outside
 * `IPORepository.mergeDuplicateInto`). The name-pollution repair used to delete a loser row
 * directly: no eligibility check, no `ipo_merge_log`, no `--unmerge`. Every loser now goes
 * through the gated, logged, undoable merge (spec section 2.3.3.3, OD-38, OD-69, OD-92), and a
 * refusal is reported for that row and skipped, never forced.
 */

const here = dirname(fileURLToPath(import.meta.url));
const scraperRoot = resolve(here, '../../..');

const REFUSAL =
  'mergeDuplicateInto: refused — the two company names do not fold to the same string ' +
  '("Jay Bee Laminations Ltd." -> jaybeelaminations, "Jay Bee Laminations Ltd. O" -> jaybeelaminationso)';

describe('mergeLoser — the name-pollution loser merge goes through mergeDuplicateInto', () => {
  it('calls mergeDuplicateInto(canonical, loser) with apply passed through and the tool named as author', async () => {
    const mergeDuplicateInto = vi.fn().mockResolvedValue({ applied: true, keepSlug: 'k', droppedSlug: 'd' });
    const out = await mergeLoser({ mergeDuplicateInto } as never, 'keep-id', 'drop-id', { apply: true });
    expect(mergeDuplicateInto).toHaveBeenCalledTimes(1);
    const [keepId, dropId, opts] = mergeDuplicateInto.mock.calls[0];
    expect(keepId).toBe('keep-id');
    expect(dropId).toBe('drop-id');
    expect(opts.apply).toBe(true);
    expect(opts.mergedBy).toBe(MERGED_BY);
    expect(out.outcome).toBe('merged');
  });

  it('a dry run asks mergeDuplicateInto for its plan (apply:false), so refusals show up before --apply', async () => {
    const mergeDuplicateInto = vi.fn().mockResolvedValue({ applied: false });
    const out = await mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: false });
    expect(mergeDuplicateInto.mock.calls[0][2].apply).toBe(false);
    expect(out.outcome).toBe('planned');
  });

  it('never forces the gate beyond allowProd: no forceDifferentName, no issue-size acknowledgement', async () => {
    const mergeDuplicateInto = vi.fn().mockResolvedValue({ applied: true });
    await mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: true });
    const opts = mergeDuplicateInto.mock.calls[0][2];
    expect(opts.forceDifferentName ?? false).toBe(false);
    expect(opts.setIssueSize).toBeUndefined();
    expect(opts.issueSizeNote).toBeUndefined();
  });

  // #1051 finding 2: the prod guard lives INSIDE mergeDuplicateInto (ipo-repository.ts:1548) and
  // checks its OWN `opts.allowProd`, independent of whatever authorized the CLI run. Before this
  // fix, `--allow-prod` reached `openRepairDb()` but never reached this call, so the first merge
  // on prod refused mid-run — after the canonical rename had already been written. This test
  // pins the fix: `--allow-prod` (mergeLoser's `allowProd: true`) must reach `mergeDuplicateInto`,
  // and a normal call (no `allowProd`) must NOT claim prod authorization.
  it('threads allowProd:true through to mergeDuplicateInto when the caller was run with --allow-prod', async () => {
    const mergeDuplicateInto = vi.fn().mockResolvedValue({ applied: true });
    await mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: true, allowProd: true });
    const opts = mergeDuplicateInto.mock.calls[0][2];
    expect(opts.allowProd).toBe(true);
  });

  it('does not claim prod authorization when the caller was not run with --allow-prod', async () => {
    const mergeDuplicateInto = vi.fn().mockResolvedValue({ applied: true });
    await mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: true });
    const opts = mergeDuplicateInto.mock.calls[0][2];
    expect(opts.allowProd ?? false).toBe(false);
  });

  it('a refusal is returned for that row, with the gate reason verbatim, and is not thrown', async () => {
    const mergeDuplicateInto = vi.fn().mockRejectedValue(new Error(REFUSAL));
    const out = await mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: true });
    expect(out.outcome).toBe('refused');
    expect(out.outcome === 'refused' && out.reason).toContain('company names do not fold');
    expect(mergeDuplicateInto).toHaveBeenCalledTimes(1); // no retry with a looser option
  });

  it('any other error (not a gate refusal) is rethrown, so a broken merge stops the run', async () => {
    const mergeDuplicateInto = vi.fn().mockRejectedValue(new Error('connection terminated unexpectedly'));
    await expect(mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: true })).rejects.toThrow(
      /connection terminated/
    );
  });
});

describe('#1051 source guards — no raw ipos delete remains in either tool', () => {
  const RAW_IPOS_DELETE = /\.delete\(\s*(schema\.)?ipos\b|delete\s+from\s+ipos\b/i;
  const RAW_IPOS_WRITE = /\b(delete\s+from|update|insert\s+into)\s+ipos\b/i;

  it('repair-name-pollution-and-redirects.ts has no direct ipos delete', () => {
    const src = readFileSync(resolve(scraperRoot, 'scripts/repair-name-pollution-and-redirects.ts'), 'utf8');
    expect(src).not.toMatch(RAW_IPOS_DELETE);
    expect(src).toMatch(/mergeDuplicateInto\(/);
  });

  it('classify-suspect-ipos.ts never deletes an ipos row; its only write is the reclass offering_type write through the plan-rebuild door', () => {
    const src = readFileSync(resolve(scraperRoot, 'scripts/audit/classify-suspect-ipos.ts'), 'utf8');
    const v = inspectIposWrites(src);
    // Fail closed: a query/execute whose SQL is not a literal cannot be read, so it is refused.
    expect(v.unresolved).toEqual([]);
    expect(v.rawSqlWrites).toEqual([]);
    expect(v.builderWrites).toEqual([]);
    // #1051 finding 3 + #1402 (spec §2.8): reclass mode is outside the #1051 class (no merge, no row
    // removed) and is allowed to write ONLY offering_type, ONLY through the one write-and-rebuild door.
    expect(v.doorCalls).toEqual([['offeringType']]);
  });

  it('the source guard itself fails on a raw write, a second door call, another column or an unreadable query', () => {
    const imp = `import { writeIposRebuildingPlanInTx as w } from '@ipodhan/shared/services/plan-invalidating-rebuild';\n`;
    const door = `await w(tx, id, { offeringType: t }, m);\n`;
    expect(inspectIposWrites(imp + door).doorCalls).toEqual([['offeringType']]);
    expect(inspectIposWrites(imp + door + `await wc.query('update ipos set offering_type = $1 where id = $2', [a, b]);`).rawSqlWrites).toHaveLength(1);
    expect(inspectIposWrites(imp + door + 'await db.execute(sql`DELETE FROM ipos WHERE id = ${x}`);').rawSqlWrites).toHaveLength(1);
    expect(inspectIposWrites(imp + door + `await db.update(schema.ipos).set({ segment: 'SME' });`).builderWrites).toHaveLength(1);
    expect(inspectIposWrites(imp + door + door).doorCalls).toHaveLength(2);
    expect(inspectIposWrites(imp + `await w(tx, id, { offeringType: t, segment: s }, m);`).doorCalls).toEqual([['offeringType', 'segment']]);
    expect(inspectIposWrites(imp + `await w(tx, id, { ...set }, m);`).doorCalls).toEqual([['<unresolved>']]);
    expect(inspectIposWrites(imp + `await wc.query(text, [a]);`).unresolved).toHaveLength(1);
  });

  it('classify-suspect-ipos.ts refuses --apply for --depollute delete, and guards reclass --apply behind --allow-prod on prod', () => {
    const src = readFileSync(resolve(scraperRoot, 'scripts/audit/classify-suspect-ipos.ts'), 'utf8');
    expect(src).toMatch(/APPLY\s*&&\s*mode\s*===\s*'delete'/);
    expect(src).toMatch(/--apply is refused for --depollute delete/);
    expect(src).toMatch(/allow-prod/);
  });
});

/**
 * #1402: the `ipos` writes in a script, read with the TypeScript parser (comments are not code).
 *  - rawSqlWrites: any string / template literal holding `update ipos`, `delete from ipos` or `insert into ipos`;
 *  - builderWrites: `.update / .insert / .delete` on `ipos` (named or aliased, from the schema or a local const);
 *  - doorCalls: per call of writeIposRebuildingPlanInTx (named by its import source, any alias), the
 *    column keys of its `set` argument, or `<unresolved>` for a spread, a computed key or a non-literal set;
 *  - unresolved: a `.query / .execute` whose SQL argument is not a literal (cannot be read: fails closed).
 */
function inspectIposWrites(src: string) {
  const sf = ts.createSourceFile('x.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const RAW = /\b(update|delete\s+from|insert\s+into)\s+ipos\b/i;
  const DOOR_MODULE = /(^|\/)plan-invalidating-rebuild(\.js|\.ts)?$/;
  const doorNames = new Set<string>();
  const doorNamespaces = new Set<string>();
  const iposAliases = new Set<string>(['ipos']);
  const out = { rawSqlWrites: [] as string[], builderWrites: [] as string[], doorCalls: [] as string[][], unresolved: [] as string[] };
  const at = (n: ts.Node) => `line ${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const literalText = (n: ts.Node): string | null => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) return [n.head.text, ...n.templateSpans.map((x) => x.literal.text)].join(' ');
    if (ts.isTaggedTemplateExpression(n)) return literalText(n.template);
    return null;
  };
  const isIposRef = (n: ts.Node | undefined) =>
    !!n && ((ts.isIdentifier(n) && iposAliases.has(n.text)) || (ts.isPropertyAccessExpression(n) && n.name.text === 'ipos'));

  // Pass 1: imports and aliases.
  const collect = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const from = n.moduleSpecifier.text;
      const b = n.importClause?.namedBindings;
      if (b && ts.isNamespaceImport(b) && DOOR_MODULE.test(from)) doorNamespaces.add(b.name.text);
      if (b && ts.isNamedImports(b)) {
        for (const el of b.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (DOOR_MODULE.test(from) && imported === 'writeIposRebuildingPlanInTx') doorNames.add(el.name.text);
          if (imported === 'ipos') iposAliases.add(el.name.text);
        }
      }
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isIposRef(n.initializer)) iposAliases.add(n.name.text);
    ts.forEachChild(n, collect);
  };
  collect(sf);

  // Pass 2: writes.
  const visit = (n: ts.Node) => {
    const text = literalText(n);
    if (text !== null && !ts.isTaggedTemplateExpression(n.parent) && RAW.test(text)) out.rawSqlWrites.push(at(n));
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      const isDoor =
        (ts.isIdentifier(callee) && doorNames.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'writeIposRebuildingPlanInTx' &&
          ts.isIdentifier(callee.expression) && doorNamespaces.has(callee.expression.text)) ||
        name === 'writeIposRebuildingPlanInTx';
      if (isDoor) {
        const set = n.arguments[2];
        const keys: string[] = [];
        if (set && ts.isObjectLiteralExpression(set)) {
          for (const p of set.properties) {
            if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) keys.push(p.name.text);
            else keys.push('<unresolved>');
          }
        } else keys.push('<unresolved>');
        out.doorCalls.push(keys.sort());
      } else if (ts.isPropertyAccessExpression(callee) && (name === 'query' || name === 'execute')) {
        const a = n.arguments[0];
        if (!a || literalText(a) === null) out.unresolved.push(at(n));
      } else if (ts.isPropertyAccessExpression(callee) && (name === 'update' || name === 'insert' || name === 'delete') && isIposRef(n.arguments[0])) {
        out.builderWrites.push(at(n));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
