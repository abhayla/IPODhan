# How this design is deviated from — the guideline

> **Status:** owner decisions of 2026-09-19, written up. The 30-second version is
> `.claude/rules/spec-adherence.md`; this file is the detail, the worked examples and the wording.
>
> **The SSOT statement, first, because everything below hangs on it.**
> `docs/design/data-sourcing-pull-model.md` is the single source of truth for the pull model. Code
> follows it. Any change to what the system does goes into the spec first, or into the spec in the
> same pull request. A code change that contradicts the spec and leaves the spec standing is a
> defect — whichever of the two turns out to be right.

---

## 1. Why this document exists

Fourteen deviations from the design were catalogued between 2026-09-09 and 2026-09-19. Twelve of the
fourteen were the same thing: **a build card asserted a fact about this codebase that was not true,
and the worker patched around it.** PR #678 was written against a feature flag `ENABLE_FIELD_PLAN`
that did not exist. PR #745 called `buildFieldPlanWalkDeps`, which did not exist. PR #758 was
specified around a `NO_FETCHER` state that is impossible, because `field_plan_state` is a PostgreSQL
enum and the value is not in it — and that one was different in kind, because the false claim meant
the card's intent could not be met at all, so scope was dropped.

Three things follow from that pattern, and they are the whole of this guideline. Most "deviations"
were never deviations, they were card defects, and treating them as judgement calls invited
judgement where none was needed. The ones that *were* judgement calls had no process, so nobody
could tell a safe one from an unsafe one. And the unsafe ones — a dropped scope, a relaxed
Definition of Done — arrived looking exactly like the safe ones.

---

## 2. The three classes

### Class 1 — CARD DEFECT (not a deviation at all)

**Trigger.** The card or the spec makes a **factual claim about the codebase** — a function, a flag,
a file, a heading, a dependency, a count — and that claim is false.

**What you do.** Build to the spec's **stated intent**. Correct the card in the **same pull
request**. Name the correction in the PR's Spec-deviation block. Nothing is escalated; nothing waits.

**The one exit.** If the false claim means the intent **cannot be met** — the state the card needs is
not representable, the endpoint does not exist, the column is not there — it is **class 3**, not
class 1. PR #758 is the worked example: `NO_FETCHER` was not a naming slip, it was a state the schema
cannot hold, so the card's intent was unbuildable and the right move was to stop, not to invent a
near-enough state.

**Why it is not a deviation.** The design did not say something you disagreed with. The card said
something untrue about the code. Correcting it is bookkeeping, and pretending otherwise inflates the
deviation count until the genuinely dangerous ones stop standing out.

This supersedes contract decision 16's halt-on-card-defect for class 1 (owner decision 2026-09-19);
decision 16's "never resolve a card/code contradiction by choosing" survives as classes 2 and 3.

### Class 2 — MINOR

**Trigger, both halves required.**

1. The change alters **what the pipeline ATTEMPTS**, not what it publishes to a reader and not the
   shape of what it stores; **and**
2. it falls inside something the spec has already declared tunable: **§7.6** (configuration over
   code, OD-51), **§5.3** (per-field validation rules and their effective dates, OD-21), or **§1.11**
   (exceptions by IPO type).

**The complete list of class-2 changes.** This is a closed list, not an illustration:

| Change | Where the spec already allows it |
|---|---|
| A validation rule's assertion, and the effective date it is valid for | §5.3 — "the date range is load-bearing"; §7.6 row "Validation rules and their effective dates" |
| A comparison normaliser (how two values are judged equal) | OD-59, §2.3.5, §3 — numbers as numbers, dates as dates, text after normalising corporate-form words |
| A per-type `NOT_APPLICABLE` list | §1.11 — e.g. fields 93–109 and 131–137 for a rights issue |
| Which table or label an extractor reads inside a document | §7.6, the `extraction` module — bytes to typed values, with provenance |
| A §4 check's own tolerance, where §4 marks it as the author's number | §4 — the 5% denominator-floor rule, `REREAD-VERDICT`'s 0.95, `REREAD-LATENCY`'s 48 h |

Anything not in that table is not class 2. In particular a source rank is **not** class 2 even
though §7.6 makes it configuration, because OD-4 and OD-5 give it an `OD-` id — and an `OD-` id is a
class-3 trigger that outranks the configuration test.

