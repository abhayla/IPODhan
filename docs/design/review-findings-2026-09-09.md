# Review round, 2026-09-09 — three independent adversarial passes

Same shape as `review-findings-2026-09-08.md`: three reviewers, dispatched in parallel, each
given the design, the build cards, the walkthroughs, the probes and the finding register, each
filing into its own id range so nothing collides, and each told that a finding without a citation
is not a finding. A fourth agent, context-blind, re-ran probes and re-derived walkthrough rows
from the fixtures alone.

| Round | Lens | Model | Ids | Findings |
|---|---|---|---|---:|
| Reviewer 1 | Indian primary-market practice — SEBI ICDR, SME rules, offering types | `opus` | F-63..F-72 | 10 |
| Reviewer 2 | engineering — can each build card be implemented against the real code | `sonnet` | F-73..F-82 | 6 |
| Reviewer 3 | verification — is the cited evidence actually evidence of that claim | `opus` | F-83..F-92 | 10 |
| Blind check | re-run the probes, re-derive 30 walkthrough rows from the fixtures alone | `sonnet` | no ids — `blind-check-2026-09-09.md` | see file |

## What they found, and what happened to it

| id | Sev | Status now | Finding |
|---|---|---|---|
| F-63 | CRITICAL | **FIXED** | lot_multiple holds the LOT SIZE (107), and the design multiplies by it to state the minimum application |
| F-64 | CRITICAL | **FIXED** | The Vinod Texworld walkthrough presents Asset Reconstruction's payload as Vinod's rank-1 source |
| F-65 | CRITICAL | **FIXED** | The 30/90 anchor lock-in split does not exist before 1 April 2022, but the formula is unconditional and the 22:00 job walks backwards into those IPOs |
| F-66 | MAJOR | **OPEN** | The SME lot-value check is written two different ways, and the weaker one can never fire |
| F-67 | MAJOR | **OPEN** | The SME 2-lot rule is stated with no effective date, and 167 SME IPOs on production predate it |
| F-68 | MAJOR | **OPEN** | The allocation check has the QIB inequality the wrong way round, allows the categories not to add up, and can double-count anchor shares |
| F-69 | MAJOR | **OPEN** | "No draft prospectus stage" is wrong for a follow-on offer, and A.2's zero-N/A count contradicts §1.11's own sentence |
| F-70 | MAJOR | **OPEN** | The design never says which of the two Indian meanings of 'OFS' the 19 production rows are, and A.2 grants them 205 fields the exchange mechanism does not have |
| F-71 | MAJOR | **OPEN** | The 10-working-day window check is a public-issue rule applied to 8 rights issues that are legitimately open far longer |
| F-72 | MAJOR | **OPEN** | A rights issue's record date and entitlement ratio are absent from the 240 fields and are not declared as a gap, unlike the equivalent NCD gap |
| F-73 | CRITICAL | **FIXED** | Item 1's Files section never rewires the actual write call sites for 3 of its 8 named tables (ipo_details, financial_statements, ipo_valuation) — they keep writing through the old, non-consolidated path |
| F-74 | MAJOR | **OPEN** | Item 1 adds three new UNIQUE constraints to production tables with no pre-migration duplicate check or repair step |
| F-75 | MAJOR | **OPEN** | The §7.1 'Depends on' column for item 6 lists only item 5, omitting item 15 — which item 6's own card names as a hard prerequisite |
| F-76 | CRITICAL | **TRIGGERED** | Item 7 schedules GMP inside the market-hours-gated live-figures job (10:00-18:30 IST), which reverts the owner-approved fix for F-41 (GMP staleness up to ~65h over a weekend) without resolving the contradiction |
| F-77 | MAJOR | **OPEN** | web/lib/utils/rating-calculator.ts has the identical dormant-threshold-activation defect as ipo-scoring-realtime.ts (tracked as F-95), but item 11 documents it without adding it to the fix scope, tests, or detection |
| F-78 | CRITICAL | **FIXED** | field_extraction_failures.rowKey is defined nullable with a 'null for singleton tables' comment, contradicting item 1's explicit non-null '' convention for the same key — breaking the join item 4's own comment promises |
| F-83 | CRITICAL | **FIXED** | D15 checks that a citation's FILE exists, never that the file is evidence — proven by mutation |
| F-84 | CRITICAL | **FIXED** | The prefix rule reintroduces the exact "PAT Margin" class the mapper's own comment claims to have blocked: financial_statements.pat is evidenced by "P/E (x)" |
| F-85 | CRITICAL | **FIXED** | ipos.issue_size (a rupee amount) is evidenced by BSE's share COUNT — the named historical "share counts stored as rupees" defect, now inside the evidence layer |
| F-86 | CRITICAL | **FIXED** | ipos.close_date is evidenced by the financial table's "Period Ended" header while the real "Close date" label sits in the same file |
| F-87 | CRITICAL | **FIXED** | One Chittorgarh cell labelled "Name" is the recorded evidence for three different entities, and its own sample shows it is a table header row |
| F-88 | CRITICAL | **FIXED** | The offer document's PROMOTER is cited as the registrar and as the intermediary; the issuer's compliance-officer email is cited as the registrar's email |
| F-89 | MAJOR | **FIXED** | The A.0 table introduced as machine-generated disagrees with the machine on three of seven rows, and the headline total is stale by nine |
| F-90 | CRITICAL | **FIXED** | D2 promises "no generator-owned count is hand-typed into the prose" and inspects exactly two phrase shapes — it passes on the stale numbers of F-89 |
| F-91 | MAJOR | **OPEN** | The SME document-type split that sets the rank-1 order for 173 IPOs has no probe behind it and does not reconcile with the one probe that counts documents |
| F-92 | MAJOR | **FIXED** | One number, 52,731,946, is the recorded evidence for four distinct columns, and the other source's evidence for the same IPO's share count is 43% smaller — nothing compares them |
| F-93 | MAJOR | **FIXED** | Section 5.2 presented all 37 amount columns as needing conversion; only 5 hold rupees today |
| F-94 | MAJOR | **OPEN** | Build item 14 (BSE share count to rupees) is largely already built |
| F-95 | MAJOR | **OPEN** | The crore conversion silently activates a dormant scoring bug: every IPO currently scores as the largest possible |
| F-96 | MINOR | **FIXED** | Item 13's 'ofs_issue is never extracted' is stale for the share form |
| F-97 | MAJOR | **FIXED** | The design undercounted the dead matrix keys by half, and mis-described what they are |
| F-98 | CRITICAL | **FIXED** | BSE's Issue_Size_No_of_shares EXCLUDES the anchor portion, so a BSE-sourced issue size understates by about a third |

