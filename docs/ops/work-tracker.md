# IPODhan work tracker

**Living document. This is the single source of truth for what is pending, what is running, and how far each item has moved.**
Owner rule (2026-09-08): nothing starts without Abhay's explicit approval. Fable updates this file every 30 minutes
with a status comparison against the previous 30-minute snapshot.

- **Progress %** = share of the six defect-fix-contract steps done: RCA, class stated, failing test, fix at class level,
  real-data proof, detection upgrade. Not started = 0%. Merged but proof still owed = 85%. Proven live = 100%.
- **Prev** = the value at the previous 30-minute snapshot. **Now** = current. A blank Prev means the item is new to the tracker.
- Status vocabulary: `APPROVED-RUNNING`, `AWAITING APPROVAL`, `BLOCKED`, `DONE`, `PAUSED BY OWNER`.

Last updated: 2026-09-08 16:06 IST (snapshot 15 - E-1 applied to the full timetable family, 12 fields; 3 anchor fields found that the first pass missed; O-11 logged on the duplicate listingExchange provenance key).

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

**Status:** DONE, MERGED as 9db4529d after two rounds and a Tier A review. The offer document now outranks every website on the fields it prints. Two traps the review caught and the fix closed: a wrong document value would have become permanently uncorrectable (a newer document can now heal an older one), and a re-extraction of an old draft could have overwritten a final price-band advertisement (document types are now ranked PRICE_BAND_AD/CORRIGENDUM > RHP > PROSPECTUS > DRHP). Timeline dates deliberately keep the exchanges first, because a printed advertisement is never reissued when a bidding window is extended. Full staging-cycle proof owed. **Prev:** 0% **Now:** 90%

### O-6. Switch SME document extraction on for production

**Abhay:** "Yes switch SME document extraction on for production."

Today the flag that lets SME candidates through the document path is on for staging and off for production. Every SME IPO on the live site therefore gets zero fields from its own offer document; each one is skipped with a ledger row and nothing is extracted. SME issues are a large share of the calendar.

The same code path is already proven: the SME walk passed in production on Qualiance International on 2026-09-04, and staging has run with the flag on since. There is no second write path and no relaxed check; SME goes through the identical door as mainboard, with the same admin protection and the same paired-document agreement gate.

**Honest risk.** With the flag on, a scrape can rewrite an SME IPO's static fields with no human in the loop. If an extraction is wrong, it writes wrong data to the live site. Mitigation: enable, watch the next two cycles by name, and revert with one line if anything writes a value the checks should have caught.

**Status:** DONE and already producing data. Enabled on production 13:3x with a dated backup. First result read at 14:15: SME IPOs holding a document-sourced field went 0 -> 2, and the overall document share moved 8.4% -> 8.9%. At 14:45 it is 3 SME IPOs and 9.0%, rising cycle by cycle without further intervention. Qualiance International now carries lead managers, registrar, ISIN, CIN, face value, allotment date, issue type and three financial figures from its own offer document. **Prev:** 0% **Now:** 100% (watching)

### O-7. A language model only for the last stretch, under strict conditions

**Abhay:** "Language model, only for the last stretch, and under strict conditions."

Recorded as a standing constraint on all document-extraction work, not as a task. The conditions, as agreed:

- The model never writes a value directly. It proposes one, together with the page number and the exact sentence it read.
- Every existing arithmetic check must still pass. A proposed issue size must reconcile with shares multiplied by price, within tolerance, or it is rejected.
- A disagreement with a website sends the value back to the document for a re-read, never straight to the website's value.
- Every model-sourced value is marked as such in the provenance record, so its accuracy can be measured separately and it can be switched off without touching anything else.
- Deterministic extraction is always tried first. The model is only for fields where the value sits in prose or in a scanned table that pattern matching cannot read.

**Status:** STANDING CONSTRAINT, not started. **Prev:** — **Now:** 0%

