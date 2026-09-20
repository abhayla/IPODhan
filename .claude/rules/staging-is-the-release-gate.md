# Scope: global

# Staging is the release gate: nothing targets production until staging is feature-complete

version: "1.0.0" (owner directive 2026-09-20 ~10:5x IST: "I want to implement everything before I decide
to do the production deployment. If everything works perfectly in the staging environment, then it will
work in production as well. So I will not target for production until staging is final."
And, on sequencing: "lets focus on completing all work before perfecting one issue.")

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
  lists any item as partial or not built.
- MUST treat "staging is final" as feature-complete per R2, never as "CI is green".
- MUST build the verification before the correctness fix when both are outstanding, except for an
  actively-losing defect per R3.
- MUST follow the spec's stated dependency order, and MUST say "inferred, not spec-stated" when inferring.
- MUST verify a card's DONE claim against the artefact on `refs/remotes/origin/main` before counting an
  item as built.
