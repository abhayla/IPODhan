#!/usr/bin/env bash
#
# Regression guard for the scheduled-staging cadence gate in
# .github/workflows/deploy-linux.yml (slice s17, 2026-09-10).
#
# The gate replaced the workflow's `push` trigger. It is the only thing
# standing between "staging deploys once per 15 minutes when main actually
# moved" and either (a) staging never deploying again, silently, or (b)
# staging deploying on every tick. Neither failure announces itself, so the
# gate's branches are pinned here.
#
# The test does NOT re-implement the gate: it extracts the `run:` body of the
# `gate` step straight out of the workflow YAML and executes it, so an edit to
# the workflow is what this test sees. `curl` is stubbed (the real
# /api/version lives on the production box and is never contacted from a
# test); git history is a throwaway repo under mktemp.
#
# Usage: bash scripts/tests/deploy-linux-schedule-gate.test.sh
# Exit 0 = every branch behaves; exit 1 = at least one case failed.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WF="$REPO_ROOT/.github/workflows/deploy-linux.yml"

if [ ! -f "$WF" ]; then
  echo "FAIL: workflow not found at $WF" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Extract the gate step's run: body. Deliberately dependency-free: this test
# runs on a bare ubuntu-latest checkout with no `npm ci`, so neither `yaml` nor
# `js-yaml` is installed. It walks to the step whose `id: gate`, finds that
# step's `run: |` block scalar, and dedents it. A wrong extraction cannot pass
# silently - the `bash -n` check below and every case then fail.
node -e '
  const fs = require("fs");
  const [wf, out] = process.argv.slice(1);
  const lines = fs.readFileSync(wf, "utf8").split(/\r?\n/);
  const idAt = lines.findIndex((l) => /^\s+id:\s*gate\s*$/.test(l));
  if (idAt === -1) { console.error("no step with `id: gate` in " + wf); process.exit(1); }
  let runAt = -1;
  for (let i = idAt; i < lines.length; i++) {
    if (/^\s+run:\s*\|\s*$/.test(lines[i])) { runAt = i; break; }
    // A following `- name:` at step level means this step has no run: block.
    if (i > idAt && /^\s+-\s+name:/.test(lines[i])) break;
  }
  if (runAt === -1) { console.error("the `id: gate` step has no `run: |` block"); process.exit(1); }
  const body = [];
  let indent = null;
  for (let i = runAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") { body.push(""); continue; }
    const lead = l.length - l.trimStart().length;
    if (indent === null) indent = lead;
    if (lead < indent) break;
    body.push(l.slice(indent));
  }
  while (body.length && body[body.length - 1] === "") body.pop();
  if (!body.length) { console.error("the `id: gate` run: block is empty"); process.exit(1); }
  fs.writeFileSync(out, body.join("\n") + "\n");
' "$WF" "$TMP/gate.sh" || { echo "FAIL: could not extract the gate step from $WF" >&2; exit 1; }

# Sanity: the extraction must have picked up the whole gate, not a fragment.
for marker in 'proceed=true' 'proceed=false' 'EVENT_NAME' 'api/version'; do
  if ! grep -qF "$marker" "$TMP/gate.sh"; then
    echo "FAIL: extracted gate body is missing '$marker' - the extraction is wrong, not the gate" >&2
    exit 1
  fi
done

bash -n "$TMP/gate.sh" || { echo "FAIL: the gate step body is not valid bash" >&2; exit 1; }

# Throwaway history: base -> docs-only commit -> code commit.
REPO="$TMP/repo"
mkdir -p "$REPO"
cd "$REPO"
git init -q .
git config user.email test@example.com
git config user.name test
mkdir -p docs
echo a > app.ts
echo a > docs/x.md
echo a > README.md
git add -A && git commit -q -m base
BASE="$(git rev-parse HEAD)"
echo b > docs/x.md
echo b > README.md
git add -A && git commit -q -m docs-only
DOCS="$(git rev-parse HEAD)"
echo b > app.ts
git add -A && git commit -q -m code
CODE="$(git rev-parse HEAD)"

mkdir -p "$TMP/bin"
cat > "$TMP/bin/curl" <<'STUB'
#!/usr/bin/env bash
# Stub: STUB_CURL_FAIL=1 emulates an unreachable staging (curl -f exit 7);
# otherwise it prints STUB_CURL_BODY verbatim.
if [ "${STUB_CURL_FAIL:-0}" = "1" ]; then exit 7; fi
printf '%s' "${STUB_CURL_BODY:-}"
STUB
chmod +x "$TMP/bin/curl"
export PATH="$TMP/bin:$PATH"

FAILED=0

run_case() {
  local name="$1" want="$2"
  shift 2
  local outfile="$TMP/out" sumfile="$TMP/sum" log="$TMP/log"
  : > "$outfile"
  : > "$sumfile"
  GITHUB_OUTPUT="$outfile" GITHUB_STEP_SUMMARY="$sumfile" "$@" bash "$TMP/gate.sh" > "$log" 2>&1
  local got
  got="$(grep -E '^proceed=' "$outfile" | tail -n1 | cut -d= -f2)"
  if [ "$got" = "$want" ]; then
    echo "PASS: $name -> proceed=$got"
  else
    echo "FAIL: $name -> proceed='$got' (wanted '$want')"
    sed 's/^/    /' "$log"
    FAILED=1
  fi
}