**Process.** Section 3 below, in full, every time.

### Class 3 — MAJOR (stop, and go to the owner)

**Any ONE of these triggers, no weighing:**

- It touches a decision carrying an `OD-` id (§0.0.1).
- It changes what a **reader** or an **admin** sees — OD-39 (the provenance line), OD-61 (a
  disagreement is never shown to a reader), OD-63 (the admin queue shows absences as well as
  disagreements).
- It adds, removes or reorders a **source**, or changes **which source wins** — OD-4, OD-5.
- It changes an **owner-stated number**: three data slots plus the 22:00 closed-IPO cycle (OD-19),
  seven-day PDF retention (OD-32), 0.5% money and share-count agreement (OD-59), the 180-day
  same-offering window (OD-35), the 2-hour hung-process ceiling (OD-55) — and every other number an
  `OD-` row states.
- It changes the **schema** or an **enum**.
- It **repairs production data** (§5.2 — how existing rows are repaired; §2.8 covers the separate
  case where the plan itself is wrong and the ranks are rebuilt); any rewrite of stored rows is the
  owner's call.
- It is an item §7.2 lists as **not cleanly reversible**: **item 11** (the crore conversion, once the
  public API has served the new shape) and **item 17** (the closed-IPO job, once website-sourced
  values on historical rows have been overwritten).
- It **drops or narrows a card's scope**.
- It **relaxes a Definition of Done.** The worked example is PR #753, where a DoD item asserting a
  specific outcome was softened to "count = 14, exit 0" — a shape assertion that a broken check
  satisfies as easily as a working one.
- It **adds a paid call** (§7.4).
- It is the **second deviation on the same requirement** (see §4).

**What OD-24 does and does not license.** OD-24 says a new owner fork is recorded as `O-nn`, marked
`PROVISIONAL`, and the work continues on the recommendation rather than halting. That stands **only
for class-3 items that §7.2 lists as reversible behind a flag with no stored value rewritten** —
items 1, 2, 3, 9, 10, 15, 16 and 18. For every other class-3 item, OD-24 is not an escape hatch: the
item waits for the owner's word before any code is written. The distinction is exactly the one §7.2
draws, and it is drawn there because a flag you can turn off is a decision you can unmake, and a
rewritten row is not.

---

## 3. The class-2 procedure, step by step

### 3.1 Prove it on two differing IPOs of every type it touches

**Two, differing, per type.** Not two runs of one IPO, and not two IPOs of one type when the change
touches two types. "Differing" means a **different registrar or a different lead manager** where the
data allows — same-registrar pairs share formatting, so a rule that passes on two of them has been
tested once. **At least one of the two must be live or recent**, because a rule proven only on 2023
rows is a rule proven against a document format that may no longer be issued.

Which types a change "touches" is read off §1.11 and Appendix A.2, never guessed. A normaliser for
registrar names touches every type that stores a registrar. A lot-size rule touches MAINBOARD and
both SME pricing shapes, and does not touch NCD, RIGHTS or the corporate actions where lot size is
`NOT_APPLICABLE`.

### 3.2 Say "unproven" out loud where the population is thin

A type with **fewer than two live samples** is written as:

```
unproven for type <X> — <N> live sample(s) available on <date>; this change does not claim it.
```

and the change **does not claim that type**. It is never skipped silently. Measured on staging,
2026-09-19: MAINBOARD IPO 59, SME book-built 46, SME fixed-price 10, TENDER 11, NCD 4, RIGHTS 4,
INVITS 1, REITS 1 (and not recent), MAINBOARD fixed-price 0, plus 40 rows with a null segment. So
today INVITS, REITS and MAINBOARD fixed-price cannot clear the bar at all, and NCD and RIGHTS clear
it only just — which is a fact about the population, not a reason to lower the bar.

Build item 30 (`docs/design/build-cards/item-30-ipo-type-table.md`) turns those counts into a
generated table so this step is a lookup rather than a query.

### 3.3 What the report row looks like

One row per type touched, in the PR body:

```
| type | IPO A (registrar / LM, open date) | IPO B (registrar / LM, open date) | result |
|---|---|---|---|
| MAINBOARD IPO | <name> (<registrar>, 2026-09-xx) | <name> (<registrar>, 2026-09-xx) | pass / pass |
| SME fixed price | <name> (<registrar>, 2026-08-xx) | unproven for type SME fixed price — 1 live sample on 2026-09-19; this change does not claim it | |
```

Each cell names an **identity**, never a count (`signal-ownership.md` R1). "Tested on two SME IPOs"
is not evidence; two names, two registrars and two dates are.

### 3.4 A builder never labels its own deviation

The class and the two-per-type evidence are confirmed **before merge** by an **independent reviewer
on a different model** — not the builder, and not a fresh instance of the builder's own model. This
is the `independent-test-verification.md` edge applied to a judgement call rather than to a test
verdict, and it exists because the builder is the one party who has already decided the deviation is
fine.

### 3.5 Write the exception into the spec, same PR

A per-type exception goes into **§1.11**; a configuration change goes into **§7.6**. The entry
carries the **IPO names** and the **date**. A deviation that lives only in a PR body is a deviation
the next reader of the spec will hit again from scratch.

---

## 4. The second time is always major

**A second deviation on the same requirement is class 3, automatically.** No weighing, no "but this
one is smaller".

The reasoning is the owner's and it is short: if the same requirement has now been departed from
twice, **the requirement is wrong, not the IPOs.** Two separate people, or the same person twice,
looked at the same sentence in the design and could not build to it. That is a defect in the
sentence. Fixing it is a spec change, which is the owner's, and no amount of care in the third
work-around substitutes for it.

This composes with the standing rule that a second occurrence of a failure class earns an
**independent review rather than a third guess** — the same instinct, one level up: change who is
aiming before firing again.

---

## 5. The scraper / admin boundary

The line is not "hard fields versus easy fields". It is **what the pipeline can establish from a
document or an exchange** versus **what only a human can settle**.

| | **Scraper owns — no admin fallback** | **Admin owns — the scraper must not attempt it** |
|---|---|---|
| **Which IPO types** | Every spec-mapped field for **MAINBOARD IPO, SME IPO (book-built and fixed price), FPO and RIGHTS** — the owner's list, 2026-09-19. FPO carries zero live rows today (§1.11) and is on the scraper side by the owner's word, not by sample count. | **Any type with fewer than two live samples — REITS, INVITS, NCD, TENDER, BUYBACK.** Their pages show admin-supplied provenance until the population allows a proven path. *Reversing this is class 3.* |
| **Where the value comes from** | **Document first**; the exchange only for the E-1 timetable exception (§1.2.1, OD-2) | A value the **document does not print** for this IPO — record `NOT_PRINTED` and stop |
| **Absences** | Every absence stored with one of **OD-62's four reason codes** — `SOURCE_UNREACHABLE`, `NOT_PUBLISHED_YET`, `EXTRACTION_FAILED`, `FAILED_VALIDATION` — **never a bare null** | A field **`EXHAUSTED`** after every source abstained or failed (§2.6) |
| **Disagreements** | The **re-read loop to its §3.3 bounds** — 2 per (IPO, field, `sha256`), 1 per document per day, 1 per IPO per slot — before any human is asked | A disagreement **unresolved within those bounds**, which arrives on the admin surface with **both values, both sources and the receipt** (§3.4) |
| **Identity** | Binding per **OD-34** (CIN, then the SEBI draft filing number, then the exchange symbol, then the normalised name), **OD-35** (one row is one offering; 180 days; an offering-type change is a new row) and **OD-38** (three no-such-symbol reads set DELISTED; every automatic merge logged and reversible) | **Production data repairs and identity merges** — the pipeline **proposes**, logs, and keeps it reversible; a **human confirms** |
| **OFS** | — | **Frozen per OD-53** (18 rows as non-IPO listings), out of scope for both scraper and admin. |
| **Never** | — | **Guessing from a peer, a ratio or a formula is forbidden.** An absence is an absence. |

**Why the thin types sit on the admin side.** Not because their documents are harder, but because
with one live sample there is no way to tell a rule from a coincidence. The boundary moves when the
population moves, and moving it is a spec change.

### 5.1 The admin queue is sized to a human

The queue exists to be **cleared**, so it is ordered and sized for one person:

