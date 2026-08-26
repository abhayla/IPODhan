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
- [ ] Item 1 — consolidation mandatory + single write path
- [ ] Item 2 — key-beats-name identity quarantine
- [ ] Item 3 — docs rollout note + prod env cleanup list

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