### O-8. The write path is push, not pull — the priority list is a tie-breaker, not a shopping list

**Raised by Abhay 2026-09-08 ~14:0x IST**, describing the logic he expects: for each IPO, loop every field; if that field's default source is the offer document, take it from the document; otherwise take it from the next source; and in every case verify the final value against Chittorgarh and the other IPO websites.

**What we actually built is the opposite shape, and this is the root cause under O-4 and O-5.**

No loop over fields exists. Each scraper wakes on its own schedule, scrapes whatever IPOs it can see, and calls one function — `DataConsolidationOrchestrator.consolidatedUpsertIPO(scrapedIPO, source, confidence)` — with exactly ONE source at a time. That function compares the arriving value against what is already stored, looks both sources up in `field-priority-matrix.ts`, and keeps the higher-ranked one (`data-consolidation-service.ts` ~1909, reason `SOURCE_PRIORITY`).

**The consequence, stated plainly.** The priority list only decides a contest between sources that both happened to arrive. If the document extractor never runs for an IPO, the document's value never enters the comparison, so its rank is irrelevant. Production proves it: the offer document is ALREADY ranked first for issue size, and it supplied the value 4 times against the websites' 277. The websites do not win an argument. They win by being the only source that showed up.

**Verification against other websites is not in the write path at all.** It happens hours later in a nightly audit, covers three fields, and has no feedback into the data. There is no step where a disagreement sends us back to that IPO's document to re-read the value. That loop does not exist.

**On segment.** The priority list is per field, not per segment. There is no mainboard branch and SME branch. SME differed only in a single switch that skipped SME IPOs at the document step entirely — turned on for production on 2026-09-08 (O-6).

| Abhay's model | What the code does today |
|---|---|
| Loop each IPO, then each field | No loop; each scraper pushes what it happened to find |
| Fetch from that field's default source | Wait and see which sources arrive |
| Fall back to the next source | The fallback is whatever else arrived |
| Verify against other websites | Separate nightly audit, three fields, no feedback |
| A disagreement sends you back to the document | Does not exist |

**Options.**

1. **Build the pull model as described (recommended, as a designed piece of work).** For each IPO, the pipeline first asks which fields the offer document can supply, ensures those are read from the document, and only then lets websites fill what is left. A website disagreement then triggers a re-read of that specific value from that IPO's document. This is what makes the offer document genuinely primary rather than nominally first in a list.
2. **Keep push, and force the document to always arrive.** Drain the backlog, raise the extraction budget, and add a rule that a field with a document source pending is not written by a website until the document has been tried. Cheaper, and it gets most of the benefit, but it leaves the trust order implicit rather than explicit and still has no re-read loop.
3. **Leave as is** and rely on the priority list plus the nightly audit. This is today, and today is 8.4%.

**Honest cost note.** Option 1 is a redesign of the write path, not a configuration change. It touches how every value on the site is written, so it needs a design agreed before any code, a staging proof, and a Tier A review. The three tasks already in flight (T-520 priority, T-521 backlog, T-522 SME) remove real blockages and are worth having either way, but none of them turns push into pull.

**The design is written and is waiting for you to read it.** `docs/design/data-sourcing-pull-model.md`,
branch `docs/pull-model-design` (2d59f3d2). Design only — no implementation code, nothing under
`scraper/src`, `web/` or `packages/shared/src` was touched. It covers the field mapping for all 194
populated published fields with priorities 1–3 and per-type exceptions, the pull loop, the re-read
loop, a verification check for every step, O-1 to O-5 and O-7 folded in, the migration path, and the
parts I am not sure about.

**What the measurement changed about the diagnosis.** Documents supply 9.0% of provenance rows
overall — but 2.8% of the `ipos` table and **100% of every other table** (`financial_data`,
`ipo_details`, `ipo_valuation`, `financial_statements`, `ipo_risk_factors`, `documents`,
`ipo_intermediaries`, `promoters`, `peer_companies`). Where the document path runs it already wins
everything it touches; it runs on 27 of 327 IPOs. This is a reach problem, not a ranking problem,
which is why O-5's priority flip alone was never going to move the number.

