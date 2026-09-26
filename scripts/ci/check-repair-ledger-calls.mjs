#!/usr/bin/env node
// #457 round 2: every repair ledger must be a typed RepairLedgerPayload — the
// `tsc` half of the detection alone did not hold, in three measured ways:
//   1. a caller excluded from scraper/tsconfig.scripts.json is never type-checked
//      (repair-lead-managers-from-payload.ts kept the old shape);
//   2. a passthrough slot typed `(path, payload: unknown) => string` accepts
//      writeLedgerFile under strict:false (bivariant params), so the call site
//      is type-checked against `unknown` (refresh-staging-row-from-prod.ts);
//   3. an `as unknown as RepairLedgerPayload` cast at the call site
//      (repair-risk-factor-heading-hash.ts).
// writeLedgerFile's runtime `assertRepairLedgerPayload` is the backstop; this
// lint refuses all three shapes before merge. It parses with TypeScript's own
// AST (never-hand-roll-a-lexer, #694).
//
// Rules, over scraper/scripts/**/*.ts:
//   R1 an `as unknown` / `as any` anywhere inside a writeLedgerFile(...) argument;
//   R2 in a file that references writeLedgerFile, a parameter named `payload`
//      typed `unknown` or `any` (the passthrough hole);
//   R3 a file excluded from tsconfig.scripts.json that calls writeLedgerFile
//      with a second argument that is not an object literal carrying
//      tool / mode / generatedAt / changes.
//
// Usage: node scripts/ci/check-repair-ledger-calls.mjs [rootDir]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const CALLEE = 'writeLedgerFile';
const REQUIRED_KEYS = ['tool', 'mode', 'generatedAt', 'changes'];

function parse(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function isLooseType(typeNode) {
  return !!typeNode && (typeNode.kind === ts.SyntaxKind.UnknownKeyword || typeNode.kind === ts.SyntaxKind.AnyKeyword);
}

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

/** Returns a list of `{ line, rule, message }` for one source file. */
export function checkSource(fileName, source, { excludedFromTsc = false } = {}) {
  const sf = parse(fileName, source);
  const out = [];
  let references = false;
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visitArg = (node) => {
    if (ts.isAsExpression(node) && isLooseType(node.type)) {
      out.push({ line: at(node), rule: 'R1', message: `\`as ${node.type.getText(sf)}\` inside a ${CALLEE}() argument hides the payload's shape from tsc` });
    }
    ts.forEachChild(node, visitArg);
  };

  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === CALLEE) references = true;
    if (ts.isCallExpression(node) && calleeName(node.expression) === CALLEE) {
      for (const a of node.arguments) visitArg(a);
      if (excludedFromTsc) {
        const payload = node.arguments[1];
        const ok =
          payload &&
          ts.isObjectLiteralExpression(payload) &&
          REQUIRED_KEYS.every((k) =>
            payload.properties.some(
              (p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name && p.name.getText(sf) === k
            )
          );
        if (!ok) {
          out.push({
            line: at(node),
            rule: 'R3',
            message: `file is excluded from scraper/tsconfig.scripts.json, so its ${CALLEE}() payload must be an object literal with ${REQUIRED_KEYS.join(', ')}`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // The module that DEFINES writeLedgerFile owns the runtime validator, whose
  // input is `unknown` by design (it is what catches an untyped caller).
  const definesCallee = /function\s+writeLedgerFile\s*\(/.test(source);
  if (references && !definesCallee) {
    const visitParams = (node) => {
      if ((ts.isParameter(node) || ts.isPropertySignature(node)) && node.name && node.name.getText(sf) === 'payload' && isLooseType(node.type)) {
        out.push({ line: at(node), rule: 'R2', message: `\`payload: ${node.type.getText(sf)}\` in a file that passes ${CALLEE} around — type it RepairLedgerPayload` });
      }
      ts.forEachChild(node, visitParams);
    };
    visitParams(sf);
  }
  return out;
}

/** The scraper/scripts files tsconfig.scripts.json excludes (repo-relative, forward slashes). */
export function readExcluded(root) {
  const cfg = JSON.parse(readFileSync(path.join(root, 'scraper', 'tsconfig.scripts.json'), 'utf8'));
  return new Set((cfg.exclude ?? []).filter((e) => e.endsWith('.ts')).map((e) => `scraper/${e}`.replace(/\\/g, '/')));
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') walk(full, acc);
    } else if (name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

export function run(root = process.cwd()) {
  const excluded = readExcluded(root);
  const violations = [];
  for (const file of walk(path.join(root, 'scraper', 'scripts'))) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const source = readFileSync(file, 'utf8');
    if (!source.includes(CALLEE)) continue;
    for (const v of checkSource(rel, source, { excludedFromTsc: excluded.has(rel) })) violations.push({ file: rel, ...v });
  }
  return violations;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const violations = run(process.argv[2] ?? process.cwd());
  for (const v of violations) console.error(`${v.file}:${v.line} [${v.rule}] ${v.message}`);
  if (violations.length > 0) {
    console.error(`check-repair-ledger-calls: ${violations.length} violation(s) — a repair ledger must be a typed RepairLedgerPayload (#457).`);
    process.exit(1);
  }
  console.log('check-repair-ledger-calls: every writeLedgerFile call is typed (#457).');
}
