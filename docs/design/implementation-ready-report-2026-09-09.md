# Implementation-ready report — the pull-model design, 2026-09-09

Contract: `docs/contracts/2026-09-09-pull-model-design-implementation-ready.md`. Branch
`docs/pull-model-implementation-ready`, worktree `IPODhan-pullmodel-ready`. Documentation only —
no behaviour ships from this run.

---

## 1. Provisional items — the things that are yours, listed first

Each is written into the design on a stated recommendation, and marked in place so you can overrule
it in one edit. Check D14 fails the gate if a marker ever loses its row.

| id | The question | Recommendation the design is written on | What waits on you |
|---|---|---|---|
| **O-12** | Five rupee columns are amounts, but in crore they read absurdly: the minimum application (about 15,000 rupees, `0.0015` crore), the two application ceilings people read in lakh, and the two grey-market rates quoted in hundreds. Does "crore by default" admit them as named exceptions? | **Yes — keep those five in rupees.** A default with five reasoned exceptions, not a rule with silent ones. | Nothing. Build item 11 ships either way; your answer decides five columns' treatment. |
| **O-13** | On 2026-09-08 you approved taking the grey-market premium OUT of the market-hours gate, because it was going 65 hours stale over a weekend. Tuesday's cadence decision, read literally, puts it back in. Which did you mean? | **Subscription and the demand graph during bidding hours only; the premium additionally fetched by each data job and the 22:00 job**, so it never freezes overnight. | Nothing is blocked, but the literal reading would undo a change you approved and readers would notice. |
| **O-7** | Language model, last stretch only | standing constraint; nothing in phase 1 uses one | nothing |

## 2. What each stage did

| Stage | What changed | Gate at the end |
|---|---|---|
| **A** — fold the decisions in | OD-19 to OD-26 added verbatim to §0.0.1; O-1, O-2 and O-3 moved out of the open table; §0.0.3, §2.1, §0.5.1, §5.1, §5.2, §5.3, §6 and §7.1 rewritten; checks D12–D15 added and each mutation-tested | 18/18 |
| **B** — prove every rank | seven probes written and run; every source reached; the real extractor run on four real offer documents; ranks corrected; §A.0 rewritten as a generated block | 18/18 |
| **C** — build cards | 18 cards, one per build item; check D16 added to gate them | 19/19 |
| **D** — walkthroughs | two real open IPOs walked field by field, generated from production and the fixtures | 19/19 |
| **E** — three reviews | 26 findings, 13 critical; the criticals fixed or recorded as owner forks | 19/19 |
| **F** — draft contract | `docs/contracts/2026-09-DRAFT-child-table-consolidated-writer.md`, not dispatched, no T-id, nothing written to the bus | — |
| **G** — close out | §8 rewritten, ledger line, tracker updates, this report, PR | 19/19 |

Commits:

```
70c9b4f5 docs(design): eighteen cards, the draft item-1 contract, and four things the cards disproved
68487aa7 docs(design): the build cards get a gate of their own
83aa1ad1 docs(design): two real IPOs walked end to end, and fourteen build cards
1eb2335e docs(design): every rank against a saved payload, and the two the payloads corrected
bc64abaa docs(design): the probes, and what they disproved
edcac748 docs(design): fold the 2026-09-09 owner decisions in, and make the gate enforce them
ffde6801 docs(contracts): pull-model design to implementation-ready - the /goal contract
e7a4cc7b docs(ops): design complete - ledger line and O-8 at 100%
da462341 docs(design): close the last five findings - the design is complete
```

## 3. Evidence — what the ranks now rest on

**72 of 387 (field, source) pairs are backed by a payload committed in this repository.**
That number went 231 → 114 → 105 → 72 across the round, and every fall was a correction, not a loss:

| Reported | Why it was wrong | What changed |
|---|---|---|
| 231 | matched loosely: `ipos.registrar` against a plausibility check, `gmp_records.gmp` against a page title, `ipos.issue_size` against a nav link | index table cells not page text; index extracted values not provenance sub-keys |
| 114 | `financial_statements.pat` against "PAT Margin", a different quantity that contains every token of the right one | block tokens that change what a number means |
| 105 | `ipos.symbol` against `business_description` — the synonym "scrip" sits inside "de-scrip-tion" | whole-token matching with a four-character floor |
| **72** | the review found five more of the same class; the ambiguity is in the SOURCE, not the matching | the matcher no longer produces evidence at all — curated labels and exact name matches only |

Per source, generated:

| Source | Backed | Searched, nothing matched | Not probed |
|---|---:|---:|---:|
| `DOC` | 14 | 149 | 0 |
| `NSE` | 21 | 36 | 0 |
| `BSE` | 14 | 41 | 0 |
| `CG` | 22 | 79 | 0 |
| `IG` | 1 | 0 | 0 |
| `REG` | 0 | 0 | 7 |
| `ADMIN` | 0 | 0 | 3 |

