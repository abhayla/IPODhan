// T-505 (owner decision 3, 2026-09-08): static assertion that the "live"
// branch of scripts/vps-data-audit-cron.sh step [4/5] calls
// audit-findings-to-issues.mjs with --new-only, not the old unfiltered call.
// This is a config-switch test (grep the shipped shell script text), not a
// behavioral test of audit-findings-to-issues.mjs itself — that module's
// own --new-only filtering logic is covered by
// scripts/tests/audit-findings-to-issues.test.mjs.
// Run: node --test scripts/tests/vps-data-audit-cron.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'vps-data-audit-cron.sh');
const SOURCE = readFileSync(SCRIPT_PATH, 'utf8');

function liveBranchBody() {
  // Isolate the `else ... fi` block that runs once $STATE_DIR/issues-live
  // exists, so this test only inspects the LIVE path, never the dry-run path
  // or the earlier, unrelated `if [[ -f "$PROD_ENV" ]] ... else ... fi` guard.
  const anchorIdx = SOURCE.indexOf('if [[ ! -f "$STATE_DIR/issues-live" ]]');
  assert.ok(anchorIdx !== -1, 'could not locate the issues-live conditional');
  const elseIdx = SOURCE.indexOf('\n  else\n', anchorIdx);
  const fiIdx = SOURCE.indexOf('\n  fi\n', elseIdx);
  assert.ok(elseIdx !== -1 && fiIdx !== -1, 'could not locate the live-branch else/fi block');
  return SOURCE.slice(elseIdx, fiIdx);
}

test('live branch invokes audit-findings-to-issues.mjs with --new-only', () => {
  const body = liveBranchBody();
  assert.match(
    body,
    /node scripts\/audit-findings-to-issues\.mjs --new-only \|\| true/,
    'expected an active (uncommented) --new-only invocation in the live branch'
  );
});

test('live branch does not also run the old unfiltered invocation', () => {
  const body = liveBranchBody();
  const uncommentedLines = body
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'));
  const unfiltered = uncommentedLines.some((line) =>
    /node scripts\/audit-findings-to-issues\.mjs \|\| true/.test(line)
  );
  assert.equal(unfiltered, false, 'the old unfiltered call must be removed, not left active alongside --new-only');
});

test('dry-run branch is untouched (still forces AUDIT_ISSUES_DRY_RUN=1)', () => {
  assert.match(
    SOURCE,
    /AUDIT_ISSUES_DRY_RUN=1 node scripts\/audit-findings-to-issues\.mjs \|\| true/,
    'the dry-run default path must remain unchanged'
  );
});
