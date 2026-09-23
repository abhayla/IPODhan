# Scope: paths
paths:
  - "docs/design/board/**"
  - "scripts/ops/render-board.mjs"
  - "scripts/ops/build-plan-board.mjs"

# The owner-facing status artifact is generated, role-complete, and updated on stage changes only

version: "1.0.0" (owner directive 2026-09-20: "keep improving until all the team members with all
the roles rate it more than nine out of ten … minimum tokens … do not use too much tokens to keep
updating it, whenever some stage crosses then only update … it should be user friendly and can be
easily shared with anyone")

This is the project copy. The portable rule is `~/.claude/rules/status-artifact.md`; this file adds
IPODhan's specifics — the board URL, its data files, and its nine roles.

## R1 — Generated from data, never hand-edited, never patched from itself

The published page is the output of `node scripts/ops/render-board.mjs`, which reads four files on
disk and emits a complete `index.html`. It MUST NOT read the live artifact.

Why this is a rule and not a preference: the previous renderer (`patch-plan.py`, retired
2026-09-20) spliced into a saved copy of the live page and asserted on that page's structure. A
renderer that depends on its own previous output breaks the first time the page is restructured —
which happened, and would have failed with a stack trace on the next run.

## R2 — Every number on the page is derived, or it is a defect

A count that a human typed will drift, and a drifted status page is worse than no status page
because it is believed. Measured 2026-09-20: the published board said "12 built, 12 partial, 5 not
built"; the source said **16 / 10 / 3**. Items 18 and 22 had been re-measured as already BUILT
(#848) and the tile was never retyped.

Counts are parsed **per row** from the generated tracking section, never by matching verdict words
across a document: a row's evidence prose can contain the word "NOT BUILT" (item 31's does), and a
document-wide grep over the source markdown returns 31 verdicts for 29 items.

If a value genuinely cannot be derived, it says so on the page in the row — `unverified`,
`unmeasured` — with the command that would measure it. A plausible default is never filled in.

**Environment facts are measured, never typed.** Served sha, serving-since and migrations applied
per DB vs main's journal come from `docs/design/board/measured-facts.json`, written only by
`node scripts/ops/collect-board-facts.mjs` (read-only ssh to the VPS + the DB tunnel), each fact with
its own `measured_at` and command. **Run the collector before the render** whenever a deploy happened
or a day has passed. `render-board.mjs` refuses `sha` / `since` / `stamp` typed into
`board-data.json`; prose cites a fact as `{{prod.sha}}`, `{{prod.migrations_behind}}`, etc. A fact older
than 24h at render time shows `stale — measured <date>`; a probe that failed shows
`unmeasured — <cause>`. Measured 2026-09-23: the typed rows said staging 61808af1 / "all 16 applied"
while staging served 55b585cb with 51 of 52, across seven republishes.

## R3 — Nine roles, nine blocks, asserted by a test

The page serves owner, product manager, senior architect, implementation, delivery/PM, deployment,
environments, QA, and data/domain. Each has a block that answers the question they open the page
with (the table in `docs/design/board/README.md` maps role → block).

`scripts/tests/render-board.test.mjs` asserts every block is present. Dropping the environments
table fails the suite rather than silently failing a role for weeks.

Adding a role means adding its block AND its assertion, in the same change.

## R4 — Update when a stage crosses, not when a commit lands

Update for: a verdict change, a deploy that changes what an environment serves, a decision landing
or newly waiting, a gate changing state, a change in what a reader of the site sees.

Do NOT update for: an ordinary merge that changes no verdict, docs commits, CI re-runs, a review
that found nothing.

The `board-owed-guard` hook is **user-level**, not in this repo:
`~/.claude/hooks/board-owed-guard.py`, wired in `~/.claude/settings.json` across three events. It
watches for a real merge command (PostToolUse/Bash), clears itself when the board is republished
(PostToolUse/Artifact), and BLOCKS the turn on Stop (exit 2) while a merge is owed — regenerating
the board for you so the only step left is the publish. When no stage actually crossed, the marker
is cleared deliberately with a stated reason, which is R4 in practice.

**Where it lives matters, because it is not where you would look.** On 2026-09-23 a session read
this rule, grepped `.claude/` inside the repo, found nothing, concluded the hook had never been
built, and built a second, weaker one — which printed a line instead of blocking. Both then fired
on the same merge. The duplicate was retired the same night. The lesson is not "grep before
trusting a rule" (that session did grep); it is **grep BOTH scopes** — `.claude/` in the repo and
`~/.claude/` — because a hook that governs this repo may be installed at either.

## R5 — The stamp is read from the clock

The renderer takes the stamp from the clock itself (`data-rendered-at` on the page); a typed `stamp`
in `board-data.json` is refused. The page also shows when its OLDEST environment fact was measured,
so a fresh render of old facts cannot pass for fresh. `--check` re-renders with the committed page's
recorded render time, so CI (which cannot re-measure) stays deterministic. Any other clock reading
(ledger, report) is still `date`, in the same step. A stamp typed from memory has been wrong by minutes-in-the-future twice
in this repo. The page shows the stamp next to "generated by render-board.mjs" so a reader can see
both how fresh it is and that it was not hand-written.

## R6 — Publish with `url`, always

`Artifact publish` with `file_path` = `docs/design/board/index.html` **and** `url` = the board URL.
Publishing without `url` creates a second artifact and every link the owner has shared goes stale.

## R7 — CI keeps the rendered page in step with its data

`node scripts/ops/render-board.mjs --check` exits 1 when `index.html` does not match its sources, so
a data edit that was never rendered cannot merge. Same shape as
`build-plan-board.mjs --check` for the tracking sections.

## CRITICAL RULES

- MUST render from data files; MUST NOT hand-edit `index.html` or read the live page to update it.
- MUST derive every count; MUST NOT type a status number into the page or its data file.
- MUST count verdicts per row, never by a document-wide word match.
- MUST keep all nine role blocks, each with a test assertion.
- MUST update on stage changes only, and MUST read the stamp from the clock.
- MUST publish with `url`; MUST NOT create a second artifact.
