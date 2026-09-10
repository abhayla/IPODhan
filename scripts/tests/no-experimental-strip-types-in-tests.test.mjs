// Anti-regression guard for the class fixed in scraper-vitest-alias-table.test.mjs
// (item 1 slice s14 CI-portability fix): a test that hands
// --experimental-strip-types to a subprocess is green on any laptop with
// Node >= 22.6 and red on every pr-gate run, because pr-gate.yml pins Node
// 20 for the steps that run scripts/**/*.test.* -- that flag does not exist
// before Node 22.6. The fix for the one known member of this class
// (scraper-vitest-alias-table.test.mjs) was to evaluate the target file
// under tsx (already a devDependency, works on Node 20) instead; this test
// makes the underlying mistake -- handing that flag to a subprocess --
// impossible to reintroduce silently, in any test file under scripts/, not
// just scripts/tests/.
//
// Scope: DISCOVERED, not hard-coded. scripts/ci/tests/ holds the same kind
// of test file (e.g. require-fixture-provenance.test.mjs) as scripts/tests/,
// and nothing stops a third directory appearing later -- so this walks the
// whole scripts/ tree for *.test.{mjs,ts,mts,cjs} rather than naming
// directories.
//
// Detection is PER LINE, not per file: a line is an offender if it contains
// the flag text AND that same line also shows evidence of handing
// something to a subprocess -- node:child_process's spawn/exec family, a
// NODE_OPTIONS assignment (which reaches whatever subprocess inherits that
// env var), or the flag written as its own quoted argv token. Per-line,
// not whole-file, on purpose: this file's own sibling,
// scraper-vitest-alias-table.test.mjs, legitimately calls spawnSync AND
// separately mentions the flag in a comment explaining what it no longer
// does -- a whole-file "contains spawn AND contains the flag" check flags
// that file every time regardless of whether the two are related, which is
// exactly the kind of guard a real fix could never pass. A prose mention or
// an error message on its own line (see generate-ipo-slug-parity.test.mjs,
// which imports a .ts file directly via Node's built-in erasable-TypeScript
// stripping and never calls spawn/exec or touches NODE_OPTIONS anywhere)
// stays clean. This also catches the flag written unquoted inside a shell
// command string on the same line (`execSync('node
// --experimental-strip-types ...')`), which a quote-anchored regex alone
// would miss.
//
// Known, accepted gap: a flag ASSEMBLED at runtime by string concatenation
// or similar (e.g. '--experiment' + 'al-strip-types') will not appear as
// the contiguous literal this guard greps for, so it evades detection no
// matter how the "handed to a process" side is framed -- catching that
// needs evaluating the code, not scanning its text. Not worth building: no
// occurrence in this repo does this, and deliberately obfuscating a flag to
// slip past a lint guard is a code-review-shaped problem (unusual,
// suspicious code), not a class this mechanical check exists to catch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, '..');
const SELF = fileURLToPath(import.meta.url);

const FLAG = '--experimental-strip-types';
const FLAG_AS_QUOTED_ARG = /['"]--experimental-strip-types['"]/;
const PROCESS_HANDOFF = /\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork|child_process)\b/;
const NODE_OPTIONS_TOKEN = /\bNODE_OPTIONS\b/;

function listTestFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTestFiles(full));
    } else if (entry.isFile() && /\.test\.(mjs|ts|mts|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test('no scripts/**/*.test.{mjs,ts,mts,cjs} file hands --experimental-strip-types to a subprocess', () => {
  const offenders = [];
  for (const file of listTestFiles(SCRIPTS_DIR)) {
    if (file === SELF) continue; // this guard names the flag throughout its own comments above
    const text = readFileSync(file, 'utf8');
    if (!text.includes(FLAG)) continue;
    const offendingLine = text
      .split('\n')
      .find(
        (line) =>
          line.includes(FLAG) &&
          (FLAG_AS_QUOTED_ARG.test(line) || PROCESS_HANDOFF.test(line) || NODE_OPTIONS_TOKEN.test(line))
      );
    if (offendingLine !== undefined) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    `these files hand --experimental-strip-types to a subprocess (directly, or via NODE_OPTIONS), ` +
      `which needs Node >= 22.6 and is therefore red on every pr-gate run (pinned to Node 20): ` +
      `${offenders.join(', ')}. Evaluate the target file under tsx instead (see ` +
      `scripts/tests/scraper-vitest-alias-table.test.mjs + scripts/tests/fixtures/print-scraper-vitest-alias.mts).`
  );
});
