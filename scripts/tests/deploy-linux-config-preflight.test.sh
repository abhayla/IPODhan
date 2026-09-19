#!/usr/bin/env bash
# #793 M1 — self-test for preflight_deployed_config() in scripts/deploy-linux.sh.
#
# THE INCIDENT IT GUARDS (docs/reviews/failure-classes/
# shared-config-not-shipped-by-code-deploy.json): a release's
# scraper/config/field-manifest.json is a SYMLINK into shared/config/<slot>/,
# which the code deploy never overwrites. b5614cc7 made `comparisonFamily` a
# required enum in field-manifest-schema.ts AND added it to the repo manifest in
# one commit; staging got the new schema against the day-old shared manifest, all
# 190 fields failed validation and the scraper crashed at start every 30 minutes
# for six hours — while the deploy reported SUCCESS.
#
# So the load-bearing case here is case 2: a DEPLOYED config the DEPLOYED schema
# refuses must FAIL the deploy. Case 1 proves the gate does not simply fail
# always (a gate that can only fail is as useless as one that can only pass).
#
# The function is extracted and run in isolation with DRY_RUN=0 (the case 8b/9b
# pattern in deploy-linux.test.sh) — a real deploy needs a real box.
#
# Run: bash scripts/tests/deploy-linux-config-preflight.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY_SCRIPT="$REPO_ROOT/scripts/deploy-linux.sh"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

PREFLIGHT_FN="$(sed -n '/^preflight_deployed_config()/,/^}/p' "$DEPLOY_SCRIPT")"
RESOLVE_BIN_FN="$(sed -n '/^resolve_bin()/,/^}/p' "$DEPLOY_SCRIPT")"
if [ -z "$PREFLIGHT_FN" ] || [ -z "$RESOLVE_BIN_FN" ]; then
  fail "could not extract preflight_deployed_config()/resolve_bin() from $DEPLOY_SCRIPT — renamed?"
  echo "SOME FAILED"
  exit 1
fi

# A "release" that looks like a real one to the function: the repo's own
# scraper/ tree (so the REAL loaders and the REAL schema run), plus a
# node_modules/ carrying tsx wherever npm hoisted it in this checkout.
TSX_REL=""
for cand in node_modules/tsx/dist/cli.mjs web/node_modules/tsx/dist/cli.mjs scraper/node_modules/tsx/dist/cli.mjs; do
  if [ -f "$REPO_ROOT/$cand" ]; then TSX_REL="$cand"; break; fi
done
if [ -z "$TSX_REL" ]; then
  echo "SKIP: no tsx/dist/cli.mjs in this checkout — install dependencies to run this suite"
  exit 0
fi
TSX_ABS="$REPO_ROOT/$TSX_REL"

make_release() {
  # $1 = release dir to build. Copies the repo's scraper tree so the validator
  # runs the REAL loaders against a config the case is free to corrupt without
  # ever touching the repo's own files.
  local rel="$1"
  mkdir -p "$rel/scraper" "$rel/node_modules/tsx/dist"
  # resolve_bin() looks for <rel>/{web,scraper,}/node_modules/tsx/dist/cli.mjs.
  # A tiny re-exporting shim beats copying tsx's whole tree.
  printf "import '%s';\n" "$TSX_ABS" > "$rel/node_modules/tsx/dist/cli.mjs"
  cp -r "$REPO_ROOT/scraper/src" "$rel/scraper/src"
  cp -r "$REPO_ROOT/scraper/config" "$rel/scraper/config"
  cp "$REPO_ROOT/scraper/package.json" "$rel/scraper/package.json" 2>/dev/null || true
  # The loaders import zod etc. from the repo's node_modules; node resolves
  # upward from the file, so give the release's scraper its own link to it.
  ln -sfn "$REPO_ROOT/node_modules" "$rel/scraper/node_modules" 2>/dev/null || true
}

run_preflight() {
  # Runs the extracted function against $1 with DRY_RUN=0. Echoes output; the
  # caller reads the exit code.
  local rel="$1"
  (
    eval "$RESOLVE_BIN_FN"
    eval "$PREFLIGHT_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    fatal() { echo "FATAL: $*" >&2; exit 1; }
    DRY_RUN=0
    SLOT="staging"
    SHA="b12c9d28deadbeefdeadbeefdeadbeefdeadbeef"
    preflight_deployed_config "$rel"
  ) 2>&1
}

# ----------------------------------------------------------------- case 1
# GREEN: a release whose deployed config matches its deployed schema passes,
# and says so. Without this, case 2 could be satisfied by a gate that always fails.
{
  REL1="$(mktemp -d)"
  make_release "$REL1"
  OUT1="$(run_preflight "$REL1")"
  RC1=$?

  if [ "$RC1" -eq 0 ]; then
    pass "case1: preflight passes when the deployed config satisfies the deployed schema"
  else
    fail "case1: preflight exited $RC1 on a GOOD config ($(printf '%s' "$OUT1" | tail -5))"
  fi

  if printf '%s' "$OUT1" | grep -q "deployed-config preflight OK"; then
    pass "case1: prints an OK line naming what loaded"
  else
    fail "case1: no 'deployed-config preflight OK' line (out=$(printf '%s' "$OUT1" | tail -3))"
  fi
  rm -rf "$REL1"
}

