// Self-test for scripts/preflight-runtime.sh (T-406, stage 9 of the test
// ladder). Drives the REAL script as a subprocess with a temp PATH full of
// fake executable shims (python3/tesseract/node/df) plus controlled env, so
// deleting or weakening a check in the script itself turns this red — this
// is not a re-implementation of the checks, it exercises the actual file.
// Run: node --test scripts/tests/preflight-runtime.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'preflight-runtime.sh');

function makeShimDir() {
  return mkdtempSync(join(tmpdir(), 'preflight-shims-'));
}

// Writes an executable POSIX-sh shim named `name` into `dir` with `body` as
// its script content. `dir` is prepended to PATH so it shadows any real
// binary of the same name.
function shim(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

function goodPython(dir) {
  shim(
    dir,
    'python3',
    [
      'if [ "$1" = "-c" ]; then',
      '  case "$2" in',
      '    *pdfplumber*) exit 0 ;;',
      '    *) exit 0 ;;',
      '  esac',
      'fi',
      'echo "Python 3.11.0"',
    ].join('\n')
  );
}

function pythonNoPdfplumber(dir) {
  shim(
    dir,
    'python3',
    [
      'if [ "$1" = "-c" ]; then',
      '  case "$2" in',
      '    *pdfplumber*) echo "ModuleNotFoundError: No module named pdfplumber" >&2; exit 1 ;;',
      '    *) exit 0 ;;',
      '  esac',
      'fi',
      'echo "Python 3.11.0"',
    ].join('\n')
  );
}

function goodTesseract(dir) {
  shim(dir, 'tesseract', 'echo "tesseract 5.3.0"');
}

function goodNode(version) {
  return (dir) => shim(dir, 'node', `echo "${version}"`);
}

// Prepends the shim dir to the REAL inherited PATH (rather than replacing it
// with a synthetic list) so the script's own POSIX-utility plumbing (df,
// awk, cat, dirname, tr, command -v itself) keeps resolving through
// bash/MSYS's normal PATH handling — bash is spawned as a native process on
// Windows (this repo's dev/CI shells), so PATH must stay in the platform's
// own delimiter/format, with only the shim dir shadowing python3/tesseract/
// node ahead of any real ones.
function pathWith(shimDir) {
  return `${shimDir}${delimiter}${process.env.PATH}`;
}

function run({ shimDir, env = {}, args = [] }) {
  const fullEnv = {
    ...process.env,
    ...env,
    PATH: pathWith(shimDir),
  };
  const result = spawnSync('bash', [SCRIPT, ...args], {
    env: fullEnv,
    encoding: 'utf8',
  });
  return result;
}

function baseGoodEnv(storeDir) {
  return {
    TZ: 'UTC',
    ADMIN_API_TOKEN: 'test-token-value',
    PROSPECTUS_STORE_DIR: storeDir,
  };
}

test('python3 missing on PATH -> FAIL, default mode exits 1', () => {
  const shimDir = makeShimDir();
  const storeDir = mkdtempSync(join(tmpdir(), 'prospectus-'));
  goodTesseract(shimDir);
  goodNode('v20.11.0')(shimDir);
  const res = run({ shimDir, env: baseGoodEnv(storeDir) });
  assert.match(res.stdout, /FAIL python3/);
  assert.notEqual(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

test('python3 present but pdfplumber import fails -> FAIL for pdfplumber check only', () => {
  const shimDir = makeShimDir();
  const storeDir = mkdtempSync(join(tmpdir(), 'prospectus-'));
  pythonNoPdfplumber(shimDir);
  goodTesseract(shimDir);
  goodNode('v20.11.0')(shimDir);
  const res = run({ shimDir, env: baseGoodEnv(storeDir) });
  assert.doesNotMatch(res.stdout, /FAIL python3 on PATH/);
  assert.match(res.stdout, /FAIL .*pdfplumber/);
  assert.notEqual(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

test('tesseract missing -> WARN only, does not fail the overall run by itself', () => {
  const shimDir = makeShimDir();
  const storeDir = mkdtempSync(join(tmpdir(), 'prospectus-'));
  goodPython(shimDir);
  goodNode('v20.11.0')(shimDir);
  const res = run({ shimDir, env: baseGoodEnv(storeDir) });
  assert.match(res.stdout, /WARN tesseract/);
  assert.doesNotMatch(res.stdout, /FAIL tesseract/);
  assert.equal(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

test('TZ neither Asia/Kolkata nor UTC -> FAIL', () => {
  const shimDir = makeShimDir();
  const storeDir = mkdtempSync(join(tmpdir(), 'prospectus-'));
  goodPython(shimDir);
  goodTesseract(shimDir);
  goodNode('v20.11.0')(shimDir);
  const res = run({
    shimDir,
    env: { ...baseGoodEnv(storeDir), TZ: 'America/New_York' },
  });
  assert.match(res.stdout, /FAIL .*TZ/);
  assert.notEqual(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

test('TZ=Asia/Kolkata is accepted (OK), per T-327 ambient-TZ allowance', () => {
  const shimDir = makeShimDir();
  const storeDir = mkdtempSync(join(tmpdir(), 'prospectus-'));
  goodPython(shimDir);
  goodTesseract(shimDir);
  goodNode('v20.11.0')(shimDir);
  const res = run({
    shimDir,
    env: { ...baseGoodEnv(storeDir), TZ: 'Asia/Kolkata' },
  });
  assert.match(res.stdout, /OK .*TZ/);
  assert.equal(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

test('PROSPECTUS_STORE_DIR set to a non-existent path -> FAIL', () => {
  const shimDir = makeShimDir();
  goodPython(shimDir);
  goodTesseract(shimDir);
  goodNode('v20.11.0')(shimDir);
  const res = run({
    shimDir,
    env: {
      TZ: 'UTC',
      ADMIN_API_TOKEN: 'x',
      PROSPECTUS_STORE_DIR: '/definitely/does/not/exist/prospectus',
    },
  });
  assert.match(res.stdout, /FAIL .*[Ss]tore/);
  assert.notEqual(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
});

test('PROSPECTUS_STORE_DIR unset -> falls back to checking the parent shared dir is writable (T-403 default not yet created)', () => {
  const shimDir = makeShimDir();
  const deployRoot = mkdtempSync(join(tmpdir(), 'deploy-root-'));
  mkdirSync(join(deployRoot, 'shared'));
  goodPython(shimDir);
  goodTesseract(shimDir);
  goodNode('v20.11.0')(shimDir);
  const res = run({
    shimDir,
    env: { TZ: 'UTC', ADMIN_API_TOKEN: 'x', DEPLOY_ROOT: deployRoot },
  });
  assert.match(res.stdout, /OK .*[Ss]tore/);
  assert.equal(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(deployRoot, { recursive: true, force: true });
});

test('node < 20 -> FAIL', () => {
  const shimDir = makeShimDir();
  const storeDir = mkdtempSync(join(tmpdir(), 'prospectus-'));
  goodPython(shimDir);
  goodTesseract(shimDir);
  goodNode('v18.19.0')(shimDir);
  const res = run({ shimDir, env: baseGoodEnv(storeDir) });
  assert.match(res.stdout, /FAIL node/);
  assert.notEqual(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

test('ADMIN_API_TOKEN unset -> FAIL', () => {
  const shimDir = makeShimDir();
  const storeDir = mkdtempSync(join(tmpdir(), 'prospectus-'));
  goodPython(shimDir);
  goodTesseract(shimDir);
  goodNode('v20.11.0')(shimDir);
  const res = run({
    shimDir,
    env: { TZ: 'UTC', PROSPECTUS_STORE_DIR: storeDir },
  });
  assert.match(res.stdout, /FAIL ADMIN_API_TOKEN/);
  assert.notEqual(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

test('ADMIN_API_TOKEN blank -> FAIL', () => {
  const shimDir = makeShimDir();
  const storeDir = mkdtempSync(join(tmpdir(), 'prospectus-'));
  goodPython(shimDir);
  goodTesseract(shimDir);
  goodNode('v20.11.0')(shimDir);
  const res = run({
    shimDir,
    env: { TZ: 'UTC', PROSPECTUS_STORE_DIR: storeDir, ADMIN_API_TOKEN: '' },
  });
  assert.match(res.stdout, /FAIL ADMIN_API_TOKEN/);
  assert.notEqual(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

test('all-green case: zero FAIL lines, exit 0', () => {
  const shimDir = makeShimDir();
  const storeDir = mkdtempSync(join(tmpdir(), 'prospectus-'));
  goodPython(shimDir);
  goodTesseract(shimDir);
  goodNode('v20.11.0')(shimDir);
  const res = run({ shimDir, env: baseGoodEnv(storeDir) });
  assert.doesNotMatch(res.stdout, /^FAIL/m);
  assert.equal(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});

test('every check runs even after an earlier FAIL — report-everything, not fail-fast', () => {
  const shimDir = makeShimDir();
  // No python3, no tesseract shim, bad TZ, no ADMIN_API_TOKEN, no store dir --
  // multiple independent FAILs should all be printed in one run.
  goodNode('v20.11.0')(shimDir);
  const res = run({
    shimDir,
    env: { TZ: 'America/New_York' },
  });
  assert.match(res.stdout, /FAIL python3/);
  assert.match(res.stdout, /FAIL .*TZ/);
  assert.match(res.stdout, /FAIL ADMIN_API_TOKEN/);
  assert.notEqual(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
});

test('--report mode: prints FAIL lines but always exits 0', () => {
  const shimDir = makeShimDir();
  goodNode('v20.11.0')(shimDir);
  const res = run({
    shimDir,
    env: { TZ: 'America/New_York' },
    args: ['--report'],
  });
  assert.match(res.stdout, /FAIL python3/);
  assert.match(res.stdout, /FAIL .*TZ/);
  assert.equal(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
});

test('WARN-only case (everything green except tesseract) still exits 0', () => {
  const shimDir = makeShimDir();
  const storeDir = mkdtempSync(join(tmpdir(), 'prospectus-'));
  goodPython(shimDir);
  goodNode('v20.11.0')(shimDir);
  const res = run({ shimDir, env: baseGoodEnv(storeDir) });
  assert.doesNotMatch(res.stdout, /^FAIL/m);
  assert.match(res.stdout, /WARN tesseract/);
  assert.equal(res.status, 0);
  rmSync(shimDir, { recursive: true, force: true });
  rmSync(storeDir, { recursive: true, force: true });
});
