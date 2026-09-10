// docs/design/check-build-cards.mjs's isIgnored() answers "does .gitignore exclude this path",
// asked of git via `git check-ignore`, for paths cited in build cards. On Windows (Git
// 2.53.0.windows.2) the naive `-q` exit code lies for a path written with a trailing slash
// whenever no .gitignore pattern actually matches it — and this is NOT an existence quirk: it
// reproduces whether the directory exists on disk or not. This test exercises the REAL isIgnored()
// (imported, not re-implemented) so a regression in the fix — or a future edit that reintroduces
// the naive `-q`-only check — turns this red.
//
// Placed under scripts/tests/ (not docs/design/) because docs/design/ has no test harness of its
// own and scripts/tests/ is this repo's existing `node --test` convention (see
// scripts/tests/build-detection-registry.test.mjs for the same "drive the real script as a
// subprocess/import, don't re-implement it" idiom).
//
// FIXTURE NOTE: an absent, untracked directory (e.g. `scripts/state/`, which does not exist in
// this worktree) is a WEAK fixture for the false-positive case — it only proves the bug depends on
// absence, which it does not. The decisive fixture is #1 below: a directory this test creates on
// disk itself, with zero tracked files and no matching .gitignore pattern. That is the case that
// still fails on the unfixed (`-q`-only) isIgnored — proving the bug is about the trailing slash,
// not about existence.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIgnored } from '../../docs/design/check-build-cards.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
// A name unlikely to collide with anything real or with any .gitignore pattern.
const EXISTING_UNTRACKED_DIR = 'zz-check-build-cards-isignored-test-fixture';
const EXISTING_UNTRACKED_DIR_ABS = path.join(REPO_ROOT, EXISTING_UNTRACKED_DIR);

before(() => {
  fs.mkdirSync(EXISTING_UNTRACKED_DIR_ABS, { recursive: true });
  fs.writeFileSync(path.join(EXISTING_UNTRACKED_DIR_ABS, 'probe.txt'), 'fixture\n');
});

after(() => {
  fs.rmSync(EXISTING_UNTRACKED_DIR_ABS, { recursive: true, force: true });
});

// Fixture 1: a directory that EXISTS on disk (created above), has zero tracked files, and matches
// no .gitignore pattern. This is the fixture that fails on the unfixed function — the naive
// `-q`-only check falsely reports it ignored purely because the query carries a trailing slash.
test('an existing, untracked directory with no matching .gitignore pattern is NOT ignored (trailing slash)', () => {
  assert.equal(isIgnored(`${EXISTING_UNTRACKED_DIR}/`), false);
});

test('the same existing, untracked, non-matching directory is NOT ignored without a trailing slash (answer must not depend on the slash)', () => {
  assert.equal(isIgnored(EXISTING_UNTRACKED_DIR), false);
});

// Fixture 1b: the same non-matching-pattern case, but for a path that does NOT exist on disk at
// all — proves the false positive is not solely an "exists" vs "doesn't exist" thing either way.
test('a non-existent path with no matching .gitignore pattern is NOT ignored, trailing slash or not', () => {
  assert.equal(isIgnored('totally-made-up-dir-xyz/'), false);
  assert.equal(isIgnored('totally-made-up-dir-xyz'), false);
});

// Real card citations that must never be excused as (LOCAL): scraper/config/ and scripts/state/
// name no .gitignore pattern (grep confirms zero occurrences), and this worktree does not have
// either directory on disk.
test('the two real card citations behind this fix (scraper/config/, scripts/state/) are NOT ignored', () => {
  assert.equal(isIgnored('scraper/config/'), false);
  assert.equal(isIgnored('scraper/config'), false);
  assert.equal(isIgnored('scripts/state/'), false);
  assert.equal(isIgnored('scripts/state'), false);
});

// Fixture 2: a genuine directory-only .gitignore pattern (`docs/design/probes/fixtures/pdf/`, line
// ends in `/`) for a path that does NOT exist on disk in this checkout. This is the fixture that a
// naive "strip the trailing slash" fix breaks: without the trailing slash on the query, git cannot
// tell a non-existent path is meant to be a directory, so a real directory-only match is missed.
test('a genuine directory-only .gitignore pattern for a path absent on disk IS ignored', () => {
  assert.equal(isIgnored('docs/design/probes/fixtures/pdf/'), true);
});

// Fixture 3: a path WITH tracked files (web/ is source-controlled and not ignored). Confirms no
// regression on the ordinary, easy case that never hit the Windows bug in the first place.
test('a tracked, non-ignored directory is NOT ignored', () => {
  assert.equal(isIgnored('web/'), false);
  assert.equal(isIgnored('docs/'), false);
});

test('a tracked, genuinely ignored directory (node_modules/) IS ignored', () => {
  assert.equal(isIgnored('node_modules/'), true);
  assert.equal(isIgnored('node_modules'), true);
});

test('the answer is cached per input string', () => {
  const first = isIgnored('scraper/config/');
  const second = isIgnored('scraper/config/');
  assert.equal(first, second);
  assert.equal(first, false);
});
