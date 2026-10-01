/**
 * #1379 round 3 (B8): every code the consolidator / runPreRankChecks / listing-exchange-resolution put on
 * a rejected source is an entry of the ONE categorized table, and every entry is emitted somewhere.
 *
 * The expected set is read from the SOURCE (TypeScript AST), never from the table: a code removed from
 * the table, or an emit added with a literal / unknown name / a shape this test cannot read, goes red.
 * Sites read:
 *  - every `reason` of an object in a `rejectedSources: [...]` array (or a `.rejectedSources.push(...)`);
 *  - every `reason` of an object whose `status` is 'REFUSED' (runPreRankChecks);
 *  - the origins of the carriers those sites pass through (`resolutionReason`, `holdEscape.resolutionReason`,
 *    `od129.reason`, `implausibleIssueSize.reason`), each followed to its own assignments in the source.
 * Any other shape (a spread, a shorthand, a non-array `rejectedSources`, an unlisted variable) fails closed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import {
  OUTCOME_CODE,
  OUTCOME_CATEGORY,
  OUTCOME_PREFIX_NAMES,
  outcomeCategoryOf,
  type OutcomeCodeName,
} from '../../../src/services/consolidation-outcome-codes';
import { isPriorityLossReason } from '../../../src/services/data-consolidation-service';

const SERVICES = join(__dirname, '../../../src/services');
const FILES = ['data-consolidation-service.ts', 'listing-exchange-resolution.ts'] as const;
const TABLE_OBJECT = 'OUTCOME_CODE';

interface TableView {
  names: ReadonlySet<string>;
  prefixNames: ReadonlySet<string>;
}
const REAL_TABLE: TableView = { names: new Set(Object.keys(OUTCOME_CODE)), prefixNames: new Set(OUTCOME_PREFIX_NAMES) };

/** Where a carrier's values come from: (file, enclosing function or null = whole file, what to collect). */
const CARRIERS: Record<string, { file: string; fn: string | null; collect: 'assign' | 'prop'; name: string }> = {
  resolutionReason: { file: 'data-consolidation-service.ts', fn: null, collect: 'assign', name: 'resolutionReason' },
  'holdEscape.resolutionReason': { file: 'data-consolidation-service.ts', fn: 'resolveHighValueHoldEscape', collect: 'prop', name: 'resolutionReason' },
  'od129.reason': { file: 'listing-exchange-resolution.ts', fn: 'decideListingExchangesOd129', collect: 'prop', name: 'reason' },
  'implausibleIssueSize.reason': { file: 'data-consolidation-service.ts', fn: 'collectImplausibleIssueSizeFields', collect: 'prop', name: 'reason' },
};

interface Emit {
  name: string;
  kind: 'exact' | 'prefix';
  at: string;
}
interface Analysis {
  emits: Emit[];
  problems: string[];
  sites: number;
  rejectedSourcesTextCount: number;
  rejectedSourcesAstCount: number;
}

function propName(p: ts.ObjectLiteralElementLike): string | null {
  if (!p.name) return null;
  if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text;
  return null;
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x)) {
    x = x.expression;
  }
  return x;
}

function findFunction(sf: ts.SourceFile, name: string): ts.Node | null {
  let found: ts.Node | null = null;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === name) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

