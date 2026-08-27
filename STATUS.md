# T-339 STATUS — consolidation mandatory, one write path, key-beats-name identity quarantine

Branch: `fleet/T-339` off `origin/main` @ b49f764f
Worktree: `D:/Abhay/Ventures/IPODhan-t339` (never touches the shared clone)

## STEP 1 — READ-ONLY live flag capture (done BEFORE any code change)

Method: SSH to the Linux app box (creds from `D:/Abhay/GLOBAL.env`, never printed),
read the two hand-provisioned, release-independent env files the deploy links into
each release (`scripts/deploy-linux.sh` header: `$ROOT/shared/env/<SLOT>/scraper.env`).
Read-only `grep` of four non-secret keys. No writes, no prod DB access.

| Key | prod (`/var/www/ipodhan/shared/env/prod/scraper.env`) | staging (`.../staging/scraper.env`) |
|---|---|---|
| `ENABLE_DATA_CONSOLIDATION` | `true` | `true` |
| `ENABLE_CONFLICT_DETECTION` | `true` | `true` |
| `ENABLE_SOURCE_TRACKING`    | `true` | `true` |
| `CONSOLIDATION_PERCENTAGE`  | `100`  | `100`  |

Corroboration: `/var/www/ipodhan/current/scraper/.env -> /var/www/ipodhan/shared/env/prod/scraper.env`,
and `scraper/src/config/feature-flags.ts:17` loads that file via dotenv — so these ARE
the values the running scraper sees. (`pm2 jlist` shows `<unset>` for all four because
the scraper reads them through dotenv at runtime, not from pm2's captured env — that is
expected, not a contradiction.)

Note: `.claude/tasks/lessons.md:92-94` (T-283) recorded `CONSOLIDATION_PERCENTAGE` as
never set in any env. That is now STALE — it is set to 100 in both slots today.

### Scope consequence (contract STEP 1 clause)

> "If prod already runs consolidation ON at 100%, item 1 shrinks to deleting the dead
> flag code paths; items 2-3 stay."

Prod IS on at 100%. So item 1 = delete the dead OFF-path code (the three `ENABLE_*`
flags, `CONSOLIDATION_PERCENTAGE`, the `upsertIPO` bypass), making consolidation
unconditional. No behavioural change in prod; the change removes the ability to
silently regress to last-writer-wins.

## Progress log
- [x] STEP 1 live flag capture
- [x] Item 1 — consolidation mandatory + single write path (ec23d85f)
- [x] Item 2 — key-beats-name identity quarantine (96fb83af)
- [x] Item 3 — docs rollout note + prod env cleanup list

## Plan (written before the first code edit)

### Item 1 — consolidation mandatory, one write path
| # | File | Change |
|---|---|---|
| 1 | `scraper/src/config/feature-flags.ts` | Delete `ENABLE_DATA_CONSOLIDATION` / `ENABLE_CONFLICT_DETECTION` / `ENABLE_SOURCE_TRACKING` and the three `*_PERCENTAGE` knobs from `FEATURE_FLAGS`. Add `assertConsolidationFlagsNotDisabled()`: **hard-fail startup** if any retired var is still set to an OFF value (`false`/`0`/partial %), warn if set to a leftover fully-ON value. Wired through `validateFeatureFlags()`, which `index.ts:104` already turns into a startup refusal. |
| 2 | `data-consolidation-service.ts` | Delete the `!ENABLE_DATA_CONSOLIDATION \|\| !shouldUseFeature(CONSOLIDATION_PERCENTAGE)` gate and the `fallbackConsolidation()` accept-all method. |
| 3 | `data-consolidation-orchestrator.ts` | Delete the `CONSOLIDATION_DISABLED` skip branch. |
| 4 | `BaseScraperOrchestrator.ts` | Delete the `else -> upsertIPO` branch AND the `consolidationResult.skipped -> upsertIPO` fallback. A skip is now **no write**. |
| 5 | `data-persister.ts` (`upsertIPO`) | Update branch always delegates to consolidation; delete the flag check, the catch-fallback-to-simple-update and the "LEGACY PATH" block. Source tracking becomes unconditional. |
| 6 | `scraper/src/services/write-path-guard.ts` (new) | `assertConsolidationDecisionRecorded()` — every HIGH_VALUE field in the data about to be written MUST carry a consolidation `fieldResults` decision record, else `WritePathIntegrityError`. This is the DoD's RED test hook. |

