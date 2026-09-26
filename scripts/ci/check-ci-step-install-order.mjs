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
import { join, resolve, dirname, extname, relative, sep } from 'node:path';
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

/**
 * Walk a root file's import graph breadth-first (so each reported chain is the
 * shortest). Returns { packages: [{ pkg, specifier, chain }], unresolved: [...] }.
 */
export function walkImportGraph(rootFile, repoRoot) {
  const rel = (p) => toPosix(relative(repoRoot, p));
  const parent = new Map([[rootFile, null]]);
  const queue = [rootFile];
  const packages = [];
  const unresolved = [];
  const seenPkg = new Set();
  const chainTo = (f) => {
    const c = [];
    for (let cur = f; cur; cur = parent.get(cur)) c.unshift(rel(cur));
    return c;
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
  }
  return { packages, unresolved };
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
            const g = walkImportGraph(abs, root);
            checked.push({ where, file: shown, packages: g.packages.map((p) => p.pkg) });
            for (const p of g.packages) {
              problems.push(
                `${where}: ${shown} reaches npm package '${p.pkg}' before any npm ci in this job\n` +
                  `      import chain: ${p.chain.join(' -> ')} -> '${p.specifier}'`
              );
            }
            for (const u of g.unresolved) {
              problems.push(
                `${where}: ${shown} has an unresolvable relative import '${u.specifier}'\n` +
                  `      import chain: ${u.chain.join(' -> ')}`
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
