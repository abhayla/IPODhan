# IPODhan work tracker

**Living document. This is the single source of truth for what is pending, what is running, and how far each item has moved.**
Owner rule (2026-09-08): nothing starts without Abhay's explicit approval. Fable updates this file every 30 minutes
with a status comparison against the previous 30-minute snapshot.

- **Progress %** = share of the six defect-fix-contract steps done: RCA, class stated, failing test, fix at class level,
  real-data proof, detection upgrade. Not started = 0%. Merged but proof still owed = 85%. Proven live = 100%.
- **Prev** = the value at the previous 30-minute snapshot. **Now** = current. A blank Prev means the item is new to the tracker.
- Status vocabulary: `APPROVED-RUNNING`, `AWAITING APPROVAL`, `BLOCKED`, `DONE`, `PAUSED BY OWNER`.

Last updated: 2026-09-08 13:30 IST (snapshot 6 - owner comments O-4..O-7 added and approved).

---

## Part 0 — Owner comments, open for discussion

Raised by Abhay 2026-09-08 ~12:30 IST. Nothing here is started. Each is discussed one at a time; new comments are appended to this list as they come.

### O-1. Documents should not be re-scraped every 30 minutes — the frequency change was agreed and looks unimplemented

**Abhay:** "We already discussed about this not to scrape the documents every thirty minutes. We had discussed to increase the frequency. Not sure why it is not being implemented."

**What I found before we discuss (facts, not argument).**

- The scraper PROCESS still wakes every 30 minutes on production (`*/30 * * * *`) and at :15/:45 on staging. That part is unchanged, and it is what you are seeing.
- The agreed change WAS partly implemented and IS switched on in both environments: `ENABLE_DUE_STEP_SCHEDULER=true`. Under it, source DISCOVERY runs only at four fixed times a day — 08:30, 11:00, 14:00 and 17:30 IST (`scraper/src/scheduler/due-step-cycle.ts`), not on every wake.
- What still happens on every wake is document PROCESSING. Each wake walks the document queue; an individual document is protected by an exponential backoff (15 minutes doubling per attempt, capped at 6 hours) and by per-cycle budgets. So a given PDF is not re-downloaded every 30 minutes, but the queue is walked every 30 minutes.
- **Honest gap:** the wake interval itself was never changed, and nothing records what the agreed target interval was. Your read is fair — the visible behaviour is exactly what you asked to change.

**Options.** (1) Raise the wake interval itself, for example hourly or market-hours only. (2) Keep the 30-minute wake but make it a no-op outside the four discovery slots and outside market hours, so it costs nothing. (3) Leave as is.

**My recommendation:** option 2, because live subscription and grey-market figures genuinely do change during the day and a long flat interval would make those stale. I want your target number before proposing anything concrete.

**Status:** AWAITING DISCUSSION. **Prev:** — **Now:** 0%

### O-2. Store money in crore, not in rupees — and find every field this applies to

**Abhay:** "Change the fields to not store the exact amount, but store the values in terms of crores... instead of writing 999.99 crore in each digit, just write 999.99. That will save the fields. Identify all such fields where this needs to be applied."

**I got this wrong today and it needs saying plainly.** When you raised this mid-morning I read it two ways, flagged both, and chose the one that kept rupees and widened the columns instead. That shipped as PR #423. You meant the other one. The merged change is not harmful — it removes the crash either way — but it is not the design you asked for, and converting later costs more than doing it once now.

**What the audit found, and it strengthens your point.** The schema is ALREADY inconsistent:

- `financial_data` stores crore today and says so in its own comments: `market_cap`, `ebitda_fy2022/23/24`, `total_income_fy2022/23/24`, `total_borrowings` are all documented "in Rs crores".
- `ipos.issue_size` stores RUPEES, and says so: "in INR RUPEES".
- Two tables in the same database hold money in two different units. Any code reading one and comparing with the other is one mistake away from being wrong by a factor of ten million. That is a live risk today, independent of column width.