**26 findings across the three rounds: 13 critical, 13 major, 0 minor.** Disposition: 14 fixed, 11 open, 1 triggered.

## The one class that mattered most

Five of the thirteen criticals were the same defect wearing different clothes: **the evidence
matcher citing a label that contains the right words and means something else.** BSE's share
count cited as a rupee amount. The financial table's "Period Ended" header cited as a bidding
close date. One Chittorgarh cell labelled "Name" standing as evidence for three different
entities. The offer document's promoter cited as the registrar.

It had already been tightened three times in this round — table cells instead of page text,
extracted values instead of provenance sub-keys, whole tokens instead of substrings, a block on
tokens that change what a number means. Each tightening removed real errors and left others.

**The fix was to stop matching.** A (column, source) pair is evidenced only by a label a person
confirmed against the payload, or by an exact name match. The token matcher survives as
`suggest()`, whose output is printed as a candidate and never written to `evidence.json`.
Coverage fell from 105 pairs to 72. That is the honest number, and it is the first one that has
not been overturned by the next person to look.

The general lesson, which is worth more than the fix: **the ambiguity was in the source, not in
the matching.** "Name" is genuinely ambiguous until somebody says name of what. No amount of
cleverness in a matcher resolves that, and three rounds of cleverness produced three rounds of
confident wrong answers.

## Detection-gap RCA — which check should have caught each critical

