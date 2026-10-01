// hermetic-git.mjs — for node tests that build throwaway git repos.
//
// WHY (2026-09-25, PR #1037): git exports GIT_DIR into hooks, and from a linked
// worktree it points at .git/worktrees/<name>. A test run by a pre-push hook
// inherited it, so its `git init` / `git config user.*` / `git commit` with
// cwd=<tmp> went to the REAL repository (core.bare=true and [user] Test in the
// shared .git/config, fixture commits on the pushed branch). Neither cwd nor
// `git -C` overrides an exported GIT_DIR.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every variable `git rev-parse --local-env-vars` lists (git 2.4x).
export const GIT_LOCAL_ENV_VARS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
  'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
];

// Removes them from process.env, so every child process (git, node, bash) this
// test spawns inherits a clean environment. Call once at module top.
export function scrubGitEnv(env = process.env) {
  for (const k of GIT_LOCAL_ENV_VARS) delete env[k];
  return env;
}

const norm = (p) => {
  const s = p.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
};

// The repository this helper ships in. A fixture must never be it, or inside it.
export const HOST_REPO_ROOT = norm(realpathSync.native(fileURLToPath(new URL('../../..', import.meta.url))));

function refuse(msg) {
  throw new Error(`hermetic-git: REFUSED — ${msg}`);
}

// Throws unless `dir` is safe for fixture git. Call it BEFORE `git init` (the
// dir must exist, be non-empty as a path, and lie outside the host repo) and
// again after it (the dir must then be the top level of its OWN repository).
// #1063: the first version passed dir='' and dir='.', because both resolve to
// the caller's cwd, which is the real repository when a test runs from it.
export function assertHermeticRepo(dir, { hostRoot = HOST_REPO_ROOT } = {}) {
  for (const k of GIT_LOCAL_ENV_VARS) {
    if (process.env[k] !== undefined) refuse(`${k} is set; fixture git would hit another repo`);
  }
  if (typeof dir !== 'string' || dir.trim() === '') refuse('fixture dir is empty');
  if (!isAbsolute(dir)) refuse(`fixture dir '${dir}' is not absolute`);
  if (!existsSync(dir)) refuse(`fixture dir '${dir}' does not exist`);
  const want = norm(realpathSync.native(dir));
  const host = norm(hostRoot);
  if (want === host || want.startsWith(`${host}/`)) {
    refuse(`fixture dir '${dir}' is the host repository or inside it (${hostRoot})`);
  }
  if (!existsSync(join(dir, '.git'))) return; // before `git init`: path checks are all that apply
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim();
  if (norm(realpathSync.native(top)) !== want) {
    refuse(`fixture '${dir}' resolves to repo top '${top}', not itself`);
  }
}
