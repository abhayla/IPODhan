#!/usr/bin/env bash
#
# Regression guard for the window-vs-manual cadence gate in
# .github/workflows/deploy-linux.yml (2026-09-16, owner standing rule
# "staging deploys in windows, not per merge").
#
# HISTORY: this gate used to key on `github.event_name` (`push` vs
# `schedule` vs `workflow_dispatch`) - slice s17 replaced the `push`
# trigger with a 15-minute `schedule` poll, then s20 restored `push`
# because `schedule` never actually fired (measured: 29 push events, 1
# dispatch, ZERO schedule runs). 2026-09-16 removes BOTH `push` and
# `schedule` outright: there is no automatic trigger left, only
# `workflow_dispatch`, and the reliable timer moved to the VPS's own root
# crontab (scripts/ops/staging-window-deploy.sh), which dispatches with
# `-f mode=window`. The gate that used to ask "is this a scheduled poll?"
# now asks "is this a window dispatch?" via the `mode` input, and a
# separate step refuses a window dispatch against slot=prod outright (a
# window must only ever touch staging).
#
# The test does NOT re-implement the gate: it extracts the `run:` body of
# the `gate` step straight out of the workflow YAML and executes it, so an
# edit to the workflow is what this test sees. `curl` is stubbed (the real
# /api/version lives on the production box and is never contacted from a
# test); git history is a throwaway repo under mktemp.
#
# Usage: bash scripts/tests/deploy-linux-schedule-gate.test.sh
# Exit 0 = every branch behaves; exit 1 = at least one case failed.

set -uo pipefail
# A pre-push hook exports GIT_DIR; drop it so fixture git never hits the real repo (#1037).
. "$(dirname "${BASH_SOURCE[0]}")/lib/hermetic-git.sh"
hermetic_git_env

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
for marker in 'proceed=true' 'proceed=false' 'MODE' 'api/version'; do
  if ! grep -qF "$marker" "$TMP/gate.sh"; then
    echo "FAIL: extracted gate body is missing '$marker' - the extraction is wrong, not the gate" >&2
    exit 1
  fi
done

bash -n "$TMP/gate.sh" || { echo "FAIL: the gate step body is not valid bash" >&2; exit 1; }


# Throwaway history: base -> docs-only commit -> code commit.
REPO="$TMP/repo"
mkdir -p "$REPO"
cd "$REPO" || exit 1
git init -q .
assert_hermetic_repo "$REPO"
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

json() { printf '{"success":true,"data":{"sha":"%s","builtAt":null}}' "$1"; }

FAILED=0

# The gate step MUST declare an explicit shell without -e. GitHub Actions'
# bare `shell: bash` implicitly runs `bash -e -o pipefail`. The real
# 2026-09-14/15 incident (8 consecutive scheduled runs failed, e.g. run
# 35000236925, sha 6eb37048) was NOT a missing PORT_FILE - on the runner
# /var/www/ipodhan/shared/env/staging/web.env.local exists, mode 0600, with
# exactly one ^PORT= line, and staging on :3012 answered 557e7dc9. The
# actual killer is the DEPLOYABLE grep -v filter further down: git diff
# --name-only 557e7dc9 6eb37048 is three docs-only files, grep -v matches
# nothing against an all-docs changed set, exits 1, and `set -e` on a
# failed command substitution assigned to a variable kills the step BEFORE
# the -z "$DEPLOYABLE" skip check ever runs - a silent exit 1, zero note()
# output. Every case below this point in the file (via run_case, which
# uses plain `bash`, no -e) could NOT have caught this - only running the
# extracted body under the real GHA invocation does. Still applies verbatim
# under the mode-keyed gate: the failure lives in the DEPLOYABLE line, not
# in what selects the window branch.
if grep -qE "^\s+shell:\s+bash --noprofile --norc -o pipefail \{0\}\s*\$" "$WF"; then
  echo "PASS: the gate step's shell is explicit and does not carry -e"
else
  echo "FAIL: the gate step must declare 'shell: bash --noprofile --norc -o pipefail {0}' (no -e) - GHA's bare 'shell: bash' silently kills this script on any grep/curl miss" >&2
  FAILED=1