**Four more measured findings:** 130 of the 194 populated published fields have no entry in the
priority matrix at all; 228 of 327 IPOs sit outside the 10-day document window with their PDFs
already purged; money is stored in four different units across six tables, not two; and the live
site publishes Annu Projects' FY2024 income when its own document reports FY2026, a figure we
already hold.

**Status:** DESIGN COMPLETE, awaiting your read. Zero findings open (45 fixed, 11 deferred with a named trigger, 1 deliberately not done); every finding needing code names a build item in §7.1. Section 0.0 is the owner-decision register and checks D10/D10b/D10c/D11 enforce it - run `node docs/design/check-design-consistency.mjs` (14/14). No owner call blocks the design: O-1, O-2, O-3 and O-7 stay open and only O-2 blocks a build item (11). **Prev:** — **Now:** 100%
blocking a scoped implementation — see below. **Prev:** 0% **Now:** 60% (design done; approval and
the target-metric decision outstanding)

### O-9. The target is 100% of the fields the offer document prints — RESOLVED

**Abhay, 2026-09-08 ~15:5x IST:** "Target should be 100%. If the field value comes from offer
document then it should be extracted from offer document. In second round, all first round correct
data should be retained and for incorrect and incomplete data, second source should be checked. Then
in 3rd round, all second round correct data should be retained and for incorrect and incomplete
data, third source should be checked."

**I had this wrong and the correction is right.** I proposed 90% of a chosen denominator. A blended
percentage is the wrong instrument: at "90%" nobody has to say WHICH 10% a website is still
supplying, and the worst fields hide inside a good average indefinitely. The rule is per field, not
an average — if the document prints it, the document supplies it, and every fall-through is a named
exception with a reason.

**The three-round model is now the governing shape of the design** (§2.1 of
`docs/design/data-sourcing-pull-model.md`): round 1 the offer document, round 2 the exchange, round 3
the website; each round works only on what the previous left INCORRECT or INCOMPLETE, and a correct
value is frozen — a later round is never even asked. That is stronger than a priority list, because
a priority list only helps when two values collide, which is exactly why the O-5 flip moved nothing.

**Measured on a real IPO** (Deepa Jewellers, the best-covered on production): 61 tracked fields, 47
already from its own document. Of the 14 it does not take from the document, **9 are printed in the
filing and lost to BSE or Chittorgarh anyway** — company name, lead managers, lot size, registrar,
symbol, price band low and high, segment, offering type. Those 9 are precisely what the three-round
model recovers.

**Status:** RESOLVED, folded into the design. **Prev:** 0% **Now:** 100%

### O-10. The whole bidding timetable stays on the exchanges — RESOLVED as named exception E-1

**Abhay, 2026-09-08:** "Keep those five on the exchange, as a written, named exception to the 100%
rule. For these fields, make NSE and BSE as first and second source." Then: "List the full timetable
family for me to see and understand. Apply the same rule to all the timetable fields."

**Applied to twelve fields.** Source order for all of them: round 1 **NSE**, round 2 **BSE**, round 3
Chittorgarh. The offer document is not a source at any round, and deliberately not a verification
source either — a printed date and an extended date legitimately differ, so comparing them would
produce a permanent stream of false disagreements and bury the real ones. Verification is the other
exchange plus our own date arithmetic.

The family was established by testing every date- and schedule-like field among the 194 published
fields against one question: **does this value change when the bidding window changes?**

