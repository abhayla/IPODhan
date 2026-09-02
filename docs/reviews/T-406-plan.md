# T-406 — VPS runtime preflight: plan

Context: `docs/reviews/ipo-pipeline-stage-gap-analysis.md` §6 stage 9 (that file does not
exist on this branch's history — not found under `docs/reviews/` here; proceeding from
the contract's DoD list directly, which is self-contained). Related: T-327 (TZ fix),
T-403 (prospectus store, on another branch — not merged here).

## Why this exists

`scripts/deploy-linux.sh` builds, migrates, and flips `current` to a new release, then
restarts PM2 — but nothing on that path checks that the BOX itself still has the runtime
the app needs (python3 + pdfplumber for DRHP PDF extraction, tesseract for OCR, a sane
process TZ, a writable prospectus store with headroom, Node >= 20, ADMIN_API_TOKEN for
the `--source=all` scraper cycle). A missing runtime dependency currently surfaces as a
silent per-cycle failure inside the scraper, not a deploy-time refusal. This is stage 9
of the test ladder: catch it BEFORE the restart, not after, in production logs.

## The T-327 TZ decision (read, not guessed)

`scripts/deploy-linux.sh`'s `restart_pm2()` prefixes every `pm2 start` with `TZ=UTC`
(lines ~537, ~544, ~576) — this is the actual fix for the T-327 P2-7 NSE date-drift
class (see the comment block there and `scripts/assert-env-keys.sh`'s `TZ` required-key
entries, same T-327 P2-7 note). `ecosystem.config.js`'s own `TZ: 'UTC'` is documented
DEAD config (never read on the Linux path). So the pm2-started process's TZ is always
forced to UTC regardless of the box's ambient TZ — this preflight check is a
defense-in-depth signal on the AMBIENT (shell/`/etc/timezone`) TZ, not the pm2 process
TZ (which the deploy already controls). Per the contract's DoD line, the accepted
ambient values are `Asia/Kolkata` (the box's likely real ambient, since this is an
India-hosted VPS and IST is a legitimate admin-facing default) or `UTC` — anything else
(or unreadable) is a FAIL, since it signals host drift the T-327 fix's belt-and-braces
posture depends on noticing.

## The T-403 PROSPECTUS_STORE_DIR decision (read, not guessed)

`document-store.ts` (the file that will define the default `PROSPECTUS_STORE_DIR`) does
not exist in this worktree — confirmed via `find` — it lives on the T-403 branch, not yet
merged. The contract names the default shape as `<shared>/prospectus`. This deploy
script's own "shared" directory is `$ROOT/shared` (see the file header's LAYOUT ON THE
BOX section and `ENV_DIR="$ROOT/shared/env/$SLOT"`), with `ROOT` defaulting to
`/var/www/ipodhan` (`DEPLOY_ROOT` override). So the check:
- If `PROSPECTUS_STORE_DIR` is set in the environment: that directory must exist and be
  writable — FAIL otherwise.
