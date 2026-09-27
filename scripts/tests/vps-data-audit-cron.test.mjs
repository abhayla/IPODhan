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

// MINOR fix (round 2, T-505): the original assertion matched --new-only
// against the raw block text, so it would still pass even if the ONLY
// --new-only line left were a comment (e.g. a revert that re-comments the
// invocation but leaves the string present in a comment above it). Strip
// comment lines first, same as the sibling test below, so this test is
// revert-proof on its own.
function activeLines(body) {
  return body.split('\n').filter((line) => !line.trim().startsWith('#'));
}

test('live branch invokes audit-findings-to-issues.mjs with --new-only', () => {
  const body = liveBranchBody();
  const uncommentedText = activeLines(body).join('\n');
  assert.match(
    uncommentedText,
    /node scripts\/audit-findings-to-issues\.mjs --new-only \|\| true/,
    'expected an active (uncommented) --new-only invocation in the live branch'
  );
});

test('live branch does not also run the old unfiltered invocation', () => {
  const body = liveBranchBody();
  const unfiltered = activeLines(body).some((line) =>
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

// #195 J2: the synthetic alert-drill step must be wired non-fatal (`|| echo`,
// never a bare `||` that sets `failed=1`) and gated to one IST weekday, so a
// still-missing NOTIFIER_KEY_IPODHAN_ALERT_DRILL (an ops step owed to the
// box, see docs/ops/prod-ops-recipes.md #17) can never fail this cron run.
test('audit-alert-drill step is invoked, IST-weekday-gated, and wired non-fatal', () => {
  assert.match(
    SOURCE,
    /IST_WEEKDAY="\$\(date -u -d "@\$\(\( \$\(date \+%s\) \+ 19800 \)\)" \+%u\)"/,
    'expected an IST-weekday computation (fixed +5:30 offset, same technique as DATE_TAG)'
  );
  assert.match(
    SOURCE,
    /if \[\[ "\$IST_WEEKDAY" == "4" \]\]; then/,
    'expected the drill to be gated to a single IST weekday'
  );
  assert.match(
    SOURCE,
    /node scripts\/audit-alert-drill\.mjs \|\| echo "NON-FATAL: audit-alert-drill exited/,
    'expected a non-fatal invocation of audit-alert-drill.mjs (never a bare `||` that sets failed=1)'
  );
});

test('audit-alert-drill step never sets failed=1 on its own exit', () => {
  const anchorIdx = SOURCE.indexOf('node scripts/audit-alert-drill.mjs');
  assert.ok(anchorIdx !== -1, 'could not locate the audit-alert-drill invocation');
  const lineEnd = SOURCE.indexOf('\n', anchorIdx);
  const line = SOURCE.slice(anchorIdx, lineEnd);
  assert.doesNotMatch(line, /failed=1/, 'audit-alert-drill must never fail the whole cron run');
});