| # | Field | Rows | Source today | Effect |
|---|---|---:|---|---|
| 1 | `anchor_investors.bid_date` | 2 | document | flips |
| 2 | `ipos.open_date` | 289 | 236 web · 50 exch · 3 doc | websites demoted to round 3 |
| 3 | `ipos.close_date` | 289 | 237 web · 49 exch · 3 doc | as above |
| 4 | `ipos.allotment_date` | 289 | 234 web · 49 exch · 6 doc | 6 document values flip |
| 5 | `ipo_details.basis_of_allotment_date` | 3 | 100% document | flips |
| 6 | `ipo_details.initiation_of_refunds_date` | 7 | 100% document | flips |
| 7 | `ipo_details.credit_of_shares_date` | 3 | 100% document | flips |
| 8 | `ipos.listing_date` | 289 | 238 web · 51 exch | websites demoted |
| 9 | `anchor_investors.lock_in_50_percent_date` | 2 | document | flips — allotment + 30 days |
| 10 | `anchor_investors.lock_in_remaining_date` | 2 | document | flips — allotment + 90 days |
| 11 | `ipos.status` | 289 | 230 web · 56 exch · 3 doc | websites demoted |
| 12 | `ipos.listing_exchanges` | 208 | 161 web · 23 exch · 24 doc | 24 document values flip |

**Three fields I had missed in the first pass**, all in `anchor_investors`: the anchor bidding date
and the two lock-in expiry dates. The lock-ins are computed off the allotment date, so when the
allotment date moves they are wrong by exactly the same amount.

**Two judgement calls made inside your instruction, flagged not silent.**
`ipo_details.upi_cutoff_time` (9 rows) and `ipo_details.bid_windows` (10 rows) sit in the same
printed timetable but hold a **time of day, not a date** — when a window is extended the date moves
and 5 PM is still 5 PM. They stay document-first. Putting fields into an exception list that the
exception's reason does not cover is how such a list becomes a dumping ground. Two-row change if you
want them included for consistency.

Also staying document-owned, because they record history rather than schedule:
`documents.filing_date` (the RoC filing date never moves, and the document-type healing rule depends
on it), `brlm_track_record.as_of_date`, and `ipo_details.designated_exchange`.

E-1 is counted, not hidden: the nightly check prints the twelve excluded fields beside the round-1
yield, and alarms if the set is ever not exactly those twelve.

**Status:** RESOLVED and applied in full. **Prev:** 0% **Now:** 100%

### O-11. Two provenance keys for one concept — `listingExchange` vs `listingExchanges`

**Found by me while building the timetable family, 2026-09-08.** `field_sources` holds
`ipos.listingExchange` (224 rows) and `ipos.listingExchanges` (208 rows). Only the plural matches a
real column; the singular has been writing provenance for a column that does not exist. Any
per-field report on that concept is split across two names and each shows about half the truth.

Small and not urgent, but it is exactly the kind of thing that gets rediscovered six months later.
Folded into the matrix cleanup already planned in the design (§7.1 item 2), alongside deleting the
13 dead snake_case matrix keys.

**Status:** LOGGED, folded into planned work, no separate decision needed. **Prev:** — **Now:** 0%

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
**Effort:** ~half a day + ~1 day. **Status:** PARTLY DONE. **Prev:** 45% **Now:** 70%. T-518 MERGED as 8b9e63cf after three rounds and two Tier A reviews: a saved page must now record its source and capture date, a page saved under the wrong company fails the PR, the escape hatch is ratcheted so it cannot grow silently, and exchange-style titles no longer fail good work. I verified each of those with my own probes AND read the pipeline this time. NOT done: the 53 existing fixtures are grandfathered, the identity check runs on zero of them in steady state, and replacing one of their contents does not trigger it - the backfill is T-523, queued. T-519 (nightly live-parser check) not started.

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

---

## Pull-model implementation-ready run — updates

Plain-language progress on taking the data-sourcing design from "complete" to "an engineer can build
from it without asking a question". No behaviour ships from this run — it is design and evidence only.

