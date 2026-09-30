# Scope: global

# Staging is the release gate: nothing targets production until staging is feature-complete

version: "1.1.0" (1.1.0 owner 2026-09-30, OD-146: R0 everything-first; OD-133 narrowing withdrawn)
(1.0.0 owner directive 2026-09-20 ~10:5x IST: "I want to implement everything before I decide
to do the production deployment. If everything works perfectly in the staging environment, then it will
work in production as well. So I will not target for production until staging is final."
And, on sequencing: "lets focus on completing all work before perfecting one issue.")

## R0 — Everything first: finish all the work, prove all of it on staging, deploy production once

Owner, verbatim (2026-09-30): "See, my idea is to complete all the work, all the implementation and coding related work, release everything in staging, test everything there, and then deploy everything all together in production ... do not give me any other ideas ... focus first on completing everything and making everything work on staging. Only then, after everything properly works, we will deploy to production. This rule and clarity should always be there."

- All implementation and coding work is completed before production is considered. Nothing is split into
  "release 1" and "next release"; nothing reviewed and green is held off `main` or off staging to protect a
  smaller release.
- Every change is merged, deployed to staging and tested there (its staging proof read and recorded).
- Production is deployed ONCE, with everything together, only after everything works on staging, and only on
  the owner's word on the pre-deploy brief.
- Do not offer alternatives to this order (partial releases, shipping a core early, deploying a subset for
  urgency). If something seems to argue for it, state the fact in the brief; the order does not change.
- Supersedes OD-133's narrowing (spec OD-146).

## R1 — Production is not a target until staging is final

No production deploy is planned, scheduled, prepared or recommended while staging is short of the bar in
R2. A production window is the owner's word on a bundle that staging has already proven; it is never the
next step after a green CI run.

This supersedes any reading of the one-deploy-window-per-day rule as "deploy little and often to prod".
That rule caps how often a prod deploy may happen. This rule states that the count is zero until R2 is
met.

## R2 — "Staging is final" means FEATURE-COMPLETE, not green

The owner's bar, chosen 2026-09-20 over three narrower options (green-plus-soak, every-issue-closed,
Swap-Test-passes): **every remaining pull-model build item implemented and proven on staging.**

The live inventory of those items — built / partial / not built, with the evidence for each verdict — is
`docs/design/pull-model-completion-state.md`. That document is the work list; this rule is the policy.
When an item lands, the document changes; this rule does not.

**WITHDRAWN by OD-146 (owner, 2026-09-30), kept as history:** ~~Narrowed by OD-133 (owner, 2026-09-28):~~ the first release after 2026-09-07 needs every fix on `main`,
the admin-route auth fix, and the admin fix-a-value core plus queue (OD-135, OD-136), built and proven on
staging. The remainders of items 6, 7 and 19 and every proof that waits on a real-world event do NOT block
it; their fields reach the admin through the queue. Plan: `docs/contracts/plans/2026-09-28-finish-line-plan.md`.

## R3 — Verification before correctness fixes

When a correctness defect and the verification that would prove it fixed are both outstanding, **build
the verification first.**

Why, in the owner's words: "let's focus on completing all work before perfecting one issue." And in
measured terms: item 14 (#728, BSE issue size 41-76% low on 6 of 6 live IPOs) sits at the end of a
dependency chain (14 <- 13 <- 2), while item 10 — the verification layer that would catch its regression
— has 21 of 26 checks unbuilt. Fixing the number first means fixing it with no instrument to confirm it
stays fixed, which is how this repository accumulated a 25-entry known-failing baseline and a merge gate
that crashed on every invocation for days without anyone noticing.

A live correctness defect is not thereby ignored: it is recorded, its class registered, and it is fixed
in dependency order with its detection arriving alongside it. Urgency is not a reason to fix a value
whose correctness nothing can subsequently assert.

**The one exception:** a defect actively causing loss — money moving wrongly, data being destroyed, a
reader being shown something that leads to a financial decision that cannot be undone — is fixed
immediately, and the verification follows. A wrong displayed number that has been wrong for weeks is not
that; it is a queued defect.

## R4 — Dependency order is read, never assumed

The pull model's spec states its own dependencies (its "Depends on" column). Work follows that order.
Where an order is inferred rather than stated, the brief says so explicitly, in the words "inferred, not
spec-stated".

Measured 2026-09-20, the chain is deep rather than parallel: item 9 needs 6; item 10 needs 6 and 9;
item 17 needs 6, 7 and 10; item 11 needs 10. Treating these as a parallel sprint produces work that
cannot be proven when it lands.

## R5 — The inventory is measured, never taken from a card

Every tracking artefact in this repository has been caught lying, and the pattern is consistent enough
to be a rule rather than a caution: the stage-3 ledger showed five merged slices as `queued` for three
days; the board's staging sha was 18 commits stale; a Definition-of-Done item has been red since
2026-09-09 for a reason that is not a defect; and **24 of 42 build cards read `Status: unknown`, a shape
`check-build-cards.mjs` accepts as valid** — so the gate passes while telling nobody anything.

Therefore: a card that says DONE is a claim. Before an item is counted as built, the artefact it claims
— a named function, a file, a script, a migration, a CI job — is confirmed to exist on
`refs/remotes/origin/main` (the explicit ref; a local branch named `origin/main` has shadowed the remote
ref twice and made a merged PR read as unmerged). A card whose artefact cannot be found is a finding, not
a build item.

## CRITICAL RULES

- MUST NOT plan, schedule or recommend a production deploy while `docs/design/pull-model-completion-state.md`
  lists any item as partial or not built, or while any finished change is not yet proven on staging (R0, OD-146).
- MUST treat "staging is final" as feature-complete per R2, never as "CI is green".
- MUST build the verification before the correctness fix when both are outstanding, except for an
  actively-losing defect per R3.
- MUST follow the spec's stated dependency order, and MUST say "inferred, not spec-stated" when inferring.
- MUST verify a card's DONE claim against the artefact on `refs/remotes/origin/main` before counting an
  item as built.
