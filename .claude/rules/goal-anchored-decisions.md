# Scope: global

# Goal-Anchored Decisions

version: "1.0.0"

Every non-trivial decision — build vs defer vs cut, a design fork, prioritization, scope,
"which option?" — MUST be evaluated against **THIS project's documented goal and its expected
users**, and resolved to the option (or **combination** of options) that best serves them.
Local engineering convenience, feature-completeness, symmetry, or "the coverage matrix has a
hole" are NOT reasons to build — serving the goal + the target user is.

**When a reversible/internal call is genuinely uncertain, do NOT bounce it back to Abhay —
adopt the engineering role that owns it (`engineering-roles.md`) and MAKE THE CALL toward the
goal.** Asking the user to decide a decidable, reversible fork is the failure this rule kills
(it is the over-ask `decision-authority.md` forbids). Escalate only the genuinely gated forks
(prod deploy/flag/cron, destructive DDL, spend, a true product fork). (Requested by Abhay
2026-06-16.)

## Anchor to the SSOTs (not a vague "goal")

"The goal" and "the user" are concrete, documented facts — read them, don't guess:

- **Product goal:** IPODhan is an **IPO information platform for Indian investors**
  (`CLAUDE.md` "Project Overview") — every publicly-available IPO field, table, and graph
  **correct, complete, and honest** for every genuine IPO, so a retail investor can research
  and decide. Correctness + honesty ARE the product, not decoration.
- **Primary user:** the **Indian retail IPO investor** (mainboard AND SME) deciding whether to
  apply to / track an IPO — relies on accurate price band, GMP, subscription, listing
  performance, financials, registrar + allotment/listing dates. **SME is ~⅔ of listed
  inventory — it is in-scope, never an afterthought.**
- **Portfolio role:** IPODhan is a **lead-generation feeder** in the 5 Wealths Financial pillar
  — correct, sticky IPO content → broker/AP (Zerodha) affiliate conversions → demat opens
  (`5W-CONTEXT.md`). Data quality is the conversion engine; a wrong or empty page loses the lead.
- **"Now" priority order:** Tier 0 **correctness + de-pollution + honesty** (no corporate
  actions on IPO surfaces; no fabricated/stale data) → Tier 1 **data completeness** (fill the
  dark child tables/columns from real sources) → Tier 2 **detail-page render + UX** → Tier 3
  **breadth** (more sources, deeper history). Update this block when the stage moves
  (`engineering-roles.md` keeps the matching stage block).
- **Principles:** the four immutable principles (`5W-PRINCIPLES.md`) — permanent/productized,
  scale-from-day-1, automate, continuously-update.

## How to apply (every recommendation)

1. **Name the goal + user impact explicitly** — e.g. "fills `listing_performance` for SME
   LISTED IPOs → the retail SME investor sees a real listing-gain number (Tier-1 completeness)."
   The anchor MUST be visible and auditable in the recommendation, never implicit.
2. **Prefer combinations over false binaries** — the best answer is often "build the autonomous
   foundation + the hard extractor, gate the risky output, and defer only the un-sourceable
   bit," not a single option.
3. **Tie-break by user + the "Now" order** — correctness/honesty beats completeness beats
   breadth. A field no real IPO investor reads loses to one on the decision path (price band,
   GMP, subscription, listing gain, financials).
4. **Honesty is a goal, not a nicety** — for an IPO research platform, **fabricated or stale
   data is the worst failure**: a wrong GMP/subscription/listing number misleads a real-money
   decision. No synthetic data — fill from a real source or leave blank + DEFER with reason
   (mirrors the data-completeness contract + `output-plausibility-verification.md`).

## Guard against (the two failure modes this rule kills)

- **Feature-completeness bias** — building X because the coverage matrix has a hole, not
  because a real IPO investor needs it (YAGNI, `claude-behavior.md` rule 21).
- **Local-optimum bias** — picking the engineering-convenient option that doesn't move the
  goal/user.

## Relationship to the other decision rules

This is the substantive **criterion for evaluating options**. It composes with — does not
replace — `decision-authority.md` (WHO decides + escalate-vs-decide), `engineering-roles.md`
(WHICH role makes the call), the **confidence gate** (converge on intent before building), and
**YAGNI**. Decide reversible/internal work yourself, in the owning role, anchored to the goal;
escalate only the genuinely gated forks — with the goal/user reasoning stated.

## CRITICAL RULES

- MUST evaluate every non-trivial decision against IPODhan's documented goal + primary user
  (Indian retail IPO investor, incl. SME) — never local convenience, feature-completeness, or
  symmetry.
- MUST, when a reversible/internal call is uncertain, adopt the owning engineering role
  (`engineering-roles.md`) and DECIDE — never bounce a decidable fork back to Abhay.
- MUST state the goal/user reasoning IN the recommendation (a visible, auditable anchor).
- MUST consider combinations of options, not just single options.
- MUST treat fabricated/stale/optimistic data as the highest-priority failure (Tier-0
  honesty), regardless of fix size.
