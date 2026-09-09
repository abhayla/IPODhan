# Delta report — the pull-model design, 2026-09-09 afternoon

Contract: `docs/contracts/2026-09-09-pull-model-design-delta.md`. Branch `docs/pull-model-delta`,
worktree `IPODhan-IPODhan-pullmodel-delta`, based on `origin/docs/pull-model-implementation-ready`.
**Documentation only — no behaviour ships from this run.** This run changed **zero files outside
`docs/`**: `git diff --name-only origin/docs/pull-model-implementation-ready...HEAD | grep -vc '^docs/'`
returns 0.

The PULL REQUEST, whose base is `main`, does show six non-docs files — the merge script and its
repair library, the over-ask hook and its test, the lessons file and `.gitignore`. Every one arrives
with the base branch, not with this run. The first version of the PR description said "zero files
outside `docs/`" against `main` and quoted a command that returns 6; that was wrong and is corrected
in the PR rather than quietly removed.

---

## 1. Provisional items — the things that are yours, listed first

| id | The question | Recommendation the design is written on | What waits on you |
|---|---|---|---|
| **O-14** | Nineteen rows are typed `OFS`. Measured today: none has a lot size, none has a single document, one has a price band — and they are Coal India, BHEL, NHPC, NLC India, Hindustan Zinc, IRFC, IndiGrid and three public-sector banks, **every one already listed**. They are SEBI's OFS-through-stock-exchange auction, not IPOs. Should they get their own page shape? | **Yes — model them as their own offering type with roughly 35 applicable fields rather than 205.** A page showing a price band, a lot size and an anchor book for an offering that has none of them is wrong in a way a reader sees immediately | Nothing is blocked. Your answer decides what a whole class of page looks like, and how many rows the coverage numbers are measured against |
| **O-15** | The design shows a 15-minute-delayed post-listing price from NSE's and BSE's free public endpoints. Fetching them is free; **republishing them may not be.** NSE's data policy forbids a subscriber redistributing market data except under agreement, and its terms of use prohibit automated extraction and redistribution | **Proceed with the delayed, dated, clearly-labelled price while you check the licence position** — it is the lowest-risk form, and the alternative is no price at all on a listed IPO's page | This is a compliance call, not an engineering one. You are a Zerodha Authorised Person bound by the NSE Code of Advertisement |
| **O-7** | Language model, last stretch only | standing constraint; nothing in phase 1 uses one | nothing |
| **O-12, O-13** | — | **Decided by you on 2026-09-09** and moved to §0.0.1 as OD-48 and OD-28 | nothing |

## 2. What each stage did

| Stage | What changed | Gate at the end | Commit |
|---|---|---|---|
| **A** — fold the decisions in | OD-27 … OD-52 added to §0.0.1 in your own words (52 rows now); OD-23 marked SUPERSEDED by OD-32; O-12 and O-13 moved out of the open-fork table; §2.1, §0.5.1, §5.2, §7.1 rewritten; §2.2.1, §2.3.3.2, §2.3.3.3, §2.5.5 written | 23/23 | `ffccce2e` |
| **B** — the new sections | §2.11 (what the reader sees), §4.5 (test corpus), §6.6 (switch-over), §7.4 (running cost), §7.5 (how this ships), §7.6 (configuration and modularity), §8.5 (how implementation proves it followed the design) | 23/23 | `ffccce2e` |
| **C** — build cards | 22 cards (19 merge tool, 20 traceability CI, 21 read side, 22 document handling added); every card gained **Rules implemented** and **Known gaps**; every one of §7.1's items names its module | 23/23 | `3a940818` |
| **D** — evidence and findings | three production probes written and run; findings **18 open → 0**; the CARDED status added so a finding cannot be closed by dropping it | 23/23 | `fe53792a` |
| **G (part)** — draft contracts | the merge-tool routing contract written; the child-table contract refreshed for the `normalized_name` discovery. Neither dispatched, no T-id | — | `1bc20bd6` |
| **F** — three reviews | domain, verification and engineering, all adversarial, all against `fe53792a` | — | `8a82c678`, `b4375d87` |
| **E** — walkthroughs | four edge cases walked on real production rows | 23/23 | `99bae7bb` |
| **F2** — second round | one fresh reviewer on only the sections the fixes changed | 23/23 | `99bae7bb` |

## 3. What was measured, and what it corrected

Nothing in this section is remembered. Each row names how it was read.