| Time | What it means for the site | Previous | Now | Notes |
|---|---|---|---:|---:|---|
| 09:57 | **Your Tuesday decisions are now written into the design and enforced by a command, not by trust.** The scraper's schedule (three data runs a day, live figures every half hour while bidding is open, old IPOs at ten at night), crore as the money unit, and one-bad-field-does-not-lose-the-row are all in the document, and four new checks fail the build if a later edit contradicts any of them. | 0% | 100% (of stage 1 of 7) | Every one of the four new checks was deliberately broken first to prove it actually fires — one of them caught a mistake of mine within a minute of being written |
| 09:57 | **Two things that would have bitten the implementer are fixed.** The table of 240 fields had no generator committed anywhere, so the rule "never hand-edit that table" was unenforceable; it now has one. And a helper file was silently writing junk files into the repository every time a check ran. | — | fixed | The stray file called `--gate` sitting in your main folder was that bug |
| 09:57 | **One decision came back to you.** Five money columns are amounts, but showing them in crore would read as "0.0015" on the page — the minimum application, the two application limits, and the two grey-market rates. Recommendation: keep those five in rupees as named exceptions. Work continues on that recommendation; the design is marked so you can overrule it in one place. | — | awaiting you | Recorded as O-12 |
| 10:31 | **The design now has an evidence trail instead of assurances.** Every source the scraper uses was called for real and its answer saved: NSE, BSE, Chittorgarh, InvestorGain, and the real PDF extractor run on four real offer documents. 105 of 387 source rankings are now backed by a payload we hold, and the build fails if that number ever falls. | 0% | 27% of rankings backed | The first version of the matcher claimed 231 — its "evidence" included matching the registrar to a plausibility check and the grey-market premium to a page title. Tightened three times; every remaining match records the exact label it matched |
| 10:31 | **Two real IPOs walked end to end.** Asset Reconstruction (mainboard, open now) and Vinod Texworld (SME, open now), field by field, with every value read from production or from a saved payload — none typed. On Asset Reconstruction, 149 of 240 published fields are empty right now. That is the number this work exists to move. | — | done | Regenerate any time with one command |
| 10:31 | **Fourteen of eighteen build cards written**, each naming the exact files, schema, tests, staging proof line and rollback. Four still being written. | 0% | 78% | The card authors found three places where the design was wrong about our own code — including one where my own instruction to them was wrong |
| 10:31 | **A second decision came back to you.** On Monday you approved taking the grey-market premium out of the market-hours gate, because it was going stale for up to 65 hours over a weekend. Tuesday's cadence decision, read literally, puts it back in. Recommendation: keep subscription and the demand graph to bidding hours, but fetch the grey-market premium in each of the three daily runs and the ten o'clock run too, so it never freezes overnight. | — | awaiting you | Recorded as O-13 |
| 10:54 | **Three independent reviews were run against the design, and they found 26 problems — 13 serious ones.** All 13 are now closed or handed back to you as a decision. The most important: five of them were the same mistake, where the machine that checks "does this source really carry this field" was matching words rather than meaning — citing a share count as a rupee amount, and the offer document's promoter as the registrar. | — | closed | The evidence count fell from 105 to 72 as a result. 72 is the first number that has survived somebody trying to break it |
| 10:54 | **A live data trap found and written down.** The stock exchange's own share count for an IPO leaves out the anchor investors' portion. Anyone computing the issue size from it would publish a number a third too small — Rs 487 crore instead of Rs 733 crore for the IPO that is open today. Our stored figure is correct; the trap is now recorded so nobody rebuilds it. | — | recorded | F-98 |
| 10:54 | **Honest gap: the run did not reach "zero open findings".** Eighteen remain, all medium or low, each with a named owner. The design is materially stronger than this morning, and it is not finished. | — | 18 open | Listed in the report |

## Pull-model design delta — updates

Started 2026-09-09 14:44 IST. This run closes the twenty-one gaps you decided on Tuesday afternoon,
adds the four sections you asked for (how it ships, settings instead of code changes, how we prove
the build followed the design, what it costs to run), and finishes what the morning run reported
short. Design only — no behaviour ships from it.

