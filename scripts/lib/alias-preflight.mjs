/**
 * Alias-resolution preflight (item 1 slice s14).
 *
 * RCA: a git worktree whose `node_modules` was junctioned from the main
 * checkout WITHOUT re-pointing the workspace packages leaves
 * `node_modules/@ipodhan/shared` pointing at the MAIN checkout's
 * `packages/shared`. Every resolver in this repo that falls through to node
 * resolution for the BARE specifier `@ipodhan/shared` (and for the subpaths
 * that no alias table covers) then reads `main`, not the branch under test.
 * Two wrong answers shipped from exactly that on 2026-09-10: a schema-drift
 * run that printed OK while the branch was broken, and a unit test that
 * advised removing a correct guard.
 *
 * Three invocation shapes, three different resolvers, and before slice s14
 * two of them fell through to node_modules:
 *   - vitest from `scraper/`  -> scraper/vitest.config.ts alias table
 *   - tsx    from `scraper/`  -> scraper/tsconfig.json `paths`
 *   - tsx    from the repo root -> root tsconfig.json `paths`
 * Slice s14 makes all three map the bare specifier into the current
 * checkout; THIS module is the backstop that proves it on every run.
 *
 * What it proves: where node's own resolution of `@ipodhan/shared` lands.
 * That is the exact condition the defect creates — a workspace link aimed
 * outside the checkout — and it is the fall-through every shape shares. It
 * does not (and cannot, from outside) re-derive a bundler's private alias
 * table; the alias tables are checked instead by the unit tests that read
 * them.
 *
 * It PRINTS the resolved path on every run, not only on failure: both wrong
 * answers on 2026-09-10 looked like ordinary output, and the one line that
 * was missing was the one naming which tree had been read.
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';

export const ALIAS = '@ipodhan/shared';

/** Windows is case-insensitive; compare paths the way the filesystem does. */
function canon(p) {
  const abs = resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/**
 * Nearest ancestor of `startDir` holding BOTH `package.json` and `.git`.
 *
 * `.git` is a FILE in a linked worktree and a directory in the main
 * checkout, so existence is the test, never `isDirectory()`.
 *
 * Anchored on a directory INSIDE the checkout (callers pass this module's
 * own location) rather than on `process.cwd()`: cwd is `scraper/` for the
 * repair tools, the repo root for the deploy's schema-drift assert, and
 * anything at all for an ad-hoc run, while the module's own path is
 * definitionally inside the checkout being exercised.
 */
export function findCheckoutRoot(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `alias-preflight: no checkout root above ${startDir} ` +
          '(looked for a directory holding both package.json and .git)'
      );
    }
    dir = parent;
  }
}

/** True when `p` is `root` itself or lies beneath it. */
export function isInsideRoot(root, p) {
  const r = canon(root);
  const c = canon(p);
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
}

/**
 * Where node resolves `@ipodhan/shared` from `fromUrl`. Symlinks/junctions
 * are resolved (node's default), which is the whole point: the defective
 * link LOOKS in-tree and points out of it.
 */
export function resolveAliasPath(fromUrl) {
  return createRequire(fromUrl).resolve(ALIAS);
}

export function formatLine(origin, resolved, root) {
  return `alias-preflight: ${ALIAS} from ${origin} -> ${resolved} | checkout ${root} | cwd ${process.cwd()}`;
}

export function formatFailure(origin, resolved, root) {
  return [
    `alias-preflight: REFUSING TO RUN - ${ALIAS} resolves OUTSIDE this checkout.`,
    `  resolved from: ${origin}`,
    `  resolved to  : ${resolved}`,
    `  checkout     : ${root}`,
    `  cwd          : ${process.cwd()}`,
    '  rule         : every run must exercise the tree it was started in. This',
    '                 resolution reads a DIFFERENT checkout, so anything this run',
    '                 reports says nothing about the code under test.',
    "  fix          : re-link this worktree's node_modules with",
    '                 ~/.claude/tools/wt-link-modules.ps1 -Repo <main> -Worktree <this tree>',
    '                 (it re-points workspace packages at the worktree; a plain',
    '                  junction of node_modules does not).',
  ].join('\n');
}

/**
 * The directories whose node resolution this run depends on: the module's own
 * location (the root node_modules tree) and, when it is inside the checkout,
 * the cwd (`scraper/` for the repair tools and the scraper vitest suite, which
 * has its OWN node_modules tree and so its own copy of the defect).
 */
export function resolutionOrigins(anchorDir, root, cwd = process.cwd()) {
  const origins = [resolve(anchorDir)];
  const c = resolve(cwd);
  if (isInsideRoot(root, c) && canon(c) !== canon(origins[0])) origins.push(c);
  return origins;
}

/**
 * Print every resolution this run depends on, and throw when any of them
 * lands outside the checkout. Output goes to stderr so it never contaminates
 * a script's parsed stdout.
 */
export function assertAliasResolvesInTree({
  anchorDir = dirname(fileURLToPath(import.meta.url)),
  cwd = process.cwd(),
  log = (m) => process.stderr.write(m + '\n'),
} = {}) {
  const root = findCheckoutRoot(anchorDir);
  const results = [];
  let failure = null;
  for (const origin of resolutionOrigins(anchorDir, root, cwd)) {
    const resolved = resolveAliasPath(pathToFileURL(join(origin, '__alias-preflight__.mjs')).href);
    log(formatLine(origin, resolved, root));
    results.push({ origin, resolved });
    if (!failure && !isInsideRoot(root, resolved)) failure = formatFailure(origin, resolved, root);
  }
  if (failure) throw new Error(failure);
  return { root, results };
}