| What | Measured | It corrected |
|---|---|---|
| The box | KVM 2, 2 vCPU, 8 GB, **100 GB disk, 7.81 TB/month** (Hostinger API, saved as a fixture) | this project's own notes said 96 GB |
| Running cost | **835 calls and 49.8 MB a day = 0.018% of plan bandwidth** (`probes/job-cost.mjs`, from the real payload byte sizes) | bandwidth was an unknown; it is now a non-issue, and CPU and disk are named as the real limits |
| SEBI observation validity | **twelve months, Reg 44(1)**, quoted from a law firm's direct citation and saved with what SEBI's own site did and did not serve | the design had no citation at all |
| SME minimum application | **2 lots above ₹2,00,000, effective 2025-07-01** (NSE/BSE circulars of 2025-06-18) | the design had ₹1,00,000 in a form that reduced to ₹50,000 — half the old floor and a quarter of the new one |
| Price band | **120% cap and 105% floor apply to SME too** (ICDR Reg 30(2), Chapter IX) | the design invented a 1.4× SME carve-out that would have passed an illegal 40% band |
| The 19 OFS rows | 0 lot sizes, 0 documents, 1 price band; names all already-listed PSUs | two sentences of §1.11 were false, including `issue_size = ofs_issue` for rows that have no `ofs_issue` |
| SME document split | SME has **0 PRICE_BAND_AD, 1 DRHP, 64 PROSPECTUS** — the claim holds; mainboard has **13** price-band ads | the design said 12 |
| `normalized_name` | **does not exist** on `promoters`, `peer_companies` or `ipo_intermediaries` | build item 1's migration named a column that has never been written |
| Field populations | `filing_date` 27/266 · `ipo_details` 25/330 · `issue_type` 19/330 · `lot_multiple` 8/330 · observation date and `company_id` **no column** | six rules keyed on inputs that are not there — now §4.6 |

## 4. Evidence, by category

**72 of 387 (field, source) pairs carry a payload committed in this repository — 19%.** That number
did not move this round, and the honest reasons are:

| Category | Pairs | Why |
|---|---:|---|
| Evidenced by a saved payload | **72** | unchanged from the morning run |
| Searched, nothing matched | 305 | the source was probed and does not carry that label |
| Never probed — registrars | 7 | **a real shortfall of this run.** The registrar probe the contract asked for was not written; the run spent its probe budget on the three questions that were blocking findings instead |
| Never probed — ADMIN | 3 | an admin override has no external source to probe |

The ratchet stayed at 71 and the check now refuses to let it fall: it reads the committed floor back
out of git, and a decrease fails on its own. Its PASS line also stopped flattering itself — it names
the 315 pairs that carry no evidence and are outside the check.

## 5. The review rounds

| Round | Model | Findings | The one that mattered |
|---|---|---|---|
| Domain | `opus` | 11 (1 CRITICAL, 6 MAJOR) | the SME minimum application shipped at half the legal floor, **in the exact weak form the same paragraph names as a defect** |
| Verification | `opus` | 6 attacked, **5 unsound** | the evidence ratchet could be set to zero by the change it was meant to constrain, and printed `[PASS] D15  0 of 387` |
| Engineering | `sonnet` | 48 claims checked, 3 wrong | §0.5.1 described one function while citing another's line |
| **Second round** | `opus` | 12 (2 CRITICAL) | **a regression the first fix introduced**: `(LOCAL)` became a universal excuse for any missing path |

Full detail: `docs/design/review-findings-2026-09-09-delta.md`.

**The four walkthroughs** (Veegaland — corrigendum; Riyaasat — fixed-price SME; Rays of Belief —
identity; FPO — no real row exists) each stopped at a rule the design could not answer, and three of
the four stopped for the same reason. That reason is §4.6.

## 6. Honest failures of this run

- **The registrar, SEBI and anchor-report probes were not written.** The contract asked for them and
  the evidence count did not move: still 72 of 387. Three other probes were written instead, because
  they unblocked findings; that was a choice, and it left this one undone.
- **Eighteen of the twenty-three checks have never been mutation-tested.** Five were attacked and
  five were unsound. The remaining eighteen are **unexamined, not known good**, and "23/23 consistent"
  reads more reassuringly than it should.
- **I introduced a CRITICAL regression while fixing a CRITICAL.** The `(LOCAL)` marker fix made LOCAL
  a universal excuse. It was caught only because a second round was run on the fixes themselves.
- **Seven findings were silently lost** when a parallel run and this session wrote the same file. The
  gate could not notice: a finding that no longer exists cannot be OPEN. Restored, and recorded as
  F-118.
- **The design was wrong about our own code nine times**, and each was found by someone reading the
  code rather than by any check. `MAX_DOCUMENT_BYTES = 150 MB` existed; `%PDF` sniffing existed; OCR
  was built and wired; every IPO page already sets a canonical tag; `decidePurge` had had a read-state
  rule since T-403.