| Finding | Which check should have caught it | Why it did not | The upgrade shipped this round |
|---|---|---|---|
| F-83 | D15 | its entire assertion was `fs.existsSync`, so any file satisfied any claim | D15 now requires the reference to name the label it matched and that label to be present in the file; the reviewer's own mutation now fails 93 of 100 |
| F-84 | D15 | same — a wrong label in a real file passed | same change, plus the matcher no longer produces evidence at all |
| F-85 | D15 and the unit checks | nothing compared the SEMANTICS of the cited label against the column | curated evidence only; F-98 records that BSE's count also excludes the anchor portion |
| F-86 | D15 | same | curated evidence only |
| F-87 | D15 | same | curated evidence only |
| F-88 | D15 | same | curated evidence only |
| F-90 | D2 | D2 inspected two hardcoded phrase shapes and never asked the generator | D2 runs `generate-appendix-a.mjs --check` and fails on drift in any generated block; mutation-tested |
| F-64 | nothing | no check existed for "this evidence belongs to a different IPO" | the walkthrough generator refuses a fixture that does not name this IPO, and reports the count separately |
| F-63 | the stated "positive integer" rule | a lot size of 107 is a positive integer | §5.3.1 adds three scoped rules, including one that rejects `lot_multiple = lot_size` |
| F-65 | nothing | the formula had no effective date, and the closed-IPO job walks backwards into the period before the rule existed | the spec formula now carries "effective 2022-04-01 onward" and says to leave the field empty before it |
| F-73 | D16 | D16 checks that a card has eleven headings and that its paths resolve — it cannot know a path is MISSING | no mechanical upgrade: this is what an engineering reviewer is for, and it is why the round exists |
| F-76 | nothing | no check compares a new owner decision against the findings an earlier one already settled | recorded as owner fork O-13 with §2.1 marked provisional; D14 keeps the marker tied to the row |
| F-78 | D16 | the two cards were each internally consistent and contradicted each other | no mechanical upgrade yet — a cross-card schema-consistency check is the obvious next one and is named here rather than pretended |

**Two of the thirteen got no mechanical upgrade, and this says so** rather than inventing one.
A cross-card schema-consistency check (F-78) and a "does a new owner decision contradict a
settled finding" check (F-76) are both buildable; neither was built in this round.

## The gate, as it stands

```
[PASS] D1  Appendix A matches the spec exactly (240 fields).
[PASS] D2  No generator-owned count is hand-typed, and every generated block matches its generator.
[PASS] D3  E-1 is 10 fields, stated consistently.
[PASS] D4  0 critical findings OPEN; the design does not claim readiness.
[PASS] D5  All 94 findings carry a declared status.
[PASS] D6  Phase-1 scope is stated in the design.
[PASS] D7  None of the seven disproved claims about our own code appear.
[PASS] D8  Sections 2-4 carry 26 file:line citations for claims about existing behaviour.
[PASS] D9  No work is parked in a non-existent phase.
[PASS] D9b  7 deferred findings each name the event that brings them into scope.
[PASS] D10  26 owner decisions each point at a section that still exists.
[PASS] D10b  Every mechanically checkable owner decision still holds.
[PASS] D10c  No undecided owner comment is written up as settled.
[PASS] D11  All 33 code citations resolve to a real file and a line that exists.
[PASS] D12  The three jobs, their times and the no-kill rule are stated; nothing schedules a document read on an interval.
[PASS] D13  37 amount columns listed in 5.2, matching the probe exactly, with every one of 160 numeric columns ruled.
[PASS] D14  3 open fork(s) in 0.0.2, 2 provisional marker(s), every one tied to a row.
[PASS] D15  72 of 387 (field, source) pairs carry evidence that resolves (floor 71).
[PASS] D16  build cards: 18 â€” every card carries all eleven headings in order, a budget, a tier, and only paths that resolve.

19/19 consistent.
```

## What the reviewers said was RIGHT

Worth recording, because a review that finds only problems is not a review.

- **E-1 is domain-correct** and better argued than most published sources: the price band
  advertisement genuinely is printed once and never reissued when a window is extended, so
  exchange-first for the timetable family is right, and excluding `upi_cutoff_time` and
  `bid_windows` because they hold a clock time rather than a date is exactly the right line.
- **§5.3's effective-date machinery is the correct answer to the closed-IPO backlog**, and it is
  what made three of the domain findings cheap corrections rather than redesigns.
- **The fresh + OFS reconciliation is real domain work**; clearing the websites of blame for the
  Kanohar and Glass Wall discrepancies was the right conclusion.
- **13 of the 18 build cards carry no blocking finding** and were judged buildable as written.
- **The probes reproduce.** Three re-ran byte-identically apart from their timestamp; the two that
  differed differed only in live bid-book fields their own comments flag as volatile.
- **D1, D11 and D13 are real checks** — the verification reviewer confirmed each does what its
  PASS line claims.