fi

# Reproduce the actual failure class under the REAL GHA invocation
# (bash -e -o pipefail is what `shell: bash` means): a genuinely missing
# PORT_FILE must still warn and deploy, not crash with zero output.
run_case_under_dash_e() {
  local name="$1" want="$2"
  shift 2
  local outfile="$TMP/oute" sumfile="$TMP/sume" log="$TMP/loge"
  : > "$outfile"; : > "$sumfile"
  GITHUB_OUTPUT="$outfile" GITHUB_STEP_SUMMARY="$sumfile" "$@" bash -e -o pipefail "$TMP/gate.sh" > "$log" 2>&1
  local rc=$?
  local got
  got="$(grep -E '^proceed=' "$outfile" 2>/dev/null | tail -n1 | cut -d= -f2)"
  if [ "$got" = "$want" ]; then
    echo "PASS: $name -> proceed=$got"
  else
    echo "FAIL: $name -> proceed='$got' rc=$rc (wanted '$want') - this is the exact 2026-09-14 regression if rc=2 and the log is empty" >&2
    sed 's/^/    /' "$log" >&2
    FAILED=1
  fi
}
# THE REAL REGRESSION (2026-09-14/15): staging serves BASE, HEAD is DOCS
# (a docs-only commit) - the changed set is 100% excluded by
# grep -vE '(\.md$|^docs/)', so grep -v exits 1. This is the exact shape
# of the incident (all changed files docs-only) and must deploy=false
# LOUDLY, not crash silently.
run_case_under_dash_e "window under bash -e -o pipefail (real GHA shell): ALL changed files are docs-only -> skip loudly, never a silent crash (the actual 2026-09-14 regression)" false   env MODE=window SLOT=staging HEAD_SHA="$DOCS" STUB_CURL_BODY="$(json "$BASE")"
# Defense-in-depth coverage kept alongside the real regression above: a
# genuinely missing/unreadable PORT_FILE has the identical `set -e` hazard
# even though it was NOT what actually failed on the runner this time.
run_case_under_dash_e "window under bash -e -o pipefail (real GHA shell): PORT_FILE missing -> warn + deploy, never a silent crash (defense in depth, not this incident)" true   env MODE=window SLOT=staging HEAD_SHA="$CODE" STUB_CURL_FAIL=1

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

# --- mode=manual is untouched: it is the ONLY route to prod, and the gate ---
# --- must never turn a human's (or the capped button's) deploy into a no-op.
run_case "mode=manual slot=prod always proceeds" true \
  env MODE=manual SLOT=prod HEAD_SHA="$CODE"
run_case "mode=manual slot=staging always proceeds" true \
  env MODE=manual SLOT=staging HEAD_SHA="$CODE"
run_case "mode=manual proceeds even with staging unreachable" true \
  env MODE=manual SLOT=prod HEAD_SHA="$CODE" STUB_CURL_FAIL=1
# The case that catches a manual dispatch accidentally falling through into
# the window logic: here the window's own answer would be "skip" (served ==
# head), so anything but proceed=true means a human's deploy - the ONLY
# route to prod - became a silent no-op.
run_case "mode=manual proceeds even when the window would say skip" true \
  env MODE=manual SLOT=prod HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$CODE")"

# --- the window ---
run_case "window: staging already serves main's head -> no deploy" false \
  env MODE=window SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$CODE")"
run_case "window: only docs/** and *.md changed -> no deploy (old paths-ignore)" false \
  env MODE=window SLOT=staging HEAD_SHA="$DOCS" STUB_CURL_BODY="$(json "$BASE")"
run_case "window: code changed -> deploy" true \
  env MODE=window SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$BASE")"
# The comparison is against what is SERVED, never against the previous
# tick, so a docs-only skip cannot swallow the code merge that follows it.
run_case "window: a docs-only skip does not lose the later code merge" true \
  env MODE=window SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$DOCS")"
# Burst collapse: any number of merges between two windows still collapse
# into one deploy carrying all of them.
run_case "window: several merges between two windows collapse into one deploy" true \
  env MODE=window SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$BASE")"