### Item 2 — identity: key beats name, quarantine on disagreement
| # | File | Change |
|---|---|---|
| 7 | `packages/shared/src/repositories/ipo-identity.ts` | Replace the "name silently wins" fallback with `IdentityQuarantineError` (carrying both candidate ids). New `resolveIpoIdentity()` returns a discriminated result for callers that want to handle it; `resolveIpoRow()` throws, so **no caller can write** on a disagreement. |
| 8 | `scraper/src/services/identity-quarantine.ts` (new) | Records the quarantine by **reusing the T-328 HOLD table/state** — an unresolved `data_conflicts` row (`resolutionReason='QUARANTINE_IDENTITY_CONFLICT'`, `severity='CRITICAL'`, both candidate ids in `value1`/`value2`) — and fires a **P1** `notifyOwner`. No new tables. |
| 9 | `BaseScraperOrchestrator.processIPO` | Catch `IdentityQuarantineError` -> record quarantine + P1 alert + skip. Never writes. |
| 10 | `scripts/lib/detection-floor-checks.mjs` | `IDENTITY_QUARANTINE_MAX_AGE_HOURS = 24` + pure `checkIdentityQuarantineAge()`. |
| 11 | `scripts/audit-detection-floor.mjs` | New nightly check `k_identity_quarantine` — **FAIL** while any quarantine row is unresolved and older than 24h. |

T-328 note: PR #233 is OPEN, not merged. It adds no tables — its HOLD state IS `data_conflicts` +
an unresolved row + a `resolutionReason` string. This task reuses that exact table and state shape
(already on `main`), so it neither waits for nor conflicts with #233.

### Item 3 — docs + env cleanup
`docs/architecture/write-path-hardening.md`: rollout note + the explicit prod/staging env-key
cleanup list for the next deploy wave. No prod writes by this task.

## Resume log — T-339F (2026-08-26)

The first attempt (worker T-339, worktree `D:/Abhay/Ventures/IPODhan-t339`) hit its
**120-turn cap** after landing item 1. Its uncommitted tail was autosaved to
`wip/T-339-autosave` (`ef090c54`); nothing of value was lost — `fleet/T-339` @ `ec23d85f`
is the real state.

This resume worker (T-339F, worktree `D:/Abhay/Ventures/IPODhan-t339-t339F`) opens the PR
first (honest, work-in-progress body) and then executes the two remaining items.

| Item | State |
|---|---|
| STEP 1 live flag capture | DONE (586538f0) |
| Plan before first edit | DONE (5a307569) |
| 1 — consolidation mandatory, one write path | DONE (ec23d85f) |
| 2 — identity: key beats name, quarantine | DONE (96fb83af) |
| 3 — docs rollout note + prod env cleanup list | DONE |

Constraints honoured: never merges, no prod DB writes, no secrets printed, commit+push
after every item.

## Final verification (T-339F)

| Gate | Result |
|---|---|
| scraper vitest (full suite, one run) | **1319/1319 pass**, 474 suites, 0 fail |
| web vitest (full suite, one run) | 2352/2354 pass. The 2 failures are `MainboardPerformanceTrackerClient` / `SMEPerformanceTrackerClient`, which PASS when run on their own or as a pair — a pre-existing parallel-run flake. This task touched **zero** files under `web/`. |
| detection-floor self-test | 60/60 pass (5 new for `k_identity_quarantine`) |
| `packages/shared` tsc | clean |
| `scraper` tsc | 118 errors — **unchanged**; measured against a stashed baseline of the same tree, none in any touched file. Pre-existing (the scraper has no commit-time type gate by design). |
| `detection-checks.json` | valid JSON, 16 checks, every id referenced by `audit-detection-floor.mjs` |
| pre-commit gates | secret scan + workflow-ASCII run on every commit |

### Honest gaps

- The web flake above is not fixed here (out of scope, untouched area) — it is
  reported, not hidden.
- Standalone backfill scripts call `resolveIpoRow` directly and do not catch
  `IdentityQuarantineError`. A disagreement there throws for that IPO — still
  no write, which is the safety property — but it is not recorded as a
  quarantine. Named as a follow-up in
  `docs/architecture/write-path-hardening.md` "Honest limits".
- The env cleanup list names two `*_PERCENTAGE` keys as "confirm before
  deleting": STEP 1's read-only capture covered four keys, not six, so
  claiming they are present would be inventing evidence.
- No prod DB writes and no env edits were made by this task. The env cleanup is
  a list for the next deploy wave, executed by a human.
