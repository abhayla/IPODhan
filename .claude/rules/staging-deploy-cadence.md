---
paths:
  - ".github/workflows/**"
  - "scripts/deploy*"
  - "scripts/ops/**"
---

# Staging deploy cadence — windows, not per merge

version: "1.0.0" (owner standing rule 2026-09-16, "staging deploys in windows, not per merge")

Two automatic deploy mechanisms were tried and both cost the box real load without buying
reliability: `push` on every merge to `main` (34 staging deploys on 2026-09-10 alone, 44 on 09-07 —
a full `npm ci` + `next build` each time, on the same 2-vCPU box that serves production), then a
GitHub `schedule` poll that was measured to NEVER fire on this repo's Actions setup (29 `push`
events, 1 `workflow_dispatch`, ZERO `schedule` runs across an hour of observation). This rule is the
replacement: a reliable timer (the VPS's own root crontab, not GitHub's), a small number of
deploys per day, and a capped escape hatch for when a human genuinely needs staging fresh now.

## R1 — `main` never auto-deploys on push

`deploy-linux.yml` has NO automatic trigger (no `on.push`, no `on.schedule`) — only
`workflow_dispatch`. Merging a PR to `main` moves staging's NEXT deploy, never triggers one.

## R2 — staging deploys in two daily windows, before any per-merge cost

The VPS's root crontab fires `scripts/ops/staging-window-deploy.sh` at 13:30 and 21:30 IST, which
dispatches `deploy-linux.yml -f slot=staging -f mode=window`. A window dispatch still runs the
served-vs-head + docs-only skip gate (`decide` job), so a window with nothing new to deploy
correctly no-ops instead of rebuilding unchanged code — several merges between two windows collapse
into one deploy.

## R3 — the manual button is capped at 2/day, always carries a reason

`scripts/ops/deploy-staging-now.sh --reason "<text>"` dispatches `mode=manual` (always deploys
unconditionally). Capped at 2 dispatches/calendar day; a 3rd is refused with the first two reasons
printed, unless `--override` (itself logged as an override). This exists so "just deploy it" cannot
recreate the per-push load this rule removes.

## R4 — the reliable scheduler is VPS cron, never GitHub `schedule` alone

GitHub's `schedule` trigger is best-effort and was proven unreliable on this repo (see the History
note above). A cron entry on the box itself — the same mechanism already used for the scraper wake
(item 7 slice 1, #660) — is the only automatic timer this rule relies on. If GitHub's `schedule`
trigger is ever reintroduced anywhere in this repo, it MUST be treated as a harmless backstop only,
never the sole scheduler for anything that must actually run.

## R5 — prod is untouched

The only route to prod remains an explicit human `workflow_dispatch` with `slot=prod` from a
`release/prod-<date>` branch (W-141, `.claude/rules/branching-model.md`). A `mode=window` dispatch
against `slot=prod` is refused by a dedicated `decide`-job step, loudly, before any install/build
step runs — a window must never be able to reach production, cron misconfiguration included.

## R6 — keep deploys cheap (item 23)

The windowed cadence is still an interim measure for the box's per-deploy cost (full `npm ci` +
`next build` on a 2-vCPU box). Item 23 (build in CI, ship an artifact so a deploy is unpack-and-flip)
is the real fix; once landed, cadence matters far less and this rule's window count/frequency should
be revisited, not assumed permanent.

## This project's concrete values

- Windows: **13:30 and 21:30 IST** (`scripts/deploy-linux.sh`'s `install_staging_window_cron`,
  `30 13,21 * * *` — no `CRON_TZ=`/`TZ=` prefix, matching the box's system timezone Asia/Calcutta and
  the existing scraper-wake cron line convention).
- Cron marker: `# ipodhan-staging-window` (idempotent install, staging slot only — mirrors
  `install_scraper_cron`'s `# ipodhan-scraper-wake:<SLOT>` pattern).
- Window payload: `scripts/ops/staging-window-deploy.sh` (VPS-side, never waits on the dispatched run).
- Manual button: `scripts/ops/deploy-staging-now.sh` (laptop-side, cap 2/day, state under the
  gitignored `scripts/ops/state/`).
- Log: `/var/log/ipodhan-staging-window.log`.
- Full recipe: `docs/ops/prod-ops-recipes.md` §14.

## CRITICAL RULES

- MUST NOT add an automatic `push` or `schedule` trigger to `deploy-linux.yml` — staging deploys only
  via `workflow_dispatch` (`mode=window` from VPS cron, `mode=manual` from a human or the capped button).
- MUST keep the window cadence driven by VPS cron, never rely on GitHub's `schedule` trigger alone.
- MUST refuse a `mode=window` dispatch against `slot=prod` — a window must only ever reach staging.
- MUST keep the manual button's per-day cap and reason requirement — no silent unlimited dispatch path.
- MUST NOT change the only route to prod (`slot=prod` dispatch from a `release/prod-<date>` branch,
  W-141) as part of any staging-cadence change.