## 4. Rank corrections found by probing

| Field | Before | After | Evidence |
|---|---|---|---|
| `peer_companies.pbv_ratio` | no rank 2 — "observed absent from a live Chittorgarh page" | Chittorgarh at rank 2 | a real page prints "Price to Book Value 2.55 3.37" and a peer table with a "P/BV Ratio" header. The rank was pinned in TWO places, so removing one changed nothing and the appendix did not move — the generator's drift check is what noticed |
| `ipos.issue_size`, BSE rank | plain rank 2 | rank 2 with a stated trap | BSE's `Issue_Size_No_of_shares` EXCLUDES the anchor portion. Measured exactly: NSE says 52,731,946 shares including a 15,819,583 anchor portion; BSE reports 36,912,363, which is the remainder to the share. Multiplying it by the floor price understates the issue by 33.5% (F-98) |
| SME on NSE | NSE ranked on labelled fields | flagged, not re-ranked | NSE returns 39 labelled rows for the mainboard IPO and an EMPTY `issueInfo` for the SME one (F-58). One live SME IPO is enough to flag a family of fields, not to change it — put to the review round with the payloads |
| `anchor_investors` lock-in dates | unconditional formula | effective 2022-04-01 onward | the 50/30 and 50/90 split did not exist before then, and the 22:00 job walks backwards into that period (F-65) |

## 5. Old documents — can the closed-IPO backlog be re-sourced?

**13 of 14 downloads succeeded.** That is the easy half of the answer.

| Host and age | Obtainable | Verdicts |
|---|---|---|
| nsearchives.nseindia.com | about 1-2 months | 3/3 | OBTAINABLE (ZIP — the archive serves a container, the re-download path must unzip) ×3 |
| www.chittorgarh.net | about 1-2 months | 1/1 | OBTAINABLE ×1 |
| www.icicisecurities.com | about 3-7 months | 1/1 | OBTAINABLE ×1 |
| cmr.co.in | about 3-7 months | 0/1 | UNREACHABLE (0 TypeError: fetch failed) ×1 |
| nsearchives.nseindia.com | about 3-7 months | 3/3 | OBTAINABLE ×1, OBTAINABLE (ZIP — the archive serves a container, the re-download path must unzip) ×2 |
| www.chittorgarh.net | about 3-7 months | 1/1 | OBTAINABLE ×1 |
| www.bseindia.com | 7+ months | 1/1 | OBTAINABLE ×1 |
| shayonaengg.com | 7+ months | 1/1 | OBTAINABLE ×1 |
| nsearchives.nseindia.com | 7+ months | 1/1 | OBTAINABLE ×1 |
| indorient.in | 7+ months | 1/1 | OBTAINABLE ×1 |

**The hard half is upstream of downloading, and nobody had asked it.** For how many LISTED IPOs do
we even hold an address to retry?

| Age bucket | Segment | Holds an offer-document URL |
|---|---|---|
| 7+ months | MAINBOARD | 1 of 17 |
| 7+ months | SME | 15 of 47 |
| about 1-2 months | MAINBOARD | 2 of 24 |
| about 1-2 months | SME | 2 of 38 |
| about 1-2 months | None | 0 of 1 |
| about 3-7 months | MAINBOARD | 10 of 21 |
| about 3-7 months | SME | 55 of 64 |
| about 3-7 months | None | 0 of 4 |
| listed under 20 days ago | MAINBOARD | 13 of 18 |
| listed under 20 days ago | SME | 5 of 17 |

**One of seventeen** LISTED mainboard IPOs older than seven months holds an offer-document URL at
all. For those, the 22:00 job cannot re-download — it has to DISCOVER the document again from NSE,
BSE or SEBI. That is a different piece of work from the one §6 originally described, and the card
for item 17 says so. NSE also serves its archives as ZIP rather than PDF.

## 6. Numbers this round corrected

| The design said | It is actually | How it was caught |
|---|---|---|
| 37 amount columns convert to crore | **5** hold rupees. 25 are already crore at the writer level and 7 carry their own per-row unit | reading the writers. A repair built from the old table would have divided 25 correct columns by ten million |
| 13 dead matrix keys | **27** unreachable of 77, of which only 5 are duplicates and **22 are orphans** — live fields with no matrix entry at all, silently taking the default rules every cycle | a probe |
| the store fits under the 5 GB ceiling at 500 IPOs (3.18 GB) | **8.25 GB**, which exceeds it | 163 of 265 document rows have no `file_size`, so two thirds of the store counted as zero bytes |
| build item 14 is open work | largely already built — `computeBSEIssueSize` converts the share count and has three passing regression tests | reading the code |
| F-46 is caused by missing corporate-form words in the normaliser | the normaliser already folds them; the cause is pipeline ORDER — the parenthetical never becomes trailing before the suffix regex runs | running the normaliser |

