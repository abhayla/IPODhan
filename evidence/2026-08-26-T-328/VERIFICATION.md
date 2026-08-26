# T-328 — verification evidence

PR: https://github.com/abhayla/IPODhan/pull/233
Branch: `fleet/T-328-detection-to-correction` @ `ce514542`

## Environment note (same as PLAN.md)

`D:\Abhay\GetWorkDone\evidence\2026-08-26-T-328\` is unreachable from this
worktree — `D:` mounts as a read-only ISO (`OPENSTACK`) with no `Abhay` tree,
confirmed again at verification time. Evidence is committed in-repo instead,
per the same convention PLAN.md documented.

## DoD checklist (against the contract at
`C:\Abhay\GetWorkDone\queue\T-328-ipodhan-r7-detection-to-correction-p1.claimed.sweep-20260826-084054.md`)

1. **PLAN.md first** — DONE (`ad80cc96`), committed before any code.
2. **MECHANISM (HOLD)** — DONE (`7663c2f7`). `data-consolidation-hold-disputed.test.ts`:
   6/6 tests pass — exact Lumino 00:01Z shape (NSE 2026-08-26 vs CHITTORGARH
   2026-08-27, IPO UPCOMING) → no flip, published date unchanged,
   `hold_status_transition` logged; negative control confirms a LOW_VALUE
   field disagreement still resolves by the priority matrix as today.
3. **TIE-BREAK** — DONE (`7663c2f7`), same commit as the mechanism.
   `DATE_FIELDS_WITH_TZ_TIEBREAK` = `{openDate, closeDate}`; a 1-day NSE-vs-
   other delta resolves to the non-NSE value with
   `resolutionReason: 'TZ_SIGNATURE_TIEBREAK_PREFER_NON_NSE'`, tied to T-327
   by comment with an explicit removal condition (re-run the Lumino-shape RED
   test once T-327 lands nse-api-client.ts's TZ fix; the tie-break should stop
   firing).
4. **UI SURFACE** — DONE (`1fce9327` autosave + `ce514542` this run).
   `FactRibbon`'s `disputed` prop renders a small amber "Under verification"
   marker. Fixed a real gap found during this resume: `openCloseDisputed` was
   computed in `page.tsx` but never attached to the Open–Close ribbon cell —
   only Price Band's flag was wired. Added `FactRibbon.test.tsx` (5/5 pass,
   new — no prior test existed for this component, which is exactly the gap
   that let the missing wiring ship silently). Visual breakpoint check
   (390/768/1280) not run live — no dev server / DB in this environment;
   the component's Tailwind classes (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-8`)
   are the existing FactRibbon responsive contract, unchanged by this prop.
5. **ALERT-TO-CORRECTION LINK** — DONE this run (`cda22f81`).
   `cross-source-disagreement-monitor.ts`'s P1 body now reads
   `resolutionReason`/`resolvedSource` from the conflict row and states
   "HELD — no value published change; X (source) stays live" or
   "TIE-BROKEN — preferred X over NSE per the T-327 TZ-signature interim
   rule", falling back to the raw-values description when no resolution
   reason is recorded. `cross-source-disagreement-monitor.test.ts`: 10/10
   pass (4 new tests added this run).

## Test results

- Scraper unit suite (full `tests/unit`): **110 files / 1245 tests passed**,
  1 pre-existing skip. Zero failures.
- Web unit suite (full `tests/unit`): passed, exit code 0, zero `FAIL`
  occurrences in output.
- `web/` `tsc --noEmit --project tsconfig.json`: clean, zero errors (both
  before and after the Open–Close wiring fix).
- `packages/shared`: `npx tsc` compiles clean.
- Scraper `tsc --noEmit`: 118 pre-existing errors, none in newly-changed
  lines. Confirmed the touched file's own errors (`export type` bottom-of-file
  re-declaration conflicts in `data-consolidation-service.ts`) are byte-identical
  to the `d002d234` baseline on `main` (pre-T-328) — not introduced by this
  change. Scraper has no tsc CI gate per `.claude/rules/shared-package-build.md`
  ("MUST NOT assume scraper code was type-checked at commit time").

## Zero new test failures vs origin/main

All scraper and web unit suites pass with exit code 0 and zero FAIL markers.
No test that passed on `origin/main` fails on this branch.

## Commits (one per DoD item, pushed after each)

1. `ad80cc96` docs(T-328): PLAN.md
2. `7663c2f7` fix(scraper): HOLD disputed HIGH_VALUE fields + TZ tie-break
3. `d083e6d0` fix(web): status-updater refuses to flip on disputed date
4. `1fce9327` autosave: UI marker (Price Band wiring + FactRibbon prop)
5. `cda22f81` fix(scraper): alert body states HELD/tie-broken action
6. `ce514542` fix(web): wire missing Open–Close disputed flag + FactRibbon test

## Coordination boundary honored

- Did NOT touch `nse-api-client.ts` date parsing (T-327's surface).
- Did NOT touch `issueSize`/lot validation (T-329's surface).
- No data repairs to already-corrupted rows.
- No new tables — `data_conflicts` + `field_sources` used as-is.
