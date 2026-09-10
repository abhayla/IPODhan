# Lane C progress log (contract §0.3)

**Last refreshed: 2026-09-11 02:44 IST** — written in the SAME turn as the board, the state file and the ledger commit. All four or none. — written in the SAME command as the ledger commit below it. Local only
(`docs/contracts/.run/` is gitignored, .gitignore:317); the durable record is
`docs/contracts/state/pull-model-implementation-lane-c-STATE.json` and
`docs/walks/2026-09-02-deepa-pipeline-walk.md` on `ops/impl-loop-c-ledger`.

## Run state

| | |
|---|---|
| Lane | C — items 14, 2, 12, 3 |
| Current | items 2 and 12 have every PLANNED slice merged; neither is DONE. Item 3 is next, at zero. |
| Test DB | `ipodhan_test3` — **drop still OWED** at Stage 7 |
| Owner alert channel | LIVE (HTTP 202 asserted) |
| PR-gate | **cap LIFTED by the owner** — merge on green, no daily run limit |
| Worktrees | 2 — coordination + `IPODhan-c02-3a` |

## Items

| Item | Status | Detail |
|---|---|---|
| 14 | MERGED-UNPROVEN | 14-S1 `10c96c6b` (#471). 14-S2 **HELD** pending #482; branch `e4a855b8` preserved on origin. Proof blocked by #472/#482 |
| 2 | MERGED-UNPROVEN | SEVEN merged: 2-S1 `b0c42202` · 2-S2 `4e188187` · 2-S3a `2fd8a43b` · 2-S3c `4d28b4db` · 2-S3b `de647f80` · 2-S4 `d8779c20` · 2-S5 `b612ff25`. 2-S3b2 BLOCKED (0 of 17 rows reachable); 2-S6 is NEW work from #515 |
| 12 | MERGED-UNPROVEN | ALL SIX merged: 12-A `ff8a0522` · 12-C `8047231e` · 12-C2 `1373620c` · 12-D1 `0fc3ab80` · 12-B `3ffc9e19` · 12-E `da8cad5a`. 12-B owes its staging read. 12-D2 deferred FUTURE with its trigger query |
| 3 | **RE-CUT-NEEDED** | the matrix governs `ipos` writes ONLY, so 3-S1/3-S2/3-S3 all aim at a narrower mechanism than the card describes. #534 opened and CLOSED tonight on that finding |

## Issues raised by this lane

| # | What | Owner |
|---|---|---|
| 468 | Manika Plastech UPCOMING, zero `document_fetch_state` rows | document services |
| 472 | `c_issue_size_floor` red 2+ nights, #401 closed while still failing | lane C (14-S2, held) |
| 477 | `floor-delta.mjs` invalid severity — nightly owner alerts 400'd silently | fixed by another lane |
| 481 | `openRepairDb` times out anonymously on DATABASE_URL-only (R6, not safety) | unassigned |
| 482 | **segment guessed not sourced** — 4 write paths, 41 of 148 prod rows unprovenanced | lane C (2-S3a/b/c) |
| 488 | **Drizzle `.where()` replaces not ANDs** — registrar search returns inactive rows; holiday filters drop year+exchange | supervisor session (Tier B class fix + new `check-drizzle-where-chaining` pr-gate check) |

## Corrections against myself

1. autocrlf stage → 546/537 whole-file churn hiding 9 lines. Caught pre-commit.
2. Called a slow migration "stuck on stdin"; it was buffered output. Killed a run for nothing.
3. Cited a false import precedent — resolved to a different directory.
4. Overgeneralised another lane's `check-ignore` finding. Withdrawn, then built the falsifying probe.
5. Relayed a supervisor CI-gate claim as fact. Builder verified and pushed back.
6. Published "share count stored as rupees" on #472 — the share count was exactly what I called implausible.
7. Literal `14:1x` placeholder in a board timestamp.
8. Never created this progress log until a tick found it missing.
9. Board left stale at 14:32 through four transitions. Third reminder.
10. Reader-audit grep **omitted `web/components`** — the user-facing readers. Caught by the Tier A reviewer; would have shipped a change making a visitor-visible mislabel MORE common.
11. This log stale 57 min: I tied the board to the ledger commit and did not extend it to this file — fixed the instance, not the class.

Shape of 3, 4, 5, 6: stating what I had not checked. Standing mitigation in every brief —
*verify against the checker, follow the checker over me* — has now caught four.

## Standing brief lines (each earned from a real incident today)

1. Verify against the checker; follow the checker over me if they differ. *(caught four of my errors)*
2. Confirm a mutation ACTUALLY APPLIED before reading its result. *(a round-1 mutation silently no-op'd = false green)*
3. Any background process is stopped and confirmed gone by PID; a `tail -f` never outlives its command. *(one orphaned; another lane found it)*
4. A blocked `find` means search under the worktree root — never the `FIND_ROOT_GUARD_ALLOW` bypass.
5. Use DISTINCT heredoc delimiters, never nested `EOF` — a body containing another unterminated start marker can false-block the guard.
6. Revert a mutation from a `.bak` taken BEFORE applying it — never `git checkout --` (now hook-blocked; it has discarded uncommitted work twice).
7. Prefix `MSYS_NO_PATHCONV=1` on any `git show|cat-file|ls-tree` with a `<ref>:<path>`; sanity-check with a line count before believing a zero.

## Predicted, announced in advance
- **`j_segment_not_null` will go PASS → FAIL** as honest NULLs appear (merged 3a + the 2-S3b repair). It fires on IPO rows with a null segment and skips non-IPO types. It passes today only because segment is MAINBOARD everywhere by default. **This is the check working, not a regression** — do not treat it as one in tonight's delta.

## Blocked externally
- **Staging deploys have failed on every push since 08:11:23 IST** (10 consecutive; last success 07:40:31). No staging proof is obtainable for #471, #473, #483 or #490. Item 14 and item 2 proofs recorded OWED with that reason.

## Owed
- `ipodhan_test3` drop at Stage 7 (STATE marker `OWED`)
- item 14 staging proof — blocked on #482
- item 12 / item 3 plan re-cuts; ledger line `[lane C] delta-1 adopted at item 12`

## 2026-09-10 18:45 IST - 2-S3b2 unblocked, by evidence I already had

I held slice 2-S3b2 (source the 33 unlabelled IPOs) saying it needed a real sample proving some
source publishes the segment. Two samples were already committed in this repo:

- `docs/design/probes/fixtures/chittorgarh/vinod-texworld-ltd.html` -> `"issue_category":"SME"`
- `docs/design/probes/fixtures/chittorgarh/asset-reconstruction-company-india-ltd.html` -> `"issue_category":"Mainline"`

Same structured key, contrasting values, two real captured pages. That is a published field.
Nothing in the codebase reads it today - grep for `issue_category` or `Mainline` returns nothing.

Independently, NSE's captured `ipo-current-issue.json` carries `series` "SME" vs "EQ", and
`nse-api-client.ts:505-513` already consumes it, so NSE-sourced live rows were never the gap.

**Still unknown, and the slice stays PLANNED not READY:** whether those 33 rows have reachable
Chittorgarh pages at all. The fixture proves the field exists, not that it covers those rows.
And `Mainline` has been observed exactly once - mapping it to MAINBOARD off one sample is the
kind of generalisation that has bitten this lane before.

**My miss:** I called a blocker external without grepping the repo's own fixtures for the thing
I claimed was missing.

## 2026-09-10 18:49 IST - correcting myself: 2-S3b2 is NOT unblocked

Twenty minutes ago I wrote that 2-S3b2 was unblocked. Withdrawing that headline.

A read-only probe against production (`default_transaction_read_only=on`, self-verified, zero
writes) shows **zero of the 17 unprovenanced IPO rows carry a stored `verifier_url`**.

Chittorgarh really does publish `issue_category` — two real fixtures, contrasting values, that
part stands. But there is no reachable page for any of these 17 rows, and constructing a URL from
the slug is the exact failure mode design section 2.3.1 exists to prevent. The probe that captured
those fixtures says so in its own header.

**So the blocker is renamed, not removed** — and the rename is still worth the hour:

| | blocker |
|---|---|
| Before | "no source publishes segment" — **false**, and false in a way that parks the slice forever |
| Now | "these 17 rows have no reachable page" — a discovery problem with a known sanctioned answer |

Also correcting my own arithmetic: production carries **48** unprovenanced rows, **17** of them
IPOs. Not the 41/11 in the repair tool's header, not the 33 from the test-copy dry run — that 33
was a different population. Three numbers were circulating in my notes for one quantity.

**Untested hypothesis, not a finding:** Chittorgarh report rows are anchors with real hrefs, so one
report query might yield a rediscovered URL *and* `issue_category` together. Not probed. Not fact.

## 2026-09-10 18:53 IST - item 12 revised, and one relayed point rejected

Lane A found a real gap in my item 12 plan (issue #506). I reproduced it before accepting it.

**Held, and it changes the plan.** `normalized_name` is a *persisted* column on all three child
tables (`schema.ts:862`, `:1832`, `:1906`) under a UNIQUE on `(ipoId, normalizedName)`, and
`backfill-normalized-name.ts` covers exactly those three - 27+326+178 = 531 rows, matching their
count. So changing the matcher without recomputing those keys in the SAME pull request leaves a
window where every stored key is stale, the constraint guards nothing, and a live extraction
writes the duplicate the constraint exists to stop.

12-B therefore grows ~200 -> ~300 and absorbs the recompute and the duplicate re-scan. It stays in
band because those steps *run existing tools* - evidence, not new lines. No split needed.

**Rejected on evidence.** They also asked me to include an `ipos` `normalized_name` column in the
re-backfill. That column does not exist. The 22 references in `ipo-repository.ts` are a query-time
SQL expression over the live `companyName`, so nothing is stored and nothing can go stale. The real
`ipos`-side risk is the SQL twin drifting from the TS function - which 12-B already required in one
commit, free, because both live in `company-name-normalizer.ts`.

**I am overriding my own principle, deliberately.** My re-cut said a data write gets its own slice.
That rule stops an *independent* write being buried in a code review. This write is not independent:
it restores the invariant its own commit breaks.

**The 5 stay.** The duplicate baseline 0/0/5 - those 5 are correct rows, one bank holding two roles
on one issue. The three-column key exists to keep them. A repair that tidied them to 0 would be
destroying real data and calling it cleanup.

**Consequence I have to honour.** The re-compute guard is lane A's s8b under #506, so I build no
second one - which means 12-B carries `No detection change: guard owned by lane A item 1 slice s8b`.
That is only honest if s8b actually ships. A declaration pointing at a guard that never lands is a
paper check, and it would be my PR carrying it.

**Hazard nobody raised.** Five functions in this repo are named `normalizeCompanyName`. "Change the
normaliser" is ambiguous across five call graphs. 12-B touches `company-name-normalizer.ts` only.

## 2026-09-10 19:44 IST - 12-A built, proven, held (e5feea5c)

First slice of item 12. An **extraction, not a behaviour change**: the company-identity fold now
has one TypeScript home, `duplicate-ipo-merge.ts` keeps `foldCompanyName` as an alias to it, and
the `.mjs` hand copy is guarded by a parity test instead of by trust.

**Premise corrected first.** The plan said "three copies". There are two. The plausible third is a
genuinely different function whose own comment says it is kept independent *so that* slice 12-B
cannot silently change what a repair tool treats as the same company.

**Real-data proof - the one that matters, because this fold feeds a row-deleting repair:**

| database | named rows | distinct identities | collision groups |
|---|---|---|---|
| ipodhan | 333 | 333 | **0** |
| ipodhan_staging | 376 | 356 | 3 |

**Zero false merges across 709 real names.** All three staging groups are genuine same-company
duplicates, listed by name not count: ARCIL, H.R.Hygiene Products (4 rows), Shree Balaji (Mala)
Textiles (5 rows).

**Side finding:** staging carries duplicate IPO rows production does not - 11 rows whose slugs end
`-o`, `-p`, `-lt`, the status-code artefacts of #16. A real defect for 12-C, not a fold problem.

**Two false results I caught in my own work**, both the same shape - a green that meant nothing:
1. The first RED was false. The worktree had no `node_modules`, so the failure was vitest missing,
   not my module missing. Linked modules, re-established red honestly.
2. My first mutation silently failed to apply (sed did not match) and the test passed - proving
   nothing. Caught only because I diffed before believing the pass.

A test result is evidence only once you have proven the change you think you made actually landed.

## 2026-09-10 21:11 IST - what to do at 00:00 IST (budget reset)

CI count reads **58**, the cap. Nothing can merge before the reset. Six lane C branches are on
origin; the two merged ones (12-A, 12-C) have been deleted after verifying their content is
actually on main - squash merges are not ancestors, so ancestry checks lie here; I checked the
files exist at `origin/main`.

### Open in this order

| # | branch | tier | state |
|---|---|---|---|
| 1 | `fix/pm-c-item02-s3b-segment-provenance-repair` | A | built, proven, pre-flighted. Aggregate not stale (main 73 check entries, branch 73 + its one new). |
| 2 | `feat/pm-c-item02-s4-validate-at-process-start` | A | built, proven. Already sits on top of main's flag change (#476) - verified by ancestry, not assumed. |
| 3 | `feat/pm-c-item02-s5-seed-group-c-fields` | B | built, proven. Predates lane B's loader fix but its test reads the JSON via `fs` and never imports the loader. |
| 4 | `feat/pm-c-item12-sC2-not-yet-backfilled-outcome` | B | built, 7 unit tests, staging still reads 0. |
| - | `feat/pm-c-item12-sB-identity-rekey` | A | **NOT READY.** SQL twin owed. Do not open. |
| - | `fix/pm-c-item14-s2-bse-issue-size-residue` | A | held pending #482. Not ready. |

### 12-B, before anything else on it

Read `docs/contracts/plans/lane-c-12B-build-card.md`. The TS side and the agreement test are
committed; the agreement test is **red on purpose** and gives the SQL rewrite a verdict in seconds.
Two faults from the failed attempt, both recorded: the generated **nesting order was inverted**
(innermost runs first), and **static chunks after `${input}` were dropped** from the emitted SQL.
The generator produced correct double backslashes in Python yet the written file showed single, so
the halving happens at write time - that is where to look first. Dump `queryChunks` before touching
a database.

### Nothing here is DONE

Item 14 unproven (three named rows, two owners). Item 2 four merged, three held, one blocked.
Item 12 two merged, one WIP, two planned. Item 3 at zero, correctly - 3-S1 was measured wrong in
the card and its own proof would have passed.

## 2026-09-10 22:47 IST - both remaining item 12 pull requests merged; item 3 is next

**MERGED:** #520 (12-B) `3ffc9e19`, then #522 (12-E) `da8cad5a`. All five checks green on each
before either merge. The order was forced, not chosen - 12-E binds grey-market list rows on the
key 12-B defines, so merging 12-E first would have bound rows against a key that did not exist yet.

With #523/#524/#525 earlier, **every slice items 2 and 12 were PLANNED with is now on main.**

### That is not the same as done, and the difference is the whole point

- **12-B owes its staging read.** `node scripts/assert-repair-held.mjs normalized-name-current
  --cycles 2` after this deploys, plus the 544-row re-key run through
  `backfill-normalized-name.ts` **unchanged**. Never a SQL UPDATE: the SQL twin has no `junk:`
  branch and would collapse those rows to the empty string. Per the defect-fix contract the merge
  is HOW that proof is obtained; the gate that REQUIRES it is the release cut.
- **Item 2 has two live gaps**: 2-S3b2 is blocked (zero of 17 unprovenanced IPO rows carry a
  reachable page) and 2-S6 is NEW work from tonight's #515 finding, never part of the item.
- **12-D2 stays deferred** - CIN as an identity tier measures at ZERO effect on real data and
  contradicts `ipo-identity.ts:485`, where an exact-name match deliberately beats a key match.

### Next

Item 3, at zero. 3-S2 (writer fix + re-key `field_sources`) then 3-S3 (delete all 27, update
W-49). 3-S1 stays killed: it was measured wrong in the card and would have re-ranked 22 fields
under a proof that passed.

## 2026-09-10 23:17 IST - main went red on my own slice, and my own item 3 PR was wrong

Two hard things, both mine.

### 1. Main was red because #522 merged red. Fixed in #536.

The PR gate was **not** lying. Run 34506230714 genuinely ran
`investorgain-list-binding.test.ts` and genuinely passed it - 9 tests, inside a
279-file / 3531-test scraper suite. It passed because the branch was tested
against a base **without 12-B**. `chooseListBinding` calls
`normalizeCompanyNameForMatching`, which `data-persister.ts` only RE-EXPORTS from
`packages/shared/src/utils/company-name-normalizer.ts` - the file 12-B rewrites.
12-B merged, 12-E merged next, and the COMBINATION was never tested by anything.
Both PRs were green and both were correct on their own base.

**I got the diagnosis wrong once and told both peers so.** I checked
`data-persister.ts`'s own git history, saw 12-B had not touched that file, and
told them their causal story was wrong. It was right. Following the filename
instead of the import is what fooled me - the second time tonight a re-export or
an alias hid a real dependency.

BOUND is the correct answer, not merely the passing one: after 12-B both names
fold to `asset reconstruction` and they are the same company. The fair objection
(a generic two-word fragment could bind to the wrong company) is answered by a
new test: two exact matches returns AMBIGUOUS and never picks one.

### 2. #534 (item 3 slice 2) was wrong, and I closed it rather than salvage it

The Tier A reviewer found it; I reproduced every step before accepting it.

**The error:** I read `field_sources` as a CONSOLIDATION ledger. It is a
PROVENANCE ledger - `filing-persister.trackField` writes a row for any tracked
write, whatever path produced it. Every number I measured is real; the label was
wrong, and the entire RCA hung on the label.

**The fact that came out of it, which is worth more than the slice was:**
`FIELD_PRIORITY_MATRIX` governs **`ipos` writes only**. Every real call site
passes `tableName: 'ipos'`. `fresh_issue`/`ofs_issue` are written directly by
`filing-persister.ts:894,897`, gated on document type. So 3-S1, 3-S2 and 3-S3 are
all aimed at a narrower mechanism than the card describes.

**Why closed, not relabelled "pre-emptive config"** (which the review offered):
this PR's own argument for refusing entries for the other seven fields was that
dead config *reads as coverage* - the class item 3 exists to remove. Two inert
entries are that same defect at a smaller size. The principle does not exempt my
own two fields.

**Reversing myself again on 3-S1:** its deletion is runtime **safe**.
`profit_fy1`..`roe_percentage` appear nowhere in `scraper/src` outside the matrix.
It still fails, but on the W-49 explicit-registration guard - a design question,
not data loss. That is twice tonight I have changed my verdict on 3-S1, both
times because a new measurement beat the previous reasoning.

## 2026-09-10 23:23 IST - main green again

#536 merged at `0164e707`. All five checks green, verified against the CURRENT
main head rather than assumed (merge-base == origin/main at merge time), and the
previously-failing test re-run from a fresh main checkout afterwards: 11 passed
where there had been 9. Both peers told; #532 and the migration freeze unblocked.

**Rule adopted for the rest of this lane**, whatever the owner decides on branch
protection: no merge unless every check is green against the CURRENT main head,
re-run if main moved, and the merge line quotes the run URL. One command, and it
would have caught this.

## 2026-09-10 23:42 IST - 12-B repaired on staging; 3-D built, run and reverted

**12-B staging repair APPLIED.** 50 stale rows -> 0, idempotent on re-run. Cross-checked
before writing: the invariant module and the backfill dry run INDEPENDENTLY reported the
same 50 of 544. `assert-repair-held --cycles 2` still running - a clean read straight after
a repair proves nothing about surviving the next real scraper cycle.

**3-D built, run, REVERTED.** Full scraper suite: 6 files, 19 tests failed. The reachability
measurement was necessary but NOT sufficient - it proved nothing in PRODUCTION reaches those
27 keys, and missed a second consumer: the test suite, which encodes intent.
`data-consolidation-service.test.ts` passes snake_case names straight into
`consolidateIPOData` with `tableName: 'ipos'`; `field-priority-matrix-gmp.test.ts` pins
`gmp_percentage` as INVESTORGAIN_GMP-sourced, time-based and range-validated. That is live
GMP intent, not dead config.

Second time the full suite has stopped this deletion. Both the peer's ruling and mine were
wrong in the same direction: reasoning from a reachability measurement straight to a
deletion, neither of us checking the tests as a consumer.

**A silent fault in my own tooling, caught only by the before-snapshot:** the first deletion
swallowed `objectives`, a real camelCase key, because I matched entry blocks by string
search instead of brace counting - 49 keys where 50 were expected. Redone correctly, then
reverted from a .bak taken before the edit.

## 2026-09-10 23:51 IST - the 12-B proof passed, and I am not banking it

`assert-repair-held --cycles 2` exited 0: count 0 at both cycles. It is weaker
than that reads. The two cycles advanced the **scraper_logs marker only**; the
repaired tables were not written by them (`promoters` and `ipo_intermediaries`
last changed 2026-09-09T16:48Z, `peer_companies` 2026-06-17). A cycle that never
touches the repaired rows cannot refute the repair.

Not a tool bug - its header deliberately uses the whole-table marker to avoid
UNDER-counting cycles. But the mirror risk is real: it can OVER-claim on a repair
whose rows are written only by an occasional path.

**Two false alarms of my own, both withdrawn before reporting.** The marker
timestamps read 5h30m in the future and I was one step from declaring the proof
invalid and filing a tool defect. It is the known stored-timestamp skew - staging
labels rows ~5.5h behind real time. Watching for 90 seconds settled it: the logs
marker moved 12:46:30 -> 12:48:28 inside 50 seconds of real time, so the advances
were genuine.

**Item 12 honest state:** repair applied, invariant independently clean (50 -> 0,
idempotent, two tools agreeing before the write), assertion passed, and the
assertion does not cover the write path at risk. Closing it needs a cycle that
actually writes a promoter, peer or intermediary row.

## 2026-09-10 23:51 IST - item 3, three of five slices disproved

3-S1, 3-S2/3-D and 3-S4 all falsified by measurement. The card was written from
READING `field-priority-matrix.ts`, not from measuring the running system, and
every premise it states about something being dead describes something live.
Raised with the owner as a contract question: the completion condition names item
3, and only the owner can change that.

## 2026-09-11 00:06 IST - two corrections of my own, and 2-S6's class moved from 9 rows to 3

**I was wrong that nothing was buildable.** 2-S6 is lane C's own work and is
buildable now that 12-B waits on an event nobody can force.

**I was wrong about STALLION.** I told the peer, and wrote here and on the board,
that it is the #515 face-value class. It is not a live defect: production carries
band 85..90 and issue_size Rs1,99,00,00,000, updated 2026-09-06. STAGING still
holds band 10..10 and Rs4,33,20,000, untouched since 2026-07-01.

The consequence is larger than the correction: **staging's rows for these
companies are months behind production**, and item 14's proof of record is a
staging read. A proof read against stale data proves little about the live system.
NIRBHAY and PIYUSH are byte-identical across both slots, so they are genuine;
STALLION was the one row that differed and it is the one I got wrong. Live
production defect count is TWO, not three.

**2-S6's class is 3 rows, not 9.** Splitting by `offering_type`: the RIGHTS and
TENDER rows (MINOLTA, SI CAPITAL, MIDLAND, SHARP INDIA) all carry `issue_size = 0`
and are never measured by the floor check. MUTHOOT FINCOTP and STANBIK AGRO carry
a Rs1000 face value, where an NCD IS priced at face - so `band == face` is correct
and the defect is `offering_type`, a different fix with a different owner.

And of all nine rows, **exactly ONE produces a floor violation** (NIRBHAY). The
class actually bites `d_lot_band_window`. A 2-S6 written to drive the floor check
green would have aimed at the wrong signal for eight of its nine rows.

Both errors tonight came from the same habit: reporting a conclusion before
measuring the thing it rested on. I caught this one only because I measured across
BOTH databases before building on my own classification - which I nearly skipped,
since I "already knew" the class.

## 2026-09-11 00:13 IST - six premises stopped by measurement, and the pattern is the finding

Tonight's tally, in order: **3-S1, 3-S2/3-D, 3-S4, 2-S6, my own exemption fix, 2-S7.**
Five were specified by someone in a card; one was mine, thirty minutes old.

Every one failed the same test. It was written from reading code and config, and
the running system says something different:

| slice | the premise | what the system said |
|---|---|---|
| 3-S1 / 3-D | 27 keys are dead config | test suite feeds them deliberately; one carries live GMP intent |
| 3-S2 | 16 fields fall to DEFAULT_RULES | the matrix governs ONE table; those fields never reach it |
| 3-S4 | stale rows for a column that never existed | the FIELD is live - 209 of 223 written in seven days |
| 2-S6 | the band carries the face value | BSE published "10-10"; a real fixed price at par |
| my fix | add the missing FIXED_PRICE exemption | `issue_type` is NULL on every row - it would exempt nothing |
| 2-S7 | populate `issue_type` from the source | neither exchange publishes it, and DERIVING it is circular |

**The 2-S7 finding is the one to keep.** It is derivable from the price format,
and deriving it would make `checkDegenerateBookbuildingBand` a no-op for exactly
the rows it exists to catch - derive FIXED_PRICE from min==max, then exempt
min==max because it is FIXED_PRICE. Permanently green, defect live. Worse than
the inert exemption we started from, because it would look fixed.

**Lane C has no buildable slice I can defend tonight.** That is a measured
statement, not a waiting state: each candidate was scoped and stopped on evidence,
and each stop is recorded with the measurement that produced it.

## 2026-09-11 00:17 IST - item 2's staging proof OBTAINED; what each item is actually short of

Read-only ssh (logs + pm2 state, nothing run on the box). **Subject verified first**:
staging serves `20260910-182533-49733e06` and `merge-base --is-ancestor` confirms
2-S4, 2-S5 and 2-S3b are all in it. Staging had already fooled me once tonight
with a two-month-stale row, so the subject check is not ceremony.

Scraper pid 2623461 started 18:45:04Z from that release, normal startup and cycle
lines, `ENABLE_FIELD_MANIFEST` absent from staging's scraper.env (the default-OFF
condition), zero manifest/loader errors. **Proves the loader import does not throw
when the flag is off - exactly the card's claim, no more.** It does NOT prove the
validator works; with the flag off the validation never runs.

### What each item is short of - one line each

| item | short of | is it a waiting state or a wall? |
|---|---|---|
| 2 | 2-S3b2, a PLANNED slice | **wall** - its 17 closed rows have no reachable source |
| 12 | a price-band-ad extraction on staging | **wait** - real, but cannot be forced; may be days |
| 14 | its proof FAILS on NIRBHAY + PIYUSH | **wall** - both need a closed row's exchange source |
| 3 | the owner's decision | **decision** - three of five slices disproved |

**Three of the four are short of something no amount of working tonight reaches.**
That is not the same as a merge freeze and it is not impossibility either: it is
one structural fact (the exchanges publish only the current board) plus one
unforceable event plus one owner call.

## 2026-09-11 02:18 IST - catching this file up; it drifted two hours behind the board

A peer tick caught it: the header said 00:17 while the board said 01:40. I had been
writing STATE.json and the artifact board and letting this file lag. Fixed, and the
lag itself is the lesson - "written in the SAME turn as the board" is only true if
it actually is.

### Landed since 00:17

| what | result |
|---|---|
| **Item 2 staging proof** | **OBTAINED**. Subject verified FIRST by merge-base before reading a single log line. Proves the loader import does not throw with the flag off - exactly the card's claim, no more. |
| **14-S4** | **MERGED `941cb57b`**. The consistency check was reporting a bare "0 violation(s)" while examining **24 of 277** rows and skipping the exact two the floor check flags. It now states coverage and returns UNVERIFIABLE, never PASS, on zero examined. Three CI runs; two of the re-runs were genuinely justified. |
| **ARCIL duplicate** | **APPLIED on staging**, four self-verifications, rollback snapshot. Held-proof exit 0 across 2 cycles - with the caveat checked and stated: 9 ipos rows UPDATED in the window, **zero CREATED**, so the insert path at risk was not exercised. |
| **2-S7** | **DRAFT #569** - the pure mapper + captured fixture + 10 tests, no caller. 523 tests green, three mutations red. Write half left for a rested reviewer. |
| **Issues filed** | **#561** AAA TECHNOLOGIES stored MAINBOARD while NSE says SME (verified by name AND symbol). **#562** the unwired matcher pairs INJECTO POLYMERS with INDIA PESTICIDES on a shared `IPL`. |
| **Worktrees** | twelve removed, main checkout proven intact each time; one coordination tree left. |

### The corrections, which matter more than the landings

- **A proof I had already merged was wrong.** 12-A reported staging had **3** collision groups, "all three genuine". It has **13**. My own published arithmetic contradicted it - 376 rows minus 356 identities is 20 surplus; 2+4+5 is 8. The load-bearing claim survives (zero false merges; production 333/333/0, and all 13 groups checked, not assumed) but **the cleanup backlog is four times what anyone was sizing for**.
- **"The exchanges publish only what is currently open" was BSE-only evidence** stated as a plural structural fact. NSE publishes 1,431 historical IPOs and our own client already implements the endpoint. The wall is real but its reason was wrong, and it is now confirmed by **three** independent negatives.
- **"2-S7 is unblocked" and then "2-S7 is owner-gated" were both wrong.** I read a stale DRAFT header as current status. It is a dependency, not an approval - and it is not greenfield either: **my own four-day-old draft #367** already builds it.
- **I refused to build 2-S7 twice on a conflated risk.** Ten narrowed claims tonight were all ASSERTIONS ABOUT DATA; my actual code passed mutation testing both times. A high assertion-error rate is not evidence of a high code-error rate.

### Habits earned tonight, in order of what they saved

1. **Grep your own ledger for absolutes** - EVERY / ALL / NONE / NEVER / ZERO / only / cannot - and test what you did not measure. Found two false statements, one twenty minutes old, one inside merged work.
2. **List your own open PRs before scoping a slice.** #367 cost most of an hour.
3. **Check the served sha before any proof read** - and with `Cache-Control: no-cache`, since /api/version carries a one-year s-maxage and served lane B a stale sha two minutes after a flip.
4. **A row-level finding names its database.** Two sessions reported staging as production in one night, in opposite directions; one was a step from an owner-approved production deletion.

## 2026-09-11 02:40 IST - 2-S7 two commits in; a safety notice verified and half corrected

**#569 (draft):** `335235dc` the pure mapper + captured fixture + 10 tests;
`1b53add2` `fillIssueTypeIfNull` on the ONE live writer - `UPDATE ... WHERE ipo_id
AND issue_type IS NULL`, rowCount returned so provenance follows a real write and not
a no-op. 2172 tests green, tsc equal to main baseline with zero in the changed file,
and the mutation removing the guard turns the suite red BY NAME.

**The IS NULL guard is the entire safety argument.** `ipo_details` has no
source-priority mechanism: the matrix governs `ipos` only, and `dropOutranked` is
cover-versus-ad arbitration. Two mechanisms were claimed for this field tonight - one
mine, one the planner - and both were withdrawn after reading the code.

**Safety notice verified, and half of it corrected.** `consolidation-dedup` really does
read `web/.env.local`, build its own Pool and INSERT INTO `ipos` on production. Precise
severity: its DELETE is scoped to its own fixture name, so the defect is an unguarded
production INSERT, not destruction of real rows.

But the notice also named my `normalizer-sql-agreement` test. It does NOT match: never
reads a file, takes `process.env.DATABASE_URL`, skips when unset, reads no table. The
string `env.local` appears twice, BOTH IN COMMENTS saying it must never do that, because
I built it in 12-B to REPLACE the tunnel-reading one. A grep-based check would flag the
FIX as the defect - the same shape as a check keying on a field nothing populates.

## 2026-09-11 02:44 IST - 2-S7 third commit; one to go

`e7a45c88` **collectIssueTypesFromReport**, pure: takes records the scraper has ALREADY
parsed plus an anchor-stripper, returns (companyName, issueType) pairs. Composes with the
existing loop rather than changing its shape. 43 files / 528 tests green.

**It drops what it cannot read rather than defaulting it**, for a specific reason:
`issue_type` feeds a check that EXEMPTS FIXED_PRICE, so a wrong value there SILENCES a
defect instead of merely being wrong. Two mutations prove it.

**One commit left:** match by identity fold, call `fillIssueTypeIfNull`, write the
`field_sources` row only when rowCount = 1. That is the one that touches the database.

**Correction to my own commit message** on `e7a45c88`: it says 538 tests; the real number
is 528. Recorded rather than amended - a number in a commit message is exactly what nobody
re-checks, which is how the 3-versus-13 error survived six hours.