**Candidate fields to convert (amounts only).** `ipos.issue_size`; `ipo_details.fresh_issue`, `ofs_issue`, `min_investment`, `max_retail_subscription`, `max_employee_subscription`; `anchor_investors.total_amount_raised`; the `ipo_financials` revenue / total income / EBITDA / profit / net worth / operating cash flow / total assets / total borrowings columns; and the `financial_data` equivalents, which are already crore and become the reference rather than the change.

**Explicitly NOT candidates:** per-share prices (price band, listing price, current price, cut-off, face value, grey-market premium, tick size), percentages, subscription multiples, and share counts. Those are small by nature and are read as rupees per share; converting them would make them harder to read, not easier.

**Options.** (1) Convert every amount column to crore with a migration, a one-time data conversion, and a single formatting helper at the read side. Honest cost: it touches the public API shape, every page that formats money, the audit checks, and the provenance rows already written. (2) Leave storage in rupees and fix only the display. Cheapest, but it addresses neither the wasted width nor the mixed units. (3) Convert only the tables that are inconsistent, so at least one unit rule holds across the database.

**My recommendation:** option 1, done once, proven on staging before production — but as its own planned change, not a same-day patch, because it changes what our public API returns.

**Status:** AWAITING DISCUSSION. **Prev:** — **Now:** 0%

### O-3. A failed field must not fail the whole document, and must not retry in a loop

**Abhay:** "If something is crashing, are we not taking care of the errors and not crashing the application? An error should not break the website or that IPO's data. Maybe some of the data could not be extracted from the PDF, but that does not mean the extraction has failed. Keep that field blank, and get that field from other sources. There is no need to keep trying for the same field again and again and going into a loop of errors."

**You are describing exactly what happened today, and the diagnosis is correct.** Rentomojo's price band advertisement was read perfectly. One field, the fresh issue amount, did not fit its column. Because the save is a single all-or-nothing insert covering more than forty fields, NOTHING was saved: not the lead managers, not the dates, not the registrar, not the ISIN. The same document was then retried seven times, each time re-downloading and re-extracting a 1 MB PDF and failing on the same field. That is precisely the loop you describe.

**What is true today.** The failure is contained. It does not crash the site or the scraper, and the IPO page still renders. But a whole document's worth of data is discarded because of one field, and the retry loop wastes real work.

**Options.** (1) Partial persistence: write every field that is valid, record the rejected fields with their reason, and never let one bad field discard the rest; the missing field is then filled from another source on its normal schedule. (2) Pre-validate each field against its column before the write and drop only the offenders. Similar effect, much simpler than restructuring the write. (3) Keep all-or-nothing but stop retrying after the first non-transient failure, so at least the loop ends.

**My recommendation:** option 2 first because it is small and immediate, then option 1 as the real design. Both should carry your rule that a field which cannot be extracted stays blank and is sourced elsewhere rather than blocking the row.

**Status:** AWAITING DISCUSSION. **Prev:** — **Now:** 0%

### O-4. Why are most downloaded documents never extracted, and fix it

**Abhay:** "Why most documents are never extracted at all."

**Answer, measured on production today.** 172 stored documents are still unextracted. There are three separate reasons, and only one of them is a bug.

**Reason 1 — five document types have no extractor at all (78 documents).** The extractor understands exactly four types: the red herring prospectus, the draft prospectus, the prospectus, and the price band advertisement, plus a separate extractor for the anchor allocation report. Everything else is downloaded, stored, and never opened. Pending today: 32 "basis for offer price" ratio documents, 23 security parameter files, 14 sample application forms, 8 bidding centre lists, 1 basis of allotment advertisement. Of these, the ratio documents genuinely matter: they carry the key performance indicators, the weighted average cost of acquisition and the peer comparison. The basis of allotment advertisement carries the final allotment. Sample forms and bidding centres are low value and can stay unread.