- **Live and upcoming IPOs first.**
- **Grouped by IPO, not by field** — an admin opening one company settles ten fields with one
  document open; an admin walking a field-ordered list opens ten documents to settle ten fields.
- **The open count is printed in the nightly report**, per `signal-ownership.md` R3 — a signal with
  no same-day consumer that diffs it is not detection.

> **An open count above what one person can clear in a day is a pipeline defect, not a backlog.**

Measured 2026-09-19: **45,804 conflicts, 31,659 resolved — every one of them by `SYSTEM`, none ever
by a human — and 14,145 still open**, plus **12,701 absent fields across 71 IPOs**. That is not a
queue; it is a list nobody has ever used, and the number says the pipeline is asking humans for
things it should be settling itself (OD-61 and OD-63 measured the same).

---

## 6. Findings sync — the registry and the spec never stand against each other

Every finding registered under `docs/reviews/failure-classes/<slug>.json` carries **`spec_ref`**: the
spec section or sections the class touches, as a list (`["§2.5", "§3.3"]`).

**A finding that contradicts the spec triggers a same-PR correction of one of the two, by the class
table above.** Either the finding is right and the spec is wrong (class 2 or class 3 depending on the
trigger list), or the spec is right and the finding is describing a defect in the code. What may not
happen is both standing, because then the next reader picks whichever they found first.

**Two mechanical cautions, both measured.**

1. The aggregate table is generated from a **fixed column list** in
   `scripts/build-detection-registry.mjs`. A key that is not in that list **validates cleanly, passes
   `--check`, and renders nowhere** — measured 2026-09-19 on a `measurements_*` key. So `spec_ref` is
   not merely added to a JSON file; the generator has to learn it (build item 34), and after
   registering anything you **grep the GENERATED artefact for the new text**, not just the source
   file (Findings-registry R5b).
2. `status` is honest: **`unguarded`** until a named detection check or gate actually covers the
   class, then `guarded`. A fix without detection stays `unguarded` and says so.

---

## 7. How a class-3 request to the owner is written

Use the five steps of `.claude/rules/stuck-means-zoom-out.md` — **purpose, place, data, impact of
absence, then the fork**. That rule is the SSOT for the shape; it is not repeated here.

Two additions specific to a spec deviation:

- **Name the trigger.** Say which of §2's class-3 triggers fired, in the first line: *"class 3 —
  changes an owner-stated number (OD-19's three data slots)"*. The owner should not have to derive
  the class from the prose.
- **Say what OD-24 permits here.** Either *"§7.2 lists this item as reversible behind a flag, so
  OD-24 applies: recorded as O-nn, PROVISIONAL, continuing on the recommendation"*, or *"§7.2 does
  not list this as flag-reversible, so it waits for your word"*. Stating it removes the most common
  ambiguity in the reply.

---

## 8. Enforcement — option B now, option C on the first miss

The owner chose **option B**: make the rule visible at every point a deviation could be introduced,
and build a hard CI gate only when one slips past it.

| # | Mechanism | Build item |
|---|---|---|
| 1 | This guideline | — |
| 2 | `.claude/rules/spec-adherence.md`, path-scoped so it loads on the directories it governs | — |
| 3 | A required **Spec deviation** block in `.github/pull_request_template.md` — class none/1/2/3, spec section, IPO names for class 2, card corrected y/n | item 31 |
| 4 | A **`Status:`** line on every build card, per the implementation contract's decision 1c | item 32 |
| 5 | **`docs/design/check-dod.mjs` repointed** so it runs in any checkout instead of a hard-coded directory, and wired into `docs-gate.yml` | item 33 |
| 6 | A **generated IPO type table** with live counts, so "two live samples" is a lookup | item 30 |
| 7 | **`spec_ref`** on every failure class, validated against the spec's real section list | item 34 |
| 8 | **§0.0.4** in the spec itself, pointing here | landed with this guideline |
| 9 | The **admin-queue open count** in the nightly report | item 35 |

**Option C — a hard CI gate that fails a PR whose Spec-deviation block is missing, or whose class-2
evidence does not name two IPOs per type — is built at the FIRST deviation that slips past option
B**, and not before (Learn-or-block: the mechanism is created at the occurrence, not speculatively).
