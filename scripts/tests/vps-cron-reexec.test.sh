#!/usr/bin/env bash
#
# Regression guard for #348: scripts/vps-data-audit-cron.sh must run TONIGHT's
# merged content on the SAME night it merges, not the following night.
#
# RCA: the old script did `git fetch` + `git reset --hard origin/main` INSIDE
# the run_audit() function. Bash parses a function body once, when the script
# starts, so resetting the FILE on disk mid-run never changed the BODY the
# already-running process was executing — the reset only took effect on the
# next cron tick.
#
# This test builds a REAL bare git origin plus a real clone (the "checked out
# copy on the box"), commits an OLD version of the script to the clone, then
# pushes a NEW version — with one extra audit step that prints a marker only
# the new body contains — to origin/main (simulating a merge landing while the
# old copy is still on disk). It then runs the file that is STILL ON DISK IN
# THE CLONE (the old content, unchanged since checkout) and asserts the
# marker from the NEW version appears in the log. That can only happen if the
# running process re-parsed the file AFTER the reset, i.e. the re-exec fired.
#
# It does not reimplement the script's logic: it copies the REAL
# scripts/vps-data-audit-cron.sh, patches its DIR/REPO/etc. defaults only via
# the DATA_AUDIT_* env var overrides the fix added (never by editing the
# script text), and lets real `node`/`npm` calls fail fast (no package.json in
# the fake repo) — those failures are already handled by the script's own
# `|| { failed=1; ... }` guards and do not block the assertions this test
# cares about.
#
# Usage: bash scripts/tests/vps-cron-reexec.test.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_SCRIPT="$REPO_ROOT/scripts/vps-data-audit-cron.sh"

if [ ! -f "$SOURCE_SCRIPT" ]; then
  echo "FAIL: vps-data-audit-cron.sh not found at $SOURCE_SCRIPT" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILED=0
git config --global user.email >/dev/null 2>&1 || git config --global user.email "test@example.com"
git config --global user.name  >/dev/null 2>&1 || git config --global user.name  "Test"

# --- build a bare origin + a clone, both seeded with the OLD script version ---
ORIGIN="$TMP/origin.git"
CLONE="$TMP/clone"
git init -q --bare -b main "$ORIGIN"
git -C "$ORIGIN" config core.autocrlf false
git clone -q "$ORIGIN" "$CLONE"
git -C "$CLONE" config core.autocrlf false
( cd "$CLONE" && git checkout -q -b main 2>/dev/null || git checkout -q main )

mkdir -p "$CLONE/scripts"
cp "$SOURCE_SCRIPT" "$CLONE/scripts/vps-data-audit-cron.sh"
( cd "$CLONE" && git add -A && git commit -q -m "old version" && git push -q origin HEAD:main )
OLD_SHA="$(git -C "$CLONE" rev-parse --short HEAD)"

# --- push a NEW version to origin: same script, plus one extra step whose
#     echo line only the NEW body contains ---
PUSHER="$TMP/pusher"
git clone -q -c core.autocrlf=false -b main "$ORIGIN" "$PUSHER"
NEW_SCRIPT="$PUSHER/scripts/vps-data-audit-cron.sh"
node -e '
  const fs = require("fs");
  const [path] = process.argv.slice(1);
  const src = fs.readFileSync(path, "utf8");
  const marker = "  echo \"--- [7/7] NEW-STEP-MARKER-V2 ---\"\n";
  const anchor = "  echo \"=== exit code: \$failed ===\"\n";
  if (!src.includes(anchor)) { console.error("anchor not found"); process.exit(1); }
  fs.writeFileSync(path, src.replace(anchor, marker + anchor));
' "$NEW_SCRIPT" || { echo "FAIL: could not build the V2 fixture script" >&2; exit 1; }
grep -qF 'NEW-STEP-MARKER-V2' "$NEW_SCRIPT" || { echo "FAIL: V2 fixture missing its own marker" >&2; exit 1; }
( cd "$PUSHER" && git add -A && git commit -q -m "new version, one more step" && git push -q origin main )
NEW_SHA="$(git -C "$PUSHER" rev-parse --short HEAD)"
[ "$OLD_SHA" != "$NEW_SHA" ] || { echo "FAIL: fixture setup produced identical shas" >&2; exit 1; }

# --- run the file STILL ON DISK IN THE CLONE (old content) ---
STATE_DIR="$TMP/state"
mkdir -p "$STATE_DIR"
PROD_ENV_FILE="$TMP/fake-prod.env"
: > "$PROD_ENV_FILE"

