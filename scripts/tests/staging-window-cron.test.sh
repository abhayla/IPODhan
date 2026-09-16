#!/usr/bin/env bash
#
# Regression guard for install_staging_window_cron() in scripts/deploy-linux.sh
# (owner standing rule 2026-09-16, "staging deploys in windows, not per
# merge"). Mirrors the idempotent, marker-scoped install_scraper_cron
# pattern it copies, and must stay idempotent the same way: running the
# install twice must leave exactly ONE staging-window crontab line, never
# two, and must never touch any other crontab entry (the scraper-wake line,
# or another slot's line).
#
# Extracts the real function body out of deploy-linux.sh (not a
# re-implementation) so an edit to the function is what this test sees, then
# runs it against a fake `crontab` shim on PATH that reads/writes a plain
# file instead of the real system crontab.
#
# Usage: bash scripts/tests/staging-window-cron.test.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/deploy-linux.sh"

if [ ! -f "$SCRIPT" ]; then
  echo "FAIL: deploy-linux.sh not found at $SCRIPT" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Extract everything from "install_staging_window_cron() {" to its closing
# "}" at column 0, plus the two variable lines immediately above it
# (STAGING_WINDOW_CRON_MARKER / STAGING_WINDOW_CRON / STAGING_WINDOW_LOG) so
# the function has the globals it reads already in scope.
node -e '
  const fs = require("fs");
  const [src, out] = process.argv.slice(1);
  const lines = fs.readFileSync(src, "utf8").split(/\r?\n/);
  const varAt = lines.findIndex((l) => /^STAGING_WINDOW_CRON_MARKER=/.test(l));
  const fnStart = lines.findIndex((l) => /^install_staging_window_cron\(\) \{/.test(l));
  if (varAt === -1 || fnStart === -1) {
    console.error("could not find STAGING_WINDOW_CRON_MARKER= or install_staging_window_cron() in " + src);
    process.exit(1);
  }
  let fnEnd = -1;
  for (let i = fnStart + 1; i < lines.length; i++) {
    if (lines[i] === "}") { fnEnd = i; break; }
  }
  if (fnEnd === -1) {
    console.error("could not find the closing brace of install_staging_window_cron()");
    process.exit(1);
  }
  const body = lines.slice(varAt, fnEnd + 1).join("\n") + "\n";
  fs.writeFileSync(out, body);
' "$SCRIPT" "$TMP/fn.sh" || { echo "FAIL: could not extract install_staging_window_cron from $SCRIPT" >&2; exit 1; }

for marker in 'install_staging_window_cron()' 'STAGING_WINDOW_CRON_MARKER' 'ipodhan-staging-window' 'SLOT' 'DRY_RUN'; do
  if ! grep -qF "$marker" "$TMP/fn.sh"; then
    echo "FAIL: extracted function body is missing '$marker' - the extraction is wrong, not the function" >&2
    exit 1
  fi
done

bash -n "$TMP/fn.sh" || { echo "FAIL: extracted function body is not valid bash" >&2; exit 1; }

# Minimal stand-ins for the helpers/vars the real script defines at top level
# that this function reads: log(), warn(), CURRENT_LINK.
cat > "$TMP/harness.sh" <<'HARNESS'
log() { echo "LOG: $*"; }
warn() { echo "WARN: $*" >&2; }
CURRENT_LINK="/var/www/ipodhan/current"
HARNESS

cat "$TMP/harness.sh" "$TMP/fn.sh" > "$TMP/lib.sh"

# Fake crontab: `crontab -l` prints $CRONTAB_FILE (or nothing/exit1 if
# missing, matching real crontab -l on an empty crontab); `crontab -`
# replaces $CRONTAB_FILE with stdin.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/crontab" <<'STUB'
#!/usr/bin/env bash
FILE="${FAKE_CRONTAB_FILE:?FAKE_CRONTAB_FILE not set}"
if [ "$1" = "-l" ]; then
  if [ -f "$FILE" ]; then cat "$FILE"; else exit 1; fi
  exit 0
elif [ "$1" = "-" ]; then
  cat > "$FILE"
  exit 0
fi
echo "unsupported fake crontab invocation: $*" >&2
exit 2
STUB
chmod +x "$TMP/bin/crontab"

FAILED=0

run_install() {
  local slot="$1" dry_run="$2" cronfile="$3"
  ( export PATH="$TMP/bin:$PATH"
    export FAKE_CRONTAB_FILE="$cronfile"
    export SLOT="$slot"
    export DRY_RUN="$dry_run"
    # shellcheck disable=SC1090
    source "$TMP/lib.sh"
    install_staging_window_cron
  )
}

# --- prod slot: must be a total no-op (no crontab call, no line installed) ---
PROD_CRON="$TMP/prod-crontab"
: > "$PROD_CRON"
run_install prod 0 "$PROD_CRON" > "$TMP/prod.log" 2>&1
if [ -s "$PROD_CRON" ]; then
  echo "FAIL: prod slot installed a crontab line - it must be a total no-op" >&2
  cat "$PROD_CRON" >&2
  FAILED=1
else
  echo "PASS: prod slot installs nothing"
fi

# --- staging slot, first install: exactly one marked line appears ---
CRON1="$TMP/crontab1"
printf '%s\n' '0 3 * * * /some/other/job.sh # unrelated' > "$CRON1"
run_install staging 0 "$CRON1" > "$TMP/install1.log" 2>&1
COUNT1="$(grep -c 'ipodhan-staging-window' "$CRON1" || true)"
if [ "$COUNT1" -eq 1 ]; then
  echo "PASS: first staging install adds exactly one marked line"
else
  echo "FAIL: first staging install produced $COUNT1 marked lines (wanted 1)" >&2
  cat "$CRON1" >&2
  FAILED=1
fi
if grep -qF '/some/other/job.sh' "$CRON1"; then
  echo "PASS: unrelated existing crontab entries survive the install"
else
  echo "FAIL: install clobbered an unrelated crontab entry" >&2
  FAILED=1
fi
if grep -q '^30 13,21 \* \* \*.*ipodhan-staging-window' "$CRON1"; then
  echo "PASS: installed line carries the 13:30/21:30 IST schedule"
else
  echo "FAIL: installed line does not match the expected schedule" >&2
  cat "$CRON1" >&2
  FAILED=1
fi

# --- idempotency: installing twice leaves exactly ONE marked line ---
run_install staging 0 "$CRON1" > "$TMP/install2.log" 2>&1
COUNT2="$(grep -c 'ipodhan-staging-window' "$CRON1" || true)"
if [ "$COUNT2" -eq 1 ]; then
  echo "PASS: second install is idempotent - still exactly one marked line"
else
  echo "FAIL: second install produced $COUNT2 marked lines (wanted 1) - not idempotent" >&2
  cat "$CRON1" >&2
  FAILED=1
fi
if grep -qF '/some/other/job.sh' "$CRON1"; then
  echo "PASS: unrelated entry still survives after the second install"
else
  echo "FAIL: second install clobbered an unrelated crontab entry" >&2
  FAILED=1
fi

# --- dry-run: never touches the crontab file at all ---
CRON2="$TMP/crontab-dryrun"
: > "$CRON2"
run_install staging 1 "$CRON2" > "$TMP/dryrun.log" 2>&1
if [ -s "$CRON2" ]; then
  echo "FAIL: dry-run wrote to the crontab file" >&2
  FAILED=1
else
  echo "PASS: dry-run does not touch the crontab"
fi
if grep -q '\[dry-run\] would install crontab line' "$TMP/dryrun.log"; then
  echo "PASS: dry-run prints the line it would install"
else
  echo "FAIL: dry-run did not print what it would install" >&2
  cat "$TMP/dryrun.log" >&2
  FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo "staging-window-cron.test.sh: PASSED"
else
  echo "staging-window-cron.test.sh: FAILED"
fi
exit "$FAILED"
