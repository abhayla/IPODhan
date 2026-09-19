---
paths:
  - "scraper/**"
  - "packages/shared/**"
  - "docs/design/**"
  - "docs/reviews/**"
  - "web/app/admin/**"
  - "web/app/api/admin/**"
  - "scripts/**"
  - ".github/**"
---
# Scope: path (paths above)

# Spec adherence — the design is the SSOT; deviations are classified, proven and reviewed

version: "1.0.0" (owner decisions, 2026-09-19)

`docs/design/data-sourcing-pull-model.md` is the single source of truth for the pull model. **Code
follows it.** Any change to what the system does goes into the spec first, or into the spec in the
SAME pull request. A code change that contradicts the spec and leaves the spec standing is a defect,
whichever of the two is right.

Detail, worked examples and the reporting wording live in
`docs/design/spec-deviation-guideline.md`. This rule is the 30-second decision.

## The three classes

| If the card or spec… | Class | What you do |
|---|---|---|
| makes a FACTUAL claim about this codebase that is FALSE (a function, flag, file, heading, dependency or count that does not exist) | **1 — card defect** | Build to the spec's stated INTENT, correct the card in the SAME PR, name the correction in the PR's Spec-deviation field. Not a deviation. If the false claim means the intent cannot be met at all → class 3. |
| would change what the pipeline ATTEMPTS, not what it publishes or stores differently, AND the change falls inside what the spec already calls configuration (§7.6), a validation rule (§5.3), or a per-type exception (§1.11) | **2 — minor** | Allowed ONLY through the six-step process below. |
| matches ANY class-3 trigger below | **3 — major** | STOP. Go to the owner before writing code. |

**Class-2 examples, and the whole list of them:** a validation rule's assertion and its effective
date (§5.3); a comparison normaliser (OD-59); a per-type `NOT_APPLICABLE` list (§1.11); which table
or label an extractor reads; a check's own tolerance where §4 marks it as the author's (the 5%
denominator floor, the 0.95 `REREAD-VERDICT` share, the 48 h `REREAD-LATENCY` bound). Nothing else
is class 2.

**Class-3 triggers — ANY ONE of these:** it touches a decision carrying an `OD-` id (§0.0.1); it
changes what a reader or an admin sees (OD-39, OD-61, OD-63); it adds, removes or reorders a source,
or changes which source wins (OD-4, OD-5); it changes an owner-stated number (three data slots
OD-19, seven-day retention OD-32, 0.5% agreement OD-59, 180-day same-offering window OD-35, the
2-hour ceiling OD-55, and every other number an OD row states); it changes the schema or an enum; it
repairs production data (§5.2; §2.8 covers plan invalidation); it is an item §7.2 lists as **not
cleanly reversible** (items 11 and 17); it drops or narrows a card's scope; it relaxes a Definition of Done; it adds a paid call (§7.4);
or it is the SECOND deviation on the same requirement.

**OD-24 does not rescue a class-3 item.** "Record `O-nn`, mark PROVISIONAL, continue on the
recommendation" is kept ONLY for class-3 items that §7.2 lists as reversible behind a flag with no
stored value rewritten (items 1, 2, 3, 9, 10, 15, 16, 18). Every other class-3 item waits for the
owner's word before any code is written.

## The class-2 process — six numbered MUSTs

1. MUST be proven on at least **two DIFFERING IPOs of every IPO type the change touches** — a
   different registrar or lead manager where the data allows, and at least one live or recent.
2. MUST write a type with fewer than two live samples as **`unproven for type <X>`**, and the change
   MUST NOT claim that type. Silently skipping it is a defect.
3. MUST NOT be labelled by its own builder. An **independent reviewer on a different model** confirms
   the class and the two-per-type evidence before merge.
4. MUST be written into the spec in the SAME pull request — §1.11 for a per-type exception, §7.6 for
   configuration — with the IPO names and the date.
5. MUST record a **second deviation on the same requirement as class 3** automatically. Twice means
   the requirement is wrong, not the IPOs.
6. MUST carry the class, the spec section, the IPO names and the card-corrected answer in the PR's
   **Spec deviation** block. The block is mandatory on every PR, `Class: none` included.

## Findings sync

Every finding registered under `docs/reviews/failure-classes/<slug>.json` MUST carry the spec
section(s) it touches (`spec_ref`). A finding that CONTRADICTS the spec MUST trigger a same-PR
correction of one of the two, by the class table above. The spec and the registry never stand
against each other.

## CRITICAL RULES

- MUST treat `docs/design/data-sourcing-pull-model.md` as the SSOT, and MUST change it first or in
  the same PR as the code that departs from it.
- MUST classify every departure as 1, 2 or 3 before writing code, and MUST state the class in the
  PR's Spec-deviation block — `none` is a valid answer, silence is not.
- MUST build to the spec's stated INTENT when a card's factual claim about the code is false, and
  MUST correct the card in the same PR (class 1).
- MUST NOT ship a class-2 deviation without two differing IPOs per touched type, an explicit
  `unproven for type X` where the population is thin, an independent reviewer on a different model,
  and the exception written into §1.11 or §7.6 with IPO names and date.
- MUST escalate every class-3 trigger to the owner BEFORE code, and MUST NOT use OD-24 to continue
  on anything §7.2 does not list as reversible behind a flag.
- MUST treat a second deviation on the same requirement as class 3, always.
- MUST carry `spec_ref` on every registered failure class, and MUST resolve a spec-versus-registry
  contradiction in the same PR.
- MUST NOT narrow a card's scope, relax a Definition of Done, or repair production data as a
  "minor" deviation — each is class 3 on its own.