- If unset (current state, since T-403 hasn't landed): the store dir itself doesn't
  exist yet by design, so the check falls back to `${DEPLOY_ROOT:-/var/www/ipodhan}/shared`
  (the PARENT the eventual `<shared>/prospectus` will be created under) and asserts THAT
  is writable. The script comments this explicitly as "default owned by T-403" so nobody
  mistakes this fallback for the real check once T-403 lands.

## Checks (in this order; every check runs even after an earlier FAIL)

1. `python3` on PATH — FAIL if absent.
2. `python3 -c 'import pdfplumber'` — FAIL if python3 absent OR import fails.
3. `tesseract` on PATH — WARN only (contract: "until E4 lands").
4. TZ sanity — `$TZ` env var if set, else `/etc/timezone` contents, else `timedatectl
   show -p Timezone --value` as a last resort — value must be exactly `Asia/Kolkata` or
   `UTC` — FAIL otherwise (including "could not determine").
5. `PROSPECTUS_STORE_DIR` writable — per the T-403 fallback logic above — FAIL if the
   resolved directory (or its parent, when the dir itself is the not-yet-created
   default) is missing or not writable.
6. Free disk >= 2 GB at the same resolved path (`df -Pk`) — FAIL otherwise.
7. `node --version` >= 20 — FAIL otherwise (or if node is absent).
8. `ADMIN_API_TOKEN` set (non-blank) — FAIL otherwise. (Required for `--source=all`,
   mirrors `scraper/src/index.ts`'s `assertRequiredEnvForCycle`.)

## Script contract

`scripts/preflight-runtime.sh [--report]`

- POSIX `sh`-compatible (no bash-only syntax: no arrays, no `[[ ]]`, no `local` reliance
  beyond what `dash`/`sh` supports — using `sh` functions with positional params instead).
  Runs fine invoked as `bash scripts/preflight-runtime.sh` or `sh scripts/preflight-runtime.sh`.
- One line per check on stdout: `OK|WARN|FAIL <check-name> — <detail>`.
- Runs every check unconditionally (no early exit on first FAIL) — report-everything.
- Default mode: exit 0 if no FAIL line was printed (WARNs are fine); exit 1 if any FAIL.
- `--report` mode: same checks/output, always exit 0 (dry-run/inspection only).

## Wiring into scripts/deploy-linux.sh

Inserted immediately before the `log "Restarting PM2 apps"` / `restart_pm2` call (end of
step 9, before step 10's restart), following the same "source the slot's env file, then
assert, `fatal` on failure" shape as `apply_migrations`/`assert-env-keys.sh`:

- Skipped entirely in `--dry-run` mode (no real release/env/box to check), same as the
  required-keys assert and migrations step.
- Sources `$SCRAPER_ENV_FILE` (`set -a; . "$SCRAPER_ENV_FILE"; set +a`) so
  `ADMIN_API_TOKEN` / `PROSPECTUS_STORE_DIR` (if hand-provisioned there) are visible to
  the check, mirroring `apply_migrations`'s handling of `$WEB_ENV_FILE`.
- Runs `bash "$SCRIPT_DIR/preflight-runtime.sh"`; on non-zero exit, `fatal "runtime
  preflight failed for $RELEASE_NAME (T-406) — 'current' already points at the new
  release but PM2 was NOT restarted; fix the box and re-run restart_pm2 by hand, or
  redeploy."` — no `|| true` anywhere on this call. This intentionally runs AFTER the
  atomic flip (per the contract's literal placement: "immediately before the pm2 restart
  step") — a FAIL here still leaves `current` pointing at the new release but the OLD pm2
  process still running the OLD release's code, so the failure is loud and recoverable,
  never silently serving a half-restarted box.

## Self-test: scripts/tests/preflight-runtime.test.mjs

Uses `node:test` + `node:child_process.spawnSync`, invoking the real
`scripts/preflight-runtime.sh` as a subprocess with a temp `PATH` prepended with fake
executable shims (`python3`, `tesseract`, `node`) and controlled `env`. Cases (red before
the script exists, green after):

1. python3 missing on PATH -> FAIL line for check 1 (and cascading FAIL for check 2),
   default mode exits 1.
2. python3 present, `pdfplumber` import fails (fake python3 shim that exits 1 on `-c`)
   -> FAIL for check 2 only.
3. tesseract missing -> WARN (not FAIL) for check 3; overall exit code unaffected by it.
4. TZ neither `Asia/Kolkata` nor `UTC` (e.g. `America/New_York`) -> FAIL check 4.
5. `PROSPECTUS_STORE_DIR` set to a non-existent/non-writable path -> FAIL check 5.
6. `PROSPECTUS_STORE_DIR` unset, fallback parent writable (temp dir) -> OK check 5.
7. Simulated low free disk (best-effort: assert the check runs and reports a value;
   forcing an actual <2GB filesystem is out of scope for a unit test, so this case
   asserts the check's happy path plus a targeted FAIL by pointing the resolved dir at a
   path whose filesystem free space we can't control — covered instead by asserting the
   `df`-parsing helper account for a stubbed `df` shim in PATH returning a small number).
8. node < 20 (fake `node` shim printing `v18.19.0`) -> FAIL check 7.
9. `ADMIN_API_TOKEN` unset/blank -> FAIL check 8.
10. All-green case: every fake shim present and correct, TZ=UTC, ADMIN_API_TOKEN set,
    PROSPECTUS_STORE_DIR pointed at a writable temp dir -> zero FAIL lines, exit 0.
11. WARN-only case: everything green except tesseract missing -> exit 0 (WARN doesn't fail).
12. `--report` mode with a forced FAIL condition (e.g. missing python3) -> prints the FAIL
    line but exits 0.

Tests are written and run RED (against the not-yet-created script) before
`scripts/preflight-runtime.sh` is implemented, per the red-then-green contract
requirement.

## Verification

- `node --test scripts/tests/preflight-runtime.test.mjs` — all green.
- `bash -n scripts/preflight-runtime.sh` and `bash -n scripts/deploy-linux.sh` — syntax OK.
- `node scripts/check-workflow-ascii.js` — unaffected (this change touches no
  `.github/workflows/*.yml` `run:` blocks with non-ASCII; the new pr-gate.yml line
  wiring the self-test in is plain ASCII, verified by the same checker's scope: workflow
  files only, no shell files are in its scan surface).
- `--report` run over SSH on the Linux VPS 72.61.240.224, read-only, output saved to
  `evidence/T-406/vps-report.txt`.

## Files touched

- `scripts/preflight-runtime.sh` (new)
- `scripts/tests/preflight-runtime.test.mjs` (new)
- `scripts/deploy-linux.sh` (wiring, ~5-10 line hunk)
- `.github/workflows/pr-gate.yml` (one step, mirrors sibling `.test.mjs` wiring)
- `evidence/T-406/vps-report.txt` (evidence, new)
- `docs/reviews/T-406-plan.md` (this file)
