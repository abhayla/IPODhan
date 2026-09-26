# Item 3 / slice S5 — config-only deploy path: the manifest lives in shared/config/<slot>, deployed without a build

Status: DONE 2026-09-17 PRs #743 proof owed (board: merged, staging proof owed)

Stage 3 ("one source table", plan v2 §3 and §4b finding 7). Ledger: `docs/design/stage-3-ledger.md`.
Gate: `node scripts/check-stage3-dod.mjs --slice S5`.

## Purpose

After this ships, a change to `scraper/config/field-manifest.json` reaches a slot with one command,
no build, no PM2 restart, and the next wake logs which config sha it ran with — while every release
stays an immutable checkout whose sha is still true.

## Serves

- OD-51 / §7.6 (configuration reaches production without a code change); plan v2 §3; §4b finding 7
  (do NOT copy into `current`: releases are immutable and `DEPLOYED_SHA-<slot>` is cross-checked,
  `scripts/deploy-linux.sh:17-22, 74, 1739`); finding 12 (S5 early gives every later slice a no-build
  staging turnaround). Owner D-3: a prod config deploy may run in any evening window, owner-worded.

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `scripts/deploy-linux.sh` — `ENV_DIR="$ROOT/shared/env/$SLOT"` (208), `CERT_FILE` (211), venv and next-cache under `shared/` (224, 237), `ln -sfn` of env files into each release (997-1001), `DEPLOYED_SHA-$SLOT` (1739), the symlink helper (1061-1075) | the pattern: `shared/config/$SLOT/field-manifest.json` is one more shared, release-independent file linked into `scraper/config/` of every release; the deploy script gains the link step and NOTHING else |
| `scripts/ops/deploy-staging-now.sh` — `--reason` required, 2/day cap with state file, `--override` logged, `--dry-run` | the discipline and the state-file idiom for the new script's reason + cap (staging cap 4/day for config, prod: owner word only) |
| `scripts/tests/deploy-staging-now.test.sh`, `scripts/tests/deploy-linux*.test.sh` (bash tests under `deploy-script-tests` job, pr-gate.yml:813) | the test harness: a fake `$ROOT` with `releases-<slot>/` and `current-<slot>` |
| `scraper/src/config/field-manifest-loader.ts` `DEFAULT_MANIFEST_PATH` and `validateFieldManifestAtStartup` (`index.ts:616-622`) | the start-time validation the plan relies on (finding 11); the loader reads through the symlink — no code change |
| S0b's start log line `field-manifest: version=… sha256=…` | the proof line; S5 appends ` config_sha=<git sha or 'release'>` read from `$ROOT/shared/config/$SLOT/CONFIG_SHA` |
| `scripts/ops/staging-window-deploy.sh` | unchanged; a window deploy re-links the shared config (inherits it), it never overwrites it |

### Changes

| Path | State | Change |
|---|---|---|
| `scripts/ops/deploy-config.sh` | NEW | `deploy-config.sh --slot staging\|prod --sha <sha on origin/main> --reason "…" [--dry-run] [--root <dir>]`: (1) refuses a sha not reachable from origin/main (same lineage rule as deploy-linux.sh step 0.5); (2) `git show <sha>:scraper/config/field-manifest.json` to a temp file, sha256 it; (3) atomically replaces `$ROOT/shared/config/$SLOT/field-manifest.json` (write `.tmp`, `mv`); (4) writes `$ROOT/shared/config/$SLOT/CONFIG_SHA` = the sha and appends `date sha slot reason sha256 user` to `$ROOT/shared/config/deploy-config.log`; (5) prod requires `--i-have-the-owners-word` and refuses otherwise; staging counts against a 4/day cap in `scripts/ops/state/` (LOCAL) like the button. No build, no restart. Runs over `ssh rfp-vps` from the laptop, or on the box |
| `scripts/deploy-linux.sh` | exists | in the release-link block (997-1001): `mkdir -p shared/config/$SLOT`; if `shared/config/$SLOT/field-manifest.json` is absent, seed it from the release's own file and write `CONFIG_SHA=release`; then `ln -sfn "$ROOT/shared/config/$SLOT/field-manifest.json" "$RELEASE_DIR/scraper/config/field-manifest.json"` |
| `scraper/src/index.ts` | exists | the S0b log line gains `config_sha=` from `CONFIG_SHA` next to the manifest (or `release` when absent) |
| `scripts/tests/deploy-config.test.sh` | NEW | fake `$ROOT`: copies only the manifest; refuses a bad sha; refuses hash mismatch; refuses prod without the owner flag; 5th staging run in a day refused; `--dry-run` writes nothing |
| `scripts/tests/deploy-linux-config-link.test.sh` | NEW (or a case in the existing deploy-linux test file if one exists — check first) | after a dry-run deploy the release's `scraper/config/field-manifest.json` is a symlink into `shared/config/<slot>/` and the shared file was seeded once, never overwritten |
| `docs/ops/prod-ops-recipes.md` | exists | recipe: "config-only deploy", rollback = same command with the previous sha; the log line to read |
| `.github/workflows/pr-gate.yml` | exists (workflow file, merge :00–:05) | the two new bash tests added to the `deploy-script-tests` job list |

