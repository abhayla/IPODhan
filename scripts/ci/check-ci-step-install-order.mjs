#!/usr/bin/env node
/**
 * check-ci-step-install-order — a CI step that runs before its job's `npm ci`
 * (or in a job that never installs) may only reach Node builtins.
 *
 * WHY THIS EXISTS (T-570, registry class ci-step-imports-package-before-install).
 * Three times on 2026-09-26 a `node` / `node --test` step was placed before
 * `npm ci`, or in a job with no install at all, while the file it runs reached
 * an npm package through its import graph (`typescript` in PR #1139, `pg` via
 * scripts/lib/pg-utc.mjs in PR #1146, `pg` via scripts/ops/admin-queue-size.mjs
 * in PR #1174). All three passed on the laptop, where node_modules exists, and
 * failed in CI with ERR_MODULE_NOT_FOUND. A hand-written "builtins only"
 * comment above the step was the only guard, and it was wrong each time.
 *
 * What it does: for every job of every workflow under .github/workflows/, it
 * walks the steps in order, tracks whether an `npm ci` / `npm install` has run
 * yet, extracts every `node` invocation of a repo file from each pre-install
 * `run:` body (`node <script>`, `node --test <f1> <f2> ...`, `--import` /
 * `--require` / `--loader` values), and resolves each file's STATIC import
 * graph:
 *   - `import ... from '<s>'`, `import '<s>'`, `export ... from '<s>'`
 *     (`import type` / `export type` are erased by TS type stripping: skipped)
 *   - `import('<literal>')` and `require('<literal>')`
 *   - child node scripts a file launches through child_process / execa
 *     (spawnSync(process.execPath, [SCRIPT]), fork(SCRIPT), ...), #1180; see
 *     spawnedScripts() below, which fails closed on paths it cannot resolve
 * Relative specifiers are followed (a `.js` specifier falls back to `.ts`, the
 * NodeNext convention). `node:` specifiers and bare builtins end the walk.
 * Anything else is an npm package, and reaching one from a pre-install step
 * fails the gate, naming the step, the file, the package and the import chain.
 *
 * Deliberately builtins-only itself: it runs as a pre-install step.
 *
 * Usage:  node scripts/ci/check-ci-step-install-order.mjs [--root <dir>] [--verbose]
 * Exit 0 = every pre-install step reaches builtins only. Exit 1 = a violation
 * (or a pre-install file that cannot be resolved). Exit 2 = the checker failed.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, resolve, dirname, extname, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOWS_DIR = join('.github', 'workflows');
const CODE_EXTS = new Set(['.mjs', '.js', '.cjs', '.ts', '.mts', '.cts']);
const TRY_EXTS = ['.mjs', '.js', '.cjs', '.ts', '.mts', '.cts'];
const JS_TO_TS = { '.js': ['.ts'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
// node flags that take a separate value argument.
const VALUE_FLAGS = new Set([
  '--import', '--require', '-r', '--loader', '--experimental-loader',
  '--test-reporter', '--test-reporter-destination', '--test-name-pattern',
  '--test-skip-pattern', '--test-concurrency', '--test-timeout', '--env-file',
  '--conditions', '-C', '--input-type', '--title', '--stack-size',
]);
const PRELOAD_FLAGS = new Set(['--import', '--require', '-r', '--loader', '--experimental-loader']);
const EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print']);
const SHELL_PREFIX_WORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'time', 'exec', 'command', '{']);

const toPosix = (p) => p.split(sep).join('/');

export function isBuiltin(spec) {
  if (spec.startsWith('node:')) return true;
  return builtinModules.includes(spec);
}

export function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// ---------------------------------------------------------------- workflow YAML

const indentOf = (l) => l.length - l.trimStart().length;

/** Strip a YAML scalar's surrounding quotes and any trailing ` # comment`. */
function scalar(v) {
  let s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s.replace(/\s+#.*$/, '');
}

/** Read a key's value inside `lines` at `keyIndent`; handles `|` / `>` block scalars. */
function readKey(lines, key, keyIndent) {
  const re = new RegExp(`^${key}:(.*)$`);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (indentOf(l) !== keyIndent) continue;
    const m = l.trim().match(re);
    if (!m) continue;
    const rest = m[1].trim();
    const block = rest.match(/^([|>])[-+0-9]*\s*(#.*)?$/);
    if (!block) return { value: scalar(rest), line: i };
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') { body.push(''); continue; }
      if (indentOf(lines[j]) <= keyIndent) break;
      body.push(lines[j]);
    }
    while (body.length && body[body.length - 1] === '') body.pop();
    const minIndent = Math.min(...body.filter((b) => b !== '').map(indentOf));
    const dedented = body.map((b) => (b === '' ? '' : b.slice(minIndent)));
    const value = block[1] === '|'
      ? dedented.join('\n')
      : dedented.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ');
    return { value, line: i };
  }
  return null;
}

/**
 * Parse a workflow into jobs -> ordered steps. A deliberately small, line-based
 * reader for the GitHub Actions shape (`jobs:` -> `<id>:` -> `steps:` -> `- `
 * items); no YAML library, because this runs before `npm ci`.
 */
export function parseWorkflowJobs(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const jobsAt = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (jobsAt === -1) return [];
  const jobs = [];
  let jobIndent = null;
  for (let i = jobsAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || l.trim().startsWith('#')) continue;
    const ind = indentOf(l);
    if (ind === 0) break;
    if (jobIndent === null) jobIndent = ind;
    if (ind === jobIndent && /^[A-Za-z0-9_-]+:\s*(#.*)?$/.test(l.trim())) {
      jobs.push({ id: l.trim().split(':')[0], start: i, end: lines.length });
      if (jobs.length > 1) jobs[jobs.length - 2].end = i;
    } else if (ind < jobIndent) {
      break;
    }
  }
  if (jobs.length) {
    // clamp the last job's end at the next top-level key
    const last = jobs[jobs.length - 1];
    for (let i = last.start + 1; i < lines.length; i++) {
      if (lines[i].trim() !== '' && !lines[i].trim().startsWith('#') && indentOf(lines[i]) === 0) { last.end = i; break; }
    }
  }
  return jobs.map((job) => {
    const body = lines.slice(job.start + 1, job.end);
    const firstKey = body.find((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    const keyIndent = firstKey ? indentOf(firstKey) : jobIndent + 2;
    const defWd = (() => {
      const d = body.findIndex((l) => indentOf(l) === keyIndent && /^defaults:/.test(l.trim()));
      if (d === -1) return null;
      const sub = [];
      for (let j = d + 1; j < body.length && (body[j].trim() === '' || indentOf(body[j]) > keyIndent); j++) sub.push(body[j]);
      const wd = sub.find((l) => /^working-directory:/.test(l.trim()));
      return wd ? scalar(wd.trim().slice('working-directory:'.length)) : null;
    })();
    const stepsAt = body.findIndex((l) => indentOf(l) === keyIndent && /^steps:\s*(#.*)?$/.test(l.trim()));
    const steps = [];
    if (stepsAt !== -1) {
      let stepIndent = null;
      let cur = null;
      for (let i = stepsAt + 1; i < body.length; i++) {
        const l = body[i];
        if (l.trim() === '') { if (cur) cur.lines.push(''); continue; }
        const ind = indentOf(l);
        if (l.trim().startsWith('#') && (stepIndent === null || ind <= stepIndent)) continue;
        if (ind <= keyIndent) break;
        if (stepIndent === null && l.trim().startsWith('- ')) stepIndent = ind;
        if (ind === stepIndent && l.trim().startsWith('- ')) {
          cur = { lines: [' '.repeat(ind) + '  ' + l.trim().slice(2)], fileLine: job.start + 2 + i };
          steps.push(cur);
        } else if (cur) {
          cur.lines.push(l);
        }
      }
      for (const [idx, s] of steps.entries()) {
        const ki = stepIndent + 2;
        s.index = idx;
        s.name = readKey(s.lines, 'name', ki)?.value ?? null;
        s.uses = readKey(s.lines, 'uses', ki)?.value ?? null;
        s.run = readKey(s.lines, 'run', ki)?.value ?? null;
        s.workingDirectory = readKey(s.lines, 'working-directory', ki)?.value ?? defWd;
        delete s.lines;
      }
    }
    return { id: job.id, steps };
  });
}

// ---------------------------------------------------------------- shell run bodies

/** Split a shell word list, honouring simple single/double quotes. */
function words(cmd) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (const m of cmd.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * Every simple command of a `run:` body, in order, with the directory it runs
 * in (tracking `cd`). Returns [{ argv, cwd }].
 */
export function simpleCommands(run, startCwd = '.') {
  const joined = run.replace(/\\\r?\n/g, ' ');
  const noComments = joined
    .split('\n')
    .map((l) => (l.trim().startsWith('#') ? '' : l.replace(/(^|\s)#.*$/, '$1')))
    .join('\n');
  const out = [];
  let cwd = startCwd;
  for (const raw of noComments.split(/&&|\|\||[;|\n()`]|\$\(/)) {
    let argv = words(raw.trim());
    while (argv.length && (SHELL_PREFIX_WORDS.has(argv[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]))) argv.shift();
    if (argv[0] === 'timeout' && argv.length > 2) argv = argv.slice(2);
    if (!argv.length) continue;
    if ((argv[0] === 'cd' || argv[0] === 'pushd') && argv[1]) {
      cwd = toPosix(join(cwd, argv[1]));
      continue;
    }
    out.push({ argv, cwd });
  }
  return out;
}

export function isInstallCommand(argv) {
  if (!['npm', 'pnpm', 'yarn'].includes(argv[0])) return false;
  if (argv.includes('-g') || argv.includes('--global')) return false;
  if (argv[0] === 'yarn') return argv.length === 1 || argv[1] === 'install';
  return ['ci', 'install', 'i'].includes(argv[1]);
}

/**
 * The repo files a `node ...` argv loads: roots = positional files (all of them
 * under --test, only the first otherwise) plus relative preload values;
 * packages = bare, non-builtin preload values (e.g. `--import tsx`).
 */
export function nodeInvocationTargets(argv) {
  const cmd = argv[0].split('/').pop();
  if (cmd !== 'node' && cmd !== 'node.exe') return null;
  const roots = [];
  const packages = [];
  let testMode = false;
  let evalMode = false;
  const positional = [];
  let i = 1;
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { i++; break; }
    if (!a.startsWith('-')) break;
    const [flag, inlineVal] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, null];
    if (flag === '--test') { testMode = true; continue; }
    if (EVAL_FLAGS.has(flag)) { evalMode = true; if (inlineVal === null) i++; continue; }
    if (VALUE_FLAGS.has(flag)) {
      const v = inlineVal ?? argv[++i];
      if (PRELOAD_FLAGS.has(flag) && v) {
        if (v.startsWith('.') || v.startsWith('/')) roots.push(v);
        else if (!isBuiltin(v)) packages.push(packageName(v));
      }
    }
  }
  if (evalMode) return { roots, packages, testMode };
  for (; i < argv.length; i++) {
    if (testMode && argv[i].startsWith('-')) continue;
    positional.push(argv[i]);
    if (!testMode) break;
  }
  for (const p of positional) {
    if (p.includes('$') || /[*?[]/.test(p)) continue;
    roots.push(p);
  }
  return { roots, packages, testMode };
}

// ---------------------------------------------------------------- import graph

// After one of these, a `/` starts a regular-expression literal, not a division.
const REGEX_AFTER_PUNCT = new Set([...'(,=:[!&|?{};+-*%<>~^']);
const REGEX_AFTER_WORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);

/**
 * Mask a JS/TS source so import patterns can only match real code: comments and
 * template-literal text become spaces (newlines kept), regex literals become
 * spaces, and every '...' / "..." string becomes a numbered placeholder whose
 * text is kept in `strings`. This is what stops an `import ... from 'pg'` that
 * lives inside a test's fixture template string, or a "require('dotenv')" inside
 * a string, from counting as a runtime import. `${...}` expressions inside a
 * template are scanned as code.
 */
export function maskSource(src) {
  const out = [];
  const strings = [];
  const frames = [{ mode: 'code', depth: 0 }];
  let lastSig = '';
  let lastWord = '';
  let i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  if (src.startsWith('#!')) { const e = src.indexOf('\n'); i = e === -1 ? n : e; out.push(' '.repeat(i)); }
  while (i < n) {
    const frame = frames[frames.length - 1];
    const c = src[i];
    if (frame.mode === 'template') {
      if (c === '\\') { out.push(blank(src.slice(i, i + 2))); i += 2; continue; }
      if (c === '`') { out.push(' '); frames.pop(); i++; lastSig = 'a'; lastWord = ''; continue; }
      if (c === '$' && src[i + 1] === '{') { out.push('  '); frames.push({ mode: 'code', depth: 0 }); i += 2; lastSig = '('; lastWord = ''; continue; }
      out.push(c === '\n' ? '\n' : ' ');
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      const end = e === -1 ? n : e;
      out.push(' '.repeat(end - i));
      i = end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e === -1 ? n : e + 2;
      out.push(blank(src.slice(i, end)));
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      strings.push(src.slice(i + 1, j));
      out.push(`${c}\u0000${strings.length - 1}\u0000${c}`);
      i = j + 1;
      lastSig = 'a'; lastWord = '';
      continue;
    }
    if (c === '`') { out.push(' '); frames.push({ mode: 'template' }); i++; continue; }
    if (c === '/') {
      const regexStart = lastSig === '' || REGEX_AFTER_PUNCT.has(lastSig) || REGEX_AFTER_WORD.has(lastWord);
      if (regexStart) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true;
          else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) break;
          j++;
        }
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++;
        out.push(blank(src.slice(i, j)));
        i = j;
        lastSig = 'a'; lastWord = '';
        continue;
      }
    }
    if (c === '{') frame.depth++;
    if (c === '}') {
      if (frame.depth === 0 && frames.length > 1) { out.push(' '); frames.pop(); i++; continue; }
      frame.depth--;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      lastWord = src.slice(i, j);
      lastSig = REGEX_AFTER_WORD.has(lastWord) ? '' : 'a';
      out.push(lastWord);
      i = j;
      continue;
    }
    if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
    out.push(c);
    i++;
  }
  return { code: out.join(''), strings };
}

/** Every module specifier a source file loads at runtime (static + literal dynamic). */
export function importSpecifiers(src) {
  const { code, strings } = maskSource(src);
  const specs = [];
  const add = (idx) => { const s = strings[Number(idx)]; if (s && !specs.includes(s)) specs.push(s); };
  const STR = `(['"])\\u0000(\\d+)\\u0000\\`;
  // import x from 's' / import {a} from 's' / export * from 's' / export {a} from 's'
  const fromRe = new RegExp(`^[ \\t]*(import|export)(?![\\w$.(])([^;'"]*?)\\bfrom\\s*${STR}3`, 'gm');
  for (const m of code.matchAll(fromRe)) {
    // `import type X from` / `export type { X } from` are erased by type stripping.
    if (/^\s+type\s+(?!from\b)[\w${*]/.test(m[2])) continue;
    add(m[4]);
  }
  for (const m of code.matchAll(new RegExp(`^[ \\t]*import\\s*${STR}1`, 'gm'))) add(m[2]);
  for (const m of code.matchAll(new RegExp(`(?<![\\w$.])import\\s*\\(\\s*${STR}1\\s*[,)]`, 'g'))) add(m[2]);
  for (const m of code.matchAll(new RegExp(`(?<![\\w$.])require\\s*\\(\\s*${STR}1\\s*\\)`, 'g'))) add(m[2]);
  return specs;
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

/** Resolve a relative specifier the way node (+ TS strip-types / tsx) would. */
export function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  if (isFile(base)) return base;
  const ext = extname(base);
  for (const alt of JS_TO_TS[ext] ?? []) {
    const p = base.slice(0, -ext.length) + alt;
    if (isFile(p)) return p;
  }
  for (const e of TRY_EXTS) if (isFile(base + e)) return base + e;
  for (const e of TRY_EXTS) if (isFile(join(base, 'index' + e))) return join(base, 'index' + e);
  return null;
}

// ---------------------------------------------------------------- spawned child scripts (#1180)
//
// A test that launches a repo script as a separate node process
// (`spawnSync(process.execPath, [SCRIPT])`) loads that script's import graph
// just as surely as an `import` would, but no import edge points at it. So the
// child is followed as an extra edge of the graph (shown as `=spawns=>`).
//
// The guard is named by IMPORT SOURCE, never by identifier text: only callees
// bound from `child_process` / `node:child_process` / `execa` (named, renamed,
// namespace, default, or `require` destructure/assign) count, so a local
// function that happens to be called `fork` is not a spawn, and
// `import { spawnSync as run }` is.
//
// Fail closed: a node child whose command, script path or argument list cannot
// be resolved statically (a computed path, a template literal, an `-e` eval
// body, a spread before the script, a child_process import in a shape this
// checker cannot bind) is reported as unresolved. A site that is genuinely safe
// carries `// install-order-ok: <reason>` on its line or the line above.
// Out of scope (noted in #1180): `exec` / `execSync` shell strings, and node
// launched indirectly through `bash` / `npx`.

const SPAWN_SOURCES = new Set(['child_process', 'node:child_process', 'execa']);
// callee name -> how its arguments are laid out
const SPAWN_KIND = {
  spawn: 'cmd', spawnSync: 'cmd', execFile: 'cmd', execFileSync: 'cmd',
  execa: 'cmd', execaSync: 'cmd', fork: 'script', execaNode: 'script',
};
const NODE = '\u0000NODE';
const WAIVER_RE = /\/\/\s*install-order-ok:\s*(\S.{9,})$/;

/** Split `code` from index `open` (just after a `(` or `[`) into top-level comma args. */
function splitArgs(code, open, closeCh) {
  const args = [];
  let depth = 0;
  let cur = '';
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) {
        if (c !== closeCh) return null;
        if (cur.trim()) args.push(cur.trim());
        return { args, end: i };
      }
      depth--;
    }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return null;
}

const reEsc = (n) => n.replace(/\$/g, '\\$');

/** Local names bound to spawn functions from a child-process source. */
export function spawnBindings(code, strings) {
  const fns = new Map(); // local name -> kind
  const namespaces = new Set();
  let bound = 0;
  const STR = `(['"])\\u0000(\\d+)\\u0000\\`;
  const srcOk = (idx) => SPAWN_SOURCES.has(strings[Number(idx)]);
  const addNamed = (list) => {
    for (const part of list.split(',')) {
      const m = part.trim().match(/^([\w$]+)(?:\s*(?:as|:)\s*([\w$]+))?$/);
      if (m && SPAWN_KIND[m[1]]) fns.set(m[2] ?? m[1], SPAWN_KIND[m[1]]);
    }
  };
  const staticIdx = new Set();
  for (const m of code.matchAll(new RegExp(`(?:^|[;\\n])[ \\t]*import\\s+([^;'"]*?)\\s*from\\s*${STR}2`, 'g'))) {
    if (!srcOk(m[3])) continue;
    staticIdx.add(m[3]);
    bound++;
    let clause = m[1].trim();
    if (/^type\s/.test(clause)) continue;
    const named = clause.match(/\{([^}]*)\}/);
    if (named) { addNamed(named[1]); clause = clause.replace(named[0], ''); }
    const ns = clause.match(/\*\s*as\s+([\w$]+)/);
    if (ns) { namespaces.add(ns[1]); clause = clause.replace(ns[0], ''); }
    const def = clause.replace(/,/g, ' ').trim();
    if (/^[\w$]+$/.test(def)) {
      if (strings[Number(m[3])] === 'execa') fns.set(def, 'cmd');
      else namespaces.add(def);
    }
  }
  for (const m of code.matchAll(new RegExp(`(?:const|let|var)\\s+(\\{[^}]*\\}|[\\w$]+)\\s*=\\s*require\\s*\\(\\s*${STR}2\\s*\\)\\s*(?=[;\\n,])`, 'g'))) {
    if (!srcOk(m[3])) continue;
    staticIdx.add(m[3]);
    bound++;
    if (m[1].startsWith('{')) addNamed(m[1].slice(1, -1));
    else namespaces.add(m[1]);
  }
  // Any other load of a child-process source (dynamic import, re-export,
  // `require(...).spawnSync`, `export * from`) is a binding this checker
  // cannot follow: report it rather than pass it.
  let unboundAt = -1;
  for (const [i, s] of strings.entries()) {
    if (!SPAWN_SOURCES.has(s) || staticIdx.has(String(i))) continue;
    const hit = code.search(new RegExp(`(?:import\\s*\\(|require\\s*\\(|from)\\s*(['"])\\u0000${i}\\u0000`));
    if (hit !== -1) { unboundAt = hit; break; }
  }
  return { fns, namespaces, unboundAt, bound };
}

/** Find `const|let|var NAME = <expr>` in the file; returns the expr text or null. */
function constExpr(code, name) {
  const re = new RegExp(`(?:const|let|var)\\s+${reEsc(name)}\\s*=\\s*`, 'g');
  const m = re.exec(code);
  if (!m) return null;
  let depth = 0;
  let out = '';
  for (let i = m.index + m[0].length; i < code.length; i++) {
    const c = code[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    if (depth === 0 && (c === ';' || c === '\n' || c === ',')) break;
    out += c;
  }
  return out.trim();
}

/**
 * Resolve an expression to a string value (a path or NODE), a URL ({ url }),
 * an array ({ items }), or null when it cannot be resolved statically.
 */
function resolveExpr(expr, ctx, depth = 0) {
  if (depth > 12 || expr == null) return null;
  let e = expr.trim();
  while (e.startsWith('(') && e.endsWith(')') && splitArgs(e, 1, ')')?.end === e.length - 1) e = e.slice(1, -1).trim();
  const str = e.match(/^(['"])\u0000(\d+)\u0000\1$/);
  if (str) return ctx.strings[Number(str[2])];
  if (e === 'process.execPath' || e === 'process.argv0') return NODE;
  if (e === 'import.meta.url') return { url: ctx.file };
  if (e === 'import.meta.filename') return ctx.file;
  if (e === 'import.meta.dirname') return dirname(ctx.file);
  if (/^process\.cwd\(\s*\)$/.test(e)) return ctx.cwd;
  if (e.startsWith('[') && e.endsWith(']')) {
    const parts = splitArgs(e, 1, ']');
    if (!parts || parts.end !== e.length - 1) return null;
    return { items: parts.args };
  }
  if (/^[\w$]+$/.test(e)) {
    const def = constExpr(ctx.code, e);
    if (def != null) return resolveExpr(def, ctx, depth + 1);
    if (e === '__dirname') return dirname(ctx.file);
    if (e === '__filename') return ctx.file;
    return null;
  }
  const url = e.match(/^new\s+URL\s*\(/);
  if (url) {
    const parts = splitArgs(e, url[0].length, ')');
    if (!parts || parts.end !== e.length - 1 || parts.args.length !== 2) return null;
    const rel = resolveExpr(parts.args[0], ctx, depth + 1);
    const base = resolveExpr(parts.args[1], ctx, depth + 1);
    if (typeof rel !== 'string' || !base?.url) return null;
    return { url: resolve(dirname(base.url), rel) };
  }
  if (e.endsWith('.href')) {
    const v = resolveExpr(e.slice(0, -5), ctx, depth + 1);
    return v?.url ? { url: v.url } : null;
  }
  const call = e.match(/^(?:(?:path|posix|nodePath|pathModule)\.)?([\w$]+)\s*\(/);
  if (call) {
    const parts = splitArgs(e, call[0].length, ')');
    if (!parts || parts.end !== e.length - 1) return null;
    const vals = parts.args.map((a) => resolveExpr(a, ctx, depth + 1));
    if (vals.some((v) => v == null)) return null;
    const fn = call[1];
    if (fn === 'fileURLToPath') return vals[0]?.url ?? null;
    if (fn === 'pathToFileURL') return typeof vals[0] === 'string' ? { url: vals[0] } : null;
    if (vals.some((v) => typeof v !== 'string' || v === NODE)) return null;
    if (fn === 'join') return join(...vals);
    if (fn === 'resolve') return resolve(ctx.cwd, ...vals);
    if (fn === 'dirname') return dirname(vals[0]);
    return null;
  }
  return null;
}

/**
 * Every child node script a source file launches. Returns
 * [{ line, script: absPath } | { line, unresolved: reason }].
 */
export function spawnedScripts(src, file, cwd) {
  const { code, strings } = maskSource(src);
  const { fns, namespaces, unboundAt } = spawnBindings(code, strings);
  const srcLines = src.split('\n');
  const lineOf = (idx) => code.slice(0, idx).split('\n').length;
  const waived = (line) => [srcLines[line - 1], srcLines[line - 2]].some((l) => l && WAIVER_RE.test(l.trim()));
  const out = [];
  const ctx = { code, strings, file, cwd };
  if (unboundAt !== -1) {
    const line = lineOf(unboundAt);
    if (!waived(line)) {
      out.push({ line, unresolved: 'loads child_process in a shape this checker cannot follow (use a static import or a require destructure)' });
    }
  }
  const alts = [];
  if (fns.size) alts.push(`(?<![\\w$.])(${[...fns.keys()].map(reEsc).join('|')})`);
  if (namespaces.size) {
    alts.push(`(?<![\\w$.])(?:${[...namespaces].map(reEsc).join('|')})\\.(${Object.keys(SPAWN_KIND).join('|')})`);
  }
  if (!alts.length) return out;
  const re = new RegExp(`(?:${alts.join('|')})\\s*\\(`, 'g');
  for (const m of code.matchAll(re)) {
    const kind = m[1] ? fns.get(m[1]) : SPAWN_KIND[m[2]];
    const line = lineOf(m.index);
    const parts = splitArgs(code, m.index + m[0].length, ')');
    const fail = (why) => { if (!waived(line)) out.push({ line, unresolved: why }); };
    if (!parts || !parts.args.length) { fail('a spawn call whose arguments cannot be parsed'); continue; }
    let argList;
    if (kind === 'cmd') {
      const cmd = resolveExpr(parts.args[0], ctx);
      if (typeof cmd !== 'string') { fail(`the command \`${parts.args[0]}\` cannot be resolved statically`); continue; }
      const base = cmd.split(/[\\/]/).pop();
      if (cmd !== NODE && base !== 'node' && base !== 'node.exe') continue; // not a node child
      argList = parts.args[1];
      if (argList == null) continue; // bare `node` with no script reads stdin: nothing to follow
    } else {
      argList = `[${parts.args[0]}]`;
    }
    const arr = resolveExpr(argList, ctx);
    if (!arr?.items) { fail(`the argument list \`${argList}\` cannot be resolved statically`); continue; }
    let script = null;
    let why = null;
    for (let k = 0; k < arr.items.length; k++) {
      const item = arr.items[k];
      if (item.startsWith('...')) { why = `a spread \`${item}\` before the script`; break; }
      const v = resolveExpr(item, ctx);
      const val = v?.url ?? v;
      if (typeof val !== 'string' || val === NODE) { why = `the script path \`${item}\` cannot be resolved statically`; break; }
      if (kind === 'cmd' && val.startsWith('-')) {
        const flag = val.includes('=') ? val.slice(0, val.indexOf('=')) : val;
        if (EVAL_FLAGS.has(flag)) { why = 'an `-e` / `--eval` child (its code is not followed)'; break; }
        if (PRELOAD_FLAGS.has(flag)) { why = `a ${flag} preload in a child`; break; }
        if (VALUE_FLAGS.has(flag) && !val.includes('=')) {
          const pv = resolveExpr(arr.items[k + 1] ?? '', ctx);
          if (typeof pv !== 'string') { why = `the value of ${flag} cannot be resolved statically`; break; }
          k++;
        }
        continue;
      }
      script = val;
      break;
    }
    if (!script) { fail(why ?? 'no script argument found'); continue; }
    const abs = isAbsolute(script) ? script : resolve(cwd, script);
    if (isFile(abs)) { out.push({ line, script: abs }); continue; }
    const alt = resolve(dirname(file), script);
    if (!isAbsolute(script) && isFile(alt)) { out.push({ line, script: alt }); continue; }
    fail(`the spawned script ${toPosix(script)} does not exist`);
  }
  return out;
}

/**
 * Walk a root file's import graph breadth-first (so each reported chain is the
 * shortest). Returns { packages: [{ pkg, specifier, chain }], unresolved: [...] }.
 */
export function walkImportGraph(rootFile, repoRoot, { cwd = repoRoot } = {}) {
  const rel = (p) => toPosix(relative(repoRoot, p));
  const parent = new Map([[rootFile, null]]);
  const spawnEdges = new Set();
  const queue = [rootFile];
  const packages = [];
  const unresolved = [];
  const unresolvedSpawns = [];
  const seenPkg = new Set();
  const chainTo = (f) => {
    const c = [];
    for (let cur = f; cur; cur = parent.get(cur)) c.unshift(cur);
    let s = rel(c[0]);
    for (let k = 1; k < c.length; k++) s += (spawnEdges.has(c[k]) ? ' =spawns=> ' : ' -> ') + rel(c[k]);
    return s;
  };
  while (queue.length) {
    const file = queue.shift();
    if (!CODE_EXTS.has(extname(file))) continue;
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    for (const spec of importSpecifiers(src)) {
      if (spec.startsWith('.') || spec.startsWith('/')) {
        const target = resolveRelative(file, spec);
        if (!target) { unresolved.push({ specifier: spec, chain: chainTo(file) }); continue; }
        if (!parent.has(target)) { parent.set(target, file); queue.push(target); }
      } else if (!isBuiltin(spec)) {
        const pkg = packageName(spec);
        if (seenPkg.has(pkg)) continue;
        seenPkg.add(pkg);
        packages.push({ pkg, specifier: spec, chain: chainTo(file) });
      }
    }
    for (const child of spawnedScripts(src, file, cwd)) {
      if (child.unresolved) {
        unresolvedSpawns.push({ reason: child.unresolved, at: `${rel(file)}:${child.line}`, chain: chainTo(file) });
        continue;
      }
      if (!parent.has(child.script)) {
        parent.set(child.script, file);
        spawnEdges.add(child.script);
        queue.push(child.script);
      }
    }
  }
  return { packages, unresolved, unresolvedSpawns };
}

// ---------------------------------------------------------------- analysis

export function listWorkflowFiles(root) {
  const base = join(root, WORKFLOWS_DIR);
  if (!existsSync(base)) throw new Error(`workflows directory not found: ${WORKFLOWS_DIR}`);
  return readdirSync(base)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((f) => toPosix(join(WORKFLOWS_DIR, f)));
}

/**
 * Returns { problems, checked } where checked lists every pre-install node
 * invocation examined (step, file, packages reached) and problems is empty on
 * a pass.
 */
export function analyze({ root, workflowPaths } = {}) {
  const paths = workflowPaths ?? listWorkflowFiles(root);
  const problems = [];
  const checked = [];
  for (const wf of paths) {
    const jobs = parseWorkflowJobs(readFileSync(join(root, wf), 'utf8'));
    for (const job of jobs) {
      let installed = false;
      for (const step of job.steps) {
        if (step.run == null) continue;
        const where = `${wf} job "${job.id}" step ${step.index + 1} "${step.name ?? '(unnamed)'}" (line ${step.fileLine})`;
        const startCwd = step.workingDirectory ? toPosix(join('.', step.workingDirectory)) : '.';
        for (const { argv, cwd } of simpleCommands(step.run, startCwd)) {
          if (isInstallCommand(argv)) { installed = true; continue; }
          if (installed) continue;
          const t = nodeInvocationTargets(argv);
          if (!t) continue;
          for (const pkg of t.packages) {
            problems.push(`${where}: \`node\` preloads package '${pkg}' before any npm ci in this job`);
          }
          for (const r of t.roots) {
            const abs = resolve(root, cwd, r);
            const shown = toPosix(relative(root, abs));
            if (!isFile(abs)) {
              problems.push(`${where}: runs ${shown}, which does not exist`);
              continue;
            }
            const g = walkImportGraph(abs, root, { cwd: resolve(root, cwd) });
            checked.push({ where, file: shown, packages: g.packages.map((p) => p.pkg) });
            for (const p of g.packages) {
              problems.push(
                `${where}: ${shown} reaches npm package '${p.pkg}' before any npm ci in this job\n` +
                  `      import chain: ${p.chain} -> '${p.specifier}'`
              );
            }
            for (const u of g.unresolved) {
              problems.push(
                `${where}: ${shown} has an unresolvable relative import '${u.specifier}'\n` +
                  `      import chain: ${u.chain}`
              );
            }
            for (const u of g.unresolvedSpawns) {
              problems.push(
                `${where}: ${shown} spawns a child that cannot be resolved statically at ${u.at}: ${u.reason}\n` +
                  `      import chain: ${u.chain}\n` +
                  '      Make the script path a literal or a path.join of literals, or mark the line ' +
                  '`// install-order-ok: <reason>` when the child cannot reach a package (#1180).'
              );
            }
          }
        }
      }
    }
  }
  return { problems, checked };
}

function main(argv) {
  const rootFlag = argv.indexOf('--root');
  const here = fileURLToPath(new URL('.', import.meta.url));
  const root = rootFlag !== -1 ? resolve(argv[rootFlag + 1]) : resolve(here, '..', '..');
  let result;
  try {
    result = analyze({ root });
  } catch (err) {
    console.error(`ci-step install-order check FAILED to run: ${err.message}`);
    return 2;
  }
  const { problems, checked } = result;
  console.log(`pre-install node invocations checked: ${checked.length}`);
  if (argv.includes('--verbose')) {
    for (const c of checked) console.log(`  ${c.file}  [${c.packages.join(', ') || 'builtins only'}]  <- ${c.where}`);
  }
  if (problems.length) {
    console.error(`\nci-step install-order check FAILED (${problems.length}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      '\nMove the step after the job\'s `npm ci` (or add one), or cut the import. A step that ' +
        'passes on a laptop with node_modules fails in CI with ERR_MODULE_NOT_FOUND (T-570).'
    );
    return 1;
  }
  console.log('OK — every pre-install CI step reaches Node builtins only.');
  return 0;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