# --- unreachable staging deploys, loudly. Never silently does nothing. ---
run_case "window: /api/version unreachable -> deploy" true \
  env MODE=window SLOT=staging HEAD_SHA="$CODE" STUB_CURL_FAIL=1
run_case "window: /api/version returns non-JSON -> deploy" true \
  env MODE=window SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="<html>502 Bad Gateway</html>"
run_case "window: sha is the 'unknown' placeholder -> deploy" true \
  env MODE=window SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json unknown)"
run_case "window: served sha is not a commit in this clone -> deploy" true \
  env MODE=window SLOT=staging HEAD_SHA="$CODE" \
  STUB_CURL_BODY="$(json 0123456789012345678901234567890123456789)"

assert_summary_mentions "unreachable staging warns in the job summary" "WARNING" \
  env MODE=window SLOT=staging HEAD_SHA="$CODE" STUB_CURL_FAIL=1
assert_summary_mentions "an up-to-date skip explains itself" "no deploy this tick" \
  env MODE=window SLOT=staging HEAD_SHA="$CODE" STUB_CURL_BODY="$(json "$CODE")"
assert_summary_mentions "a docs-only skip explains itself" "Only documentation changed" \
  env MODE=window SLOT=staging HEAD_SHA="$DOCS" STUB_CURL_BODY="$(json "$BASE")"

# --- concurrency group: no automatic trigger remains, so the group keys ---
# --- purely on inputs.slot (every event reaching this workflow is a       ---
# --- workflow_dispatch).
if grep -qF "group: deploy-linux-\${{ inputs.slot }}" "$WF"; then
  echo "PASS: concurrency group keys on inputs.slot only (no automatic trigger remains)"
else
  echo "FAIL: concurrency group expression is not the expected inputs.slot-only form:"
  grep -n 'group: deploy-linux-' "$WF" | sed 's/^/    /'
  FAILED=1
fi

# --- no automatic trigger: push and schedule are both gone. ---
if grep -qE '^\s*push:' "$WF"; then
  echo "FAIL: an 'on.push' trigger is still present in $WF - staging must not auto-deploy on push (owner rule 2026-09-16)" >&2
  FAILED=1
else
  echo "PASS: no 'on.push' trigger (staging deploys in windows, not per merge)"
fi
if grep -qE '^\s*schedule:' "$WF"; then
  echo "FAIL: an 'on.schedule' trigger is still present in $WF - GitHub's schedule trigger was measured unreliable here and must not be relied on" >&2
  FAILED=1
else
  echo "PASS: no 'on.schedule' trigger (the reliable timer is the VPS crontab, not GitHub schedule)"
fi

# --- the mode input exists with exactly the two expected choices, default manual. ---
if grep -qE "^\s+mode:\s*$" "$WF"; then
  echo "PASS: workflow_dispatch declares a 'mode' input"
else
  echo "FAIL: workflow_dispatch is missing a 'mode' input" >&2
  FAILED=1
fi
if grep -qE "options: \[manual, window\]" "$WF"; then
  echo "PASS: 'mode' input has exactly the [manual, window] choices"
else
  echo "FAIL: 'mode' input does not declare exactly [manual, window]" >&2
  FAILED=1
fi
if grep -A4 -E "^\s+mode:\s*$" "$WF" | grep -qE "default: manual"; then
  echo "PASS: 'mode' defaults to manual"
else
  echo "FAIL: 'mode' input does not default to manual" >&2
  FAILED=1
fi

# --- a window dispatch against prod must be refused, in its own step, ---
# --- separately from the served-vs-head gate above (defense in depth). ---
if grep -qE "if: inputs\.mode == 'window' && inputs\.slot == 'prod'" "$WF"; then
  echo "PASS: a dedicated step refuses mode=window against slot=prod"
else
  echo "FAIL: no step guards against a mode=window dispatch targeting slot=prod" >&2
  FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo "deploy-linux-schedule-gate.test.sh: PASSED"
else
  echo "deploy-linux-schedule-gate.test.sh: FAILED"
fi
exit "$FAILED"