# ----------------------------------------------------------------- case 2
# RED — THE INCIDENT. The deployed manifest is the PREVIOUS config deploy's
# copy (no `comparisonFamily`); the deployed schema is today's, which requires
# it. This is the staging outage reproduced, and it MUST fail the deploy.
{
  REL2="$(mktemp -d)"
  make_release "$REL2"
  node -e 'const fs=require("fs");const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p,"utf8"));for(const k of Object.keys(m.fields))delete m.fields[k].comparisonFamily;fs.writeFileSync(p,JSON.stringify(m,null,2));' "$REL2/scraper/config/field-manifest.json"

  OUT2="$(run_preflight "$REL2")"
  RC2=$?

  if [ "$RC2" -ne 0 ]; then
    pass "case2: preflight FAILS the deploy when the deployed manifest lacks a key the deployed schema requires (#793)"
  else
    fail "case2: preflight exited 0 on the exact config that killed staging — the gate does not catch its own incident"
  fi

  # signal-ownership R6: the gate prints its reason, from the loader itself,
  # before exiting — not a bare "preflight failed".
  if printf '%s' "$OUT2" | grep -q "comparisonFamily"; then
    pass "case2: the loader's OWN error text (naming comparisonFamily) is printed"
  else
    fail "case2: failure text does not name the offending key ($(printf '%s' "$OUT2" | tail -5))"
  fi

  if printf '%s' "$OUT2" | grep -q "deploy-config.sh"; then
    pass "case2: names the recovery command (deploy-config.sh) in the failure"
  else
    fail "case2: failure does not name the recovery command"
  fi
  rm -rf "$REL2"
}

# ----------------------------------------------------------------- case 3
# FAIL CLOSED: the validator script missing from the release is a FAILED gate,
# not a silent skip. A gate that skips when it cannot run is the bug being fixed.
{
  REL3="$(mktemp -d)"
  make_release "$REL3"
  rm -f "$REL3/scraper/src/scripts/validate-deployed-config.ts"

  OUT3="$(run_preflight "$REL3")"
  RC3=$?

  if [ "$RC3" -ne 0 ]; then
    pass "case3: a missing validator script FAILS the deploy (fail closed, never skip)"
  else
    fail "case3: preflight exited 0 with its validator absent — it skipped instead of failing"
  fi
  rm -rf "$REL3"
}

# ----------------------------------------------------------------- case 4
# A dry run does not need a box: it logs the intent and returns 0, matching
# preflight_scraper_wake()'s dry-run behaviour.
{
  OUT4="$(
    (
      eval "$RESOLVE_BIN_FN"
      eval "$PREFLIGHT_FN"
      log() { echo "==> $*"; }
      fatal() { echo "FATAL: $*" >&2; exit 1; }
      DRY_RUN=1
      SLOT="staging"
      SHA="deadbeef"
      preflight_deployed_config "/nonexistent/release"
    ) 2>&1
  )"
  RC4=$?
  if [ "$RC4" -eq 0 ] && printf '%s' "$OUT4" | grep -q 'would run deployed-config preflight'; then
    pass "case4: dry-run logs the intent and returns 0"
  else
    fail "case4: dry-run behaved unexpectedly (rc=$RC4, out=$OUT4)"
  fi
}

# ----------------------------------------------------------------- case 5
# The gate is WIRED: deploy-linux.sh must actually call it on the real
# (non-dry-run) restart path, before the scraper is started. A perfect function
# nobody calls guards nothing.
{
  if grep -q 'preflight_deployed_config "\$RELEASE_DIR"' "$DEPLOY_SCRIPT"; then
    pass "case5: deploy-linux.sh calls preflight_deployed_config on the restart path"
  else
    fail "case5: deploy-linux.sh never calls preflight_deployed_config — the gate is dead code"
  fi

  CALL_LINE="$(grep -n 'preflight_deployed_config "\$RELEASE_DIR"' "$DEPLOY_SCRIPT" | head -1 | cut -d: -f1)"
  START_LINE="$(grep -n 'pm2 start "\$RELEASE_DIR/scripts/scraper-wake.sh"' "$DEPLOY_SCRIPT" | head -1 | cut -d: -f1)"
  if [ -n "$CALL_LINE" ] && [ -n "$START_LINE" ] && [ "$CALL_LINE" -lt "$START_LINE" ]; then
    pass "case5: the call precedes the scraper pm2 start (line $CALL_LINE < $START_LINE)"
  else
    fail "case5: call ordering wrong (call=$CALL_LINE, scraper start=$START_LINE)"
  fi
}

echo "---"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME FAILED"
  exit 1
fi
