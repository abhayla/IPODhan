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
import { existsSync, readFileSync } from 'node:fs';

export const ALIAS = '@ipodhan/shared';

/** Windows is case-insensitive; compare paths the way the filesystem does. */
function canon(p) {
  const abs = resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/**
 * True when `dir` holds the package.json of the REPO ROOT.
 *
 * The marker is the `workspaces` field: the root package.json declares it
 * (`["web", "scraper", "packages/*"]`), and no workspace MEMBER does. Any
 * package.json would stop the walk at `web/` or `packages/shared/` and hand
 * back a sub-tree as the checkout root — which is the wrong-tree resolution
 * this whole module exists to make impossible.
 */
function isRepoRoot(dir) {
  const pkg = join(dir, 'package.json');
  if (!existsSync(pkg)) return false;
  try {
    const parsed = JSON.parse(readFileSync(pkg, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && parsed.workspaces !== undefined;
  } catch {
    return false;
  }
}

/**
 * Nearest ancestor of `startDir` whose package.json declares `workspaces`.
 *
 * NOT keyed on `.git`. The deploy builds every release directory with
 * `git archive "$SHA" | tar -x` (scripts/deploy-linux.sh), so a release has
 * no `.git` at ANY level; a `.git`-keyed root finder threw in every staging
 * and production deploy from the moment it shipped (2026-09-11, run
 * 34521965457). The `workspaces` marker is present in every shape this code
 * runs in — the main checkout, a linked worktree (where `.git` is a file),
 * and a `.git`-less archive extract.
 *
 * Anchored on a directory INSIDE the checkout (callers pass this module's
 * own location) rather than on `process.cwd()`: cwd is `scraper/` for the
 * repair tools, the repo root for the deploy's schema-drift assert, and
 * anything at all for an ad-hoc run, while the module's own path is
 * definitionally inside the checkout being exercised.
 *
 * Finding nothing THROWS. There is deliberately no fallback to cwd and no
 * default root: a guard that guesses a root cannot prove anything about which
 * tree was read, which is the only thing it is for.
 */
export function findCheckoutRoot(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    if (isRepoRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `alias-preflight: no checkout root above ${startDir} ` +
          '(looked for a directory whose package.json declares "workspaces")'
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
  printOnSuccess = true,
  log = (m) => process.stderr.write(m + '\n'),
} = {}) {
  const root = findCheckoutRoot(anchorDir);
  const results = [];
  const lines = [];
  let failure = null;
  for (const origin of resolutionOrigins(anchorDir, root, cwd)) {
    const resolved = resolveAliasPath(pathToFileURL(join(origin, '__alias-preflight__.mjs')).href);
    lines.push(formatLine(origin, resolved, root));
    results.push({ origin, resolved });
    if (!failure && !isInsideRoot(root, resolved)) failure = formatFailure(origin, resolved, root);
  }
  // A refusal ALWAYS prints its resolution lines, whatever the caller asked
  // for: the failure text names the offending pair, and the lines name every
  // origin that was consulted.
  if (printOnSuccess || failure) for (const line of lines) log(line);
  if (failure) throw new Error(failure);
  return { root, results, lines };
}
