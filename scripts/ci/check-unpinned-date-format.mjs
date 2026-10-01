#!/usr/bin/env node
/**
 * Detection check for failure class `host-timezone-date-format`
 * (docs/reviews/failure-classes/host-timezone-date-format.json), issue #1347.
 *
 * Core mechanism: date-fns `format()` and `toLocale*String()` / `Intl.DateTimeFormat` WITHOUT a
 * `timeZone` print in the zone of the RUNNING process. The VPS renders in UTC and the reader's
 * browser in IST (or anywhere), so a component that formats a date that way produces different
 * text on the server and in the browser: React #418 (hydration mismatch), and a date that is one
 * day off for part of every IST day (.claude/rules/ist-timezone.md).
 *
 * The fix is the IST helpers in web/lib/utils/date-formatter.ts (formatIPODate, formatIstDateTime,
 * formatInIst). This check keeps new unpinned formatting out of web/components, web/app and web/lib.
 *
 * It parses each file with the TypeScript compiler (no hand-rolled lexer) and decides by IMPORT
 * SOURCE, not identifier text:
 *   - date-fns   : any reference to an imported zone-dependent formatter (format, formatISO,
 *                  formatISO9075, formatRFC3339, formatRFC7231, formatRelative, lightFormat),
 *                  whatever local name it was imported under; `import * as df` -> df.format.
 *   - FAIL CLOSED: a shape that cannot be resolved is reported, never skipped: a re-export of
 *                  date-fns (`export ... from`), `require('date-fns')`, `import('date-fns')`, a
 *                  namespace import used other than `ns.name`, a bare `Intl` reference, an options
 *                  argument that is not an object literal or contains a spread.
 *   - Intl.DateTimeFormat / toLocaleDateString / toLocaleTimeString without `timeZone`.
 *   - toLocaleString: flagged when its options literal names a date/time field without `timeZone`,
 *                  or (no options / unresolvable options) when the receiver is `new Date(...)` or a
 *                  name that reads as a date (…Date, …Time, …At, …Stamp). KNOWN BLIND SPOT: a
 *                  date held in a variable with a non-date name, formatted with no options, looks
 *                  like a number to a syntax-only check (no type checker here, by design).
 *
 * Deliberate uses are listed in scripts/ci/unpinned-date-format-baseline.json, one entry per
 * (file, kind) with a count and a reason. A new offender fails; a count BELOW its baseline also
 * fails ("lower the baseline") so the baseline can never hide room for a new offender.
 *
 * Usage: node scripts/ci/check-unpinned-date-format.mjs [--baseline]
 *   --baseline  print the current offender counts as baseline JSON (reasons left as TODO)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(__dirname, 'unpinned-date-format-baseline.json');
const SCAN_DIRS = ['web/components', 'web/app', 'web/lib'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs']);
const EXCLUDE = [/\/node_modules\//, /\/\.next\//, /\.d\.ts$/, /\.(test|spec)\.[a-z]+$/, /\/__tests__\//];

export const ZONE_DEPENDENT_DATE_FNS = new Set([
  'format', 'formatISO', 'formatISO9075', 'formatRFC3339', 'formatRFC7231', 'formatRelative', 'lightFormat',
]);
const DATE_FIELD_KEYS = new Set([
  'dateStyle', 'timeStyle', 'weekday', 'era', 'year', 'month', 'day', 'hour', 'minute', 'second',
  'fractionalSecondDigits', 'hour12', 'hourCycle', 'timeZoneName', 'dayPeriod',
]);
const DATE_LIKE_NAME = /(?:Date|date|Time|time|Stamp|stamp|At)$/;

const isDateFnsSpecifier = (s) => s === 'date-fns' || s.startsWith('date-fns/');

/** Pure: scan one source text, return [{ kind, line, detail }]. */
export function scanSource(text, fileName = 'x.tsx') {
  const kind = fileName.endsWith('.tsx') || fileName.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const report = (k, n, detail) => out.push({ kind: k, line: lineOf(n), detail });

  const flaggedLocals = new Set(); // local names bound to a zone-dependent date-fns formatter
  const namespaces = new Set(); // local names bound to `import * as ns from 'date-fns'`

  // Pass 1: imports (and unresolvable date-fns module references).
  const visitImports = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && isDateFnsSpecifier(n.moduleSpecifier.text)) {
      const spec = n.moduleSpecifier.text;
      const clause = n.importClause;
      if (clause && !clause.isTypeOnly) {
        const sub = spec === 'date-fns' ? null : spec.slice('date-fns/'.length);
        if (clause.name) {
          if (sub && ZONE_DEPENDENT_DATE_FNS.has(sub)) flaggedLocals.add(clause.name.text);
          else if (!sub) report('date-fns-unresolved', clause.name, `default import of '${spec}'`);
        }
        const nb = clause.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) namespaces.add(nb.name.text);
        else if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            if (el.isTypeOnly) continue;
            const imported = (el.propertyName ?? el.name).text;
            if (ZONE_DEPENDENT_DATE_FNS.has(imported) || (imported === 'default' && sub && ZONE_DEPENDENT_DATE_FNS.has(sub))) {
              flaggedLocals.add(el.name.text);
            }
          }
        }
      }
    }
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && isDateFnsSpecifier(n.moduleSpecifier.text)) {
      report('date-fns-unresolved', n, `re-export from '${n.moduleSpecifier.text}'`);
    }
    if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0]) && isDateFnsSpecifier(n.arguments[0].text)) {
      const callee = n.expression;
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
        report('date-fns-unresolved', n, `require/dynamic import of '${n.arguments[0].text}'`);
      }
    }
    ts.forEachChild(n, visitImports);
  };
  visitImports(sf);

  const optionsVerdict = (argNode) => {
    // 'pinned' | 'unpinned' | 'unresolved'
    if (!argNode) return 'unpinned';
    if (!ts.isObjectLiteralExpression(argNode)) return 'unresolved';
    let hasSpread = false;
    for (const p of argNode.properties) {
      if (ts.isSpreadAssignment(p)) hasSpread = true;
      else if (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === 'timeZone') return 'pinned';
    }
    return hasSpread ? 'unresolved' : 'unpinned';
  };
  const literalKeys = (obj) =>
    obj.properties.filter((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))).map((p) => p.name.text);
  const receiverLooksLikeDate = (expr) => {
    if (ts.isNewExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'Date') return true;
    let e = expr;
    while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
    if (ts.isIdentifier(e)) return DATE_LIKE_NAME.test(e.text);
    if (ts.isPropertyAccessExpression(e)) return DATE_LIKE_NAME.test(e.name.text);
    return false;
  };
  const isIntlRef = (e) => (ts.isIdentifier(e) && e.text === 'Intl') || (ts.isPropertyAccessExpression(e) && e.name.text === 'Intl');

  const visit = (n) => {
    // Identifier references.
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isPropName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) ||
        ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)) && p.name === n) ||
        (ts.isQualifiedName(p)) ||
        ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) ||
        (ts.isBindingElement(p) && p.propertyName === n);
      if (!isPropName) {
        if (flaggedLocals.has(n.text)) report('date-fns-format', n, `date-fns formatter '${n.text}' (host-zone dependent)`);
        if (namespaces.has(n.text)) {
          const viaMember = ts.isPropertyAccessExpression(p) && p.expression === n;
          if (!viaMember) report('date-fns-unresolved', n, `namespace '${n.text}' used other than as ${n.text}.<name>`);
          else if (ZONE_DEPENDENT_DATE_FNS.has(p.name.text)) report('date-fns-format', n, `date-fns formatter '${n.text}.${p.name.text}' (host-zone dependent)`);
        }
        if (n.text === 'Intl') {
          const viaMember = ts.isPropertyAccessExpression(p) && p.expression === n;
          const viaNested = ts.isPropertyAccessExpression(p) && p.name === n; // globalThis.Intl
          if (!viaMember && !viaNested) report('intl-datetimeformat', n, "bare 'Intl' reference (cannot resolve which constructor is used)");
        }
      }
    }
    // Namespace via element access: ns['format'] -> the identifier branch reports it as unresolved.
    // Intl.DateTimeFormat(...) / new Intl.DateTimeFormat(...)
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'DateTimeFormat' && isIntlRef(n.expression)) {
      const p = n.parent;
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === n) {
        const v = optionsVerdict(p.arguments?.[1]);
        if (v === 'unpinned') report('intl-datetimeformat', n, 'Intl.DateTimeFormat without timeZone');
        else if (v === 'unresolved') report('intl-datetimeformat', n, 'Intl.DateTimeFormat options cannot be resolved (not a plain object literal)');
      } else {
        report('intl-datetimeformat', n, 'Intl.DateTimeFormat used other than as a direct constructor call');
      }
    }
    // x.toLocaleDateString / toLocaleTimeString / toLocaleString
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const name = n.expression.name.text;
      if (name === 'toLocaleDateString' || name === 'toLocaleTimeString') {
        const v = optionsVerdict(n.arguments[1]);
        if (v === 'unpinned') report('locale-string', n, `${name} without timeZone`);
        else if (v === 'unresolved') report('locale-string', n, `${name} options cannot be resolved`);
      } else if (name === 'toLocaleString') {
        const opt = n.arguments[1];
        const dateLike = receiverLooksLikeDate(n.expression.expression);
        if (opt && ts.isObjectLiteralExpression(opt)) {
          const keys = literalKeys(opt);
          const pinned = keys.includes('timeZone');
          const dateKeys = keys.some((k) => DATE_FIELD_KEYS.has(k));
          if (!pinned && (dateKeys || dateLike)) report('locale-string', n, 'toLocaleString date formatting without timeZone');
        } else if (dateLike) {
          report('locale-string', n, 'toLocaleString on a date-like receiver without a resolvable timeZone');
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = full.split(path.sep).join('/');
    if (EXCLUDE.some((re) => re.test(rel + (statSync(full).isDirectory() ? '/' : '')))) continue;
    if (statSync(full).isDirectory()) walk(full, files);
    else if (EXTENSIONS.has(path.extname(name)) && !EXCLUDE.some((re) => re.test(rel))) files.push(full);
  }
  return files;
}