| Time | What moved | Before | Now | Note |
|---|---|---:|---:|---|
| 15:08 | **Your twenty-six decisions are now written into the design itself**, each quoted in your own words, each pointing at the section that implements it. The document's own checker refuses to pass if one of them loses its section. | 0% | 100% | 52 decisions on record now |
| 15:08 | **The document-retention decision replaced the old one.** We now keep the READ TEXT of every offer document for the life of the IPO, and the PDF itself for seven days after the last successful read. The old decision kept the PDF forever, which is what would have filled the disk. | 0% | 100% | Your words, folded in |
| 15:08 | **The grey-market premium question is settled in the design.** Subscription and the demand graph only run while bidding is open; the premium runs every thirty minutes whenever an IPO is upcoming or open, including evenings and weekends. | awaiting you | decided | The five rupee columns are settled too |
| 15:08 | **New: what runs, when, and which lock it takes.** Six pieces of scheduled work, two separate locks so a fifty-minute data run can never freeze the subscription figure on a closing day. | 0% | 100% | Your "live figures must have their own lock" |
| 15:08 | **New: the rules for what arrives from the exchanges.** Multi-part filings, scanned pages, password-locked files, error pages served as PDFs, a 100 MB ceiling and a two-minute timeout. We found the real hole: today the downloader has NO size limit at all — a huge file would kill the process rather than be refused. | 0% | 100% | Five handling rules, five limits |
| 15:08 | **New: when two documents disagree.** The later filing wins within a type; a corrigendum changes only the fields it names and freezes them so a later re-read cannot undo the correction. Reading our own code found a real trap: a corrigendum filed AFTER the prospectus would currently lose to it. | 0% | 100% | Now stated as a rule with named tests |
| 15:08 | **New: what the reader sees.** The site already records where every number came from and when it was last confirmed — and shows none of it. Nothing on any page reads that data today. The design now says exactly which line appears under each block of facts. | 0% | 100% | Also: a correction reaches the page in the same cycle, not up to 20 minutes later |
| 15:08 | **New: how this ships.** Twenty-two build items grouped into five weekly releases, urgent fixes the same evening, everything else batched — the GitHub billing problem written into the design rather than remembered. | 0% | 100% | Your deployment rule |
| 15:08 | **New: settings instead of code changes.** Eleven kinds of setting (source ranks, timings, budgets, retention, unit tags, cost caps) become configuration a person can change without a code release, plus ten modules with a rule that stops one from reaching into another. | 0% | 100% | Your "customization, not code changes" |
| 15:08 | **New: proving the build followed the design.** Every rule in the document now has a permanent id — 144 of them so far — so a build card, a test and the CI check can all name the same rule. | 0% | 60% | The check that enforces it is next |
| 15:08 | **Two defects found in the design's own tooling.** Its checker passed on a rule-extractor that silently matched nothing, and the document carried 69 mangled dashes from a Windows console paste. Both fixed. | — | fixed | The extractor now finds 144 rules instead of 30 |