**Reason 2 — the per-cycle budget is three (94 documents).** Each cycle extracts at most three filing documents plus one anchor report. With the queue walked in order and retries consuming slots, a backlog of 74 prospectuses, 19 red herring prospectuses and 1 draft prospectus never drains. These are all types the extractor DOES understand. This is the real bug and the biggest single win.

**Reason 3 — large scanned documents time out.** A single extraction is capped at 10 minutes. A 600-page scanned prospectus that needs character recognition can exceed it. This is why the Skyways document hard-failed.

**Options.** (1) Raise the per-cycle budget and give the backlog its own drain path, separate from the live-IPO queue, so a live IPO is never starved by history. (2) Add extractors for the ratio document and the basis of allotment advertisement; leave forms and bidding centres unread deliberately and say so. (3) Split large-document extraction onto its own longer budget instead of the shared 10-minute cap.

**My recommendation:** all three, in that order. Option 1 alone converts 94 already-downloaded documents into real data with no new parsing code.

**Status:** APPROVED by the owner. **Prev:** — **Now:** 0%

### O-5. The offer document must outrank every website in the source priority

**Abhay:** "Change the source priority so the offer document outranks every website for the fields it contains, instead of merely being one source among five."

**Today's order** puts a manual admin edit first, then the draft prospectus, then NSE, BSE, Moneycontrol, Chittorgarh, the grey-market source and an API fallback. In practice the websites win because they arrive first and the document path is throttled, so the field already holds a website value by the time the document is read.

**What changes.** For every field the offer document contains, the document becomes the highest non-admin source, and a website value can never overwrite a document value. Websites keep two jobs: filling fields no document contains, such as live subscription and grey market premium, and acting as the second opinion that triggers a re-read of the document when they disagree.

**Risk to manage honestly.** Some current values came from websites and are correct. Flipping the priority does not retroactively rewrite them; it changes which source wins on the next write. A separate, deliberate pass is needed to re-source existing rows from their documents, and that pass must be proven on staging first.

**Status:** APPROVED by the owner. **Prev:** — **Now:** 0%

### O-6. Switch SME document extraction on for production

**Abhay:** "Yes switch SME document extraction on for production."

Today the flag that lets SME candidates through the document path is on for staging and off for production. Every SME IPO on the live site therefore gets zero fields from its own offer document; each one is skipped with a ledger row and nothing is extracted. SME issues are a large share of the calendar.

The same code path is already proven: the SME walk passed in production on Qualiance International on 2026-09-04, and staging has run with the flag on since. There is no second write path and no relaxed check; SME goes through the identical door as mainboard, with the same admin protection and the same paired-document agreement gate.

**Honest risk.** With the flag on, a scrape can rewrite an SME IPO's static fields with no human in the loop. If an extraction is wrong, it writes wrong data to the live site. Mitigation: enable, watch the next two cycles by name, and revert with one line if anything writes a value the checks should have caught.

**Status:** APPROVED by the owner. **Prev:** — **Now:** 0%

### O-7. A language model only for the last stretch, under strict conditions

**Abhay:** "Language model, only for the last stretch, and under strict conditions."

Recorded as a standing constraint on all document-extraction work, not as a task. The conditions, as agreed:

- The model never writes a value directly. It proposes one, together with the page number and the exact sentence it read.
- Every existing arithmetic check must still pass. A proposed issue size must reconcile with shares multiplied by price, within tolerance, or it is rejected.
- A disagreement with a website sends the value back to the document for a re-read, never straight to the website's value.
- Every model-sourced value is marked as such in the provenance record, so its accuracy can be measured separately and it can be switched off without touching anything else.
- Deterministic extraction is always tried first. The model is only for fields where the value sits in prose or in a scanned table that pattern matching cannot read.

**Status:** STANDING CONSTRAINT, not started. **Prev:** — **Now:** 0%

---

## Part 1 — Root causes: why defects survived the tests and checks

