# IPODhan work tracker

**Living document. This is the single source of truth for what is pending, what is running, and how far each item has moved.**
Owner rule (2026-09-08): nothing starts without Abhay's explicit approval. Fable updates this file every 30 minutes
with a status comparison against the previous 30-minute snapshot.

- **Progress %** = share of the six defect-fix-contract steps done: RCA, class stated, failing test, fix at class level,
  real-data proof, detection upgrade. Not started = 0%. Merged but proof still owed = 85%. Proven live = 100%.
- **Prev** = the value at the previous 30-minute snapshot. **Now** = current. A blank Prev means the item is new to the tracker.
- Status vocabulary: `APPROVED-RUNNING`, `AWAITING APPROVAL`, `BLOCKED`, `DONE`, `PAUSED BY OWNER`.

Last updated: 2026-09-08 12:0x IST (snapshot 1 — baseline).

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
**Effort:** ~half a day. **Status:** AWAITING APPROVAL. **Prev:** — **Now:** 0%

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
| Rentomojo price-band persist (#402, PR #423) | A filing that failed every 30 minutes on both slots now saves. Seven money columns widened; a guard refuses oversized values cleanly. | 85% | 90% | MERGED; proven on staging schema, cycle proof owed, not on prod until the next release |
| Lead managers persisted (#416, PR #417) | Every IPO whose exchange payload lists lead managers now stores them. Steamhouse repaired on prod. | 100% | 100% | DONE, proven across 2 real cycles |
| Band provenance on 85 prod IPOs (T-457) | Correct source records for price bands; stops false audit flags. | 100% | 100% | DONE, proven across 2 real cycles |
| Qualiance lot size (#415, PR #424) | Stops a false alarm and adds minimum-application as its own check. Stored lot unchanged. | 100% | 100% | MERGED |
| Automatic issue filing for new audit findings (#420) | New nightly problems become tracked issues without a human. | 100% | 100% | MERGED |
| Main branch re-tested on every code push (#421) | A bad merge is caught immediately, not at the next deploy. | 100% | 100% | MERGED |
| Lead-manager cache invalidation (#419, PR #427) | Lead-manager changes appear on the site immediately instead of up to 15 minutes later. | 80% | 100% | MERGED 97f90329, review PASS WITH NOTES |
| Steamhouse price-band unit (#403, PR #428) | A scanned advertisement whose rupee symbol was misread by OCR now parses, so the document stops failing every cycle. | 70% | 90% | MERGED 3f5e52d9, review PASS WITH NOTES, all 5 checks green; staging cycle proof owed |
| Sector from Chittorgarh (#394, PR #425) | Would populate the sector filter. | 40% | 60% | PAUSED BY OWNER — 3 major findings open |
| Prod repair skipped: stale correction table (#422) | Prevented a tool from erasing correct dates on a listed IPO. | — | 100% | DONE (issue filed, contract written, not started) |

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
