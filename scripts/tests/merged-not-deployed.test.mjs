// Self-test for scripts/ops/merged-not-deployed.mjs (T-498) — proves the
// register finds fix/feat commits merged after the latest prod-* tag on a
// throwaway fixture repo (git init in a temp dir), never a real box or the
// project's own git history.
// Run: node --test scripts/tests/merged-not-deployed.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectMergedNotDeployed, latestProdTag } from '../ops/merged-not-deployed.mjs';

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function commit(repo, message, isoDate) {
  writeFileSync(join(repo, 'file.txt'), `${message}-${Math.random()}`);
  git(repo, ['add', 'file.txt']);
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_DATE: isoDate,
  };
  execFileSync('git', ['commit', '-m', message], { cwd: repo, env });
}

function withFixtureRepo(fn) {
  const repo = mkdtempSync(join(tmpdir(), 'merged-not-deployed-fixture-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  try {
    fn(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test('a fresh repo with no prod-* tag reports no tag, not a crash', () => {
  withFixtureRepo((repo) => {
    commit(repo, 'chore: init', '2026-09-01T00:00:00Z');
    // simulate an "origin/main" ref by tagging HEAD, since this fixture has no remote
    git(repo, ['branch', 'main-ref']);
    const result = collectMergedNotDeployed(repo, { ref: 'main-ref' });
    assert.equal(result.prodTag, null);
    assert.deepEqual(result.commits, []);
  });
});

test('RED: with a prod tag and merged fix commits after it, the register must list them (fails before the fix logic exists / on an empty range)', () => {
  withFixtureRepo((repo) => {
    commit(repo, 'chore: init', '2026-09-01T00:00:00Z');
    git(repo, ['tag', 'prod-2026-09-05']);

    commit(repo, 'fix(scraper): SME rows never keep a stale FPO (#180) (#377)', '2026-09-06T10:00:00Z');
    commit(repo, 'docs(walk): supervision tick 12:00', '2026-09-06T12:00:00Z');
    commit(repo, 'fix(hooks): stop guard wait exemption (#397)', '2026-09-06T15:00:00Z');

    git(repo, ['branch', 'main-ref']);
    const result = collectMergedNotDeployed(repo, { ref: 'main-ref' });

    // This is the RED assertion: on a naive/no-op implementation (e.g. one
    // that always returns an empty list, or does not filter on tag..ref),
    // this fails. Kept as the permanent regression guard.
    assert.equal(result.prodTag, 'prod-2026-09-05');
    assert.equal(result.commits.length, 2, 'must find exactly the two fix() commits, not the docs(walk) one');

    const subjects = result.commits.map((c) => c.subject);
    assert.ok(subjects.some((s) => s.includes('SME rows')));
    assert.ok(subjects.some((s) => s.includes('stop guard wait exemption')));
    assert.ok(!subjects.some((s) => s.includes('supervision tick')), 'docs(walk) commits with no issue ref must be excluded');
  });
});

test('GREEN: issue numbers and days-since-merge are extracted correctly', () => {
  withFixtureRepo((repo) => {
    commit(repo, 'chore: init', '2026-09-01T00:00:00Z');
    git(repo, ['tag', 'prod-2026-09-01']);
    commit(repo, 'fix(web): unknown slugs 404 (#350) (#355)', '2026-09-02T00:00:00Z');
    git(repo, ['branch', 'main-ref']);

    const result = collectMergedNotDeployed(repo, { ref: 'main-ref' });
    assert.equal(result.commits.length, 1);
    assert.deepEqual(result.commits[0].issues, ['350', '355']);
    assert.equal(typeof result.commits[0].daysSinceMerge, 'number');
    assert.ok(result.commits[0].daysSinceMerge >= 0);
  });
});

test('a commit with a bare #NNN reference but no fix()/feat() prefix is still tracked', () => {
  withFixtureRepo((repo) => {
    commit(repo, 'chore: init', '2026-09-01T00:00:00Z');
    git(repo, ['tag', 'prod-2026-09-01']);
    commit(repo, 'refactor: tidy up per review notes (#500)', '2026-09-02T00:00:00Z');
    git(repo, ['branch', 'main-ref']);

    const result = collectMergedNotDeployed(repo, { ref: 'main-ref' });
    assert.equal(result.commits.length, 1);
    assert.deepEqual(result.commits[0].issues, ['500']);
  });
});

test('newest prod-* tag wins when multiple exist (by creation date, not name sort)', () => {
  withFixtureRepo((repo) => {
    commit(repo, 'chore: init', '2026-09-01T00:00:00Z');
    git(repo, ['tag', 'prod-2026-09-01']);
    commit(repo, 'fix(a): older fix (#1)', '2026-09-02T00:00:00Z');
    git(repo, ['tag', 'prod-2026-09-06']); // deliberately "later" alphabetically too, but that's incidental
    commit(repo, 'fix(b): newer fix (#2)', '2026-09-07T00:00:00Z');
    git(repo, ['branch', 'main-ref']);

    assert.equal(latestProdTag(repo), 'prod-2026-09-06');
    const result = collectMergedNotDeployed(repo, { ref: 'main-ref' });
    assert.equal(result.commits.length, 1);
    assert.deepEqual(result.commits[0].issues, ['2']);
  });
});

test('round 2 (RC1 alarm fatigue): a docs(walk) commit referencing #NNN is excluded, a fix() commit with an issue ref is included', () => {
  withFixtureRepo((repo) => {
    commit(repo, 'chore: init', '2026-09-01T00:00:00Z');
    git(repo, ['tag', 'prod-2026-09-01']);
    commit(repo, 'docs(walk): #406 FAIL -> round 2', '2026-09-02T00:00:00Z');
    commit(repo, 'fix(scraper): SME rows never keep a stale FPO (#180) (#377)', '2026-09-02T01:00:00Z');
    git(repo, ['branch', 'main-ref']);

    const result = collectMergedNotDeployed(repo, { ref: 'main-ref' });
    const subjects = result.commits.map((c) => c.subject);
    assert.equal(result.commits.length, 1, 'only the fix() commit is tracked, not the docs(walk) one');
    assert.ok(!subjects.some((s) => s.startsWith('docs(walk)')), 'docs(walk) commit must be excluded even though it references #406');
    assert.ok(subjects.some((s) => s.includes('SME rows')), 'fix() commit must be included');
    assert.deepEqual(result.commits[0].issues, ['180', '377']);
  });
});

test('fully caught-up repo (no fix/feat commits past the tag) reports zero, not an error', () => {
  withFixtureRepo((repo) => {
    commit(repo, 'chore: init', '2026-09-01T00:00:00Z');
    git(repo, ['tag', 'prod-2026-09-01']);
    commit(repo, 'docs: update readme', '2026-09-02T00:00:00Z');
    git(repo, ['branch', 'main-ref']);

    const result = collectMergedNotDeployed(repo, { ref: 'main-ref' });
    assert.equal(result.commits.length, 0);
  });
});