| 15:29 | **The design was caught being wrong about our own code, eight times, and each one is now corrected.** Writing the build cards meant reading the real files, and that found: the downloader already refuses HTML error pages and checks a file is really a PDF; a 150 MB size ceiling already exists; scanned-page OCR is already built and wired; the canonical tag every IPO page needs is already set. The design had claimed all four were missing. | — | corrected | An implementer would have spent days rebuilding working code |
| 15:29 | **Two more corrections that would have caused real bugs.** The page cache key the design named is not the one the IPO page actually uses — a "correction published instantly" that cleared the wrong key would never have reached the page. And the rule for the smallest allowed SME application was written two different ways, a factor of two apart, one of which could never fail. | — | corrected | Found by reading the code, not by review |
| 15:29 | **The rules that check money splits were backwards.** The design said a book-built IPO must give at least 50% to institutions. SEBI's rule for the ordinary route is the opposite — at most 50%, at least 35% to retail. As written the check would have accepted the exact mis-reading it exists to catch. | — | fixed | Now split by which SEBI route the issue used |
| 15:29 | **A new question for you (O-14).** Nineteen rows on the site are typed "OFS". That word means two different things in India: the offer-for-sale part of a normal IPO, or a promoter selling shares in a two-day exchange auction with no offer document, no lot size and no anchor round. A probe is reading the real rows now. Recommendation: if they are the auction kind, give them their own page shape with ~35 fields instead of 205. | — | awaiting you | Nothing is blocked; the design is written on the recommendation |
| 15:29 | **Cost of running the whole design, measured for the first time.** 835 requests and 50 MB a day. The server plan allows 7.81 TB a month, so this is 0.018% of it. Bandwidth is not a constraint and never will be; the real limits are the two CPUs and the document disk. | 0% | 100% | Read from the Hostinger API, not from memory |