export function analyzeOutcomeCodes(sourceByFile: Record<string, string>): Analysis {
  const sfs: Record<string, ts.SourceFile> = {};
  for (const [f, text] of Object.entries(sourceByFile)) sfs[f] = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
  const emits: Emit[] = [];
  const problems: string[] = [];
  let sites = 0;
  let rejectedSourcesAstCount = 0;
  let rejectedSourcesTextCount = 0;

  const where = (n: ts.Node): string => {
    const sf = n.getSourceFile();
    return `${sf.fileName}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  };

  const resolve = (expr: ts.Expression, depth: number): void => {
    const e = unwrap(expr);
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === TABLE_OBJECT) {
      emits.push({ name: e.name.text, kind: 'exact', at: where(e) });
      return;
    }
    if (ts.isTemplateExpression(e) && e.head.text === '' && e.templateSpans.length >= 1) {
      const first = unwrap(e.templateSpans[0].expression);
      if (ts.isPropertyAccessExpression(first) && ts.isIdentifier(first.expression) && first.expression.text === TABLE_OBJECT) {
        emits.push({ name: first.name.text, kind: 'prefix', at: where(e) });
        return;
      }
    }
    if (ts.isConditionalExpression(e)) {
      resolve(e.whenTrue, depth);
      resolve(e.whenFalse, depth);
      return;
    }
    const carrier = CARRIERS[e.getText()];
    if (carrier && depth < 4) {
      const sf = sfs[carrier.file];
      const scope = sf && (carrier.fn ? findFunction(sf, carrier.fn) : sf);
      if (!scope) {
        problems.push(`${where(e)}: carrier ${e.getText()} -> ${carrier.file}${carrier.fn ? `#${carrier.fn}` : ''} not found (fail closed)`);
        return;
      }
      let origins = 0;
      const visit = (n: ts.Node): void => {
        if (
          carrier.collect === 'assign' &&
          ts.isBinaryExpression(n) &&
          n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(n.left) &&
          n.left.text === carrier.name
        ) {
          origins += 1;
          resolve(n.right, depth + 1);
        }
        if (carrier.collect === 'assign' && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === carrier.name && n.initializer) {
          origins += 1;
          resolve(n.initializer, depth + 1);
        }
        if (carrier.collect === 'prop' && ts.isPropertyAssignment(n) && propName(n) === carrier.name) {
          origins += 1;
          resolve(n.initializer, depth + 1);
        }
        if (carrier.collect === 'prop' && ts.isShorthandPropertyAssignment(n) && n.name.text === carrier.name) {
          problems.push(`${where(n)}: shorthand \`${carrier.name}\` in a carrier origin is unreadable (fail closed)`);
        }
        ts.forEachChild(n, visit);
      };
      visit(scope);
      if (origins === 0) problems.push(`${where(e)}: carrier ${e.getText()} has no origin in the source (fail closed)`);
      return;
    }
    problems.push(`${where(e)}: emit \`${e.getText()}\` is not ${TABLE_OBJECT}.<NAME> (a literal, an unknown name, or an unreadable shape)`);
  };

  const readReasonOf = (obj: ts.Expression, ctx: string): void => {
    const o = unwrap(obj);
    if (!ts.isObjectLiteralExpression(o)) {
      problems.push(`${where(o)}: ${ctx} element is not an object literal (fail closed)`);
      return;
    }
    sites += 1;
    const reasonProps = o.properties.filter((p) => propName(p) === 'reason' || (ts.isShorthandPropertyAssignment(p) && p.name.text === 'reason'));
    if (o.properties.some((p) => ts.isSpreadAssignment(p))) problems.push(`${where(o)}: ${ctx} entry has a spread (fail closed)`);
    if (reasonProps.length !== 1 || !ts.isPropertyAssignment(reasonProps[0])) {
      problems.push(`${where(o)}: ${ctx} entry has no readable \`reason:\` (fail closed)`);
      return;
    }
    resolve(reasonProps[0].initializer, 0);
  };

  for (const file of FILES) {
    const sf = sfs[file];
    if (!sf) {
      problems.push(`${file}: not provided (fail closed)`);
      continue;
    }
    rejectedSourcesTextCount += (sourceByFile[file].match(/\brejectedSources\b\??\s*:/g) ?? []).length;
    rejectedSourcesTextCount += (sourceByFile[file].match(/\.rejectedSources\s*\.\s*push\s*\(/g) ?? []).length;
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && propName(n) === 'rejectedSources') {
        rejectedSourcesAstCount += 1;
        const init = unwrap(n.initializer);
        if (!ts.isArrayLiteralExpression(init)) {
          problems.push(`${where(n)}: rejectedSources is not an array literal (fail closed)`);
        } else {
          for (const el of init.elements) {
            if (ts.isSpreadElement(el)) problems.push(`${where(el)}: spread in rejectedSources (fail closed)`);
            else readReasonOf(el, 'rejectedSources');
          }
        }
      }
      if (ts.isPropertySignature(n) && propName(n as never) === 'rejectedSources') rejectedSourcesAstCount += 1; // a type member
      if (ts.isShorthandPropertyAssignment(n) && n.name.text === 'rejectedSources') {
        rejectedSourcesAstCount += 1;
        problems.push(`${where(n)}: shorthand rejectedSources (fail closed)`);
      }
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === 'push' &&
        ts.isPropertyAccessExpression(n.expression.expression) &&
        n.expression.expression.name.text === 'rejectedSources'
      ) {
        rejectedSourcesAstCount += 1;
        for (const a of n.arguments) readReasonOf(a, 'rejectedSources.push');
      }
      if (ts.isObjectLiteralExpression(n)) {
        const status = n.properties.find((p) => propName(p) === 'status');
        if (status && ts.isPropertyAssignment(status) && ts.isStringLiteral(unwrap(status.initializer)) && (unwrap(status.initializer) as ts.StringLiteral).text === 'REFUSED') {
          readReasonOf(n, "status: 'REFUSED'");
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { emits, problems, sites, rejectedSourcesTextCount, rejectedSourcesAstCount };
}

/** Problems of an analysis against a table view: uncategorized emits, wrong kind, never-emitted entries. */
export function completenessProblems(a: Analysis, table: TableView): string[] {
  const out = [...a.problems];
  for (const e of a.emits) {
    if (!table.names.has(e.name)) out.push(`${e.at}: ${e.name} is emitted but is not in the table (uncategorized)`);
    else if ((e.kind === 'prefix') !== table.prefixNames.has(e.name)) out.push(`${e.at}: ${e.name} emitted as ${e.kind}, table says otherwise`);
  }
  const emitted = new Set(a.emits.map((e) => e.name));
  for (const n of table.names) if (!emitted.has(n)) out.push(`table entry ${n} is never emitted`);
  if (a.rejectedSourcesTextCount !== a.rejectedSourcesAstCount) {
    out.push(`rejectedSources: text sees ${a.rejectedSourcesTextCount} sites, the AST read ${a.rejectedSourcesAstCount} (a shape this test cannot read; fail closed)`);
  }
  return out;
}

const realSources = (): Record<string, string> =>
  Object.fromEntries(FILES.map((f) => [f, readFileSync(join(SERVICES, f), 'utf-8')]));

describe('#1379 round 3: the outcome-code table is complete against the emitter source', () => {
  it('every emitted code is a table entry and every table entry is emitted (read from the source)', () => {
    const a = analyzeOutcomeCodes(realSources());
    expect(completenessProblems(a, REAL_TABLE)).toEqual([]);
    expect(a.sites).toBeGreaterThanOrEqual(20); // the parser really read the emitter files
  });

  it('OD129_DOCUMENT_LISTING_HOLDS is emitted (via od129.reason) and is KEEP -- the code round 2 missed', () => {
    const a = analyzeOutcomeCodes(realSources());
    expect(a.emits.map((e) => e.name)).toContain('OD129_DOCUMENT_LISTING_HOLDS');
    expect(OUTCOME_CATEGORY.OD129_DOCUMENT_LISTING_HOLDS).toBe('KEEP');
    expect(isPriorityLossReason('OD129_DOCUMENT_LISTING_HOLDS')).toBe(true);
  });

  it("detector proof: round 2's hand-typed lists, checked against the source, are red on OD129_DOCUMENT_LISTING_HOLDS", () => {
    // Round 2's PRIORITY_LOSS_REASONS + WRITE_REFUSAL_REASONS + its two prefixes, by table name.
    const round2: TableView = {
      names: new Set([...Object.keys(OUTCOME_CODE)].filter((n) => !n.startsWith('OD129_DOCUMENT_LISTING_') || n === 'OD129_DOCUMENT_LISTING_DISAGREES')),
      prefixNames: REAL_TABLE.prefixNames,
    };
    const problems = completenessProblems(analyzeOutcomeCodes(realSources()), round2);
    expect(problems.some((p) => p.includes('OD129_DOCUMENT_LISTING_HOLDS is emitted but is not in the table'))).toBe(true);
  });

  it.each(Object.keys(OUTCOME_CODE))('mutation: removing table entry %s goes red', (name) => {
    const names = new Set(REAL_TABLE.names);
    names.delete(name);
    const problems = completenessProblems(analyzeOutcomeCodes(realSources()), { names, prefixNames: REAL_TABLE.prefixNames });
    expect(problems.some((p) => p.includes(`${name} is emitted but is not in the table`))).toBe(true);
  });

  it('mutation: a table entry nobody emits goes red', () => {
    const names = new Set([...REAL_TABLE.names, 'NEVER_EMITTED_CODE']);
    const problems = completenessProblems(analyzeOutcomeCodes(realSources()), { names, prefixNames: REAL_TABLE.prefixNames });
    expect(problems).toContain('table entry NEVER_EMITTED_CODE is never emitted');
  });

  const withExtra = (snippet: string): Record<string, string> => {
    const s = realSources();
    return { ...s, 'data-consolidation-service.ts': `${s['data-consolidation-service.ts']}\n${snippet}\n` };
  };
  it.each([
    ['a string literal', `const m1 = { rejectedSources: [{ source: 'NSE', value: 1, reason: 'BRAND_NEW_CODE' }] };`],
    ['an unknown table name', `const m2 = { rejectedSources: [{ source: 'NSE', value: 1, reason: OUTCOME_CODE.NOT_A_CODE }] };`],
    ['an unlisted variable', `const m3 = { rejectedSources: [{ source: 'NSE', value: 1, reason: someReason }] };`],
    ['a push with a literal', `result.rejectedSources.push({ source: 'NSE', value: 1, reason: 'PUSHED_CODE' });`],
    ['a non-array rejectedSources', `const m5 = { rejectedSources: buildRejections() };`],
    ['a spread entry', `const m6 = { rejectedSources: [...others] };`],
    ['a REFUSED pre-rank result with a literal', `const m7 = { status: 'REFUSED', reason: 'NEW_PRE_RANK_REFUSAL' };`],
    ['a new resolutionReason assignment', `resolutionReason = 'NEW_RESOLUTION';`],
    ['a shorthand rejectedSources', `const m9 = { rejectedSources };`],
  ])('mutation: an uncategorized emit (%s) goes red', (_label, snippet) => {
    const problems = completenessProblems(analyzeOutcomeCodes(withExtra(snippet)), REAL_TABLE);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('mutation: a carrier whose function is renamed fails closed', () => {
    const s = realSources();
    const renamed = s['listing-exchange-resolution.ts'].replace(/function decideListingExchangesOd129\b/, 'function renamedDecider');
    const problems = completenessProblems(analyzeOutcomeCodes({ ...s, 'listing-exchange-resolution.ts': renamed }), REAL_TABLE);
    expect(problems.some((p) => p.includes('not found (fail closed)'))).toBe(true);
  });
});

describe('#1379 round 3: categories at runtime', () => {
  it.each(Object.keys(OUTCOME_CODE) as OutcomeCodeName[])('%s reads as its table category', (name) => {
    const reason = OUTCOME_PREFIX_NAMES.has(name) ? `${OUTCOME_CODE[name]}SUFFIX` : OUTCOME_CODE[name];
    expect(outcomeCategoryOf(reason)).toBe(OUTCOME_CATEGORY[name]);
    expect(isPriorityLossReason(reason)).toBe(OUTCOME_CATEGORY[name] === 'KEEP');
  });
  it('an unknown code is a REFUSE (fail closed), never a priority loss', () => {
    expect(outcomeCategoryOf('SOME_FUTURE_CODE')).toBe('REFUSE');
    expect(isPriorityLossReason('SOME_FUTURE_CODE')).toBe(false);
    expect(isPriorityLossReason(undefined)).toBe(false);
  });
  it('a bare prefix (no suffix) is not the prefix entry', () => {
    expect(isPriorityLossReason('SME_SINGLE_EXCHANGE_COLLAPSE_')).toBe(false);
  });
});
