// hermetic-git.mjs — for node tests that build throwaway git repos.
//
// WHY (2026-09-25, PR #1037): git exports GIT_DIR into hooks, and from a linked
// worktree it points at .git/worktrees/<name>. A test run by a pre-push hook
// inherited it, so its `git init` / `git config user.*` / `git commit` with
// cwd=<tmp> went to the REAL repository (core.bare=true and [user] Test in the
// shared .git/config, fixture commits on the pushed branch). Neither cwd nor
// `git -C` overrides an exported GIT_DIR.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

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

// Throws unless `dir` is the top level of its OWN repository. Call right after
// `git init` of a fixture, before any config/add/commit.
export function assertHermeticRepo(dir) {
  for (const k of GIT_LOCAL_ENV_VARS) {
    if (process.env[k] !== undefined) {
      throw new Error(`hermetic-git: REFUSED — ${k} is set; fixture git would hit another repo`);
    }
  }
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim();
  const want = realpathSync.native(dir);
  if (norm(realpathSync.native(top)) !== norm(want)) {
    throw new Error(`hermetic-git: REFUSED — fixture '${dir}' resolves to repo top '${top}', not itself`);
  }
}