run_clone_script() {
  ( export DATA_AUDIT_DIR="$TMP/unused"
    export DATA_AUDIT_REPO="$CLONE"
    export DATA_AUDIT_STATE_DIR="$STATE_DIR"
    export DATA_AUDIT_NOTIFIER_ENV="$TMP/no-such-notifier.env"
    export DATA_AUDIT_PROD_ENV="$PROD_ENV_FILE"
    unset DATA_AUDIT_REEXECED
    bash "$CLONE/scripts/vps-data-audit-cron.sh"
  )
}

run_clone_script > "$TMP/run.log" 2>&1
LOG_FILE="$(ls -1 "$STATE_DIR"/run-*.log 2>/dev/null | head -1)"

if [ -z "$LOG_FILE" ]; then
  echo "FAIL: no run log was written to $STATE_DIR" >&2
  cat "$TMP/run.log" >&2
  FAILED=1
else
  if grep -qF 'NEW-STEP-MARKER-V2' "$LOG_FILE"; then
    echo "PASS: running the OLD on-disk script executed the NEW (post-merge) body — the re-exec fired"
  else
    echo "FAIL: the NEW version's step never ran — a merged change did not take effect on the same run" >&2
    echo "----- run log -----" >&2
    cat "$LOG_FILE" >&2
    FAILED=1
  fi

  if grep -qE "checked out: .*\($NEW_SHA.*[0-9]+ audit steps" "$LOG_FILE" || \
     { grep -qF "$NEW_SHA" "$LOG_FILE" && grep -qE '[0-9]+ audit steps' "$LOG_FILE"; }; then
    echo "PASS: log names the checked-out sha and this run's own step count (#348 detection)"
  else
    echo "FAIL: log is missing the checked-out sha + step-count detection line" >&2
    cat "$LOG_FILE" >&2
    FAILED=1
  fi

  if [ -f "$CLONE/scripts/vps-data-audit-cron.sh" ] && grep -qF 'NEW-STEP-MARKER-V2' "$CLONE/scripts/vps-data-audit-cron.sh"; then
    echo "PASS: the clone's working tree was actually reset to the new commit"
  else
    echo "FAIL: the clone's working tree was not updated to the new commit" >&2
    FAILED=1
  fi
fi

# --- second case: fetch fails -> the run still completes, WARN line present ---
BROKEN_CLONE="$TMP/broken-clone"
cp -r "$CLONE" "$BROKEN_CLONE"
rm -rf "$BROKEN_CLONE/.git"
mkdir -p "$BROKEN_CLONE/.git"  # a .git dir that is not a real repo -> fetch fails
BROKEN_STATE="$TMP/broken-state"
mkdir -p "$BROKEN_STATE"

( export DATA_AUDIT_DIR="$TMP/unused2"
  export DATA_AUDIT_REPO="$BROKEN_CLONE"
  export DATA_AUDIT_STATE_DIR="$BROKEN_STATE"
  export DATA_AUDIT_NOTIFIER_ENV="$TMP/no-such-notifier.env"
  export DATA_AUDIT_PROD_ENV="$PROD_ENV_FILE"
  unset DATA_AUDIT_REEXECED
  bash "$BROKEN_CLONE/scripts/vps-data-audit-cron.sh"
) > "$TMP/broken-run.log" 2>&1

BROKEN_LOG_FILE="$(ls -1 "$BROKEN_STATE"/run-*.log 2>/dev/null | head -1)"
if [ -z "$BROKEN_LOG_FILE" ]; then
  echo "FAIL: broken-fetch case wrote no run log — the run did not complete" >&2
  cat "$TMP/broken-run.log" >&2
  FAILED=1
else
  if grep -qE '^WARN: #348 pre-reexec fetch/reset skipped' "$BROKEN_LOG_FILE"; then
    echo "PASS: a failed fetch/reset prints a WARN line naming the cause"
  else
    echo "FAIL: no WARN line for the failed fetch/reset" >&2
    cat "$BROKEN_LOG_FILE" >&2
    FAILED=1
  fi
  if grep -qE '^=== exit code: [0-9]+ ===' "$BROKEN_LOG_FILE"; then
    echo "PASS: the audit still ran to completion despite the failed fetch/reset"
  else
    echo "FAIL: the audit did not run to completion after the failed fetch/reset" >&2
    cat "$BROKEN_LOG_FILE" >&2
    FAILED=1
  fi
fi

if [ "$FAILED" -eq 0 ]; then
  echo "vps-cron-reexec.test.sh: PASSED"
else
  echo "vps-cron-reexec.test.sh: FAILED"
fi
exit "$FAILED"