export function scanTree(root = REPO_ROOT, dirs = SCAN_DIRS) {
  const counts = new Map(); // `${file}\t${kind}` -> { file, kind, count, lines }
  for (const d of dirs) {
    const abs = path.join(root, d);
    if (!existsSync(abs)) continue;
    for (const f of walk(abs)) {
      const rel = path.relative(root, f).split(path.sep).join('/');
      for (const v of scanSource(readFileSync(f, 'utf8'), rel)) {
        const key = `${rel}\t${v.kind}`;
        const e = counts.get(key) ?? { file: rel, kind: v.kind, count: 0, lines: [] };
        e.count += 1;
        e.lines.push(`${v.line}: ${v.detail}`);
        counts.set(key, e);
      }
    }
  }
  return [...counts.values()].sort((a, b) => (a.file + a.kind).localeCompare(b.file + b.kind));
}

/** Pure: compare current offenders to the baseline entries; returns problem strings. */
export function compareToBaseline(current, baseline) {
  const problems = [];
  const base = new Map();
  for (const b of baseline) {
    if (typeof b.reason !== 'string' || b.reason.trim().length < 20) {
      problems.push(`baseline entry ${b.file} [${b.kind}] needs a reason of 20+ characters`);
    }
    base.set(`${b.file}\t${b.kind}`, b);
  }
  for (const c of current) {
    const b = base.get(`${c.file}\t${c.kind}`);
    if (!b) {
      problems.push(`NEW unpinned date formatting in ${c.file} [${c.kind}] x${c.count}:\n    ${c.lines.join('\n    ')}`);
    } else if (c.count > b.count) {
      problems.push(`${c.file} [${c.kind}] has ${c.count} offenders, baseline allows ${b.count}:\n    ${c.lines.join('\n    ')}`);
    }
  }
  const cur = new Map(current.map((c) => [`${c.file}\t${c.kind}`, c]));
  for (const b of baseline) {
    const c = cur.get(`${b.file}\t${b.kind}`);
    if (!c) problems.push(`baseline entry ${b.file} [${b.kind}] no longer matches anything: remove it`);
    else if (c.count < b.count) problems.push(`baseline entry ${b.file} [${b.kind}] says ${b.count} but only ${c.count} remain: lower it`);
  }
  return problems;
}

function main() {
  const current = scanTree();
  if (process.argv.includes('--baseline')) {
    console.log(JSON.stringify(current.map(({ file, kind, count }) => ({ file, kind, count, reason: 'TODO' })), null, 2));
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const problems = compareToBaseline(current, baseline);
  if (problems.length > 0) {
    console.error('FAIL: unpinned date formatting (host-timezone-date-format, #1347)');
    for (const p of problems) console.error(`  ${p}`);
    console.error(
      '\nUse formatIPODate / formatIstDateTime / formatInIst from @/lib/utils/date-formatter, or pass timeZone: \'Asia/Kolkata\'.\n' +
        'A deliberate client-only use is added to scripts/ci/unpinned-date-format-baseline.json with a reason.'
    );
    process.exit(1);
  }
  console.log(`PASS: ${current.length} baselined (file, kind) entries, no new unpinned date formatting.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