| 15:37 | **Every open problem in the design is now closed.** Eighteen this morning, zero now: nine corrected in the document, seven handed to the build item that will fix them in code (each written into that item's own "known gaps" so it cannot be quietly dropped), and two answered by going and reading the live database instead of arguing. | 18 open | 0 open | A new status was added so a problem can never be closed by deleting it |
| 15:37 | **The nineteen "OFS" rows are not what the design assumed.** They are Coal India, BHEL, NHPC, NLC India, Hindustan Zinc, IRFC, IndiGrid and three public-sector banks — all already listed. None has a lot size, none has a single document, and only one has a price band. So they are promoters selling shares in a two-day exchange auction, not IPOs. The design was granting them 205 fields that do not apply. | — | measured | Needs your call (O-14) on whether they get their own page shape |
| 15:37 | **A migration in the plan cannot run as written.** The first build item was going to add a uniqueness rule on a column called normalized_name across three tables. That column does not exist on any of them. Caught by running the check against production rather than reading the plan. Good news: no duplicate rows to clean up either. | — | caught | Order is now written down: add the column, re-scan, then add the rule |
| 15:37 | **Three independent reviews are running now** — one on Indian market rules, one attacking the design's own checks to see which are real and which only look real, one re-reading every claim the design makes about our code. Four more real IPOs are being walked through the design end to end, including one with a correction notice and one where the company changed its name mid-way. | 0% | running | Results in the next update |

| 15:49 | **A reviewer was asked to break the design's own safety checks, and broke five of six.** The worst: the rule that says "evidence coverage can only go up" could be switched off by the same edit it was supposed to stop — set the number to zero and the check happily reported "0 of 387 backed" as a PASS. Another accepted a made-up filename because the word "new" happened to appear elsewhere on the line; that excuse covered 164 of 352 file references. | 6 checks | 5 broken | This is exactly why the review was run |
| 15:49 | **All five are fixed, and each fix was proved by breaking it again.** There is now a standing test that deliberately damages the design four ways and fails if any check stays quiet. It repairs every file afterwards and verifies the repair byte for byte. Result: 4 out of 4 caught. | 0% | 100% | The tool that writes into build cards was also deleting hand-written text and reporting success — it now refuses |
| 15:49 | **Two other reviews found real errors too.** On market rules: the smallest allowed SME application in the design is half the legal minimum (SEBI raised it to over Rs 2 lakh from 1 July 2025), the price-band width rule invents an SME exception that does not exist, and the listing-deadline rule has no start date so it would reject every IPO that listed before December 2023. On our own code: the design describes a file-deletion rule that was already fixed months ago. | — | fixing now | Fixes going in next |

| 16:06 | **The design work is finished and the pull request is going up.** Every problem is closed — 114 recorded, none open. Four independent reviews, four real IPOs walked end to end, and a second review aimed at the fixes themselves, which found one place where my fix had made things worse. | 0 open | done | Report: docs/design/delta-report-2026-09-09.md |
| 16:06 | **The most useful thing found today was not a mistake in the writing.** Walking four awkward IPOs showed that several rules cannot run at all, because the data they read is not there: the field that orders documents by date is filled on 27 of 266 documents, the field that says whether an IPO is fixed-price on 19 of 330, and two fields the rules name do not exist as columns at all. The design now states, for every such rule, what happens when the field is empty. | — | new section | This was invisible from reading the rules |
| 16:06 | **Two decisions still need one line each from you.** (1) The nineteen "OFS" rows are Coal India, BHEL, NHPC and similar — already-listed companies whose promoters sold in a two-day auction. Give them their own page shape? (2) We fetch delayed prices from the exchanges' free pages; republishing them may need a licence. That is a compliance call and you are a Zerodha AP. | — | awaiting you | Nothing is blocked either way |

## Implementation lane B - updates

Lane B builds six of the twenty-two pull-model items - the CI traceability check, document downloads and retention,
retiring Moneycontrol, the ratios extractor, and the read side - beside lane A, which builds the other fifteen.
Nothing here is deployed; everything lands on `main`, which feeds staging only.

- **2026-09-10 11:17 IST - lane B started.** 0% to 0%: nothing built yet. Preflight passed on every check - the shared code on
  `main` is green, this lane's own throwaway test database is built and matches the schema exactly (35 tables to 35),
  and the design documents pass their own consistency gates. First item is the check that makes CI fail when the
  design says something the code never tests; a reader of ipodhan.com sees nothing from it, but every later item in
  BOTH lanes is proven by it instead of taken on trust. One mistake already, mine, recorded honestly: a mistyped path
  meant a database reset silently did not run and the migration that followed ran on the wrong state - redone
  properly before anything was built. Nothing needed from you.
- **2026-09-10 11:36 IST - 0% to 0% merged.** Still the first of item 20's four slices: the check that makes a pull request fail
  when the design says something the code never tests. It was built, then an adversarial review refused it, and the
  refusal was worth it. The check could report success while scanning nothing - point it at a folder that has been
  renamed and it printed PASS instead of failing, which would have made a third of its job silently useless across
  the whole repository. And the parser bug it fixed this morning had no test, so the bug could have come straight
  back. Both are fixed and both fixes were proved by deliberately breaking them; a second review is checking that
  the fix covers every path and not just the one the reviewer happened to try. A reader of ipodhan.com would notice
  nothing from any of this - it is the machinery that proves the later items really do what the design says.
  Nothing merged yet, no CI minutes spent by this lane, nothing needed from you.
- **2026-09-10 12:00 IST - 0% to 25% merged.** The first of item 20's four slices is live on main: a check that fails a pull
  request when the design claims a rule the code never tests. Two review rounds refused it first, and both refusals
  were right - it could have reported success while scanning nothing, and the parser bug it fixed had no test to stop
  it returning. The third slice, which checks that no lower layer of the system reaches up into a higher one, was
  refused outright: it passed every run, but it turned out to be looking at no code at all - the reviewer reversed
  the entire rule it enforces and it still said PASS. That is being fixed now, and any real violations it finds will
  be listed openly in a file that can only shrink, never hidden. A reader of ipodhan.com would notice nothing from
  any of this yet; it is the machinery that makes the later work provable. One alarm was raised and disproved: the
  test runner is not silently passing failing tests. Nothing needed from you.
- **2026-09-10 12:37 IST - 25% merged, a second slice one check from landing.** The layering check is in CI. It took three review
  rounds and the first two refused it: the first version could not fail at all, and the second was blind to the
  scraper because it could not follow that code's own import style. Fixed, it found **41 real places where a lower
  part of the system reaches up into a higher one** - all listed openly in a file that can only shrink, none hidden,
  none fixed here. A fourth slice is building alongside: the one that catches a design sentence being reworded
  without its code or tests being touched. A reader of ipodhan.com still sees nothing from any of this. Nothing
  needed from you.
