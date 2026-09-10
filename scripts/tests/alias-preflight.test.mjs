// Item 1 slice s14: the alias-resolution preflight.
//
// The interesting cases are exercised as SUBPROCESSES against fabricated
// checkouts on disk, not as calls into re-implemented logic: a fake checkout
// (package.json + .git + node_modules/@ipodhan/shared) whose workspace link
// points INSIDE it must run and print, and one whose link points OUTSIDE it
// must exit non-zero naming both paths. That is exactly the shape of the
// defect -- a worktree whose node_modules was junctioned from the main
// checkout without re-pointing the workspace packages.
//
// Mutation-proof: delete the outside-the-root check in
// scripts/lib/alias-preflight.mjs and "refuses when the link points outside
// the checkout" turns red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const LIB = join(REPO_ROOT, 'scripts', 'lib');

const preflight = await import(pathToFileURL(join(LIB, 'alias-preflight.mjs')).href);

/**
 * Build a throwaway checkout:
 *   <tmp>/checkout/{package.json,.git,scripts/lib/*.mjs,node_modules/@ipodhan/shared -> ...}
 *   <tmp>/elsewhere/shared            (the "main checkout" the bad link points at)
 * `where` picks which of the two the workspace link resolves to.
 */
function makeCheckout(where) {
  const base = mkdtempSync(join(tmpdir(), 'alias-preflight-'));
  const checkout = join(base, 'checkout');
  const inside = join(checkout, 'packages', 'shared');
  const outside = join(base, 'elsewhere', 'shared');
  for (const d of [inside, outside, join(checkout, 'node_modules', '@ipodhan'), join(checkout, 'scripts', 'lib')]) {
    mkdirSync(d, { recursive: true });
  }
  for (const d of [inside, outside]) {
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: '@ipodhan/shared', version: '0.0.0', main: 'index.js' }));
    writeFileSync(join(d, 'index.js'), 'module.exports = {};\n');
  }
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({ name: 'fake-root' }));
  // A LINKED worktree carries `.git` as a file, not a directory -- the root
  // finder must accept both, so the fixture uses the harder of the two.
  writeFileSync(join(checkout, '.git'), 'gitdir: /nowhere\n');
  for (const f of ['alias-preflight.mjs', 'alias-preflight-auto.mjs']) {
    cpSync(join(LIB, f), join(checkout, 'scripts', 'lib', f));
  }
  symlinkSync(where === 'inside' ? inside : outside, join(checkout, 'node_modules', '@ipodhan', 'shared'), 'junction');
  return { base, checkout, inside, outside };
}

function runPreflight(checkout, cwd) {
  const r = spawnSync(process.execPath, [join(checkout, 'scripts', 'lib', 'alias-preflight-auto.mjs')], {
    cwd: cwd ?? checkout,
    encoding: 'utf8',
  });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

test('runs, and PRINTS the resolved path, when the workspace link points inside the checkout', () => {
  const fx = makeCheckout('inside');
  try {
    const r = runPreflight(fx.checkout);
    assert.equal(r.status, 0, r.out);
    // Printing on SUCCESS is the point: both wrong answers on 2026-09-10
    // looked like ordinary output because no line named the tree being read.
    assert.match(r.out, /alias-preflight: @ipodhan\/shared from .* -> /);
    assert.ok(r.out.includes(fx.inside), `expected the in-tree path in:\n${r.out}`);
    assert.ok(!r.out.includes(fx.outside), `must not resolve to the other checkout:\n${r.out}`);
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
});

test('refuses when the link points outside the checkout, naming BOTH paths and the rule', () => {
  const fx = makeCheckout('outside');
  try {
    const r = runPreflight(fx.checkout);
    assert.notEqual(r.status, 0, `expected a non-zero exit, got:\n${r.out}`);
    assert.match(r.out, /REFUSING TO RUN/);
    assert.ok(r.out.includes(fx.outside), `failure must name the resolved path:\n${r.out}`);
    assert.ok(r.out.includes(fx.checkout), `failure must name the checkout root:\n${r.out}`);
    assert.match(r.out, /every run must exercise the tree it was started in/);
    assert.match(r.out, /wt-link-modules\.ps1/);
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
});

test('refuses from a SUBDIRECTORY cwd too (the repair tools run from scraper/)', () => {
  const fx = makeCheckout('outside');
  try {
    const sub = join(fx.checkout, 'scraper');
    mkdirSync(sub, { recursive: true });
    const r = runPreflight(fx.checkout, sub);
    assert.notEqual(r.status, 0, `expected a non-zero exit, got:\n${r.out}`);
    assert.ok(r.out.includes(fx.checkout), r.out);
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
});

test('findCheckoutRoot needs BOTH package.json and .git, and accepts .git as a file', () => {
  const fx = makeCheckout('inside');
  try {
    const deep = join(fx.checkout, 'scripts', 'lib');
    assert.equal(resolve(preflight.findCheckoutRoot(deep)), resolve(fx.checkout));
    // packages/shared has a package.json but no .git -- it must NOT be
    // mistaken for the root, or the boundary check would always pass.
    assert.equal(resolve(preflight.findCheckoutRoot(fx.inside)), resolve(fx.checkout));
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
});

test('isInsideRoot does not treat a sibling with the same prefix as inside', () => {
  const root = resolve('/a/b/repo');
  assert.equal(preflight.isInsideRoot(root, resolve('/a/b/repo/packages/shared')), true);
  assert.equal(preflight.isInsideRoot(root, root), true);
  // The bug this guards: `startsWith(root)` alone calls /a/b/repo-worktree
  // "inside" /a/b/repo, which is precisely the pair of trees involved here.
  assert.equal(preflight.isInsideRoot(root, resolve('/a/b/repo-worktree/packages/shared')), false);
});

test('the cwd is checked as its own resolution origin when it is inside the checkout', () => {
  const fx = makeCheckout('inside');
  try {
    const sub = join(fx.checkout, 'scraper');
    mkdirSync(sub, { recursive: true });
    const origins = preflight.resolutionOrigins(join(fx.checkout, 'scripts', 'lib'), fx.checkout, sub);
    assert.equal(origins.length, 2);
    assert.ok(origins.some((o) => resolve(o) === resolve(sub)));
    // A cwd outside the checkout is meaningless to resolve from and is dropped.
    assert.equal(preflight.resolutionOrigins(join(fx.checkout, 'scripts', 'lib'), fx.checkout, fx.outside).length, 1);
  } finally {
    rmSync(fx.base, { recursive: true, force: true });
  }
});