## 7. Review rounds

Full detail in `docs/design/review-findings-2026-09-09.md`; the blind re-derivation is in
`docs/design/blind-check-2026-09-09.md`.

| Round | Model | Budget | Findings | Criticals |
|---|---|---|---:|---:|
| domain | `opus` | 20 min / 40 calls | 10 | 3 |
| engineering | `sonnet` | 20 min / 40 calls | 6 | 3 |
| verification | `opus` | 20 min / 40 calls | 10 | 7 |
| blind re-derivation | `sonnet` | 20 min / 40 calls | 15 of 30 rows mismatched | — |

Register now: **68 fixed, 18 open, 7 deferred with a named trigger, 1 not doing.**
**Zero critical findings are open.** Eighteen major and minor ones are, each owned by a build item.

## 8. Honest failures of this run

- **The contract asked for zero open findings after three reviews. There are 18.** All are major or
  minor and each names its owner, but the bar as written was not met, and a second review round on
  the changed sections was not run. Calling that "done" would be the exact failure this design
  exists to stop.
- **The contract asked for every one of the 387 (field, source) pairs to be evidenced. 72 are.**
  The registrar sites were never probed at all, and one round of live IPOs cannot evidence a rank
  for an offering type that has no rows on production.
- **I broke things the checks then caught, four times.** D7 caught my own text quoting a disproved
  claim. D12 caught a sentence of mine putting documents back on a clock. D15 caught three labels I
  had synthesised rather than read. The generator caught a rank correction that had silently done
  nothing. That is the system working, and it is also four defects I wrote.
- **The evidence matcher was wrong three times before it was abandoned**, and each time I believed
  the tightened version. A reviewer had to prove by mutation that the check guarding it asserted
  nothing at all.
- **`--write` on the appendix generator rewrote a CRLF file as LF for two runs.** Nothing checked
  line endings, so a one-row regeneration would have arrived as a whole-file diff.
- **The SME walkthrough is thin.** Two of its 239 applicable fields have a rank-1 source backed by
  its own payload. That is the true state, and it is much weaker than the first version implied.

## 9. Learnings to fold back (PROPOSE only — nothing auto-applied)

1. **A check that has never been red is not a check.** Every check added this round was broken on
   purpose first, and two of them still turned out to assert less than their PASS line claimed.
   Proposal: a mutation test is part of a check's definition of done, and the PASS line must state
   what is asserted, not what is hoped.
2. **Automatic matching of free text to a schema produces confident wrong answers.** Three
   tightenings each removed real errors and left others. Proposal: where a human judgement is
   needed to say what a label names, encode the judgement, and let the matcher only suggest.
3. **A ratchet must be allowed to go down with a reason.** Forbidding that would have locked in nine
   false matches. Proposal: floors carry a stated reason per removed item.
4. **A generated number in prose goes stale within the hour.** Proposal: generated blocks are
   marked in the file and gated by the generator, not by a regex over phrasings.

## 10. Skipped (already covered)

Nothing was skipped: this was a first run of this contract, and §0.2 found no prior progress file.

## 11. The gate

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

## 12. SUMMARY

- **DONE** — the owner decisions folded in and enforced by checks D12–D16, every one mutation-tested;
  72 of 387 source ranks backed by committed payloads with a ratchet; 18 build cards gated by D16;
  two real IPOs walked field by field; three adversarial reviews plus a blind re-derivation; every
  critical finding closed or recorded as an owner fork; the draft item-1 contract written and NOT
  dispatched.
- **PENDING** — 18 major/minor findings open, each owned by a build item; the second review round on
  the changed sections; evidence for the remaining source ranks, which needs a registrar probe and
  more IPO types than are live today.
- **BLOCKED** — nothing.
- **NEXT** — yours: answer O-12 and O-13 (one line each). Mine, on your word: the second review round,
  then the item-1 contract is ready to dispatch.

---

## 13. Postscript: the pull request's red check

`pr-gate` fails on one step, and it is not this branch's:

```
[write-ratchet] FAIL — new file(s) write to `ipos` outside the baseline:
  NEW: scripts/merge-duplicate-ipo.mjs  [raw_sql]
```

That file arrived in commit `9709f987` on the BASE branch `docs/pull-model-design`. This branch
changed zero files under `scripts/` (`git diff --name-only origin/docs/pull-model-design...HEAD |
grep -c '^scripts/'` returns 0), and the run's guardrails forbid editing anything there.

It is left alone deliberately. A one-off repair script writing to `ipos` with raw SQL is precisely
what the write ratchet exists to notice, and silencing it from a documentation branch would hide the
signal rather than answer it. Whoever merges `docs/pull-model-design` meets the same failure. The two
honest options — route the write through the shared path, or add it to the baseline with a stated
reason — are both somebody's decision, not a docs edit.