# A skip must never be silent: the gate has to say why, in the job summary.
assert_summary_mentions() {
  local name="$1" needle="$2"
  shift 2
  local outfile="$TMP/out2" sumfile="$TMP/sum2"
  : > "$outfile"
  : > "$sumfile"
  GITHUB_OUTPUT="$outfile" GITHUB_STEP_SUMMARY="$sumfile" "$@" bash "$TMP/gate.sh" > /dev/null 2>&1
  if grep -qF "$needle" "$sumfile"; then
    echo "PASS: $name (summary says why)"
  else
    echo "FAIL: $name - job summary does not contain '$needle'; got: $(cat "$sumfile")"
    FAILED=1
  fi
}

json() { printf '{"success":true,"data":{"sha":"%s","builtAt":null}}' "$1"; }

# --- workflow_dispatch is untouched: it is the ONLY route to prod, and the ---
# --- gate must never turn a human's deploy into a no-op.                  ---
run_case "workflow_dispatch slot=prod always proceeds" true \
  env EVENT_NAME=workflow_dispatch SLOT=prod HEAD_SHA="$CODE"
run_case "workflow_dispatch slot=staging always proceeds" true \
  env EVENT_NAME=workflow_dispatch SLOT=staging HEAD_SHA="$CODE"
run_case "workflow_dispatch proceeds even with staging unreachable" true \
  env EVENT_NAME=workflow_dispatch SLOT=prod HEAD_SHA="$CODE" STUB_CURL_FAIL=1
# The case that catches a dispatch accidentally falling through into the poll:
# here the poll's own answer would be "skip" (served == head), so anything but
# proceed=true means a human's deploy - the ONLY route to prod - became a
# silent no-op.
run_case "workflow_dispatch proceeds even when the poll would say skip" true \
  env EVENT_NAME=workflow_dispatch SLOT=prod HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$CODE")"

# --- the poll ---
run_case "schedule: staging already serves main's head -> no deploy" false \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$CODE")"
run_case "schedule: only docs/** and *.md changed -> no deploy (old paths-ignore)" false \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$DOCS" STUB_CURL_BODY="$(json "$BASE")"
run_case "schedule: code changed -> deploy" true \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$BASE")"
# The comparison is against what is SERVED, never against the previous tick,
# so a docs-only skip cannot swallow the code merge that follows it.
run_case "schedule: a docs-only skip does not lose the later code merge" true \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$DOCS")"
# Burst collapse: two merges (docs then code) with one tick between them and
# staging still on BASE produce ONE deploy carrying both.
run_case "schedule: two merges in one window collapse into one deploy" true \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$BASE")"

# --- unreachable staging deploys, loudly. Never silently does nothing. ---
run_case "schedule: /api/version unreachable -> deploy" true \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$CODE" STUB_CURL_FAIL=1
run_case "schedule: /api/version returns non-JSON -> deploy" true \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="<html>502 Bad Gateway</html>"
run_case "schedule: sha is the 'unknown' placeholder -> deploy" true \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json unknown)"
run_case "schedule: served sha is not a commit in this clone -> deploy" true \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$CODE" \
  STUB_CURL_BODY="$(json 0123456789012345678901234567890123456789)"

assert_summary_mentions "unreachable staging warns in the job summary" "WARNING" \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$CODE" STUB_CURL_FAIL=1
assert_summary_mentions "an up-to-date skip explains itself" "no deploy this tick" \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$CODE")"
assert_summary_mentions "a docs-only skip explains itself" "Only documentation changed" \
  env EVENT_NAME=schedule SLOT=staging HEAD_SHA="$DOCS" STUB_CURL_BODY="$(json "$BASE")"

# --- the concurrency group (s20: push restored alongside schedule, since
# --- the schedule trigger never fired). Both push and schedule must map to
# --- the staging group, or a push deploy would not serialise against a
# --- manual slot=staging dispatch on the same box.
if grep -qF "group: deploy-linux-\${{ (github.event_name == 'push' || github.event_name == 'schedule') && 'staging' || inputs.slot }}" "$WF"; then
  echo "PASS: concurrency group keys on both push and schedule events"
else
  echo "FAIL: concurrency group expression is not the expected push+schedule-keyed form:"
  grep -n 'group: deploy-linux-' "$WF" | sed 's/^/    /'
  FAILED=1
fi

if grep -qE "^\s+-\s+cron:\s+'\*/15 \* \* \* \*'" "$WF"; then
  echo "PASS: schedule is every 15 minutes"
else
  echo "FAIL: expected a */15 cron in $WF"
  FAILED=1
fi

# --- s20: the schedule trigger from #549 never fired (measured twice, an
# --- hour apart: 0 scheduled runs). push is restored as the primary
# --- trigger; schedule is kept as a harmless backstop (the decide job's
# --- served==head check no-ops a late scheduled tick after a push already
# --- deployed).
if grep -qE '^\s+push:' "$WF"; then
  echo "PASS: push trigger restored (schedule never fired - see s20)"
else
  echo "FAIL: expected the push trigger to be present in $WF"
  FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo "deploy-linux-schedule-gate.test.sh: PASSED"
else
  echo "deploy-linux-schedule-gate.test.sh: FAILED"
fi
exit "$FAILED"