- **The two walkthroughs published this morning still carry dates that are one day early** (F-104).
  The cause is fixed at the source; those two files were not regenerated.
- **Two rules still cannot run** even after §4.6: the lapsed-draft rule has no observation-date
  column, and the IPO → FPO link has no `company_id`. Both are now stated as build work rather than
  described as if they worked.

## 7. Learnings (PROPOSE only — nothing auto-applied)

1. **A "does not exist" claim needs a repo-wide grep, never a single-file read.** The canonical-tag
   error came from grepping `page.tsx` instead of the helper the page calls.
2. **A parallel run must never write a file the parent also writes.** Give it its own output file and
   merge. Seven findings were lost to this, and nothing detected the loss.
3. **A fix to a check needs its own mutation test before it is believed.** Two of today's check fixes
   were wrong on the first attempt, and one made things worse.
4. **Ask of every rule: is its input populated on production?** Six rules keyed on empty fields, and
   reading the rules could never have found it — only walking real IPOs did.
5. **A rewriting tool must declare what it owns.** The card generator deleted hand-written prose
   twice before a marker made ownership explicit.

## 8. Skipped

- The registrar / SEBI / anchor-report probes (§6, first bullet) — not done, not disguised.
- Regenerating the two morning walkthroughs after the date fix.
- The compliance line beside the grey-market premium (domain finding 10) — one sentence, and it is
  your wording to approve rather than mine to invent.

## 9. The merge order, which is yours to choose

Both this PR and **#432** meet the same red check, and neither is caused by either branch:
`scripts/merge-duplicate-ipo.mjs` writes to `ipos` with raw SQL and trips the write ratchet.

> **The unblocker is build item 19**, and its contract is written and ready:
> `docs/contracts/2026-09-DRAFT-merge-tool-shared-write-path.md`. The ratchet baseline is shrink-only
> and is **never** edited — the fix is routing.

| Option | What it means |
|---|---|
| **Merge #432 first, then this PR on top** | two smaller reviews; the item-19 fix lands after both |
| **Let this PR supersede #432** | one review of the finished design; #432 closes unmerged |

Neither changes behaviour, so nothing on the site waits on this.

**And a second merge tool exists.** `scraper/scripts/merge-duplicate-ipos.ts` (plural) also writes
raw SQL to `ipos` and is **already in the baseline**, grandfathered before that rule existed. Out of
item 19's scope, named in §8.3, and the honest reading is that the project owes a second routing job.

## 10. The Definition of Done, walked

The contract's Definition of Done was checked item by item rather than declared met, by
`docs/design/check-dod.mjs` — a command anyone can re-run:

```
node docs/design/check-dod.mjs        # Definition of Done: 14 met, 0 not met, of 14.
```

It asserts the real artefacts, not a checklist of intentions: 52 OD rows with OD-23 superseded and
O-12/O-13 gone from the fork table; all nine new sections present; D17-D20 in the gate with the gate
green; the mutation suite red-then-green on four attacks; 22 cards past the card gate; items 19-22
present; 166 live rules with **zero orphans**; **zero open findings**; six walkthrough files; the
review record with its second round; two DRAFT contracts with no TBD in either; O-14 and O-15
recorded; and the ledger line, tracker section, report and released lock.

**One item it caught that nothing else had:** the contract this run fulfils was committed on a
different branch (`d9ba3430` on `docs/pull-model-design`) and was therefore **not in this branch at
all** — so a reviewer of the pull request could not read what the run had been asked to do. It is
now on the branch, byte-identical to the original (md5 `0fb00585…`).

## 11. SUMMARY

- **DONE** — 26 owner decisions folded in and enforced by four new checks; seven new sections;
  22 build cards with every one of 166 design rules owned or declared unclaimed; findings 18 → 0
  (114 total, none open); three production probes that corrected four claims; four edge-case
  walkthroughs; four adversarial reviews including a second round on the fixes; five unsound checks
  fixed and proved by a standing mutation suite (4 caught, 0 missed); two draft contracts, neither
  dispatched.
- **PENDING** — the registrar/SEBI/anchor probes and the evidence count that depends on them;
  eighteen checks never mutation-tested; two morning walkthroughs carrying one-day-early dates.
- **BLOCKED** — nothing in this run. The PR's red check is build item 19's, and its contract is
  written.
- **NEXT** — yours: **O-14** and **O-15**, one line each, and the merge order in §9. Mine, on your
  word: dispatch item 19, then item 1.