These five are the *reasons* the feature defects in Part 2 exist. Fixing features without fixing these means the next
batch arrives the same way.

### C1. Tests validate data the author invented, not the real source
**What it is.** A test passes because it asserts against a fixture the same person created. Nothing ties the fixture to
reality.
**Evidence.** Today the sector test asserted "Vikran Engineering → Specialty Chemicals" and was green, but the saved page
was Neochem Bio's, filed under Vikran's name. Issue #133 is the same class at scale: 24 scraper tests built on hand-typed
mock HTML that no longer matches the live sites.
**Options.**
1. *Fixture provenance gate (recommended).* Every fixture file must carry a header line naming its source URL and capture
   date, and a CI check fails a PR whose new fixture lacks one. A second check asserts the fixture's own identity fields
   (title/company) match the filename. Cheap, deterministic, catches today's exact failure.
2. *Live-source contract tests.* A nightly job re-fetches each fixture's source URL and fails when the real page's shape
   has drifted. Catches drift too, but adds network flakiness and Actions minutes.
3. *Do nothing;* rely on reviewers noticing. This is what we do today, and it failed today.
**Recommendation: option 1 now, option 2 later only for the 3-4 fixtures that back money-carrying extractors.**

**APPROVED by the owner 2026-09-08 ~13:00 IST**, with the owner's own improvement folded in: fixtures are sourced FROM
the per-IPO document store that already exists () rather than
hand-saved, so provenance is automatic and the human step where the mistake happens is removed. Split into **T-518**
(provenance header, identity check, shrink-only backfill allowlist, sourcing helper, pr-gate step) — BUILDING now — and
**T-519** (revive the live-parser check as a nightly scheduled job; the answer to "why not just read the live sites") —
QUEUED. The three October-2025 BSE snippets are sized as a follow-up, not re-captured in T-518.
**Effort:** ~half a day + ~1 day. **Status:** APPROVED-RUNNING. **Prev:** 5% **Now:** 45% (T-518 built as PR #430 but Tier A FAILED it: CI is red and the new gate never executed there; six findings, two of which would break every PR in the repo; round 2 in progress. T-519 not started.)

### C2. Checks compare our data to itself, never to the outside world
**What it is.** Audits assert internal consistency. They cannot see that a correct-looking value is wrong.
**Evidence.** The nightly audit reported the sector column healthy for weeks because an empty string counted as filled
(fixed today inside PR #425). The a_b_live_conflict check that compares against an independent oracle is the only check
of this kind we have, and it is what caught the Qualiance lot-size question.
**Options.**
1. *Extend the independent-oracle comparison (recommended).* We already parse ipowatch for lot size, issue size and
   dates. Add the fields that visitors actually read — price band, listing date, listing gain, subscription — and report
   disagreements nightly by name.
2. *Second oracle.* Add a third-party source beyond ipowatch so two independent sources must agree. Stronger, roughly
   double the scraping surface and maintenance.
3. *Spot-check by hand each week.* No engineering cost, does not scale, and depends on someone remembering.
**Recommendation: option 1.** It reuses a working mechanism and turns "our data agrees with itself" into "our data agrees
with the market".
**Effort:** ~1 day. **Status:** AWAITING APPROVAL. **Prev:** — **Now:** 0%

### C3. Gates check shape, not substance
**What it is.** The write-ratchet counts files, the migration lint checks ordering, lint counts errors. All of them pass
on data that is entirely wrong.
**Evidence.** Every gate was green on the sector feature while it was capable of writing another company's industry
permanently. Nothing in CI can ask "does this produce the right value for a real IPO".
**Options.**
1. *Golden-record substance test (recommended).* Pin 5-8 real IPOs with hand-verified correct values for the fields that
   matter, and run one CI test that drives the real extractors against their real captured documents and asserts those
   values. When a change alters a golden value, the PR must state why.
2. *Full end-to-end pipeline test on a seeded database.* Broader, but it is the tier that is already broken (#252) and it
   would be slow on every PR.
3. *Accept the gap* and rely on the nightly audit after the fact. That is the status quo, and it means defects reach
   production first.
**Recommendation: option 1.** It is the only cheap way to make CI able to fail on a wrong value rather than a wrong shape.
**Effort:** ~1 day. **Status:** AWAITING APPROVAL. **Prev:** — **Now:** 0%

### C4. Signals existed but nobody read them
**Status: already fixed, 2026-09-07 to 2026-09-08.** Failures now resolve to named IPOs with issue numbers, nightly
findings open issues automatically for new problems only, and a register lists what is fixed in code but not yet live.
**Residual.** The first live night of automatic filing will record a baseline and file nothing; genuinely standing
failures will never be filed unless their details change. That is deliberate but worth knowing.
**Recommendation: no further work.** **Status:** DONE. **Prev:** — **Now:** 100%

### C5. Coverage is counted, not proven
**What it is.** We count tests. We never check that a test would fail if the code it guards were deleted.
**Evidence.** Issue #369: a security guard in the environment-check script can be neutralised with the entire suite still
green. Issue #196 is the standing job to find more of them; PR #368 (draft) measured one guard and found it a survivor,
with seven more never run.
**Options.**
1. *Finish the mutation sweep (recommended).* Complete PR #368's run over the eight registered guards, fix every
   survivor, and schedule the sweep nightly rather than on every PR (it takes minutes, not seconds).
2. *Full mutation testing on the codebase.* Far stronger, and far too slow and noisy for this repo today.
3. *Leave it.* We keep shipping guards that do not guard.
**Recommendation: option 1.** The tool already exists in a draft PR; it needs a full run and the survivors fixed.
**Effort:** ~1 day including fixing survivors. **Status:** AWAITING APPROVAL. **Prev:** — **Now:** 25% (tool built, 1 of
8 guards measured)

---

## Part 2 — Pending features

### Group A — Pages showing fake or broken content to real visitors

| Item | What a visitor sees | Prev | Now | Status |
|---|---|---|---|---|
| A1 Affiliates page broken (#97) | An error box instead of the broker list. This is the path to demat signups, so it is the revenue page. | — | 0% | AWAITING APPROVAL |
| A2 Landing metrics fabricated (#98) | A 60/40 gain split and 25%/15% figures that are hardcoded constants, not computed from data. | — | 0% | AWAITING APPROVAL |
| A3 Performance trackers show demo data (#96) | Invented companies with future "listed on" dates, labelled as a demonstration. | — | 0% | AWAITING APPROVAL |
| A4 Registrars directory polluted (#94) | About 28 dummy rows (Alpha Registrar, Beta Registrar) with fake contact details. | — | 0% | AWAITING APPROVAL |

**Options for Group A.**
1. *Fix all four as one batch (recommended).* They share a cause: seed and placeholder data that reached production, plus
   one page whose data source fails. One release, one review, one deploy window.
2. *Fix A1 only now.* It is the revenue path. The other three are trust damage but not revenue.
3. *Hide rather than fix.* Remove the fabricated sections from the pages until real data exists. Fastest, and honest,
   but the pages lose content.
**Recommendation: option 1, with option 3 as the fallback for A2 if computing the real figures turns out to need data we
do not have.** A site whose purpose is accurate IPO information cannot show invented companies.
**Effort estimate:** 1-2 days for the batch.

### Group B — Missing data across the IPO catalogue

| Item | What a visitor sees | Prev | Now | Status |
|---|---|---|---|---|
| B1 Blank fields and empty graphs across ~285 IPOs (#89) | Detail pages with "NA" where financials, objectives and peers should be. | — | 0% | AWAITING APPROVAL |
| B2 Sector empty everywhere (#394, #343, #73) | The sector filter has no real options on any page. | — | 60% | PAUSED BY OWNER (PR #425 open, 3 major findings unfixed) |
| B3 142 of 167 IPOs stuck at "closed" (#70, #72) | No listing date and no listing gain, ever, for most listed IPOs. | — | 0% | AWAITING APPROVAL |
| B4 Listing performance writes fail on every row (#139) | The listing-gain data that B3 would display is never stored. 243 of 243 rows fail. | — | 0% | AWAITING APPROVAL |
| B5 Reviews, scores, anchor investors unwired (#167) | Features that exist in code but are removed from navigation. | — | 0% | AWAITING APPROVAL |
| B6 Subscription figures under-report (#153) | We show 7.95x where the exchange closed at 21.69x. | — | 0% | AWAITING APPROVAL |
| B7 Company description empty (#69) | No "about this company" text on any IPO. | — | 0% | AWAITING APPROVAL |

**Options for Group B.**
1. *Fix the listing chain first: B4 then B3 (recommended).* B4 is a write that fails 100% of the time, which is a single
   defect with a single cause, and B3 depends on it. Together they restore listing gain for roughly 142 IPOs, which is the
   single most-read number on an IPO site after the price band.
2. *Fix B1 first (breadth).* Touches the most pages, but it is really several separate extractors and would take longest.
3. *Finish B2 first* since it is 60% done. Its remaining work is three real defects including one that makes the live
   path write nothing.
**Recommendation: option 1, then finish B2, then B6, then B1.** B6 is a correctness error on a number people trade on; a
wrong subscription figure is worse than a missing one.
**Effort estimate:** B4+B3 about 2 days; B2 remaining about half a day; B6 about 1 day; B1 several days.

### Group C — Pipeline correctness

| Item | Impact | Prev | Now | Status |
|---|---|---|---|---|
| C-a Discovery missed a real IPO for 4 days (#356) | Karamtara was live and invisible on the site for four days. | — | 0% | AWAITING APPROVAL |
| C-b Issue size not refreshed when the issuer changed it (#349) | Karamtara cut from 1,750 Cr to 875 Cr; we kept the old figure. | — | 0% | AWAITING APPROVAL |
| C-c Cross-company numeric clone (#178) | One company inherited another company's exact figures. Root cause still unknown. | — | 0% | AWAITING APPROVAL |
| C-d Stale "open" status on non-IPO rows (#147) | Rights issues and debentures show as open past their close date. | — | 0% | AWAITING APPROVAL |

**Options for Group C.**
1. *Investigate C-c first (recommended).* It is the only one whose root cause is unknown, and a value silently copied
   between companies is the most dangerous defect class on the site: it looks completely normal.
2. *Fix C-a and C-b first.* Both are about a live IPO being wrong or missing, which visitors notice sooner.
3. *Defer the whole group* until Groups A and B are done.
**Recommendation: option 1 for the investigation only (a day, no code), then C-b, then C-a.**

### Group D — Infrastructure risk

| Item | Impact | Prev | Now | Status |
|---|---|---|---|---|
| D1 Prod and staging share one Redis, unnamespaced (#151) | A staging write can serve a production visitor and the reverse. Silent, and hard to trace after the fact. | — | 0% | AWAITING APPROVAL |
| D2 Health endpoint is CDN-cached (#138) | A real database outage still returns "healthy" to external monitoring. We would learn about downtime from a visitor. | — | 0% | AWAITING APPROVAL |

**Options for Group D.**
1. *Fix both (recommended).* D2 is small: exclude the health path from caching and verify with a real request. D1 needs
   slot-namespaced cache keys and a careful rollout, since changing key shapes invalidates everything at once.
2. *D2 only now, D1 in a planned window.* D1's rollout briefly empties the cache and raises database load.
**Recommendation: option 2.** D2 today because it is cheap and it protects every future incident; D1 as a planned change
in a deploy window with the cache warm-up understood.

### Group E — Test and tooling debt

| Item | Impact | Prev | Now | Status |
|---|---|---|---|---|
| E1 42 failing unit tests in 8 files (#109) | The suite has permanent red that people learn to ignore. | — | 0% | AWAITING APPROVAL |
| E2 Integration tier broken (#252) | 12 files fail against an empty test database; the tier never runs. | — | 0% | AWAITING APPROVAL |
| E3 Guard survives deletion (#369, #196) | See root cause C5. | — | 25% | AWAITING APPROVAL |
| E4 Shared-package module resolution bug (#392) | One repair tool cannot be run at all. | — | 0% | AWAITING APPROVAL |
| E5 24 tests on drifted mock HTML (#133) | See root cause C1. | — | 0% | AWAITING APPROVAL |

**Recommendation: E1 and E2 only if we adopt root cause C3's golden-record test, since that test needs a working
integration tier. Otherwise this group can wait.**

---

## Part 3 — In flight and completed today (2026-09-08)

| Item | What it does for users | Prev | Now | Status |
|---|---|---|---|---|
| Rentomojo price-band persist (#402, PR #423) | A filing that failed every 30 minutes on both slots now saves. Seven money columns widened; a guard refuses oversized values cleanly. | 90% | 90% | MERGED; columns verified widened on staging; the failed document sits at 7 of 10 retries and has not been re-attempted yet, so the row is still empty — proof pending its next retry |
| Lead managers persisted (#416, PR #417) | Every IPO whose exchange payload lists lead managers now stores them. Steamhouse repaired on prod. | 100% | 100% | DONE, proven across 2 real cycles |
| Band provenance on 85 prod IPOs (T-457) | Correct source records for price bands; stops false audit flags. | 100% | 100% | DONE, proven across 2 real cycles |
| Qualiance lot size (#415, PR #424) | Stops a false alarm and adds minimum-application as its own check. Stored lot unchanged. | 100% | 100% | MERGED |
| Automatic issue filing for new audit findings (#420) | New nightly problems become tracked issues without a human. | 100% | 100% | MERGED |
| Main branch re-tested on every code push (#421) | A bad merge is caught immediately, not at the next deploy. | 100% | 100% | MERGED |
| Lead-manager cache invalidation (#419, PR #427) | Lead-manager changes appear on the site immediately instead of up to 15 minutes later. | 80% | 100% | MERGED 97f90329, review PASS WITH NOTES |
| Steamhouse price-band unit (#403, PR #428) | A scanned advertisement whose rupee symbol was misread by OCR now parses, so the document stops failing every cycle. | 92% | 92% | MERGED 3f5e52d9, live on staging since 12:2x; its document is due for its next attempt at 16:52 IST, which is the proof |
| Sector from Chittorgarh (#394, PR #425) | Would populate the sector filter. | 40% | 60% | PAUSED BY OWNER — 3 major findings open |
| Prod repair skipped: stale correction table (#422) | Prevented a tool from erasing correct dates on a listed IPO. | 100% | 100% | DONE (issue filed, contract written, not started) |
| NEW — failure tracker over-reports (#429) | The tool every tick relies on reported Rentomojo as still failing when its last real failure was 9 hours earlier. It scans a log window, not current state, so a working fix looks unfixed. | — | 0% | AWAITING APPROVAL |

---

## Part 4 — Tonight's deploy decision (needs Abhay)

The release branch `release/prod-2026-09-08` was cut this morning at commit 95b329cc, before today's fixes.

- **Keep the cut as approved.** Ships 14 live IPOs that production cannot currently show, including two open issues and
  the National Stock Exchange listing. Today's merged fixes wait for tomorrow. Lowest risk.
- **Re-cut at today's tip around 18:00.** Everything above plus today's merged fixes go live tonight. Soak drops from a
  full day to about three hours, with a fresh hosted gate run.
- **Defer entirely.** Nothing changes for visitors; the 14 missing IPOs stay invisible another day.

**Recommendation: keep the cut as approved.** The 14 missing IPOs are the user-facing win and they are already proven;
today's merged fixes are internal correctness that can wait one day and get a full soak.