## Schema

No schema change.

## Interfaces

```
scripts/ops/deploy-config.sh --slot <staging|prod> --sha <sha> --reason "<text>" [--dry-run] [--root <dir>] [--i-have-the-owners-word]
  exit 0  deployed (or dry-run printed)      exit 1 refused (reason printed: lineage | hash | prod-guard | cap | missing arg)
$ROOT/shared/config/<slot>/field-manifest.json   the live file, symlinked into every release
$ROOT/shared/config/<slot>/CONFIG_SHA            "<sha>" or "release"
$ROOT/shared/config/deploy-config.log            one line per run: <iso> <slot> <sha> <sha256> <user> <reason>
```

## Feature flag

None. Inert until a config deploy is run; a release with no shared file seeds it from itself, so
behaviour on day one is identical to today.

## Tests

### Failing test first

`scripts/tests/deploy-config.test.sh` (NEW) red by absence; the deploy-linux link test is red on
b0fafc6b (the release's manifest is a regular file, not a link). Bash tests run under the
`deploy-script-tests` CI job. Tier: scripts (bash), no vitest tier.

## Detection

`No detection change: deploy tooling with its own bash test suite in CI; the cycle log line is the runtime signal`.

## Staging proof

**Swap Test, path 1** (plan §1): a docs/config PR swaps rank 1 and rank 2 of `ipos.issue_size` in the
spec, S0b regenerates the manifest, the PR merges; `deploy-config.sh --slot staging --sha <merged>
--reason "swap test path 1"`; a manual wake; the cycle log prints `field-manifest: version=2 …
config_sha=<merged sha>`; the walk asked CHITTORGARH first for issue_size (walk log by IPO); then the
same command with the previous sha restores it. Read by identity: IPO slug, field, cycle time.
Because S5 lands before S1, at S5's own landing the proof is only the log line and the link
(`readlink`); the rank-order half is re-run after S1b and recorded in the ledger under both rows.

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S5-1 | `bash scripts/tests/deploy-config.test.sh` | exit 0 | local |
| S5-2 | `bash scripts/tests/deploy-linux-config-link.test.sh` | exit 0 | local |
| S5-3 | `bash scripts/ops/deploy-config.sh --slot staging --sha HEAD --reason "dod dry run" --dry-run --root /tmp/ipodhan-dod-root` | exit 0 | local |
| S5-4 | `grep -c "deploy-config.test.sh" .github/workflows/pr-gate.yml` | line: `1` | local |
| S5-5 | `ssh rfp-vps "readlink /var/www/ipodhan/current-staging/scraper/config/field-manifest.json"` | line: `/shared/config/staging/field-manifest.json` | staging |
| S5-6 | `ssh rfp-vps "cat /var/www/ipodhan/shared/config/staging/CONFIG_SHA"` | regex: `^([0-9a-f]{7,40}\|release)$` | staging |
| S5-7 | `ssh rfp-vps "tail -1 /var/www/ipodhan/shared/config/deploy-config.log"` | regex: `staging` | staging |

## Rollback

`deploy-config.sh --slot <slot> --sha <previous sha> --reason "rollback"` (same path, logged).
Reverting the code commit turns the link back into a regular file at the next release deploy; the
shared file stays on disk, unused, and is removed by hand if wanted. No database data is touched.

## Tier, budget and cost

Tier A (deploy tooling; touches the deploy script and prod path). `Budget: 30 min wall-clock,
60 tool calls`. Review: Opus, adversarial, mutation tests every guard (lineage, hash, prod word, cap).
Why Opus: a guard that fails open here mutates production config with no build gate in front of it.
Builder: Sonnet.

### Dependencies

None. Lands right after S0c so every later slice's staging turnaround is a config copy, not a build.

## Rules implemented

<!-- hand-owned: not generated by apply-rule-ownership.mjs, see docs/design/apply-rule-ownership.mjs HAND_OWNED_MARKER -->

| Design section | Rule ids |
|---|---|
| §7.6 | R-143 |

## Known gaps

- Only `field-manifest.json` is routed through shared config in this slice. `validation-rules.json`
  and any other `scraper/config/*.json` keep riding releases; widening is a one-line list in the
  script once the owner asks (recorded here so it is not "forgotten").
- The 4/day staging cap and the owner-word prod guard are in the script, not in a hook; a hook is
  owed only on the first observed bypass (Learn-or-block).
