#!/usr/bin/env bash
# Stage 3 item 3 slice S5 — self-test for the config-only-deploy link step
# added to scripts/deploy-linux.sh's release-link block: after a deploy,
# <release>/scraper/config/field-manifest.json is a symlink into
# shared/config/<slot>/, seeded once from the release's own file, never
# overwritten by a later release deploy.
#
# Run: bash scripts/tests/deploy-linux-config-link.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/../deploy-linux.sh"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

fresh_root() {
  local d
  d="$(mktemp -d)"
  printf '%s' "$d"
}

current_release_dir() {
  # staging slot -> $ROOT/current-staging ; prod -> $ROOT/current
  local root="$1" slot="$2" link
  if [ "$slot" = "prod" ]; then
    link="$root/current"
  else
    link="$root/current-$slot"
  fi
  if [ -L "$link" ]; then
    readlink -f "$link" 2>/dev/null || readlink "$link"
  elif [ -f "$link" ]; then
    # emulated marker (no native symlink support) — not expected on the
    # Linux target, but keep the helper honest if this runs there.
    cat "$link"
  fi
}

# ----------------------------------------------------------------- case 1
# A dry-run deploy leaves the release's manifest a REAL symlink into
# shared/config/<slot>/, and the shared file was seeded (CONFIG_SHA=release).
{
  ROOT1="$(fresh_root)"
  OUT="$(DEPLOY_ROOT="$ROOT1" bash "$DEPLOY_SCRIPT" staging --dry-run --force 2>&1)"
  RC=$?

  if [ "$RC" -eq 0 ]; then
    pass "case1: dry-run deploy exits 0"
  else
    fail "case1: dry-run deploy exited $RC ($(printf '%s' "$OUT" | tail -20))"
  fi

  RELEASE1="$(current_release_dir "$ROOT1" staging)"
  MANIFEST1="$RELEASE1/scraper/config/field-manifest.json"

  if [ -n "$RELEASE1" ] && [ -L "$MANIFEST1" ]; then
    pass "case1: release's field-manifest.json is a symlink"
  else
    fail "case1: release's field-manifest.json is not a symlink (release=$RELEASE1, path=$MANIFEST1, $(ls -la "$RELEASE1/scraper/config" 2>&1))"
  fi

  LINK_TARGET="$(readlink "$MANIFEST1" 2>/dev/null)"
  case "$LINK_TARGET" in
    *"shared/config/staging/field-manifest.json"|*"shared\\config\\staging\\field-manifest.json")
      pass "case1: symlink target points into shared/config/staging/" ;;
    *)
      fail "case1: symlink target does not point into shared/config/staging/ (target=$LINK_TARGET)" ;;
  esac

  if [ -f "$ROOT1/shared/config/staging/CONFIG_SHA" ] && [ "$(cat "$ROOT1/shared/config/staging/CONFIG_SHA")" = "release" ]; then
    pass "case1: CONFIG_SHA seeded as 'release'"
  else
    fail "case1: CONFIG_SHA not seeded as 'release' ($(cat "$ROOT1/shared/config/staging/CONFIG_SHA" 2>&1))"
  fi
}

# ----------------------------------------------------------------- case 2
# Seeded once, never overwritten: pre-seed the shared file with a sentinel,
# run a deploy, and confirm the sentinel content survives untouched.
{
  ROOT2="$(fresh_root)"
  mkdir -p "$ROOT2/shared/config/staging"
  printf '{"version":"SENTINEL-DO-NOT-OVERWRITE","fields":{}}' > "$ROOT2/shared/config/staging/field-manifest.json"
  printf '%s' "deadbeef1234567890" > "$ROOT2/shared/config/staging/CONFIG_SHA"

  DEPLOY_ROOT="$ROOT2" bash "$DEPLOY_SCRIPT" staging --dry-run --force >/tmp/deploy-config-link-case2.log 2>&1
  RC=$?

  if [ "$RC" -eq 0 ]; then
    pass "case2: second deploy over a pre-seeded shared config exits 0"
  else
    fail "case2: second deploy exited $RC ($(tail -20 /tmp/deploy-config-link-case2.log))"
  fi

  SHARED_CONTENT="$(cat "$ROOT2/shared/config/staging/field-manifest.json" 2>&1)"
  if printf '%s' "$SHARED_CONTENT" | grep -q "SENTINEL-DO-NOT-OVERWRITE"; then
    pass "case2: pre-seeded shared manifest content is NOT overwritten by a release deploy"
  else
    fail "case2: shared manifest was overwritten (content=$SHARED_CONTENT)"
  fi

  SHARED_SHA="$(cat "$ROOT2/shared/config/staging/CONFIG_SHA" 2>&1)"
  if [ "$SHARED_SHA" = "deadbeef1234567890" ]; then
    pass "case2: pre-seeded CONFIG_SHA is NOT overwritten by a release deploy"
  else
    fail "case2: CONFIG_SHA was overwritten (value=$SHARED_SHA)"
  fi

  RELEASE2="$(current_release_dir "$ROOT2" staging)"
  MANIFEST2="$RELEASE2/scraper/config/field-manifest.json"
  if [ -L "$MANIFEST2" ]; then
    LINKED_CONTENT="$(cat "$MANIFEST2" 2>&1)"
    if printf '%s' "$LINKED_CONTENT" | grep -q "SENTINEL-DO-NOT-OVERWRITE"; then
      pass "case2: the new release's manifest (through the symlink) reads the pre-seeded sentinel"
    else
      fail "case2: new release's manifest content wrong via symlink ($LINKED_CONTENT)"
    fi
  else
    fail "case2: new release's manifest is not a symlink"
  fi
}

# ----------------------------------------------------------------- case 3
# prod slot uses shared/config/prod (not staging), same mechanics.
{
  ROOT3="$(fresh_root)"
  DEPLOY_ROOT="$ROOT3" bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-config-link-case3.log 2>&1
  RC=$?

  RELEASE3="$(current_release_dir "$ROOT3" prod)"
  MANIFEST3="$RELEASE3/scraper/config/field-manifest.json"

  if [ "$RC" -eq 0 ] && [ -L "$MANIFEST3" ]; then
    LINK_TARGET3="$(readlink "$MANIFEST3" 2>/dev/null)"
    case "$LINK_TARGET3" in
      *"shared/config/prod/field-manifest.json"|*"shared\\config\\prod\\field-manifest.json")
        pass "case3: prod slot links into shared/config/prod/" ;;
      *)
        fail "case3: prod slot symlink target wrong ($LINK_TARGET3)" ;;
    esac
  else
    fail "case3: prod dry-run deploy did not produce a symlinked manifest (rc=$RC, $(tail -20 /tmp/deploy-config-link-case3.log))"
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
