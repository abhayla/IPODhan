# Data sourcing: the pull model

> ### Status — complete and ready for your read; no finding is open
>
> Every finding from the four review passes is dispositioned — fixed, deferred with a named trigger,
> or deliberately not done. Each finding that needs code names a build item in §7.1. **§8 is the
> honest account of what is measured, what is read from the code, and what is judgement** — read it
> before approving anything here.
>
> Four owner decisions remain yours (§0.0.2). None of them blocks this design, and none is assumed:
> build items 1–10 and 12–15 can be scoped on your word alone; only item 11 waits on O-2.
>
> **Do not trust any finding count typed in this document.** `findings.json` is the register and it
> changes; a number written here is stale the moment it is typed. Run the check instead:
>
> ```
> node docs/design/check-design-consistency.mjs --gate
> ```
>
> It prints the live counts and fails if this document contradicts the register, the field spec, or
> an owner decision.
>
> **Scope (owner, 2026-09-08): phase 1 is open and upcoming IPOs only — 19 today, all plain `IPO`,
> mainboard or SME.** No closed IPO is touched. Closed IPOs follow afterwards, one at a time, newest
> close date first.

Author: this session, 2026-09-08. Origin: owner comment O-8 in `docs/ops/work-tracker.md`.

Abhay's requirement, in his words: *"almost ninety percent of our data should come from the offer
documents. These are the primary source. All those websites are only for verification. They are not
the source of the data."*

Every number in this document was measured during this session against the production database
through the read-only tunnel, or read out of the named file. Nothing is carried forward from an
earlier note. Where a measured number differs from an earlier one, the measured one is used and the
difference is stated.

---

## 0.0 The decisions this design is built on

You asked how you would know this design follows your guidance rather than my judgement. This
section is the answer, and `check-design-consistency.mjs` check **D10** enforces it: every row below
names a section of this document, and the check fails if that section has gone missing or if the
decision's signature has stopped holding. So the claim "the design follows your decisions" is a
command you can run, not a sentence you have to trust.

**Two rules for this table.** Your words are quoted, never paraphrased into something stronger. A
decision you have not actually made is in the second table, not the first — I do not get to promote
it by assuming.

### 0.0.1 Decisions you made — the design is bound by these

| id | Your words | Date | Lives in | What D10 checks |
|---|---|---|---|---|
| OD-1 | *"Target should be 100%. If the field value comes from offer document then it should extracted from offer document."* | 2026-09-08 | §1.1 | the 100% target is stated; no blended-90% target survives anywhere |
| OD-2 | *"Keep those five on the exchange, as a written, named exception to the 100% rule."* — then extended to the whole timetable family | 2026-09-08 | §1.2.1 | E-1 exists and its size matches the field spec (also D3) |
| OD-3 | *"Retire the Moneycontrol scraper."* | 2026-09-09 | §1.11.1 | the field spec serves zero fields from Moneycontrol |
| OD-4 | *"Change the source priority so the offer document outranks every website for the fields it contains."* | 2026-09-08 | §1.1, O-5 | every non-E-1 field the document prints ranks the document first |
| OD-5 | *"Make this priorities configurable... we should not be required to change the code."* | 2026-09-08 | §2.3.5 | the section exists |
| OD-6 | *"Verification is a read, not a write."* | 2026-09-08 | §2.5 | the section states it |
| OD-7 | A value we could not re-source is kept and marked stale, never blanked | 2026-09-08 | §2.6 | the section exists |
| OD-8 | *"Freeze a withdrawn page with a notice."* | 2026-09-08 | §2.9 | the section exists |
| OD-9 | *"Is there a unique ID for each IPO? If yes then there should be only one row for each IPO."* | 2026-09-09 | §2.3.1 | the one-row / late-binding identity rule is present |
| OD-10 | *"Agreed, child-table writer is item 1."* | 2026-09-08 | §7.1 | item 1 of the build sequence is the child-table writer |
| OD-11 | *"There is no phase 2."* | 2026-09-08 | whole doc | no work is parked in a phase 2 (also D9); every deferred finding names its trigger (D9b) |
| OD-12 | Phase 1 is open and upcoming IPOs only | 2026-09-08 | header | the scope is stated (also D6) |
| OD-13 | *"Drop the extractor and mark it deliberately unread."* (basis-of-allotment) | 2026-09-08 | §5.4 | the section exists |
| OD-14 | Twenty-five fields are retired and must never be written | 2026-09-08 | §1.12 | the section exists |
| OD-15 | *"Nothing outside reads that API."* (the 19 dead API fields) | 2026-09-08 | §1.12 | the section exists |
| OD-16 | *"Merge the two rows."* (the duplicate Asset Reconstruction row) | 2026-09-09 | F-55 | done on production; the duplicate invariant holds |
| OD-17 | *"Do not proceed below 95% confidence... ask ONE question at a time, each with your recommendation and a one-line reason."* | 2026-09-08 | how this doc is written | not mechanically checkable — stated so it is not forgotten |
| OD-18 | *"Every number you state must be measured in this session and its source named."* | 2026-09-08 | whole doc | hand-typed counts the generator owns are banned (D2) |
| OD-19 | *"Offer document never on a clock. Live figures only during bidding. Subscription-related work can run every hour or even thirty minutes, but not the scraper that is fetching the IPO data. Three runs a day, midnight, eight in the morning, two in the afternoon. Add another cycle at ten o'clock at night that deals only with old IPOs, latest closed first, at most 10 old IPOs a day, do not repeat which are already done."* | 2026-09-09 | §2.1, §5.1 | four named jobs at the stated times, and no section schedules a document read on an interval (D12) |
| OD-20 | *"Crore should be the default for every amount column."* | 2026-09-09 | §5.2 | the amount-column inventory matches the money columns the schema actually has, with none unclassified (D13) |
| OD-21 | *"Go with your recommendation"* — per-field validation before the write, the failing field dropped with its cause, rank 2 asked, and no timed retry | 2026-09-09 | §5.3 | the section specifies per-field validation and names the failure row it writes |
| OD-22 | Closed IPOs are in the build, drained by the 22:00 job, not deferred behind preconditions | 2026-09-09 | §6 | §6 specifies a scheduled job with a done-marker, not a deferral |
| OD-23 | Offer documents and the data taken from them survive close and listing | 2026-09-09 | §0.5 | **SUPERSEDED by OD-32** (2026-09-09, later the same day). The half that survives is the DATA: extracted text is kept for the life of the IPO row. The half that does not is the PDF, which OD-32 keeps for seven days after its last successful extraction and then deletes. The row stays here because a decision is never deleted, only superseded |
| OD-24 | A new owner fork is recorded, marked provisional and continued on the recommendation — never guessed silently, never a halt | 2026-09-09 | §0.0.2 | every `PROVISIONAL on O-nn` marker names a row in §0.0.2, and every row this run added carries a marker or says it blocks nothing (D14) |
| OD-25 | Probes are the standard of proof: a claim about a source, a document, the code or the data cites a probe output, a saved payload or a `file:line` | 2026-09-09 | §0.0.3 | every rank in Appendix A carries an evidence reference that resolves (D15) |
| OD-26 | The finish line is the five-part definition of done in the implementation-ready contract, and provisional items are allowed to remain | 2026-09-09 | §8.4 | not mechanically checkable — recorded so it is not quietly widened |
| OD-27 | *"The live figures job should have its own lock. The data job and the ten o'clock job can share the heavy one. The data job must never block the live figures."* | 2026-09-09 | §2.1 | two named locks exist in §2.1 and the live-figures job is not gated on the heavy lock (D17) |
| OD-28 | *"Subscription and the demand graph only when bidding is on. The grey market premium every thirty minutes whenever an IPO is upcoming or open."* — decides O-13 | 2026-09-09 | §2.1 | §2.1 gates subscription and demand graph on bidding hours and does NOT gate the grey-market premium on them (D17) |
| OD-29 | *"Yes I accept 15-minute delayed prices from the exchanges' public endpoints, with the 90-day windows."* — no broker feed reaches the public site | 2026-09-09 | §2.1, §1.9 | a post-listing price window of 90 days at 15 minutes is stated, and no broker feed (Kite, SmartAPI, Upstox) is named as a public-site source (D17) |
| OD-30 | Within one document type the later filing date wins; a corrigendum overrides only the fields it names and freezes them; the final prospectus is terminal | 2026-09-09 | §2.5, §3 | the three rules are stated and each names its test (D17) |
| OD-31 | *"Check again on the morning an IPO is due to open, before it opens."* — a discovery-only check about 09:45 IST, its time set by probe | 2026-09-09 | §2.1 | the opening-day check exists, is discovery-only, and its time cites the probe output (D17) |
| OD-32 | *"We read the document, retain it for a week so that we re-read it if previous reads were not successful and then delete it."* — REPLACES OD-23 | 2026-09-09 | §0.5.1, §6 | extracted text is kept for the life of the IPO row, the PDF for seven days after its last successful extraction, and no section keeps a PDF for the life of the IPO or schedules a re-download of an extracted document (D17) |
| OD-33 | *"Once a scraper scrapes an IPO document it should not rescrape the same document again. Only a new document for an existing IPO is scraped."* | 2026-09-09 | §2.1, §2.5 | the sha256 identity rule and the removal of the timed backoff retry are both stated with a named test (D17) |
| OD-34 | Identity binds in order: CIN, then the SEBI draft filing number, then the exchange symbol, then the normalised name; a name-only row is flagged | 2026-09-09 | §2.3 | the four-step order is stated in that order and the name-bound flag exists (D17) |
| OD-35 | One row is one offering: same identifier and open dates within 180 days is the same offering; an offering-type change is a new row; a lapsed draft at twelve months is a new offering | 2026-09-09 | §2.3 | the 180-day rule, the offering-type rule and the lapsed-draft rule are stated, and the twelve months cites the ICDR clause fixture (D17) |
| OD-36 | Document handling: multi-part filings, image-only pages to OCR, one blank-password attempt, content sniffed before store, the exchange's document id stored | 2026-09-09 | §2.2.1 | the five handling rules are stated and each names a real fixture (D17) |
| OD-37 | Download limits: host allow-list, private and loopback addresses refused, 100 MB cap, two-minute timeout, every refusal logged with its cause | 2026-09-09 | §2.2.1 | the five limits are stated with their numbers and the refusal log line is named (D17) |
| OD-38 | Three consecutive no-such-symbol reads stop the price job and set DELISTED; every automatic merge is logged and reversible; a merge touching a live IPO posts to the Notifier | 2026-09-09 | §2.3, §2.9 | the delisting rule, the merge log and the unmerge command are stated (D17) |
| OD-39 | *"The reader should see where a number came from and when it was last confirmed."* | 2026-09-09 | §2.11 | §2.11 names the component file, the query and the cache key for the source-and-confirmed line (D17) |
| OD-40 | After a cycle writes published fields it drops the Redis keys and calls one authenticated revalidate endpoint with the touched slugs | 2026-09-09 | §2.11 | the end-of-cycle revalidate call is stated once per cycle and the timed rebuild is cited from code (D17) |
| OD-41 | After a merge: canonical tag on every IPO page, sitemap from live rows only, retired slugs permanently redirected | 2026-09-09 | §2.11 | the three SEO rules are stated and the redirect table is cited (D17) |
| OD-42 | Every check this design names has a registered consumer that reads it | 2026-09-09 | §4 | every design check id appears in `docs/reviews/detection-checks/` with a consumer (D18) |
| OD-43 | Test corpus: one directory per source, a header per fixture, no PDFs committed, a weekly live shape check, the legacy fixtures backfilled or deleted | 2026-09-09 | §4.5 | the corpus rules are stated and the weekly shape check names what it files (D17) |
| OD-44 | Switch-over is a per-IPO staged flip: reconciliation groups flip together, open and upcoming IPOs first, two clean staging cycles as proof, per-field rollback | 2026-09-09 | §6.6 | the flip order, the group rule and the two-cycle proof are stated (D17). The contract called this §6.5; that number was already the document-type precondition, so it is §6.6 |
| OD-45 | *"Running cost has to be measured, per job, against the box we actually have."* — per-job budgets, an alarm at 150 percent for three days, zero paid API calls in phase 1 | 2026-09-09 | §7.4 | the cost table exists, every row cites a probe output, and the zero-paid-call rule is stated (D17) |
| OD-46 | Four more walkthroughs on real IPOs: a corrigendum, a fixed-price SME, a rename between draft and RHP, an FPO | 2026-09-09 | §8.2 | four walkthrough files exist under `docs/design/walkthroughs/`, each complete or ending at a named untested rule (D17) |
| OD-47 | The first run's shortfalls are closed: evidence for the remaining source ranks, all eighteen open findings resolved, one fresh second review round | 2026-09-09 | §8.2 | `findings.json` carries zero OPEN findings and A.0 records a sixth verification round (D4, D5) |
| OD-48 | *"Ensure that no error should occur even for world's largest IPOs in rupees terms."* — the five retail columns stay in rupees with a unit tag; decides O-12 | 2026-09-09 | §5.2 | the five rupee columns are named exceptions with their precision, and the scale test is specified (D17) |
| OD-49 | PR #432's red gate is fixed by routing the merge tool through the shared write path, never by grandfathering it into the shrink-only ratchet baseline | 2026-09-09 | §8.3 | build item 19 exists and no section proposes editing the write-ratchet baseline (D17) |
| OD-50 | *"Avoid lot of deployments. If there is any urgent code change, it should happen the same day in the evening. If it is a normal code change, then it can be delayed for a week, or maybe it can happen on weekends."* | 2026-09-09 | §7.5 | the branching model and the two deploy cadences are stated, and the release grouping lists every build item (D17) |
| OD-51 | *"For settings, we should use customization not code changes. When I said change the source of the field from currently one to three, you should just make a small customization change, not a code change. Everything is properly modularized and can easily be updated without affecting the whole code."* | 2026-09-09 | §7.6 | every tunable named in the design appears in the configuration schema, and the module map with its dependency rule is stated (D17) |
| OD-52 | *"How will the implementation prove it has followed this design, rule by rule?"* — every normative rule gets an id, every build card lists the ids it implements, every test declares them, and CI refuses a PR that breaks the chain | 2026-09-09 | §8.5 | every R-id in `docs/design/rules.json` is claimed by at least one build card, with zero orphans (D19) |

### 0.0.2 Decisions that are still yours — the design does NOT assume an answer

These are owner comments the design does **not** answer for him. Nothing here depends on a
particular answer, and **D10c fails if any section writes one of them up as settled.** They are in
one place so the list of what needs him is not scattered through a tracker.

**Five of them are no longer here.** O-1 (cadence), O-2 (money unit) and O-3 (partial failure) were
answered by the owner on the morning of 2026-09-09 and moved to §0.0.1 as OD-19, OD-20 and OD-21.
**O-12** (the five retail rupee columns) and **O-13** (the grey-market premium and the market-hours
gate) were answered that afternoon and moved as **OD-48** and **OD-28**. A row leaves
this table only by being decided, never by being assumed.

**How a new fork gets added (OD-24).** When work on this design meets a decision that is genuinely
the owner's — irreversible, outward-facing, a change to the public product, or two valid builds with
no best-practice winner — it is added here as `O-12` onward with the question in one sentence, the
recommended answer and the reason. Every section that depends on it opens with **PROVISIONAL on
O-nn**, and the work continues on the recommendation rather than stopping. Check **D14** ties the two
together: a marker with no row, or a row this run added with neither a marker nor the words "blocks
nothing", fails the gate.

| id | The comment, or the fork | Status / recommendation | Why it is still his |
|---|---|---|---|
| O-7 | *"Language model, only for the last stretch, and under strict conditions."* | STANDING CONSTRAINT | Recorded as a constraint in §5.6. Nothing in the phase-1 build uses a language model, so there is nothing to approve yet. |

### 0.0.3 The standard of proof this document is held to (OD-25)

Prose cannot prove behaviour. The single most expensive lesson of this design's first four rounds was
that a confident sentence about a source ("that site carries no restated per-year table", "Chittorgarh
prints a P/BV") survives every reading until somebody actually fetches the page — and then it turns
out that 51 of the ranks built on such sentences were wrong. So every claim in this document about
**how a source behaves, what a document contains, what our own code does, or what the data holds**
must cite one of exactly three things:

1. **A probe** — a small read-only script under `docs/design/probes/`, with its output saved beside
   it as `<name>.out.txt` or `<name>.out.json`. The probe is the claim; the output is the evidence.
2. **A saved payload** under `docs/design/probes/fixtures/`, carrying the URL it came from and the
   date it was fetched.
3. **A `file:line` citation** into this repository, which check **D11** re-resolves on every run —
   a citation nobody can follow is indistinguishable from an invented one.

**What a probe may and may not do.** It may read production and staging through the read-only tunnel
(`docs/ops/prod-ops-recipes.md` §1), fetch NSE, BSE, SEBI, Chittorgarh and InvestorGain pages, and
run the **existing** extractors from `scraper/src` **on the laptop** against PDFs copied read-only out
of the document store. It may not write to any database, may not run on the production box (the VPS
serves live traffic), and may not add a dependency — it uses what `scraper/` and `web/` already have.

**An unreachable source is recorded as unreachable.** Three attempts, then the row's evidence reads
`unreachable on <date>, rank carried as judgement` and it is listed as such. A payload is never
invented to fill a gap, and a rank never rests on a plausible-sounding sentence.

Check **D15** enforces the appendix half of this: every rank of every field in Appendix A.1 carries an
evidence reference that resolves to a file that exists.

---

## 0. What is true today, measured

### 0.1 Where the data actually comes from

`field_sources` on production, 2026-09-08 ~14:48 IST. This is the provenance table: one row per
(IPO, table, field), holding which source last wrote it.

| Source | Records | Share |
|---|---:|---:|
| Chittorgarh (website) | 4,635 | 69.8% |
| BSE | 801 | 12.1% |
| **Offer documents** (`DRHP` slot) | **595** | **9.0%** |
| NSE | 393 | 5.9% |
| Moneycontrol (website) | 206 | 3.1% |
| Admin (manual) | 8 | 0.1% |
| **Total** | **6,638** | |

**The target is 100% of the fields the offer document prints** (owner, 2026-09-08 — see §2.1.1).
Not a blended share: every field the document carries comes from the document, and each exception is
named. Measured on the best-covered IPO on production, that set is 56 fields and 47 of them come
from the document today (84%); on the typical IPO it is zero.

**But that single number hides the real diagnosis.** Split the same table by which table the field
lives in:

| Table the field belongs to | Provenance rows | From documents | Share |
|---|---:|---:|---:|
| `ipos` — the core row | 6,216 | 173 | **2.8%** |
| `financial_data` | 160 | 160 | 100% |
| `ipo_details` | 143 | 143 | 100% |
| `ipo_risk_factors` | 26 | 26 | 100% |
| `financial_statements` | 25 | 25 | 100% |
| `documents` | 24 | 24 | 100% |
| `ipo_intermediaries` | 22 | 22 | 100% |
| `ipo_valuation` | 14 | 14 | 100% |
| `promoters` | 7 | 7 | 100% |
| `peer_companies` | 1 | 1 | 100% |

Every table except `ipos` is **already 100% document-sourced**, because only the document path ever
writes them. Inside `ipos`, Chittorgarh alone holds 74.6% and the document holds 2.8%.

So this is not a ranking problem and never really was. **Where the document path runs, it already
wins everything it touches. It runs on 27 of 327 IPOs.** The problem is reach, and the pull model is
the fix for reach.

### 0.2 The headline fields, document against website

Same table, same moment. Every one of these six is printed on the front page of the offer document.

| Field | From documents | From websites (CG + MC) | From exchanges (NSE + BSE) |
|---|---:|---:|---:|
| Issue size | 4 | 221 | 56 |
| Price band (min / max) | 2 | 154 | 128 |
| Lot size | 2 | 157 | 52 |
| Lead managers | 2 | 224 | 63 |
| Registrar | 1 | 222 | 66 |
| ISIN | 13 | 233 | 43 |

### 0.3 Why the priority list does not fix this

The offer document has ALREADY outranked the websites for issue size since 9db4529d merged this
morning (O-5). It still supplied that value 4 times against 277. The reason is structural, and it is
the whole point of this design:

> The write path is PUSH. Each scraper wakes on its own schedule, scrapes whatever it can see, and
> calls `DataConsolidationOrchestrator.consolidatedUpsertIPO(scrapedIPO, source, confidence)` with
> exactly ONE source at a time. That function compares the arriving value against the stored one,
> looks both up in `field-priority-matrix.ts`, and keeps the higher-ranked one
> (`data-consolidation-service.ts`, reason `SOURCE_PRIORITY`).

A ranking can only decide a contest between sources that both turned up. If the document extractor
never runs for an IPO, the document's value never enters the comparison and its rank is irrelevant.
**The websites are not winning an argument. They are the only source that showed up.**

### 0.4 How little of the document path reaches an IPO

| Measure | Count | Of 327 IPOs |
|---|---:|---:|
| IPOs on production | 327 | 100% |
| IPOs with any document stored | 116 | 35% |
| IPOs with any document extracted | 27 | 8.3% |
| IPOs with any document-sourced field | 27 | 8.3% |

Documents by type and extraction status (`documents`, 256 rows):

| Group | COMPLETED | PENDING | FAILED | MANUAL_REVIEW |
|---|---:|---:|---:|---:|
| Types the extractor understands (DRHP, RHP, PROSPECTUS, PRICE_BAND_AD) | 60 | **91** | 4 | 0 |
| Anchor allocation report (its own extractor) | 2 | 7 | 2 | 12 |
| Types with **no extractor at all** | 0 | **78** | 0 | 0 |

The 78 with no extractor: ratios / basis-for-offer-price 32, security parameters 23, sample
application forms 14, bidding centres 8, basis-of-allotment advertisement 1.

**176 of 256 stored documents have never been opened. 91 of those are types we can already read.**

### 0.5 The three hard limits this design must live inside

Read out of the code this session:

- `CYCLE_BUDGET.EXTRACTIONS_PER_CYCLE = 1` (`document-state-machine.ts`), with the runtime spawn
  budget `DEFAULT_MAX_SPAWNS_PER_CYCLE = 3` filings plus
  `DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE = 1` anchor (`filing-auto-persist.ts`).
- `EXTRACT_TIMEOUT_MS = 10 * 60 * 1000` — ten minutes per document, inside a
  `DEFAULT_WAKE_BUDGET_MS = 20 * 60 * 1000` wake shared with everything else.
- `LIVE_WINDOW_DAYS_AFTER_LISTING = 10` (`document-state-machine.ts:749`) — an IPO listed more than
  ten days ago gets **no document state rows at all**. **Removed by OD-23, as amended by OD-32; see §0.5.1.**

That last one was the migration blocker, and it was bigger than it looked:

| Bucket | IPOs |
|---|---:|
| UPCOMING / OPEN / CLOSED (document work allowed) | 76 |
| LISTED within 10 days (document work allowed) | 23 |
| **LISTED more than 10 days ago (no document work at all)** | **228** |

**70% of the site's IPOs sat structurally outside the document path.** And their PDFs were being
deleted: `decidePurge` (`document-store.ts:264`) removes an IPO's directory at
`close_date + DEFAULT_RETENTION_DAYS` (7, `document-store.ts:32`), with a hard ceiling of
`DEFAULT_MAX_RETENTION_DAYS` (30, `document-store.ts:45`) and `DEFAULT_MAX_STORE_GB`
(5, `document-store.ts:46`). The database rows and the source URLs survived; the files did not.

#### 0.5.1 What is kept, and for how long (OD-32, owner 2026-09-09 — replaces OD-23)

> Owner: *"We read the document, retain it for a week so that we re-read it if previous reads were
> not successful and then delete it."*

Two different things were being called "the document", and OD-23 kept both when only one needs
keeping. OD-32 separates them:

| What | Kept for | Why |
|---|---|---|
| **The extracted text**, page by page, with the page number on every page | **the life of the IPO row** | this is what every later re-read reads. A website disagreement (§3), a fixed extractor, a new field — none of them need the PDF back, they need the words |
| **The PDF file itself** | **seven days after its LAST SUCCESSFUL extraction** | the week exists so a failed or partial extraction can be retried against the original bytes. Once a successful extraction is on record, the bytes have done their job |
| **The row in `documents`** — URL, type, filing date, sha256, the exchange's own document id | the life of the IPO row | it is how we know we already have this document and must not fetch it again |

Three rules follow, and check **D17** enforces all three:

- `LIVE_WINDOW_DAYS_AFTER_LISTING` (`document-state-machine.ts:749`) stops gating document work. An
  IPO's documents are workable for the life of the IPO row.
- The purge clock changes its anchor. Today `decidePurge` (`document-store.ts:264`) deletes at
  `close_date + 7 days` — a date that has nothing to do with whether we ever read the file. Under
  OD-32 it deletes at **last successful extraction + 7 days**, and it never deletes a document that
  has no successful extraction yet.
- **Nothing re-downloads an already-extracted document.** After the seven days the PDF is gone on
  purpose, and a design section that asks for it back is a defect, not a feature — that is exactly
  what D17 fails on.

**The counter-case this rule has to answer.** "What if the extractor improves in six months and we
want to re-run it on a document whose PDF is deleted?" Then it re-runs **on the stored text**, which
is what §3's re-read loop already does. The only loss is a re-run of the PDF-to-text step itself —
which matters for exactly one class of failure, an image-only scan that OCR handled badly, and that
class is caught inside the seven days by the extraction-failure reading (§4), not six months later.

**Why the storage matters more than it looks.** Every IPO that closes today joins the closed-IPO
backlog tomorrow. Under the OLD rule it lost its documents seven days after *closing*, whether or not
anything had ever read them, so the backlog grew and each new member got harder to fix at the same
time. OD-32 keeps the text forever and the bytes only while they are still useful; the backlog stops
compounding, and the 22:00 job (§6) drains it.

The 5 GB store ceiling stays. Under OD-32 it is far easier to honour than under OD-23, because the
only files on disk are the ones extracted within the last seven days plus anything not yet
successfully extracted — a working set, not an archive.

**The number behind the ceiling** — the current on-disk size of the document store, and the size
projected at 500 IPOs — comes from `docs/design/probes/document-store-size.mjs`, whose saved output
is the evidence for the compression rule above. A retention policy with no measured store size
behind it is a wish.

### 0.6 The matrix has forgotten two thirds of the site

Built from `packages/shared/src/db/schema.ts` (35 tables, 574 real columns), the live API responses,
and the repositories `web/app/ipos/[slug]/page.tsx` loads — deliberately NOT from the priority
matrix, so a field the matrix forgot still appears.

| | Count |
|---|---:|
| Publishable columns across the 18 published tables | 307 |
| **Populated on production — this mapping's scope** | **194** |
| Entirely empty on production | 113 |
| Distinct keys in `field-priority-matrix.ts` | 77 |
| **Populated published fields the matrix covers** | **64** |
| **Populated published fields with NO matrix entry** | **130** |

Two thirds of what the site publishes has no source ranking at all. That includes everything the
document work of the last month created — `ipo_valuation` (17 live fields), `financial_statements`
(11), `ipo_risk_factors`, `promoters`, `anchor_investors`, `ipo_intermediaries`,
`documents.filing_date` — and all 23 live `ipo_details` fields. For 130 fields there is no argument
for the document to win.

**Also, and this was undercounted until it was measured** (`probes/matrix-dead-keys.mjs`):
**27 of the 77 matrix keys are snake_case and therefore unreachable**, because consolidation writes
camelCase. An earlier draft said thirteen, and said they were duplicates. Only **5** are duplicates
in the harmless sense — `close_date` beside `closeDate`, `lot_size` beside `lotSize`,
`company_description`, `gmp_price`, `open_date`. The other **22 are orphans**, and an orphan is
worse than a duplicate: the live camelCase field has **no matrix entry at all**, so it takes the
default rules on every cycle and nobody has ever chosen its source order. They include
`total_subscription`, `retail_subscription`, `qib_subscription`, `nii_subscription`, `listing_price`,
`issue_price`, `min_investment`, `roe_percentage`, `pb_ratio` and `peer_companies`.

The draft's own example was also wrong: `revenue_fy1` is not a mis-cased `revenueFy2022`. It is the
real camelCase name of a *third* table, `ipo_financials` (`packages/shared/src/db/schema.ts:582-587`),
which nothing in `scraper/src` writes.

### 0.7 Verification exists; nothing consumes it

`data_conflicts` holds 31,014 rows on production. **2,398 are unresolved**, including all 578
`leadManagers` conflicts and 495 of the `faceValue` ones. We already detect that two sources
disagree and we already write it down. What does not exist is any path from that row back to the
IPO's own document to settle it. The nightly audit reads our own rows; the reverse sweep
(`scripts/audit-reverse-sweep.mjs`) checks whether an IPO exists at all, not whether its values are
right.

### 0.8 Money is stored in four different units

Measured, not read off a comment:

| Table and field | Unit actually stored | Evidence (min / median / max) |
|---|---|---|
| `ipos.issue_size` | **rupees** | 50,000 / 563,500,800 / 106,030,000,000 |
| `ipo_details.fresh_issue`, `ofs_issue` | **rupees** | 600,000,000 / — / 7,329,740,000 |
| `ipo_valuation.mcap_at_floor/cap` | **rupees** | 17,014,000,000 / — / 78,581,730,000 |
| `financial_data.*` (market cap, net worth, income, EBITDA, …) | **crore** | market cap 40.46 / 172.17 / 50,095.75 |
| `anchor_investors.total_amount_raised` | **crore** | 12.81 / — / 216.00 |
| `financial_statements.revenue / total_income / ebitda / pat / net_worth / op_cash_flow` | **whatever the document printed**, tagged per row by the `unit` column | 55 rows MILLION, 10 rows LAKH |

Four units, six tables, one concept. `financial_statements` does not normalise at all — it stores
the document's own unit and leaves the conversion to whoever reads it.

### 0.9 A live defect this design has to fix, not merely describe

`financial_data` has hard-coded `*Fy2022`, `*Fy2023`, `*Fy2024` columns. Annu Projects Limited's
offer document reports five fiscal years, FY2022 through FY2026, and all five are already in our
`financial_statements` table. The two newest have nowhere to go.

Checked against the live site this session
(`GET https://ipodhan.com/api/ipos/annu-projects-ltd/financials`): the newest total income
ipodhan.com publishes is **FY2024, ₹155.42 crore**. The document says **FY2026, ₹244.59 crore**.
We hold the right number and publish one two years out of date.

---

## 1. The field mapping

### 1.1 How to read it

**240 published fields are here: 194 populated on production today, plus 46 published columns the
offer document prints but that hold no data at all today** (F-13 — scoping this mapping to only
what's already populated was backwards; a field is empty precisely because no document was ever read
for it). **§1 gives the reasoning per group; Appendix A gives the implementable per-field table with
per-type variations, and where the two differ Appendix A wins.** Each falls into one of six classes,
and the class decides whether a source ranking is even meaningful:

| Class | Meaning | Ranking |
|---|---|---|
| **D** | The offer document prints it | 1 document · 2 exchange · 3 website |
| **T** | The bidding timetable — **named exception E-1** (§1.2.1) | 1 NSE · 2 BSE · 3 website; document is not a source |
| **X** | Other live or exchange-governed data (subscription, demand graph) | 1 exchange · 2 website · 3 document |
| **W** | Neither document nor exchange publishes it (grey market) | website only |
| **M** | Market data after listing | 1 exchange · 2 website |
| **C** | We compute it; it has no external source | formula + named inputs, no ranking |
| **I** | Our own pipeline produces it (bookkeeping) | writer named, no ranking |

Class counts across the 240, computed from the field list rather than estimated:
**D 162 · T 10 · X 13 · M 4 · W 1 · C 13 · I 37 = 240** (authoritative count, from the generated
spec in Appendix A — an earlier estimate in this section was slightly off and Appendix A wins). The
pull loop walks the D, T, X, W and M fields — **190 of the 240**. The 10 T fields are the named
exception E-1 (§1.2.1) and are the only fields excluded from the 100% rule. The 13 C fields are
recomputed after their inputs settle (2 of them — the anchor lock-in dates — moved here from T,
F-22). The 37 I fields are written by the pipeline itself and are never sourced.

**Document type order inside rank 1**, inherited from 9db4529d: for price-dependent fields
`PRICE_BAND_AD / CORRIGENDUM > RHP > PROSPECTUS > DRHP`; for final post-issue facts
`PROSPECTUS > CORRIGENDUM > PRICE_BAND_AD > RHP > DRHP`. A newer document can heal an older one; an
older draft can never overwrite a final advertisement.

Source labels: `DOC` = the IPO's own offer document, best available type · `NSE` · `BSE` ·
`CG` = Chittorgarh · `MC` = Moneycontrol · `IG` = InvestorGain (grey market) · `REG` = the
registrar's own site · `ADMIN` = manual, always above every rank.

`rows` = production population measured this session. `unit` — `keep` means no change; **`→ Cr`**
marks an O-2 conversion. "Doc §" cites `docs/reviews/wp-c-extraction-contract.md` §1 groups A–F
where that contract already names the section; new rows extend it in the same shape.

### 1.2 `ipos` — the core row (32 live fields)

| # | Field | rows | Cls | 1 | 2 | 3 | Unit | Doc § | Check before write | Verify against / disagreement means | Exceptions by type |
|---|---|---:|---|---|---|---|---|---|---|---|---|
| 1 | `symbol` | 259 | D | DOC | NSE | BSE | keep | E7 cover | `^[A-Z0-9&-]{1,20}$`; matches the exchange's symbol for the same ISIN | NSE + BSE. Disagreement = re-read the cover. | SME/BSE: BSE is rank 2, NSE absent |
| 2 | `company_name` | 327 | D | DOC | NSE | BSE | keep | cover | legal-name form (ends Limited/Ltd); normalised name matches the exchange's ±1 token | CG, MC. Disagreement on the legal suffix is not a conflict; a different entity is. | — |
| 3 | `issue_size` | 327 | D | DOC | BSE | CG | **→ Cr** | A5+A6 | `fresh + OFS = total ±0.5%`; `shares_at_cap × cap ≈ total ±0.5%`; > ₹1 cr and < ₹50,000 cr | CG, MC, BSE. Disagreement = re-read A5/A6 from the PBA, never adopt the website number. | Rights/OFS/NCD: no PBA — rank 1 becomes the offer letter, rank 2 BSE |
| 4 | `lot_size` | 266 | D | DOC | BSE | NSE | keep | A3 | `lot × floor ≥ ₹10,000` mainboard; `≥ ₹1,00,000` SME (2 lots × ₹50k floor, SEBI 2025) | NSE, BSE, CG. | **SME: minimum application is 2 lots since SEBI's 2025 rule** — the check is on `2 × lot × floor`, which is what caused the Qualiance false alarm |
| 5 | `open_date` | 327 | **T** | **NSE** | **BSE** | CG | keep | B2 | `open ≤ close`; within 90 days of the RHP filing date | the other exchange, then CG. **The document is NOT a verification source** — see §1.2.1 | **Named exception E-1 (§1.2.1).** Owner decision 2026-09-08. |
| 6 | `close_date` | 327 | **T** | **NSE** | **BSE** | CG | keep | B2 | `close ≥ open`; `close ≤ open + 10` working days | as 5 | **Named exception E-1** |
| 7 | `listing_date` | 266 | **T** | **NSE** | **BSE** | CG | keep | B6 | `listing > close`; `listing ≤ close + 3` working days (T+3) | as 5 | **Named exception E-1** |
| 8 | `status` | 327 | **T** | **NSE** | **BSE** | CG | keep | — | must be a legal transition (UPCOMING→OPEN→CLOSED→LISTED); never regresses without an ADMIN row | our own date arithmetic. A status contradicting the dates is a conflict. | **Named exception E-1.** WITHDRAWN / POSTPONED only from the exchange or ADMIN |
| 9 | `registrar` | 267 | D | DOC | BSE | CG | keep | E3 | resolves to a row in `registrars` by name or SEBI reg no. | CG, MC. Disagreement = re-read E3. | — |
| 10 | `registrar_id` | 267 | **C** | — | — | — | keep | — | FK resolved from field 9 | derived; never sourced | — |
| 11 | `rating_override` | 327 | **I** | ADMIN | — | — | keep | — | boolean, admin-only | — | — |
| 12 | `slug` | 327 | **C** | — | — | — | keep | — | `generateIPOSlug(company_name)`; unique; old slug written to `ipo_slug_redirects` | — | — |
| 13 | `sector` | 196 | D | DOC | CG | MC | keep | F1 | non-empty, from the fixed sector list | CG. | — |
| 14 | `price_range_min` | 300 | D | DOC | NSE | BSE | keep | A1 | `floor < cap`; `cap ≤ 1.2 × floor` mainboard, `≤ 1.4 ×` SME; `floor ≥ face_value` | NSE, BSE, CG. Disagreement = re-read the PBA cover. | Fixed-price issues: floor = cap; the ratio check is skipped |
| 15 | `price_range_max` | 300 | D | DOC | NSE | BSE | keep | A1 | as 14 | as 14 | as 14 |
| 16 | `last_scraped_at` | 327 | **I** | — | — | — | keep | — | pipeline clock, UTC | — | — |
| 17 | `listing_exchanges` | 327 | **T** | **NSE** | **BSE** | CG | keep | A15 | non-empty subset of {NSE, BSE}; an SME row may not claim both unless both confirm | the other exchange | **Named exception E-1.** Also **the only field that distinguishes SME-on-NSE from SME-on-BSE** — `ipos.exchange` is NULL on all 327 rows and `bse_scrip_code` on 0 of 327 |
| 18 | `face_value` | 327 | D | DOC | BSE | NSE | keep | A2 | one of {1,2,5,10}; `floor ≥ face_value` | CG. | — |
| 19 | `allotment_date` | 239 | **T** | **NSE** | **BSE** | CG | keep | B3 | `> close`, `< listing` | as 5 | **Named exception E-1** — it moves whenever the window moves |
| 20 | `company_description` | 159 | D | DOC | CG | MC | keep | F1 | ≤ 1,200 chars; no boilerplate ("The company was incorporated…" alone fails) | CG. | — |
| 21 | `lead_managers` | 231 | D | DOC | BSE | CG | keep | E1 | non-empty array; each name resolves or is recorded as new; count matches `bse_payload_lead_manager_count` when present | BSE, CG. **578 unresolved conflicts today** — this field is the re-read loop's first customer. | — |
| 22 | `isin` | 150 | D | DOC | NSE | BSE | keep | E7 | `^INE[A-Z0-9]{9}$`; check digit valid | NSE, BSE. | Pre-listing an ISIN may not exist yet → `NOT_AVAILABLE_YET`, not a failure |
| 23 | `segment` | 321 | D | DOC | NSE | BSE | keep | A15 | MAINBOARD or SME; must agree with the lot-value check in field 4 | NSE, BSE, CG. | — |
| 24 | `offering_type` | 327 | D | DOC | BSE | CG | keep | A11 | one of the 14 enum values; `IPO` requires a DRHP or RHP to exist | BSE `IR_flag`, CG. A corporate action mis-typed as an IPO is the Mopshop/Sarda class. | **No matrix entry today** despite being the field that decides whether a row belongs on the site at all |
| 25 | `scraper_locked` | 327 | **I** | ADMIN | — | — | keep | — | admin-only | — | — |
| 26 | `last_manual_edit_at` | 87 | **I** | — | — | — | keep | — | set by the admin write path | — | — |
| 27 | `objectives` | 137 | D | DOC | CG | MC | **→ Cr** | F4 | sum of objects + GCP ≈ net proceeds ±1%; GCP ≤ 25% of gross | CG. | Rights/OFS: no objects section; expect empty, not a gap |
| 28 | `bse_ipo_no` | 10 | **I** | BSE | — | — | keep | — | integer from the BSE payload | — | BSE-listed only |
| 29 | `bse_payload_lead_manager_count` | 10 | **I** | BSE | — | — | keep | — | integer; used only as the cross-check in field 21 | — | BSE-listed only |
| 30 | `company_website` | 30 | D | DOC | CG | — | keep | E7 | resolves over HTTPS; same registered domain as the filing | — | — |
| 31 | `verifier_url` | 213 | **I** | — | — | — | keep | — | our own audit pointer | — | — |
| 32 | `cin` | 27 | D | DOC | — | — | keep | E7 | `^[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$` | MCA lookup (not built). No second source exists — a document-only field. | — |

### 1.2.1 E-1 — the fields where the exchange wins, under the re-filing test (S-05)

**This is no longer an exception. It is an application of a rule.**

The owner confirmed the governing principle on 2026-09-08, and it lives in
`docs/specs/per-ipo-due-step-pipeline.md` **S-05** — the SSOT for source tiers. It is not restated
here; the one line that matters is:

> **The filing wins wherever a change to the fact forces a new filing. The exchange wins where it
> does not.**

Almost every fact obliges the issuer to re-file when it changes, so the document stays current by
construction and tier 1a is right. The bidding timetable is the one group where nothing is re-filed:
a price band advertisement is printed once and is **never reprinted when a window is extended**.

That reading removes the contradiction between this design and the approved source-tier spec (finding
F-43): S-03 stands untouched, and E-1 is what S-05 produces when applied to the timetable — not a
carve-out from it. The practical consequence is unchanged from the owner's original instruction:
**NSE first, BSE second, Chittorgarh third, and the document is not a source for these fields.**

**Source order for every field in E-1:** round 1 **NSE**, round 2 **BSE**, round 3 Chittorgarh.
The offer document is not a source for these fields at any round.

**Why.** The price band advertisement does print an indicative timetable, so by the letter of the
100% rule these would be document fields. But the advertisement is printed once and **is never
reissued when a company extends its bidding window.** NSE and BSE update the same day; the PDF does
not. Sourcing these from the document would publish a stale close date on a live IPO — the single
most damaging error this site can make, and the reason the W-117 rule exists.

**The fields in E-1 — ten.** The owner named five and then directed (2026-09-08): *"list the
full timetable family for me to see and understand. Apply the same rule to all the timetable
fields."* The full family, established by walking every date- and schedule-like field among the 194
fields known at the time and testing each against one question — **does this value change when the
bidding window changes?** Two of the twelve originally named here were removed 2026-09-08 closing
F-22: `anchor_investors.lock_in_50_percent_date` and `lock_in_remaining_date` are not independently
sourced at all — they are **derived** (`allotment_date + 30 / + 90 days`) and move automatically
whenever field 4 moves, so E-1 membership was never the right frame for them. See the note below the
table.

| # | Field | Contract § | Rows | Source today | Effect of E-1 |
|---|---|---|---:|---|---|
| 1 | `anchor_investors.bid_date` | B1 | 2 | document (no provenance row) | **flips to exchange-first** |
| 2 | `ipos.open_date` | B2 | 289 | 236 web · 50 exch · 3 doc | already exchange-first; websites demoted to round 3 |
| 3 | `ipos.close_date` | B2 | 289 | 237 web · 49 exch · 3 doc | as 2 |
| 4 | `ipos.allotment_date` | B3 | 289 | 234 web · 49 exch · 6 doc | **6 document values flip** |
| 5 | `ipo_details.basis_of_allotment_date` | B3 | 3 | 3 doc (100%) | **flips** |
| 6 | `ipo_details.initiation_of_refunds_date` | B4 | 7 | 7 doc (100%) | **flips** |
| 7 | `ipo_details.credit_of_shares_date` | B5 | 3 | 3 doc (100%) | **flips** |
| 8 | `ipos.listing_date` | B6 | 289 | 238 web · 51 exch · 0 doc | already exchange-first |
| 9 | `ipos.status` | — | 289 | 230 web · 56 exch · 3 doc | named by the owner; position in the timetable |
| 10 | `ipos.listing_exchanges` | A15 | 208 | 161 web · 23 exch · 24 doc | named by the owner; **24 document values flip** |

**Removed from E-1, F-22 (2026-09-08):** `anchor_investors.lock_in_50_percent_date` and
`lock_in_remaining_date` (contract § not applicable — these have no exchange or document filing of
their own). They are class **C**, computed as `allotment_date + 30 days` and `allotment_date + 90
days` per the SEBI circular — **that regulation reading is UNVERIFIED against the circular text**
and should be confirmed before this design is built from. Separately: **the live scraper does not
compute them this way today.** `scraper/src/scrapers/anchor-investors-scraper.ts:302` derives both
dates from the anchor **bid** date instead of the allotment date, which lands roughly a week early —
an existing production bug, tracked separately, not fixed by this design.

**Deliberately NOT in E-1, and why.** Two fields sit in the same printed table but cannot go stale,
because they hold a **time of day rather than a date**: when a window is extended the date moves,
5 PM is still 5 PM.

| Field | § | Rows | Reason it stays document-first |
|---|---|---:|---|
| `ipo_details.upi_cutoff_time` | B7 | 9, all document | clock time, not a date |
| `ipo_details.bid_windows` | B8 | 10, all document | per-investor-class clock windows, not dates |

Three more date fields stay document-owned because they record history rather than schedule:
`documents.filing_date` (26 rows — the RoC filing date never moves, and the document-type healing
rule in §6.2 depends on it), `brlm_track_record.as_of_date`, and `ipo_details.designated_exchange`
(a structural fact of the offer, not a schedule item).

Adding the two clock-time fields to E-1 would cost nothing operationally, but it would put fields in
the exception list that the exception's own reason does not cover — which is how an exception list
becomes a dumping ground. E-1 is held to exactly the fields that can go stale. If the owner would
rather they be included for consistency, it is a two-row change here.

**On SME.** The order is NSE then BSE as instructed. For a single-exchange IPO the absent exchange
simply has no payload and answers `NOT_PRINTED` at zero cost — an SME-on-BSE IPO therefore resolves
on BSE in round 2, and an SME-on-NSE IPO on NSE in round 1. No separate rule is needed; the existing
per-type source resolution in §2.2 handles it. Measured population: 106 SME-on-BSE, 61 SME-on-NSE.

**The document is deliberately NOT a verification source for E-1 fields.** A printed date and an
extended date legitimately differ, so comparing them would generate a permanent stream of false
disagreements and bury the real ones. Verification for E-1 is the other exchange, plus our own date
arithmetic (`open ≤ close < allotment < refund ≤ credit < listing`, and `listing ≤ close + 3`
working days).

**E-1 is counted, not hidden.** Check 4.3b reports the ten E-1 fields as a fixed, named exclusion
alongside the round-1 yield, so "100% of document-owned fields" is always read against a visible
list of what was excluded and why. If that list ever grows without a decision recorded here, check
4.6 alarms.

### 1.3 `ipo_details` — issue mechanics (23 live fields)

Every field here is class **D**: the offer document is the only place these are printed in full.
Rank 2 is the exchange circular where one exists, rank 3 Chittorgarh's detail page.
**None of the 23 has a matrix entry today.** `ipo_details` exists for only 20 of 327 IPOs.

| # | Field | rows | 1 | 2 | 3 | Unit | Doc § | Check | Verify / disagreement | Exceptions |
|---|---|---:|---|---|---|---|---|---|---|---|
| 33 | `company_description` | 9 | DOC | CG | MC | keep | F1 | ≤ 1,200 chars | CG | duplicate of `ipos.company_description`; §5.5 says which one wins |
| 34 | `issue_type` | 15 | DOC | BSE | CG | keep | A11 | BOOK_BUILDING / FIXED_PRICE / HYBRID; FIXED_PRICE requires floor = cap | CG | SME is commonly FIXED_PRICE — not an anomaly |
| 35 | `fresh_issue` | 8 | DOC | BSE | CG | **→ Cr** | A5 | `fresh + OFS = issue_size ±0.5%` | CG | OFS-only: legitimately 0, not missing |
| 36 | `ofs_issue` | 4 | DOC | BSE | CG | **→ Cr** | A6 | as 35 | CG | fresh-only: legitimately 0 |
| 37 | `face_value` | 14 | DOC | BSE | — | keep | A2 | equals `ipos.face_value` | `ipos.face_value` — a mismatch is an internal conflict, not a source conflict | — |
| 38 | `basis_of_allotment_date` | 3 | **NSE** | **BSE** | CG | keep | B3 | `> close < listing` | the other exchange | class **T**, **named exception E-1** |
| 39 | `initiation_of_refunds_date` | 7 | **NSE** | **BSE** | CG | keep | B4 | `≥ allotment` | the other exchange | class **T**, **named exception E-1** |
| 40 | `credit_of_shares_date` | 3 | **NSE** | **BSE** | CG | keep | B5 | `≥ refunds`, `≤ listing` | the other exchange | class **T**, **named exception E-1** |
| 41 | `exchanges` | 20 | DOC | NSE | BSE | keep | A15 | equals `ipos.listing_exchanges` | internal | — |
| 42 | `data_source` | 20 | **I** | — | — | keep | — | our own label | — | — |
| 43 | `last_verified_at` | 20 | **I** | — | — | keep | — | pipeline clock | — | — |
| 44 | `compliance_officer` | 10 | DOC | — | — | keep | E4 | non-empty person name | none — document-only | — |
| 45 | `compliance_officer_phone` | 5 | DOC | — | — | keep | E4 | Indian phone form | none | — |
| 46 | `compliance_officer_email` | 8 | DOC | — | — | keep | E4 | email form; domain matches the company website | none | — |
| 47 | `upi_cutoff_time` | 9 | DOC | NSE | — | keep | B7 | time-of-day on the close date | NSE circular | — |
| 48 | `designated_exchange` | 8 | DOC | NSE | BSE | keep | A14 | one of {NSE, BSE}; must be in `listing_exchanges` | internal | SME-on-BSE: always BSE |
| 49 | `lot_multiple` | 8 | DOC | BSE | — | keep | A3 | positive integer; `lot_multiple × lot × floor` is the true minimum | BSE | **SME: 2 since the 2025 rule** — this is the field that records it, rather than doubling `lot_size` |
| 50 | `allocation_pct` | 6 | DOC | NSE | — | keep | A13 | QIB + NII + retail ≤ 100; book-built QIB ≥ 50 (≥ 75 where the regulation is cited) | NSE circular | Fixed-price SME: different split, check relaxed to ≤ 100 only |
| 51 | `pre_ipo_placement` | 5 | DOC | — | — | keep | D6 | boolean | none | absent for Rights/OFS |
| 52 | `bid_windows` | 10 | DOC | NSE | — | keep | B8 | each window inside open..close | NSE | — |
| 53 | `promoter_shares_held` | 1 | DOC | — | — | keep | D2 | `≤ total pre-issue shares` | none | — |
| 54 | `sebi_regulation_cited` | 6 | DOC | — | — | keep | A12 | matches `Reg \d+\(\d+\)` | none | — |
| 55 | `promoter_group_transactions_since_drhp` | 3 | DOC | — | — | keep | D7 | array; empty is a valid answer and must be stored as empty, not null | none | only meaningful when a DRHP preceded the RHP |

### 1.4 `financial_data` — the legacy financial row (26 live fields)

All class **D**, rank 1 DOC, rank 2 CG, rank 3 MC. All already stored in **crore** — this table is
the unit the rest of the database should move to, not away from.

**This whole table is on notice.** Its `*Fy2022/23/24` columns are hard-coded fiscal years, and
§0.9 shows that costs us the two newest years on a live IPO. §5.2 proposes `financial_statements`
becomes the source of truth and `financial_data` becomes a derived view of its three newest years.

| # | Fields | rows | Unit | Doc § | Check | Verify / disagreement |
|---|---|---:|---|---|---|---|
| 56–58 | `revenue_fy2022/23/24` | 3 / 11 / 22 | crore (keep) | C1 | ≥ 0; years consecutive; unit line found in the document and applied | CG detail page. Disagreement = re-read the restated P&L. |
| 59–61 | `profit_fy2022/23/24` | 4 / 126 / 155 | crore (keep) | C1 | sign consistent with the Risk Factors table when both are present | CG |
| 62 | `net_worth` | 160 | crore (keep) | C2 | `= reserves + share capital ±1%` | CG |
| 63 | `pe_ratio` | 135 | ratio (keep) | A9 | `= cap ÷ post-issue EPS ±1%`; loss-making → null with reason, never 0 | CG. A PE where EPS ≤ 0 is a defect, not a disagreement. |
| 64 | `eps` | 149 | ₹/share (keep) | C6 | sign matches PAT | CG |
| 65 | `roe` | 123 | % (keep) | — | −100 ≤ x ≤ 100 outside a loss year | CG |
| 66 | `debt_to_equity` | 115 | ratio (keep) | — | 0 ≤ x ≤ 50 | CG |
| 67 | `reserves_and_surplus` | 140 | crore (keep) | C2 | with 62 | CG |
| 68 | `total_assets` | 144 | crore (keep) | C2 | `≥ net_worth` | CG |
| 69 | `total_borrowing` | 133 | crore (keep) | C2 | `≤ total_assets` | CG |
| 70–71 | `promoter_holding_pre/post_issue` | 140 / 136 | % (keep) | D8 | `post < pre` when there is a fresh issue; `post = pre × pre_shares ÷ (pre_shares + fresh) ±1%` | CG |
| 72 | `market_cap` | 142 | crore (keep) | A8 | `= post-issue shares × cap ±0.5%` | CG. Must agree with `ipo_valuation.mcap_at_cap` after that field's unit conversion — today they are in different units (§0.8). |
| 73–74 | `pre_ipo_eps`, `post_ipo_eps` | 140 / 133 | ₹/share (keep) | C6 | `post ≤ pre` when fresh shares are issued | CG |
| 75 | `ronw` | 138 | % (keep) | A10 | matches `ipo_valuation.ronw_weighted_3y` within 1pp, or the difference is explained (single-year vs weighted) | CG |
| 76–78 | `ebitda_fy2022/23/24` | 2 / 120 / 148 | crore (keep) | C1 | `≤ total_income` | CG |
| 79–81 | `total_income_fy2022/23/24` | 3 / 126 / 153 | crore (keep) | C1 | `≥ revenue` | CG |

### 1.5 `financial_statements` — the per-year financial rows (11 live fields)

All class **D**. **Six of the eleven have Chittorgarh at rank 2 and Moneycontrol at rank 3** — CG's
detail page carries a restated per-fiscal-year "Company Financials" table
(`scraper/src/scrapers/chittorgarh-detail-fields.ts`, `getTableById(html,'financialTable')`) giving
revenue, total income, EBITDA and PAT per year plus the fiscal years themselves. The five that stay
document-only are `basis`, `unit`, `eps_basic`, `eps_diluted` and `op_cash_flow` — CG prints a single
pre/post-issue EPS pair and no basis, unit or cash-flow line. **Appendix A is authoritative for the
per-field ranks.** A field here that the document cannot supply stays null — there is nowhere else
to go, and that is the correct answer, not a failure.

**This table should become the source of truth for financials** (§5.2), which makes its unit
handling the single most important unit decision in this design.

| # | Field | rows | Unit | Doc § | Check | Verify / disagreement |
|---|---|---:|---|---|---|---|
| 82 | `fiscal_year` | 83 | keep | C1 | read from the statement header, never assumed; consecutive within the IPO | the header itself — a non-consecutive set fails the whole group |
| 83 | `basis` | 83 | keep | C8 | RESTATED or STANDALONE, read from the header | — |
| 84 | `unit` | 83 | **see below** | C7 | MILLION / LAKH / CRORE, read from the document's own unit line | — |
| 85 | `revenue` | 65 | **→ Cr** | C1 | ≥ 0 | `financial_data.revenue_fy*` for the overlapping years, after conversion |
| 86 | `total_income` | 63 | **→ Cr** | C1 | `≥ revenue` | as 85 |
| 87 | `ebitda` | 53 | **→ Cr** | C1 | `≤ total_income` | as 85 |
| 88 | `pat` | 67 | **→ Cr** | C1 | sign consistent with EPS | as 85 |
| 89 | `net_worth` | 54 | **→ Cr** | C2 | positive unless the document shows accumulated losses | as 85 |
| 90 | `eps_basic` | 52 | ₹/share (keep) | C6 | sign matches PAT | CG |
| 91 | `eps_diluted` | 12 | ₹/share (keep) | C6 | `|diluted| ≤ |basic|` | CG |
| 92 | `op_cash_flow` | 12 | **→ Cr** | C3 | same year set as C1 | none |

**The `unit` column decision.** Today the amounts are stored raw (55 rows MILLION, 10 LAKH) and the
`unit` column tells the reader what to do. That is a trap: any query that forgets to join on `unit`
is wrong by 10× or 100×. Under O-2 the amounts are **converted to crore on write** and `unit` is
kept as a record of what the document printed, not as an instruction to the reader. Renaming it
`source_unit` in the same migration makes that unambiguous.

### 1.6 `ipo_valuation` — the price-band advertisement table (17 live fields)

All class **D**, **document-only** (rank 1 DOC, no rank 2 or 3 — no website prints shares-at-floor).
`pricing_event` distinguishes the PBA row from the Prospectus row, so both are kept and the newer
event wins on read.

| # | Field | rows | Unit | Doc § | Check | Notes |
|---|---|---:|---|---|---|---|
| 93 | `pricing_event` | 14 | keep | — | PRICE_BAND_AD or PROSPECTUS | the row key; never overwritten across events |
| 94–95 | `price_floor`, `price_cap` | 10 / 10 | ₹/share (keep) | A1 | `floor < cap`; equal `ipos.price_range_min/max` | an internal mismatch is a defect, not a source conflict |
| 96–97 | `shares_at_floor / _cap` | 6 / 6 | count (keep) | A7 | `shares_floor > shares_cap`; `shares × price ≈ fresh amount ±0.5%` | |
| 98–99 | `mcap_at_floor / _cap` | 4 / 4 | **→ Cr** | A8 | `mcap_floor < mcap_cap`; `= post-issue shares × price ±0.5%` | **stored in rupees today** while `financial_data.market_cap` is in crore |
| 100–101 | `pe_at_floor / _cap` | 3 / 3 | ratio (keep) | A9 | null with `pe_not_ascertainable_reason` when loss-making — never 0 | the reason column is 0% populated, so today "not ascertainable" is indistinguishable from "not extracted" |
| 102 | `ronw_weighted_3y` | 12 | % (keep) | A10 | 3 years present and weighted per the document's footnote | |
| 103–104 | `face_value_multiple_floor / _cap` | 8 / 8 | **C** | A4 | `= price ÷ face_value ±0.01` | computed, not extracted — check it against the printed value when the document prints one |
| 105–106 | `fresh_shares_at_floor / _cap` | 6 / 6 | count (keep) | A7 | `fresh + OFS = total` at the same price point | |
| 107 | `ofs_shares` | 7 | count (keep) | A7 | as 105 | 0 for a fresh-only issue |
| 108–109 | `total_shares_at_floor / _cap` | 5 / 6 | count (keep) | A7 | `= fresh + OFS` at that price point | |

### 1.7 The remaining document tables (fields 110–137)

| # | Table.field | rows | Cls | 1 | 2 | 3 | Unit | Doc § | Check | Verify / disagreement |
|---|---|---:|---|---|---|---|---|---|---|---|
| 110 | `promoters.name` | 27 | D | DOC | — | — | keep | D1 | non-empty; matches a name in the shareholding table | none |
| 111 | `promoters.waca` | 5 | D | DOC | — | — | ₹/share keep | D3 | `cap ÷ WACA` equals the printed multiple ±1%; a nil WACA (bonus) is null with reason `bonus_nil`, never 0 | none |
| 112 | `promoters.is_promoter_group` | 27 | D | DOC | — | — | keep | D1 | boolean from the table it was read in | none |
| 113 | `ipo_intermediaries.role` | 161 | D | DOC | BSE | — | keep | E1–E6 | one of the 7 enum roles | BSE payload for BRLM and registrar |
| 114 | `ipo_intermediaries.name` | 161 | D | DOC | BSE | CG | keep | E1–E6 | non-empty | BSE, CG. Must reconcile with `ipos.lead_managers` for the BRLM rows. |
| 115 | `ipo_risk_factors.seq` | 2130 | D | DOC | — | — | keep | F2 | consecutive from 1; unique per IPO | none |
| 116 | `ipo_risk_factors.heading` | 2130 | D | DOC | — | — | keep | F2 | ≥ 20 headings for a mainboard IPO; unique | none |
| 117–120 | `brlm_track_record.*` | 2 each | D | DOC | — | — | counts keep | E2 | `closed_below ≤ issues_3y`; `as_of_date ≤ RHP filing date` | none |
| 121 | `peer_companies.company_name` | 326 | D | DOC | CG | — | keep | C9 | non-empty | CG |
| 122 | `peer_companies.is_listed` | 326 | D | DOC | CG | — | keep | C9 | boolean | CG |
| 123 | `peer_companies.pe_ratio` | 307 | D | DOC | CG | — | ratio keep | C9 | > 0 or null; never 0 for a profitable peer | CG |
| 124–125 | `peer_companies.eps`, `diluted_eps` | 321 / 256 | D | DOC | CG | — | ₹ keep | C9 | `|diluted| ≤ |basic|` | CG |
| 126 | `peer_companies.ronw` | 321 | D | DOC | CG | — | % keep | C9 | −100..100 | CG |
| 127 | `peer_companies.nav` | 316 | D | DOC | CG | — | ₹ keep | C9 | > 0 | CG |
| 128 | `peer_companies.pbv_ratio` | 5 | D | DOC | CG | — | ratio keep | C9 | `= price ÷ NAV ±1%` | CG |
| 129–130 | `peer_companies.data_source`, `last_updated` | 326 | I | — | — | — | keep | — | pipeline | — |
| 131 | `anchor_investors.bid_date` | 2 | **T** | **NSE** | **BSE** | CG | keep | B1 | `< open_date` | the other exchange. **Named exception E-1 (§1.2.1)** |
| 132 | `anchor_investors.total_shares_offered` | 2 | D | DOC | — | — | count keep | — | `= Σ investor_list.shares ±0` | internal |
| 133 | `anchor_investors.total_amount_raised` | 2 | D | DOC | — | — | crore (keep) | — | `= Σ investor_list.amount ±0.5%`; `= shares × cap ±0.5%` | internal |
| 134 | `anchor_investors.anchor_investors_count` | 2 | D | DOC | — | — | keep | — | `= len(investor_list)` | internal |
| 135–136 | `anchor_investors.lock_in_*_date` | 2 each | **C** | — | — | — | keep | — | `= allotment_date + 30d / + 90d` (SEBI circular, **UNVERIFIED** against the circular text) | derived, not sourced — **reclassed out of E-1, F-22 (2026-09-08)**; the live scraper computes both from `bid_date` instead of `allotment_date` (`anchor-investors-scraper.ts:302`), ~1 week early — a production bug, tracked separately |
| 137 | `anchor_investors.investor_list` | 2 | D | DOC | — | — | amounts **→ Cr** | — | Σ `percent_of_issue` ≤ 100 | internal |

### 1.8 `documents` — the filing register (15 live fields)

Class **I** throughout except `filing_date`. These describe our own handling of a PDF, and the pull
loop reads them rather than sourcing them.

| # | Field | rows | Cls | Written by | Check |
|---|---|---:|---|---|---|
| 138 | `type` | 256 | I | the classifier (`document-classifier.ts`) | one of the 15 enum types; a misclassification is what makes an old draft outrank a final ad, so this is a **Tier A** field |
| 139–140 | `title`, `url` | 256 | I | discovery | URL is absolute and on an allowed host |
| 141 | `file_size` | 93 | I | download | > 0; under the store cap |
| 142 | `uploaded_at` | 256 | I | download | UTC |
| 143 | `exchange` | 256 | I | discovery | NSE / BSE / BOTH |
| 144–146 | `media_type`, `sequence_number`, `is_active` | 256 | I | discovery | only one active row per (IPO, type) |
| 147–150 | `extraction_status`, `extracted_at`, `extraction_error`, `retry_count` | 256 / 62 / 18 / 256 | I | extraction | `retry_count` bounded by §3.4 |
| 151 | `sha256` | 115 | I | download | 64 hex; identity of the file for the re-read loop |
| 152 | `filing_date` | 24 | **D** | DOC cover, rank 2 BSE payload | `< open_date`; **this is the field the document-type healing rule depends on**, and it is populated on only 24 of 256 documents |

### 1.9 Live market data (fields 153–184)

| # | Table.field | rows | Cls | 1 | 2 | 3 | Unit | Check | Verify / disagreement |
|---|---|---:|---|---|---|---|---|---|---|
| 153 | `subscriptions.timestamp` | 27,489 | I | — | — | — | keep | UTC, monotonic per IPO | — |
| 154–157 | `subscriptions.qib / nii / retail / total_subscription` | 27,489 | **X** | NSE | BSE | CG | × keep | 0 ≤ x ≤ 5,000; `total ≈ Σ categories` weighted by shares offered ±2% | CG. Newest wins (`timeBased`). The document never prints these. |
| 158–160 | `employee`, `b_nii`, `s_nii` | 3,693 / 2,075 / 2,075 | **X** | NSE | BSE | — | × keep | `bNII + sNII ≈ nii` ±2% | — |
| 161–162 | `total_shares_bid`, `shares_offered` | 2,349 | **X** | NSE | BSE | — | count keep | `shares_offered` equals the document's `shares_at_cap` ±0.5% — **the one place the document verifies the exchange** | DOC. A disagreement here means the price band moved or our extraction is wrong. |
| 163 | `scope` | 126 | I | — | — | — | keep | BSE_ONLY / NSE_ONLY / CONSOLIDATED | — |
| 164–166 | `gmp_records.timestamp / gmp / source` | 8,369 | **W** | IG | CG | — | ₹/share keep | `|gmp| ≤ 3 × cap`; newest wins | the two grey-market sources against each other. No document, ever. |
| 167 | `gmp_records.gmp_percentage` | 8,365 | **C** | — | — | — | % | `= gmp ÷ cap × 100 ±0.1` | recomputed, never taken from the site |
| 168 | `listing_performance.listing_price` | 237 | **M** | NSE | BSE | CG | ₹ keep | > 0; within ±90% of issue price or flagged | CG |
| 169 | `listing_performance.issue_price` | 237 | **C** | — | — | — | ₹ | `= ipos.price_range_max` at listing | internal mismatch is a defect |
| 170 | `listing_gain_percent` | 237 | **C** | — | — | — | % | `= (listing − issue) ÷ issue × 100 ±0.01` | recomputed |
| 171–172 | `current_price`, `current_gain_percent` | 237 | **M / C** | NSE | BSE | — | ₹ / % | price > 0; gain recomputed | CG |
| 173 | `last_updated` | 237 | I | — | — | — | keep | pipeline clock | — |
| 174–175 | `current_price_bse / _nse` | 177 / 136 | **M** | BSE / NSE | — | — | ₹ keep | the two differ by < 5% during market hours or one is stale | each other |
| 176–178 | `symbol`, `company_name`, `listing_date` | 235 / 237 / 237 | **C** | — | — | — | keep | copies of `ipos.*`; must equal them | internal |
| 179 | `data_source` | 237 | I | — | — | — | keep | pipeline label | — |
| 180–184 | `ipo_demand_graph.timestamp / price_point / is_cut_off / cumulative_quantity / exchange` | 245 | **X** | NSE | BSE | — | keep | `price_point` inside the band or `is_cut_off`; quantity monotonic | the other exchange |

### 1.10 `registrars` — reference data (fields 185–194)

Class **D** for the identity fields, rank 1 DOC (§E3 prints the registrar's name, SEBI registration
number and address), rank 2 the registrar's own website (`REG`), rank 3 Chittorgarh. This is
per-registrar reference data, not per-IPO, so it is refreshed on the reference cadence (§2.6), not
in the per-IPO walk.

| # | Field | rows | Cls | 1 | 2 | 3 | Check |
|---|---|---:|---|---|---|---|---|
| 185–186 | `name`, `short_name` | 19 | D | DOC | REG | CG | non-empty; unique |
| 187–188 | `email`, `phone` | 15 | D | DOC | REG | — | contact form valid |
| 189 | `website` | 19 | D | REG | DOC | — | resolves over HTTPS |
| 190 | `allotment_check_url` | 14 | **I** | REG | — | — | resolves; **the only field here with a live health check** |
| 191 | `address` | 15 | D | DOC | REG | — | non-empty |
| 192 | `active` | 19 | **I** | ADMIN | — | — | boolean |
| 193–194 | `allotment_url_healthy`, `allotment_url_checked_at` | 19 / 14 | **I** | — | — | — | our own probe |

### 1.11 Exceptions by IPO type, gathered

Written once here rather than duplicated into every row.

| Type | Population today | Exceptions that apply |
|---|---:|---|
| **Mainboard IPO** | 99 | The base case. Full document set; both exchanges available as rank 2 and 3. |
| **SME on BSE** | 106 | `listing_exchanges = ["BSE"]`. **NSE cannot be rank 2 or 3 for any field** — there is no NSE payload. Minimum application is **2 lots** (SEBI 2025), recorded in `ipo_details.lot_multiple`, so the lot-value check is `2 × lot × floor ≥ ₹1,00,000`; applying the mainboard check is what produced the Qualiance false alarm. Commonly FIXED_PRICE, so the `cap ≤ 1.2 × floor` check is skipped and floor = cap is expected. Designated exchange is always BSE. |
| **SME on NSE** | 61 | Mirror image: `listing_exchanges = ["NSE"]`, **BSE cannot be rank 2 or 3**. Same 2-lot rule. |
| **SME on both** | 5 | Unusual for SME. Treat as mainboard for ranking, but flag for review — this is more likely a data error than a genuine dual listing, and §4 gives it a check. |
| **Rights issue** | 8 | No DRHP, no price band advertisement, no anchor round, no lot size in the IPO sense. Rank 1 is the letter of offer; where no document type exists for it, rank 1 falls to BSE. Fields 93–109, 131–137 are `NOT_APPLICABLE`, not gaps. |
| **OFS** | 19 | No fresh issue: field 35 is legitimately 0 and `issue_size = ofs_issue`. No objects of the offer (field 27 empty is correct). No DRHP stage. |
| **NCD** | 7 | Debt. Price band, EPS, PE, promoter holding and peer comparison are all `NOT_APPLICABLE`. Its own prospectus is rank 1 for coupon, tenor and rating — **none of which we currently store**, which is a gap this design surfaces rather than closes. |
| **INVITS / REITS** | 5 | `segment` is NULL for all 5 today. Unit-based, not share-based; lot size and face value do not apply in the same sense. Out of the pull model's first release — say so explicitly rather than letting them fail every check. |
| **BUYBACK / TENDER** | 17 | Corporate actions, not offerings. They should arguably not be on an IPO site at all (the Mopshop / Sarda class). Field 24 `offering_type` is the guard; §4.6 gives it a check. |
| **FPO** | **0 today** | The brief asked for follow-on offers. **There are none on production.** The rule is written and not exercised: no draft prospectus stage, so rank 1 is the RHP or prospectus directly; everything else follows mainboard. Because no row exercises it, it carries a higher risk of being wrong than any other line in this table. |

### 1.11.1 Retired source: Moneycontrol (owner decision, 2026-09-09)

**Moneycontrol is retired as a source.** It holds no rank in this design.

**What it actually served**, corrected — I stated "nine fields" from one grep of one file, which was
wrong. Across `moneycontrol-scraper.ts` and `moneycontrol-orchestrator-v2.ts` it produces about
**fifteen core fields plus four subscription figures**: allotment date, close date, company name,
ISIN, issue size, listing date, listing exchange, lot size, offering type, open date, price band low
and high, segment, status, symbol, and the QIB/NII/retail/total subscription multiples.
(`field_sources` also carries `faceValue` and `registrar` rows from Moneycontrol that neither file
maps today — pre-refactor writes.)

**The conclusion is unchanged, and it is the reason to retire it: for every one of those fields, the
offer document plus NSE plus BSE — or the document plus Chittorgarh — already fill the top three.**
Moneycontrol is fourth-best at everything and reaches a rank nowhere. Its ~180 provenance rows exist
only because the **push** model let it win by arriving first, not because it was preferred.

**Retirement is not deletion, and the order matters:**

1. **Now, in this design:** zero ranks, and no capability entry. The pull loop never asks it.
2. **Next:** stop scheduling the scraper. This is where the saving is — one fewer source fetched
   every aggregator run.
3. **Not done:** the `MONEYCONTROL` value stays in the `scraper_source` enum, and the ~180 existing
   provenance rows stay exactly as they are. **Those rows are the historical truth of where a value
   came from** — rewriting them would be falsifying provenance. They will be superseded naturally as
   the pull loop re-sources those fields from the document.
4. **Kept, and separate:** `moneycontrol-rss.ts` reads an IPO **news** feed, not IPO data. It is a
   different thing that happens to share a domain name and is untouched by this decision.

**What we lose:** nothing this design ranks. **What to watch:** if a field ever falls through all
three ranks on an IPO where Moneycontrol used to supply it, that is an `EXHAUSTED` row (§2.6) and it
is visible — it is not silence.

### 1.12 Retired fields — never write these (owner decision, 2026-09-08)

The public API returns **19 fields that are `null` on all 327 production IPOs**, and the `ipos` table
carries **6 more columns not even declared in `schema.ts`** — orphaned, unreachable from Drizzle,
readable only by raw SQL. Twenty-five in total.

**They are not gaps. They are duplicates of data that is already flowing**, and the live homes are
full while the mirrors are empty:

| The empty API fields | Where the data actually lives | Volume there | Source |
|---|---|---:|---|
| `subscriptionRetail` · `subscriptionHni` · `subscriptionQib` · `subscriptionTotal` | `subscriptions` | **27,514 rows · 111 IPOs** | NSE → BSE |
| `gmpPrice` · `gmpPercentageHistorical` · `gmpUpdatedAtHistorical` — and the orphans `gmp`, `gmp_percentage`, `gmp_updated_at` | `gmp_records` | **8,400 rows · 90 IPOs** | InvestorGain → Chittorgarh |
| `listingPriceHistorical` · `listingDateHistorical` · `listingGainPercentage` · `listingGainAmount` · `currentPrice` · `currentGainPercentage` · `currentGainAmount` · `currentPriceUpdatedAt` | `listing_performance` | **242 rows · 242 IPOs** | NSE/BSE for prices; the gains are computed |
| `historicalDataSource` · `historicalDataScrapedAt` | `listing_performance.data_source` / `last_updated` | — | our own pipeline |
| orphans `price_band_low` · `price_band_high` | `ipos.price_range_min/max` | 300 IPOs | DOC → NSE → BSE |
| orphan `exchange` | `ipos.listing_exchanges` | 327 IPOs | NSE → BSE (E-1) |

So `ipos.subscription_total` is null on all 327 IPOs while `subscriptions` holds 27,514 rows. Same
data — one column empty, one table full.

**Why this matters to the pull model specifically.** These are a trap. The design introduces a
configuration file listing every field and its sources (§2.3.5). While a column exists *and* appears
in the API, someone eventually adds it to that config and starts writing to it **in parallel with the
child table the rest of the codebase reads** — the exact duplicate-write problem this design exists
to remove, reintroduced by a leftover.

**The owner's decision, 2026-09-08, in three steps:**

1. **Now, in this design: all 25 are marked `never write`.** No plan row, no rank, no config entry.
2. **Next release, as its own small change: the 19 stop appearing in the API response.** This is
   near-zero risk and not really a breaking change — **a field that is `null` on every IPO is already
   functionally absent to every consumer.** A reader gets `null` today and `undefined` afterwards;
   both are falsy and every consumer already handles the empty case, because that is all it has ever
   received. Only code testing for the *key's existence* rather than its value would notice, and the
   owner confirmed **nothing outside this repo reads this API**.
3. **Later, after phase 1: drop the columns**, behind a per-table consumer audit. That is the part
   that carries real risk — `listing_performance.current_price` is populated and shares a name with
   the dead `ipos.current_price`, so a name-based grep cannot tell them apart.

**Two exceptions held back deliberately: `rating` and `ratingRationale`.** These are not mirrors of
anything. They would be **IPODhan's own view of an IPO**, for which no external source exists or
should. `ipo_scores` holds 10 rows and `ipo_reviews` holds zero — **an unbuilt feature, not dead
weight.** They leave the API response with the other 17 (they are null either way, so nothing is
lost), but **the columns stay**, so the product decision remains open rather than being closed as a
side effect of tidying.

## 2. How we go and get it — the pull loop

**Scope: phase 1 only.** 19 IPOs, status OPEN or UPCOMING, all `offering_type = 'IPO'`, mainboard or
SME (measured 2026-09-08). No closed IPO is read or written. Closed IPOs follow afterwards, one at a
time, newest close date first — that is section 6, and none of it is specified here.

Every claim below about how the system behaves today carries the file and line it was read from.
Anything not cited is a proposal, not a fact. That rule exists because the first draft of this
section asserted seven things about our own code that were false, and an implementer who trusted
them would have built the wrong thing.

### 2.1 What runs, and when — the owner's cadence, decided 2026-09-09

**This supersedes D-13's timing for everything below.** D-13 (owner, 2026-09-03,
`docs/walks/2026-09-02-deepa-pipeline-walk.md`) moved discovery off "every wake" and onto four IST
slots; its code is `scraper/src/scheduler/due-step-cycle.ts:15`. On **2026-09-09** the owner replaced
that timing (OD-19):

> *"Offer document never on a clock. Live figures only during bidding. Subscription-related work can
> run every hour or even thirty minutes, but not the scraper that is fetching the IPO data. Three
> runs a day, midnight, eight in the morning, two in the afternoon. Add another cycle at ten o'clock
> at night that deals only with old IPOs, latest closed first, at most 10 old IPOs a day, do not
> repeat which are already done."*

D-13's *principle* survives — work runs on named occasions, not on a drumbeat. Its *slots* do not.

#### The scheduled work, in full

| Job | When (IST) | Lock it takes | What it touches | What it must never do |
|---|---|---|---|---|
| **Data job** | **00:00, 08:00, 14:00** | `heavy` | discovery; document download and extraction; the per-field pull walk; verification reads | never re-read a document because time passed |
| **Opening-day check** | about **09:45**, only on a day an IPO is due to open (OD-31) | `heavy`, skipped if held | the two exchange lists only: register a new or changed IPO so the live jobs can see it | never fetch, download or extract a filing; it writes identity and status, nothing else |
| **Live-figures job** | **every 30 minutes, 10:00–18:30**, only on a day when at least one IPO is OPEN | `live` | subscription and the demand graph (OD-28) | never touch a document, a field plan row, or any static field |
| **Grey-market premium** | **every 30 minutes** on the same wake, whenever any IPO is UPCOMING or OPEN — evenings, weekends and holidays included (OD-28, F-41) | `live` | `gmp_records` only | never gated on bidding hours, and never touches a document or a static field |
| **Post-listing price** | **every 15 minutes during exchange market hours, for 90 days after listing**, then it stops (OD-29) | `live` | `ipos.current_price` and its as-of stamp, from the free NSE and BSE public quote endpoints | never a broker feed, and never touches a document or a static field |
| **Closed-IPO job** | **22:00** | `heavy` | at most **10** IPOs a night, status LISTED or CLOSED, close date before today, ordered by close date **descending**, each marked done so it is never picked twice | never start while the heavy lock is held |

Six pieces of scheduled work, and one rule that binds all of them: **no job ever kills a running
cycle.**

*(The owner's words of 2026-09-09 morning define three jobs and the no-kill rule; the opening-day
check, the grey-market split and the post-listing price window were decided that afternoon as OD-31,
OD-28 and OD-29. They are listed as separate rows because they have separate schedules and separate
locks, not because anyone renamed a rule into a job.)*

#### The two locks (OD-27)

The owner's rule: *"The live figures job should have its own lock. The data job and the ten o'clock
job can share the heavy one. The data job must never block the live figures."*

| Lock | Held by | TTL | What happens when it is held |
|---|---|---|---|
| `heavy` | the data job, the opening-day check, the closed-IPO job | 55 min (derived below) | the arriving job **skips this occurrence and logs the skip with the holder's start time**; it never kills, never queues, never waits |
| `live` | the live-figures job, the grey-market fetch, the post-listing price fetch | 4 min | the arriving wake skips; these are single HTTP reads, so a held lock means the previous one is stuck and that is what the skip line reports |

Two locks, not one, for a measured reason: a data job may legitimately run for 50 minutes
(the wake budget below), and on a closing day the subscription figure must keep moving through all
50 of those minutes. Under one lock the 14:00 data job would blank the most-watched number on the
site for the rest of the afternoon. Check **D17** fails the design if the live-figures job is ever
described as taking, waiting on, or being skipped by the heavy lock.

#### One download, one read (OD-33)

The owner's rule: *"Once a scraper scrapes an IPO document it should not rescrape the same document
again. Only a new document for an existing IPO is scraped."* Written as four rules with a test each:

| Rule | Test | Where it stands today |
|---|---|---|
| The same bytes are never downloaded twice: identity is the sha256 of the content, not the URL | a second discovery of the same PDF at a different URL produces zero downloads | already true — `document-state-machine.ts:670` compares the hash before storing |
| A COMPLETED document is never extracted a second time | re-running a cycle over an IPO whose filings are all COMPLETED spawns no extractor | partly true; the exception below is the only one allowed |
| The one allowed re-extraction is an extractor-version change, and only for the fields that failed | a bumped `extractorVersion` re-runs only rows whose field set is incomplete | `extractorVersion` exists (`document-state-machine.ts:295`); the field-level condition is build item 8 |
| The timed backoff retry is removed | no code path schedules a document fetch by elapsed time | **not true today** — the 15-minute backoff doubling to 6 hours over 10 attempts still exists and is deleted by OD-21 and this rule |

Every later re-read (a website disagreement, a fixed extractor) works from the **stored text**, never
from a fresh download — which is what makes OD-32's seven-day PDF window safe.

**A document is read once, on arrival**, and again only when (a) a newer document *type* arrives for
that IPO, (b) the extractor version changes, or (c) the re-read loop of §3 asks for it. There is no
interval, no backoff timer and no nightly re-extraction of a document that has not changed. This is
the whole of *"offer document never on a clock"*, and check **D12** fails the design if any section
puts a document read back on an interval.

**Verification reads go to the exchanges first — NSE, then BSE — and only then to websites** (owner,
2026-09-09). §2.5 orders the verification sources on that rule.

#### The opening-day check, and why 09:45 is a measured number (OD-31)

The 08:00 data job can run before either exchange has published the day's opening list, and the next
data job is at 14:00 — so an IPO that opens at 10:00 could be invisible on the site for the first
four hours of its own bidding window. The fix is a **discovery-only** check: fetch the two exchange
lists, register anything new or changed, and stop. It downloads nothing and extracts nothing, which
is why it is safe to run on a clock without violating *"offer document never on a clock"*.

The time is not a guess. Probe `probes/exchange-list-change-time.mjs` records, on days an IPO is due
to open, the wall-clock time at which each exchange's list first shows the new row; the check is
placed **15 minutes after the later of the two**. Its output is
`probes/exchange-list-change-time.out.json`, and the number in the table above is read from it.

#### Post-listing prices: 15 minutes, 90 days, and no broker feed (OD-29)

After listing, the page's most-asked question stops being "what is the GMP" and becomes "where is it
trading". The owner's decision: *"yes I accept 15-minute delayed prices from the exchanges' public
endpoints, with the 90-day windows."*

- **Source:** the same free public NSE and BSE quote endpoints the scrapers already reach — no new
  vendor, no key, no cost (§7.4 counts the calls).
- **Window:** every 15 minutes during exchange market hours, for 90 days after the listing date;
  after that the job stops for that IPO and the page keeps the last value it had.
- **Label:** the page shows the price **with the timestamp it was read at, marked "delayed"**. A
  price with no as-of stamp is the defect this rule exists to prevent.
- **What is refused, and why:** a broker feed (Zerodha Kite, Angel One SmartAPI, Upstox) is licensed
  for the account holder's own use. Redistributing a quote to the public needs an NSE Data and
  Analytics licence, which this project does not hold. No broker feed reaches the public site.

#### Why these numbers, and what they cost

Two or three mainboard IPOs open in a typical week; the static facts about an issue change on the
day a document is filed, not every half hour. Three data passes a day is roughly ten times more
often than the underlying data actually moves. What genuinely moves within a day is the
subscription book, the demand graph and the grey-market premium — and those are the live-figures
job, which is a handful of HTTP calls and touches nothing static. The exchanges publish the closing
day's final subscription after 17:00, which is why the live window runs to 18:30 rather than 17:00.

The cost of the change is latency on a document filed at, say, 09:00: it is picked up at 14:00
rather than within the hour. That is accepted deliberately — the alternative, which is what runs
today, is a scraper that treats elapsed time as a reason to re-open a document it has already read,
and gets killed mid-extraction for its trouble.

#### The force-kill goes, and the budgets that depend on it

Today the scraper is started `--no-autorestart --cron-restart="*/30 * * * *"`
(`scripts/deploy-linux.sh:237` computes that default). A cycle still running on the half hour is
**killed**, and because extraction is a blocking `spawnSync` the signal handler that releases locks
cannot run — so `FILING_EXTRACTION_LOCK_TTL_MS` (`filing-auto-persist.ts:530`, 45 minutes) is held to
expiry and the next wakes lose their extraction slot. That force-kill is what made a 10-minute
extraction timeout necessary in the first place.

**Under OD-19 the force-kill goes.** Each job is started by a scheduler that **skips its start when
the cycle lock is held** — it never kills what is running. That unlocks the budget changes the owner
directed, and they have to be derived rather than typed, because three constants are coupled:

| Constant | Today | Becomes | Where the number comes from |
|---|---|---|---|
| `EXTRACT_TIMEOUT_MS` (`filing-auto-persist.ts:166`) | 10 min | **30 min** | owner, OD-19 — a real prospectus extraction is no longer racing a 30-minute kill |
| wake budget `DOCUMENT_CYCLE_WAKE_BUDGET_MS` (`document-cycle.ts:182`) | 20 min | **50 min** | owner, OD-19 |
| `CYCLE_LOCK_TTL_MS` (`scraper/src/index.ts:179`) | wake + 5 = 25 min | **55 min** | *derived, not typed* — the existing expression `getWakeBudgetMs() + 5 min` already computes it |
| `FILING_EXTRACTION_LOCK_TTL_MS` (`filing-auto-persist.ts:530`) | 45 min | **60 min** | derived below |
| `DEFAULT_MAX_SPAWNS_PER_CYCLE` (`filing-auto-persist.ts:500`) | 3 | **3, but budget-bound** | see the new invariant |

**The invariant that makes this safe, and which does not exist today.** The current derivation
(`maxAnchorSpawnsWithinLockTtl`, `filing-auto-persist.ts:541`) computes the worst case as
`DEFAULT_MAX_SPAWNS_PER_CYCLE × EXTRACT_TIMEOUT_MS`. At the new numbers that is 3 × 30 = **90
minutes**, which is longer than the 50-minute wake it is supposed to fit inside and longer than any
sane lock TTL. Raising the timeout without touching this would produce exactly the kind of arithmetic
that passes a unit test and breaks in production.

So the design adds one rule to the extraction runner:

> **A filing extraction is never started unless the remaining wake budget is at least
> `EXTRACT_TIMEOUT_MS`.**

With that rule the worst case of a whole filing pass is the wake budget itself — 50 minutes, not 90 —
whatever the spawn count is. The lock TTL then derives as
`wake budget (50) + one anchor sidecar at its configured timeout + LOCK_SLACK_MS (60 s)`, which is
under 60 minutes; `FILING_EXTRACTION_LOCK_TTL_MS = 60 min` is that bound rounded up to the minute.
`maxAnchorSpawnsWithinLockTtl` is re-derived from the wake budget instead of from
`spawns × timeout`, and the static test that guards it asserts the new expression rather than a
re-typed number.

The practical effect on throughput: a data job does up to three filing extractions when they are
quick and one when a big prospectus runs long, instead of starting a third and being killed. Three
data jobs a day is fewer *slots* than today's forty-eight wakes, but today's slots are mostly spent
either idle or dying — the honest comparison is against **completed** extractions, which is a number
this design does not yet have and which §4 makes a named check.

#### 2.1.1 One correction to how D-13 was built: grey-market premium is gated with subscription, and should not be

D-13 said *"live numbers"*. The implementation put **subscription, demand graph and GMP behind one
market-hours gate** (`scraper/src/index.ts:343` runs `live:GMP` only inside
`isMarketHoursIST`). Those three do not have the same shape:

- **Subscription and the demand graph only exist during bidding hours.** Gating them is correct.
- **The grey market is an informal market that is most active in the evening**, and it trades at
  weekends. Gating it to 10:00–17:00 weekdays freezes the number exactly when readers look at it.

**Measured on production, 2026-09-08 22:03 IST:**

| | Before the scheduler (pre-04 Sep) | After |
|---|---:|---:|
| GMP fetches on a Saturday or Sunday | 2,045 | **0** |

and the newest `gmp_records` row was **16:02 IST while it was 22:03** — six hours stale, and it stays
that way until 10:00 the next morning. `timestamp` is our own fetch clock, not the source's
(`investorgain-gmp-orchestrator-v2.ts:536` sets `timestamp: new Date()`), so this is our gap, not
InvestorGain's. Over a Friday-to-Monday weekend the published figure reaches **about 65 hours old**.

**APPROVED by the owner, 2026-09-08.** Split the live step. Subscription and demand graph stay
inside the market-hours gate. **GMP runs on every wake while an IPO is UPCOMING or OPEN, including
evenings, weekends and holidays.** It is one HTTP request against one page and it is the single
most-read number on an IPO page outside market hours.

This is a change to D-13's *implementation*, not to D-13. Finding **F-41**, approved.

#### 2.1.2 An open question: nothing runs between 17:30 and 08:30

Discovery has a **15-hour hole overnight**. Price band advertisements are commonly filed in the
evening for an issue that opens the next morning; if that is the real pattern, the site shows no
price band for the whole evening before an issue opens — the window in which people actually
research it.

**This is a hypothesis, not a measured fact, and it cannot be measured from our own data**: discovery
only runs at those four slots, so our record of when a document "appeared" is a record of when we
looked. A fifth slot around 21:00 IST would close it cheaply. **APPROVED by the owner, 2026-09-08: add the evening slot.** Finding **F-42**.

#### 2.1.3 A contradiction with an existing approved spec, surfaced rather than buried

`docs/specs/per-ipo-due-step-pipeline.md` §6 (source tiers S-03/S-04, decided 2026-09-03) says tier-1a
filings are the truth for *"every static field (terms, **timeline**, financials, promoters,
intermediaries, objects, risks)"*, and that a tier-1b exchange value must never override a filing
value.

**Exception E-1 in this design does the opposite for the bidding timetable** — it puts NSE and BSE
above the document for open, close, allotment and listing dates, because a printed advertisement is
never reissued when a window is extended (W-117).

Both have a real reason. They cannot both stand. The design's position is that E-1 is the narrower
and later rule and should win **for the twelve timetable fields only**, leaving §6 intact everywhere
else — but that is a change to an approved spec and it is the owner's to confirm. Until then §6 and
E-1 disagree in writing, and no implementer should be asked to guess which one governs.

### 2.2 The process this has to survive, which the first draft ignored

The scraper is **one pm2 process, not a cluster**, started
`--no-autorestart --cron-restart="*/30 * * * *"` (`scripts/deploy-linux.sh:681-682`). Three facts
follow, and together they set the shape of everything below:

1. **`cron-restart` on a running process is a restart, not a skip.** A walk still running at the
   thirty-minute boundary is killed.
2. **The worst-case extraction pass is 30 minutes** — `DEFAULT_MAX_SPAWNS_PER_CYCLE = 3`
   (`filing-auto-persist.ts:500`) × `EXTRACT_TIMEOUT_MS = 10 min` (`filing-auto-persist.ts:166`) —
   against a 30-minute cron. So being killed mid-walk is not an edge case. **It is the normal
   operating state.**
3. **Extraction is `spawnSync`** (`filing-auto-persist.ts:170`), which blocks the event loop, so the
   signal handler that releases locks (`document-cycle.ts:84-128`) cannot run during it. The process
   is killed outright and `FILING_EXTRACTION_LOCK_KEY` stays held for its full 45-minute TTL
   (`filing-auto-persist.ts:500-551`) — costing the next two wakes their extraction slot.

**Therefore the walk commits one field at a time and is resumable from any point.** No multi-IPO
batch held in memory and flushed at the end; no four-pass sequence that only makes sense if it
completes. Each field's outcome is written before the next field is attempted. A kill loses at most
the field in flight.

This replaces the first draft's four sequential passes per IPO, which were exactly the wrong shape
for a process on a thirty-minute drumbeat.

**And the drumbeat itself is going (OD-19, §2.1).** The `cron_restart` force-kill is removed and each
job skips its turn rather than killing the cycle in progress, so fact 1 above stops being true the
day item 7 ships. The one-field-at-a-time rule survives that change anyway, for a different reason: a
2-vCPU box can still lose a process to an OOM kill, a deploy or a crash mid-extraction, and a walk
that is only resumable when it was allowed to finish is not resumable. What the removal buys is that
being interrupted stops being the **normal** case and becomes the exceptional one.


#### 2.2.1 What arrives is not always a clean PDF (OD-36, OD-37)

A filing link on an exchange page is not a promise. Five things that really happen to these
documents were unwritten until now, and each is a rule with one real fixture behind it.

**Document handling (OD-36).**

| Rule | What it means in the loop | The fixture that proves the case is real |
|---|---|---|
| **Multi-part filings are extracted per part** | a filing published as Volume I / Volume II (or an NSE `.zip` holding several PDFs) is extracted part by part, and the **part number is written into provenance** beside the page number, so a field's citation reads "part 2, page 118" and can be checked | `probes/fixtures/` — the Skyways NSE archive is a 23 MB zip (`document-discovery-runner.ts:200` records the case that set the download budget) |
| **Image-only pages go to OCR, marked** | a page whose extractable text is below a density floor is treated as a scan: it is routed to OCR, every value taken from it is stamped `ocr` with a **lower confidence**, and a field whose only source is an OCR page is never allowed to win a disagreement against a text page | one scanned annexure per SME batch is the norm; the fixture is captured by `probes/extract-real-pdf.mjs` on a real filing |
| **A password-protected PDF gets one blank attempt** | try the empty password once, and on failure stop: the document is marked `unreadable` **with the cause recorded**, and nothing retries it on a clock | a real encrypted filing, captured as a fixture with its error string |
| **Content is sniffed before it is stored** | the first bytes must be `%PDF` (or the zip magic) — a 200 response carrying an HTML error page is **not stored**, and the cause is recorded against the attempt | today `contentType` is captured (`document-discovery-runner.ts:622`) but nothing asserts the body actually is a PDF, so an exchange error page can be stored as a filing |
| **The exchange's own document id is stored beside the URL** | NSE and BSE both carry a stable identifier for a filing; storing it means a moved or re-hosted link is still recognisably the same document | `documents` gains the column; the discovery runner already knows the id at parse time |

**Download limits (OD-37).** These bound a request whose URL came off a page we do not control.

| Limit | Value | Where it stands today |
|---|---|---|
| **Host allow-list** | NSE, BSE, SEBI, **the registrars in the `registrars` table**, and the issuer's own host as printed in its filing | mostly built: `TRUSTED_DOCUMENT_HOSTS` (`company-host-source.ts:336`) with exact-or-DNS-suffix matching (`company-host-source.ts:375`) and the company-rung rule (`company-host-source.ts:395`). **New:** the registrar hosts, which are data rather than a constant |
| **Private and loopback addresses refused** | any resolved address in a private, loopback, link-local or unique-local range is refused before the request is made | **new.** The allow-list makes this unreachable in practice today; the check is what keeps it unreachable after the registrar hosts turn a constant into a database table |
| **100 MB per file** | the response is abandoned the moment it passes 100 MB | **new, and the real gap.** `defaultFetcher` buffers the whole body with `await res.arrayBuffer()` (`document-discovery-runner.ts:619`) with no ceiling at all — on a 2 GB response the process dies of memory, not of a limit. The number is set from measurement: the mean stored document is 7.4 MB and the largest type averages 11 MB (`probes/document-store-size.out.json`), so 100 MB is roughly nine times the largest thing we have ever legitimately stored |
| **Two-minute timeout** | one request, 120 seconds | **already true** — `DOWNLOAD_TIMEOUT_MS = 120_000` (`document-discovery-runner.ts:206`), split from the 20-second API budget after a 25 MB RHP timed out at exactly 20,018 ms |
| **Every refusal is logged with URL, host and reason** | the refusal joins the per-cycle failure reading as an identity, not a count | **new**, and it is the half that matters: a limit that refuses silently is indistinguishable from a source that has no document (`.claude/rules/signal-ownership.md`, R1) |

One test per rule, and the tests live with the download path rather than with the extractor —
these are network rules, and they have to fail closed when the network misbehaves, not when a PDF
parser does.

### 2.3 Where the loop records what it asked

The loop needs somewhere to record *what was asked and what came back*, because `field_sources`
records only successful writes — a field never attempted and a field attempted and failed look
identical in it, both absent.

One new table, `ipo_field_plan`, one row per (IPO, table, field):

| Column | Purpose |
|---|---|
| `ipo_id`, `table_name`, `field_name` | the key |
| `rank1_source`, `rank2_source`, `rank3_source` | resolved for this IPO's type, so an SME-on-BSE IPO never lists NSE |
| `state` | `PENDING` · `SUPPLIED` · `NOT_PRINTED` · `NOT_AVAILABLE_YET` · `CHECK_FAILED` · `EXHAUSTED` |
| `chosen_source`, `chosen_rank`, `chosen_document_id`, `chosen_document_type`, `chosen_sha256`, `chosen_page` | what won, and **on what evidence** — this is what makes §2.5 work |
| `attempts`, `last_attempt_at`, `next_due_at` | per-field backoff |
| `claimed_at`, `claim_token` | so a killed walk's in-flight row is reclaimable, mirroring `isStaleInProgress` (`document-state-machine.ts:730`) |
| `verify_due_at`, `verify_state`, `verify_source`, `verify_value`, `disagreement_count` | §3's state, scheduled rather than accidental |
| `manifest_version` | so the plan is reconciled when the manifest changes, never regenerated per cycle |

**The plan row is written from the *result* of the write, never in parallel with it.**
`consolidatedUpsertIPO` returns `skipped: true, skipReason: 'LOCK_NOT_ACQUIRED'`
(`data-consolidation-orchestrator.ts:137-139`) when it cannot take its per-slug lock — silently. A
plan row marked `SUPPLIED` against a write that was dropped is a false-clean state that every check
downstream would read as success. So: a skipped return leaves the row `PENDING` with `attempts`
untouched.

### 2.3.1 Every non-document fetch must prove the page is this IPO

**The mechanism, observed 2026-09-08.** A Chittorgarh IPO URL is
`/ipo/<slug>-ipo/<number>/`. **Only the number identifies the page; the slug is ignored.** Asking
for `/ipo/prasol-chemicals-ipo/1234/` returns HTTP 200 and the *Empyrean Cashews* page — a real,
well-formed page for a different company, with no redirect and no error.

**This is not a live defect today, and the design should not pretend otherwise.** The scraper does
not construct these URLs; it reads the href from a link on the listing page
(`scraper/src/scrapers/chittorgarh-scraper.ts:72-77`) and stores it as `ipos.verifier_url`. Six
stored URLs were fetched and checked on 2026-09-08 — Prasol, Glass Wall Systems, Pranav
Constructions, Kanohar Electricals, Veegaland, Manipal Payment — and every one served the right
company.

**It matters for the pull model for two reasons that are specific to this design.**

1. **A wrong URL is inherited forever.** `verifier_url` is stored per IPO (213 of 327 populated).
   If one was ever captured against the wrong listing row, every later fetch repeats the error
   silently, and nothing in the system re-checks it.
2. **The pull loop is new code that fetches rank-2 and rank-3 values on demand.** When a stored URL
   is missing — 114 of 327 IPOs have none — the tempting shortcut is to build one from the slug.
   That is exactly the path that returns another company's page with a 200.

**The rule, and it costs one string comparison:**

> Before any value is read from a fetched page, the page must name the IPO we asked about, compared
> through the existing company-name normaliser. If it does not match: read nothing, record
> `IDENTITY_MISMATCH` on the plan row, and clear the stored URL so it is rediscovered from the
> listing page rather than reused.

No extra request, no new dependency. And the standing check that turns a silent inheritance into a
detected one: **for every IPO holding a `verifier_url`, the nightly audit asserts the page names
that IPO** — reported by IPO name, never as a count.

#### 2.3.2 Which fields this touches, and the second identity problem it does not solve

**Two different identity failures, and the rule above only fixes one.**

| How we reach the source | Identity risk | Guarded by |
|---|---|---|
| **Per-IPO page** — Chittorgarh detail, via the stored `verifier_url` | the URL can serve another company's page | §2.3.1 above |
| **One list for all IPOs** — InvestorGain GMP (`data-read/331`), the Chittorgarh listing page | the page is right; the **row binding** can be wrong | **nothing yet — F-46** |

**Exposure of the per-IPO path, by the approved rank of the website:**

| Website's rank | Fields | Which |
|---|---:|---|
| Rank 1 | **1** | `gmp_records.gmp` — but it is list-fetched, so §2.3.1 does not apply to it |
| Rank 2 | **47** | nearly all of `financial_data`, `financial_statements`, `peer_companies`, plus `ipo_valuation.mcap_at_cap` / `pe_at_cap`, `promoters.name`, `ipos.sector` / `company_description` / `objectives` |
| Rank 3 | 37 | the long tail |

**Nothing where a website is rank 1 is fetched by per-IPO URL**, so the honest severity of §2.3.1 is
medium, not high. Today the exposure is smaller still: `financial_data` and `financial_statements`
are 100% document-sourced on production, so rank 2 is rarely reached.

**The pull model is what changes that.** Its whole shape is *"when round 1 fails its check, ask round
2"* — and round 2 for the financials **is** the Chittorgarh detail page. A path that is rare today
becomes the path taken on every failed extraction. If the stored URL is wrong, we write another
company's revenue, profit and net worth onto this IPO, and **every arithmetic check passes**, because
those numbers are internally consistent for the company they actually belong to.

**The second problem, unguarded (F-46).** List sources bind a row to our IPO by normalised company
name (`investorgain-gmp-orchestrator-v2.ts:331-336`). The page-identity rule cannot help: the page
is correct, the binding is not. Measured on production, **24 distinct fields holding 4,825 values**
come from the Chittorgarh listing page this way — `segment` 242, `offeringType` 241, `listingDate`
238, `closeDate` 237, `openDate` 236, `isin` 228, `faceValue` 226, `issueSize` 221, `registrar` 219,
`leadManagers` 219 — and `gmp_records.gmp`, the one field where a website is rank 1, is bound the
same way. This design needs a stated binding rule: what counts as a match, what a near-match does,
and what an ambiguous match does. It does not have one yet.

#### 2.3.3 Binding a list row to an IPO (F-46)

For a list source the page is never wrong — the binding is. The rule:

**Bind on the strongest key the row carries, and never on a partial or similarity match.**

1. `symbol` (exchange ticker) — exact.
2. `isin` — exact.
3. Normalised company name — exact after
   `packages/shared/src/utils/company-name-normalizer.ts`, which lowercases, expands `&`, and
   strips punctuation, a trailing parenthetical, a trailing `IPO`/`FPO`, and the legal suffix
   (`Limited`, `Ltd`, `Private Limited`, `Pvt Ltd`). **This is exact-match on a normalised string,
   not fuzzy matching** — nothing binds on substring, edit distance or "closest".

**Outcomes, all three of which must be recorded:**

| Result | What happens |
|---|---|
| Exactly one IPO matches | bind, and continue |
| **More than one matches** | `AMBIGUOUS` — bind nothing, write no value, record both candidates by name |
| **No IPO matches** | `UNBOUND` — not an error. This is how a newly announced IPO is found, and it is the signal discovery consumes. Record it by name so it is visible rather than dropped |

**And one cross-check the binding gets for free.** A list row carries its own dates. **If the row's
open or close date disagrees with the IPO it just bound to, the binding is suspect** — record it and
write nothing. A wrong binding almost always shows up here first, because two different IPOs rarely
share a bidding window.

**A measurement I read backwards, corrected 2026-09-09.** On 2026-09-08 I ran the normalisation
across all 327 production IPOs, found **zero** pairs collapsing to the same string, and reported that
as reassuring. **That reading was wrong, and it was wrong in the dangerous direction.**

Zero collisions does not mean the matching is safe. It means **the normaliser is too weak to ever
merge two rows — including two rows that describe the same company.**

Proven live, on an IPO that opens today:

```
ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED  ->  "asset reconstruction company (india)"
Asset Reconstruction Co.(India) Ltd.          ->  "asset reconstruction co (india)"
                                                                    ^^^^^^^ vs ^^
```

It strips `Limited`, `Ltd`, `Private Limited` and `Pvt Ltd` — **but not `Company` against `Co.`** So
production carries **two rows for one mainboard IPO**, both UPCOMING, both opening 9 September, both
priced 132–139, and the site shows it twice with different numbers (F-55). This is the **W-108
class** from 2026-09-03 — a second *Rays of Belief* row where *"identity tiers 1–5 all missed"* —
recurring.

**So the binding rule above is necessary but not sufficient.** Exact-match on a normalised name is
only as good as the normalisation, and a normaliser that never collides is a normaliser that never
detects a duplicate either. Two things follow, and both belong to the loop rather than to a repair:

1. **The normaliser must fold corporate-form words** — `Company`/`Co.`, `Corporation`/`Corp.`,
   `Industries`/`Inds.` — not only the legal suffix.
2. **Duplicate detection is a check that runs at discovery**, on a deliberately stricter key than
   the binding key. A sweep with such a key over production finds exactly one duplicate group today:
   this one. Binding and de-duplication want opposite error biases, so they must not share a key.

**The de-duplication key, specified.** Written and measured 2026-09-09; the shipped implementation
is `scripts/lib/repair-invariants/duplicate-ipo-rows.mjs`, which the ARCIL repair used as its
held-proof. Lowercase, replace `.,()&'"-` with a space, delete the words below as whole words, then
delete all remaining whitespace:

```
private  pvt  limited  ltd  company  co  corporation  corp  incorporated  inc
and  the  of  india  indian
```

Two rows are the same IPO when this key matches **and** they share an open date. The open-date
condition is what keeps the key safe: it is deliberately lossy — `india` and `industries`-style
words are dropped — so on its own it would over-merge. Two genuinely different companies almost
never open the same day, and if they do, the AMBIGUOUS outcome above already covers it.

**Measured, both directions.** Before the merge, this key found exactly one duplicate group on
production — the Asset Reconstruction pair — which the shipped normaliser missed entirely. After the
merge, across all **329** production IPOs it produces **329 distinct keys**: zero false merges. So
the fold is strong enough to catch the duplicate the shipped one missed, and not so strong that it
collapses two real companies. Run on staging it reports **12** groups, all of a different defect
(F-57, slug-suffix rows), which is why the check takes a scope argument rather than a bare count.

**Why this is a de-duplication key and not the binding key.** Binding must never bind the wrong row,
so it errors toward `UNBOUND`. De-duplication must never miss a duplicate, so it errors toward
flagging. Sharing one key would force one of those to be wrong. The binding key stays the strict one
in the numbered list above; this looser key only ever raises a duplicate for review — **it never
merges anything by itself.** The ARCIL merge was run by an owner-authorised tool with a dry run, a
backup and a refusal on any disagreeing strong identifier; nothing in the loop merges rows.

#### 2.3.3.1 One row per IPO — identity is late-binding, so the rule cannot be enforced at insert

**Owner, 2026-09-09: "Is there a unique ID for each IPO? If yes then there should be only one row
for each IPO for that unique ID."** Agreed on the principle. The data shows why it is not happening,
and the reason is not a missing rule — it is timing.

**Measured on production, 2026-09-09:**

| Status | IPOs | ISIN | Symbol | CIN | BSE no. |
|---|---:|---:|---:|---:|---:|
| UPCOMING | 13 | **0** | 12 | 8 | 9 |
| OPEN | 6 | **0** | 5 | 5 | 4 |
| CLOSED | 60 | 1 | 12 | 0 | 0 |
| LISTED | 251 | 149 | 234 | 18 | 0 |

**No open or upcoming IPO has an ISIN.** The depository assigns it near listing, so the one
permanently unique identifier **arrives after the row has been created and published**. And the
duplicate proves the point: the second Asset Reconstruction row carries **no identifier of any kind**
— no symbol, no ISIN, no CIN, no BSE number. There was nothing to key on.

**So the rule takes the shape of late-binding identity, in four parts:**

1. **Create on the best identity available.** At discovery that is the normalised name — which is
   why §2.3.3's normaliser must fold corporate-form words, not only the legal suffix.
2. **Every time a stronger identifier arrives, check it against every other row.** When the second
   row is assigned its symbol it becomes `ARCIL`, **and `ARCIL` already exists**. That collision is
   the detection, and it is guaranteed to arrive before listing even though it is absent today.
3. **Converging identifiers mean a merge, not an alert.** Two rows sharing one symbol, one CIN or
   one ISIN are the same IPO by definition. The merge is automatic, keeps the union of populated
   fields, and preserves the provenance of both — a warning nobody reads is what produced the
   current state.
4. **Use CIN earlier than we do.** It is on 8 of 13 upcoming IPOs and, unlike a symbol or an ISIN,
   it exists from incorporation — long before any exchange assigns anything, and we already extract
   it from the filing (§E7). It is not sufficient alone, because one company can return with a
   rights issue or an FPO, but **CIN plus open date is a strong pair available early**.

**The gap this closes.** We hold four candidate identifiers and have **no rule for what happens when
two rows converge on one**. That absence, not the identifiers, is what let a mainboard IPO exist
twice on the day it opened.


#### 2.3.3.2 The binding order, and what counts as one offering (OD-34, OD-35)

§2.3.3.1 says identity is late-binding. This says, in order, **what binds** — because "check every
identifier against every row" is not a rule until you say which identifier wins when two disagree.

**The binding order (OD-34).** First match wins; a later identifier never re-opens an earlier bind.

| # | Identifier | Available from | Why it is at this rank |
|---|---|---|---|
| 1 | **CIN** | incorporation — before any exchange knows the company exists | it is the only identifier that cannot be reassigned, and we already extract it from the filing (§E7). On production it is on 8 of 13 upcoming rows |
| 2 | **The SEBI draft filing number** | the day the draft is filed | it identifies the OFFERING, not the company, which is exactly what the one-row rule is about |
| 3 | **The exchange symbol** | days before listing | unique among live issues, but reused across time and absent for most of an IPO's life |
| 4 | **The normalised name** | discovery, always | the weakest, and the only one available at the moment a row is created |

A row bound on nothing stronger than the name carries the flag **`name-bound`** until an identifier
arrives. The flag is not decorative: a `name-bound` row may not be auto-merged with another
`name-bound` row (that is two guesses agreeing, not evidence), and the nightly audit reports the
`name-bound` rows by name — never as a count (`signal-ownership.md` R1).

**The test this rule owes** is a REAL rename pair, not a synthetic one: a company whose draft and its
RHP carry different names, found by probe over `documents` and `ipos` on production. If no such pair
exists in our data, the test uses the pair the probe found on the exchange and the finding says so.

**One row is one offering (OD-35).** The identifier answers "same company". This answers "same
offering", which is the question that actually decides whether to write into a row or create one.

| Situation | Rule | Why |
|---|---|---|
| Same identifier, open dates within **180 days** of each other (or one not yet open) | **same offering** — write into the existing row | a postponed issue keeps its identity; 180 days is wider than any real postponement and narrower than any real re-offering |
| Same identifier, offering type changes (IPO → FPO, IPO → rights) | **new row**, linked by `company_id` | an FPO is a different offering with different terms. Writing it into the IPO row is how a page starts showing two issues' numbers mixed |
| Same identifier, a **new draft** arrives while the existing row has **no open date** | the lapsed-draft rule below | this is the case the owner raised, and it is the only one where the answer depends on time |

**The lapsed-draft rule.** A new draft for a company whose existing row never opened:

- If the existing row is **WITHDRAWN**, or its draft is **older than the SEBI observation-validity
  period with no RHP filed**, the old offering has lapsed: **freeze it** with a forward-linking
  notice (the OD-8 mechanism — the page stays, it says what happened, and it points at the new row)
  and **create a new row**.
- Otherwise it is a **re-filing of the same offering** and it updates the existing row (S-05).

**The period is twelve months, and it is cited, not remembered.** SEBI ICDR Regulations 2018,
**Regulation 44(1)**: *"A public issue/rights issue may be opened within twelve months from the date
of issuance of observations by SEBI, in terms of Regulation 44(1), 85 and 140."* The clause is saved
at `probes/fixtures/sebi-icdr-observation-validity-2026-09-09.txt` with the URL it came from and
what SEBI's own site did and did not serve on the day.

Two things that fixture also records, and which change the shape of the rule:

1. **An eighteen-month class exists** (Regulation 59C is cited alongside 44(1) in SEBI's own
   April 2026 circular commentary). Its verbatim text was not reachable in this run, so it is
   recorded as reported rather than verified.
2. **SEBI grants one-time relaxations** — the circular of 2026-04-07 extended letters expiring
   between 2026-04-01 and 2026-09-30 to 2026-09-30.

So the threshold is **configuration with a dated reason, never a constant in code** (OD-51), and the
rule is written to fail safely: a draft past the period is frozen only when **no RHP has arrived**,
so a relaxation nobody noticed costs a stale notice, never a deleted row.

#### 2.3.3.3 Delisting, and undoing a merge that was wrong (OD-38)

Two things this design creates and therefore has to be able to reverse.

**Delisting.** The post-listing price job (§2.1) reads a symbol every 15 minutes. When the exchange
answers *"no such symbol"* or reports the scrip as delisted **three consecutive times**, the job
stops for that IPO, the row's status becomes **DELISTED with the date of the third read**, and the
page is frozen with the withdrawn-notice mechanism (OD-8). Three reads rather than one because a
single bad answer from an exchange endpoint is a normal event and a status change is not.

**Every automatic merge is reversible.** §2.3.3.1 makes converging identifiers merge automatically,
which is right — a warning nobody reads is what produced the duplicate row we already had — but an
automatic merge that cannot be undone is a one-way door on a guess:

| Rule | What it means |
|---|---|
| **A merge log, not a diff** | before the merge, both original rows are stored whole: every field value and every provenance row, keyed by the merge id. Not "what changed" — the rows themselves |
| **An `unmerge` command** | `scripts/merge-duplicate-ipo.mjs` gains `unmerge <merge-id>`: it restores both rows from the log and **re-points the slug redirect** so the page that was redirected goes back to its own row |
| **A live merge is announced** | a merge touching an IPO that is OPEN or UPCOMING posts to the Notifier immediately (`GLOBAL.md` §2), because that is the case where a wrong merge is visible to readers within the hour |
| **The tool writes through the shared write path** | it does not hold its own SQL. This is build item 19, and it is also what makes PR #432's gate green — see §8.3 |

#### 2.3.4 A correct page still contains other companies' numbers

The two rules above get us to the right page and bind it to the right IPO. **Neither stops the third
mistake: reading a value from the right page that belongs to a different company.**

**Observed 2026-09-08 on Chittorgarh's Prasol Chemicals page.** It shows a `PE Ratio` column — inside
a table headed *"Recently Listed IPOs in Specialty Chemicals"*, listing Sudeep Pharma and others. A
scraper matching that label anywhere on the page would have written **Sudeep Pharma's P/E of 47.61
onto Prasol Chemicals**, and no arithmetic check would object: it is a perfectly plausible P/E.

**The rule:**

> A value is only read from within the page section that is about **this** IPO. Extraction anchors
> on the section — the company's own financial table, its own valuation block — never on a label
> matched across the whole document. A label that appears in more than one section is a defect in
> the extractor, not a value.

This is the same failure as §2.3.1 moved one level in: there, the wrong page; here, the right page's
wrong table. `financial_data.pe_ratio` lost Chittorgarh as a source because of it, and the existing
scraper already applies this discipline in one place — the issue-size prose fallback anchors on the
page's own company name (`chittorgarh-detail-fields.ts:551`). The rule generalises what that comment
already knows.

### 2.3.5 The priority order is configuration, not code (owner requirement, 2026-09-08)

**The requirement.** *"For each field, make these priorities configurable. If we decide to change
them later, it should be easy configuration. We should not be required to change the code."*

Today the order lives in `scraper/src/config/field-priority-matrix.ts` — TypeScript. Changing which
source leads a field means editing code, opening a PR, passing CI and deploying. That is the wrong
cost for a decision that is not a code decision.

#### Two separate things, and only one of them is configurable

The day's verification work makes the distinction sharp, and it is what keeps this safe:

| | What it is | Who decides | Changes how |
|---|---|---|---|
| **Capability** | Can this source serve this field **at all**? | reality — proven by fetching | the verification job updates it |
| **Priority** | Of the sources that *can*, which do we **prefer**? | the owner | **configuration** |

Chittorgarh **cannot** serve `financial_data.pe_ratio` — the only P/E on its page belongs to other
companies (§2.3.4). NSE **cannot** serve any of the 33 financial fields — its API returns bidding
and demand data only. **No configuration may make an incapable source rank 1**, because the result
is not a different value, it is a permanent `NOT_PRINTED` and a silent slide to whatever is below.

So priority is configurable **within** capability, never over it.

#### Where the configuration lives

Three layers, each overriding the one above, reusing patterns this repo already has:

1. **The registry — `config/field-sources.json`, in the repo.** One row per field: its ranks, its
   unit, its check, its exceptions. This is what `field-source-resolution.spec.mjs` already
   generates for Appendix A; it stops being a document artefact and becomes the file the scraper
   reads. Changing it is a data edit reviewed like any other change, then deployed.
2. **The override table — `field_source_overrides`**, shaped on the existing
   `field_protection_metadata` (which is already per-field, per-IPO, with `edited_by`, `edit_note`
   and `is_permanent`). Columns: `table_name`, `field_name`, `ipo_id` (nullable — null means every
   IPO), `rank1/2/3`, `reason`, `set_by`, `set_at`, `expires_at`. **Takes effect at the next cycle
   with no deploy.**
3. **A per-IPO admin override**, which already exists as field protection and is untouched.

Effective order = the first valid layer, resolved once per walk and recorded on the plan row.

#### Four rules that keep this from becoming a foot-gun

A free-form config over the write path is a way to break production quietly at 2am. So:

- **An override is validated before it takes effect.** Every named source must be capable of that
  field, and the order must satisfy S-05 (`per-ipo-due-step-pipeline.md`). An invalid override is
  refused and logged — never partially applied.
- **An override expires.** `expires_at` defaults to 30 days. A change meant to be permanent goes
  into the registry, where it is reviewed. This stops the override table quietly becoming the real
  configuration that nobody reads.
- **Provenance records which configuration produced the value** — registry version or override id.
  Without it, "why does this field say that?" is unanswerable after any config change.
- **A nightly check reports every active override by field and reason**, and fails on one that is
  expired, invalid, or older than its stated intent. An override nobody remembers is the same class
  as a stale ranking in code, only harder to find.

#### What configuration cannot do, stated plainly

- **Reordering sources that already work: pure configuration.** No deploy.
- **Adding a new source** (another website, another exchange feed): needs a scraper for it, and a
  capability entry proven by fetching. **That is code.**
- **Adding a new field:** needs a column, an extractor and a check. **That is code.**

So the honest promise is: *changing the order is configuration; changing what we can reach is not.*

### 2.4 What the loop does, per field

```
for each IPO in phase 1, at each of the four slots:
  for each field in the plan, in dependency order:

    if an admin protection row exists for this field  -> skip; do not store a state (§2.7)

    for rank in 1, 2, 3:
        answer = ask(source[rank])
        SUPPLIED   -> value passes its §1 check: write it, record the evidence, stop
        CHECK_FAILED / EXTRACT_FAILED -> record the named check or cause, try the next rank
        NOT_PRINTED       -> this source never carries it: try the next rank, no retry, no error
        NOT_AVAILABLE_YET -> it will exist but does not yet: try the next rank for a
                             PROVISIONAL value, and keep the field due so rank 1 reclaims it

    all three ranks failed -> state = EXHAUSTED, and see §2.6
```

### 2.5 When a supplied value is asked for again

The first draft said a correct value is frozen and never re-asked. That is wrong, and it was the
single worst error in the document: a draft prospectus filed in July gives an internally consistent
issue size that passes its check and freezes; the September RHP prints the final, larger number; the
site publishes the July figure for the life of the IPO.

**The rule is not "don't re-ask a correct value". It is "don't re-ask while the evidence still
holds".**

> A field is not re-asked while `chosen_document_id` is still the best available document, of the
> highest-precedence type, for that field.

When a document reaches `EXTRACTED` that outranks the stored one — a higher-precedence type, or the
same type with a newer `filing_date` — every plan row whose `chosen_document_id` it supersedes goes
`SUPPLIED → PENDING` in the same transaction, with `superseded_by` recorded. The next slot re-asks
those fields and the newer document wins.

**Precondition, and it is not optional.** The design cannot inherit this from the September 8th
merge. `decideSupersession` is *specified and unit-tested but explicitly not wired* — the code says
so itself: *"NOT YET CALLED BY THE RUNNER, and deliberately so"*
(`document-state-machine.ts:15-23`), and there is no non-test caller anywhere in `scraper/src`. It
orders by `filing_date`, which is populated on **24 of 256 documents**. So wiring supersession, and
backfilling `filing_date`, are both prerequisites of the pull loop, not parts of it.

#### 2.5.1 Every trigger that re-asks a field, in one place

The triggers below were scattered across five sections of an earlier draft. An implementer would
have had to assemble them to know when the loop actually runs, which is how a mechanism gets
half-built. They are listed here once, and §2.5's evidence rule is trigger 3 rather than the whole
story.

| # | Trigger | Concrete case | Can it hit a field that already holds a value? |
|---|---|---|---|
| 1 | State is `PENDING` — never supplied | an SME prospectus not yet filed: the price band is asked four times a day and comes back empty | No — nothing to protect |
| 2 | `NOT_AVAILABLE_YET` reclaim | `isin` does not exist before listing; the field stays due and is taken the moment the exchange assigns it | Only a provisional lower-rank value, which is replaced, not blanked |
| 3 | **A better document arrived** (§2.5) | July's draft said the fresh issue was ₹400 cr; September's prospectus prints ₹320 cr after a pre-IPO placement. Every field from the draft returns to `PENDING` | **Yes** |
| 4 | **Scheduled verification** (§3.1) | every supplied field on a live IPO is re-checked against rank 2 weekly; `leadManagers` (578 unresolved conflicts) and `faceValue` (495) every slot | **Yes — the common one** |
| 5 | **A disagreement was found** (§3.2) | Chittorgarh disagrees with the document, so that one value is re-read from that page of that PDF | **Yes** |
| 6 | **The plan was invalidated** (§2.8) | Mopshop stored as `FPO`, corrected to `IPO`: its ranks were resolved for the wrong type, so the plan is rebuilt | **Yes** |
| 7 | **A visible bidding date moved** (S-05) | NSE moves the close date from 2 to 4 September; allotment, refund and credit dates move with it, and the advertisement is never reprinted | **Yes** |

**This is why §2.6 matters.** Triggers 3–7 all reach a field that already holds a good value. Under
the deleted "blank it" rule, a live IPO's price band would disappear because Chittorgarh happened to
be down during a Tuesday-afternoon verification pass. The field keeps its value; only the plan row
records that we could not reconfirm it, and the page marks it *last confirmed on <date>* once that
gap passes the staleness threshold (owner decision, 2026-09-08).

#### 2.5.2 A re-ask must not rewrite an unchanged value

Triggers 3-7 re-ask fields that already hold good values, and trigger 4 does it on a schedule. At
phase-1 size that is **19 IPOs x ~150 sourced fields = roughly 2,850 checks a week**. If each one
wrote, we would produce about **148,000 writes a year of pure churn**, each dragging a provenance
row and a cache invalidation with it.

**The rule (owner decision, 2026-09-08): verification is a read. It writes only when something changed.**

| Outcome of a re-ask | What is written |
|---|---|
| Same value, check passes | **nothing** — only `verify_state` and the timestamp on the plan row |
| Different value from a better document (trigger 3) | the new value, a provenance row, a cache drop |
| Different value from a verification source | no data write — this opens the re-read loop (§3.2) |
| Re-read produces a correction | the corrected value, provenance, cache drop |

**This also protects a signal we would otherwise destroy.** `ipos.updated_at` and
`field_sources.updated_at` must keep meaning *the value changed*, not *we looked at it*. The moment
verification writes on every pass, every freshness check downstream reads noise.

**What already exists, and does not need rebuilding.** Two layers landed in September and the pull
loop uses them rather than inventing a third:

- **A normalised comparison** — `areEquivalent` + `normalizeChosen`
  (`scraper/src/services/data-consolidation-service.ts:919-932`). It exists because Postgres returns
  a numeric as the string `"6800000000.00"` while the scraper holds the number `6800000000`, so
  every re-scrape of an unchanged number used to count as a write. The same comparison now decides
  both the row update and the provenance row, so the two cannot disagree.
- **A row-level gate** — the update is built as a diff and skipped when the diff is empty
  (`scraper/src/services/data-persister.ts:2258`). An earlier version keyed on a counter that never
  counted `listingExchanges`, `registrarId` or `offeringType`, so a resolved registrar could be
  dropped forever.

**One open gap this design inherits, and it stops being cosmetic here.** Walk item **W-106**
(2026-09-03) records that `valueActuallyChanged` is dead on every tested path — a higher-priority
source arriving with an equivalent value is treated as convergence before the check is consulted. It
was filed as *"not a behaviour defect; a misleading counter"* and left open.

Under the pull model that counter is the only thing separating *"verification confirmed 2,850 fields
and nothing changed"* from *"verification rewrote 2,850 fields identically."* **A dead counter makes
the no-op suppression unverifiable**, so W-106 becomes a prerequisite rather than a follow-up, and
check `PULL-NOOP` below is what proves it: writes per cycle divided by fields re-asked per cycle,
which on a quiet day must be near zero.

#### 2.5.3 Computed fields need their formulas audited — no source ranking can catch a wrong one

**Found by the owner, 2026-09-08.** `anchor_investors.lock_in_50_percent_date` and
`lock_in_remaining_date` are computed, not sourced. The live code computes both from the **anchor bid
date** (`scraper/src/scrapers/anchor-investors-scraper.ts:302`):

```
lockIn50PercentDate = bidDate + 30 days
lockInRemainingDate = bidDate + 90 days
```

**The regulation says the clock starts at allotment.** SEBI ICDR 2018, Schedule XIII Part A: 50% of
an anchor's allotment is locked for 30 days **from the date of allotment**, the remaining 50% for 90
days from allotment — the split rule for issues opening on or after 1 April 2022. Verified against
the regulation on 2026-09-08 rather than taken from memory.

**Measured impact.** ESDS Software: bid 27 Aug, allotment 2 Sep. We publish a 50% lock-in expiry of
**26 Sep**; the correct date is **2 Oct** — **six days early**, on a date traders watch because it is
when anchor shares become sellable and supply reaches the stock. Three more rows carry the same wrong
base and cannot yet be checked because their allotment date is not in yet.

**The general lesson, and it is a gap in this design.** **No source ranking could ever have caught
this.** A wrong formula takes correct inputs and produces a plausible output; every priority rule,
every conflict check and every arithmetic bound in §1 is blind to it, because nothing disagrees.
Sourcing discipline protects every sourced field and does nothing for the **13 computed ones**.

**So computed fields get their own audit, on the same standard as sources:**

| # | Field | Formula | Audited against |
|---|---|---|---|
| 1–2 | `lock_in_50_percent_date`, `lock_in_remaining_date` | `allotment_date` + 30 / + 90 | **SEBI ICDR Sch. XIII Part A — verified** |
| 3–4 | `face_value_multiple_floor/cap` | price ÷ face value | the multiple printed on the advertisement (§A4) |
| 5 | `gmp_percentage` | gmp ÷ price cap × 100 | recomputed, never taken from the source |
| 6 | `issue_price` | `ipos.price_range_max` at listing | the prospectus |
| 7–8 | `listing_gain_percent`, `current_gain_percent` | (price − issue) ÷ issue × 100 | arithmetic on stored inputs |
| 9 | `slug` | `generateIPOSlug(company_name)` | uniqueness + the redirect table |
| 10 | `registrar_id` | FK from `registrar` | the registrars table |
| 11–13 | `listing_performance.symbol` / `company_name` / `listing_date` | copies of `ipos.*` | must equal the source row — a divergence is a defect, not a disagreement |

**Every formula carries the authority it derives from** — a regulation, a printed value, or a stored
input — and a test asserts it. A formula with no cited authority is the same defect as a source rank
with no evidence, which is what this design spent 2026-09-08 removing.

#### 2.5.4 Issue-size components are provisional until the prospectus, and the check runs inside one document

`ipo_details.pre_ipo_placement` is a boolean. A red herring prospectus says *"Fresh Issue of up to
₹400 crore, subject to reduction by a Pre-IPO Placement of up to ₹80 crore"*; if the placement
happens, the final prospectus prints ₹320 crore. A yes/no records **that** it happened, never **by
how much** — and the issue size feeds market cap, shares at cap and the P/E, which cross-check
against each other and therefore **agree while all being wrong**.

**Measured 2026-09-08: the flag is `false` on 5 IPOs and `null` on 20. It has never once been
`true`** across 25 extractions, which is itself worth checking — a boolean that is never true may be
a detector that never fires rather than a fact that never occurs.

**Two rules, which cost nothing and are needed before the loop runs:**

1. **Issue-size fields are provisional until sourced from a `PROSPECTUS`.** An RHP figure is an
   upper bound (*"up to"*), not a final number.
2. **`fresh + OFS = total` is evaluated within ONE document, never across two.** Comparing a draft's
   fresh issue against a final total fails a correct extraction — and under the deleted blanking
   rule that failure would have destroyed the data.

**This check already fails on production, and diagnosing it (2026-09-09) found two extractor bugs
and cleared the websites of blame.**

Running the check as specified over the rows carrying both components: **six of nine fail.** The
provenance column explains it in one look — **every passing row took its total from the document;
every failing row took its total from a website while its components came from the document.** Two
sources describing the same offer, under no obligation to agree.

**But the websites are right, and our extraction is wrong.** NSE states each offer in words, which
settles it independently:

| IPO | NSE's own wording | Our stored fresh | Reconciliation |
|---|---|---:|---|
| **Kanohar** | fresh Rs 3,000 mn + OFS 11,957,915 shares | **₹60 cr** — wrong, NSE says ₹300 cr | 300 + (11,957,915 × ₹632) = **₹1,055.74 cr = the stored total, exactly** |
| **Glass Wall** | fresh Rs 600 mn + OFS 20,213,722 shares | **₹260 cr** — wrong, NSE says ₹60 cr | 60 + (20,213,722 × ₹182) = **₹427.89 cr = exact** |
| **Pranav** | fresh Rs 3,156 mn + OFS 2,856,869 shares | ₹315.60 cr — correct | implied OFS ₹35.43 cr ÷ 2,856,869 = **₹124/share = its stored cap, exactly** |
| **Prasol** | fresh Rs 800 mn + OFS Rs 4,200 mn | ₹80 cr — correct | 80 + 420 = **₹500 cr = exact** |
| **Karamtara** | fresh Rs 6,750 mn + OFS Rs 2,000 mn | ₹675 cr — correct | 675 + 200 = **₹875 cr = exact** |

**Two distinct defects, and the second is the common one:**

1. **`ofs_issue` is never extracted — all six.** The offer for sale is stated two ways: in rupees
   (*"OFS aggregating up to Rs. 4,200 million"*) and in shares (*"OFS of up to 20,213,722 equity
   shares"*). Neither form is being captured. The share form additionally needs multiplying by the
   cap price, which is where §1's unit discipline applies.
2. **`fresh_issue` is mis-extracted on two of six** — Kanohar reads ₹60 cr against NSE's ₹300 cr,
   Glass Wall ₹260 cr against ₹60 cr. Both are wrong in the *digits*, not the units, so a
   magnitude bound would not catch them. **Only the reconciliation check does.**

**What this says about the design.** The check specified here would have caught all six on day one;
it is not built. And §2.6's rule earns itself again: under the deleted blanking rule, six live IPOs
would have had their issue size destroyed by a check that was correctly failing on a *component*
that was never extracted.

**Asset Reconstruction is still unexplained** — `ofs_issue` ₹732.97 cr against a total of ₹696.06 cr,
a component larger than the whole, with no fresh issue recorded and no NSE symbol to check against.
It needs its own look.

Under §2.6 the pull loop handles these correctly: the check fails, the existing value stays, and an
`EXHAUSTED` row makes the gap visible instead of blanking the field. The data above shows the check
earning its place before a line of it is built.


#### 2.5.5 Two documents of the same type, and what a corrigendum does (OD-30)

§2.5 says a better document supersedes a worse one, and `DOCUMENT_PRECEDENCE`
(`document-types.ts:53`) says which type is better: `PROSPECTUS` 100, `BASIS_OF_ALLOTMENT_AD` 90,
`CORRIGENDUM` 80, `ADDENDUM` 75, `PRICE_BAND_AD` 70, `RHP` 50, `DRHP` 10. That table answers "which
TYPE wins". It does not answer the three questions below, and each of them has already produced a
wrong value on a real site.

**Rule 1 — within one type, the later filing date wins, and an old re-extraction never wins.**

> Two documents of the same type are ordered by `filing_date`. A re-extraction of the OLDER one
> **never** overwrites a value that came from the newer one, whatever order the extractions finish in.

The failure this stops is not hypothetical: a re-extraction is triggered by an extractor-version
bump, which fires across the whole corpus at once, so the old document's extraction can land after
the new one's on any given cycle. The guard is that supersession compares `(precedence,
filing_date)` of the SOURCE documents, never the order in which extractions completed.
**Named test:** `same-type-later-filing-wins` — two RHPs, the older extracted second, asserting the
stored value is the newer document's.

**Rule 2 — a corrigendum overrides only the fields it names, and freezes them.**

A corrigendum is not a replacement document. It is a list of corrections, and it usually corrects two
or three fields out of two hundred. So:

> A corrigendum overrides **only the fields it explicitly names**, and those fields are then
> **frozen against every earlier document of any type** until a newer corrigendum or the final
> prospectus arrives.

Without the freeze, the next re-extraction of the RHP quietly restores the number the corrigendum
existed to correct — the RHP still says it, and nothing in a type-precedence table says "except the
bit the corrigendum fixed".
**Named test:** `corrigendum-overrides-named-fields-only` — a corrigendum naming the price band
must move the band and must leave the lot size, the objects and the financials exactly as the RHP
had them; a following RHP re-extraction must not move the band back.

**Rule 3 — the prospectus is terminal, with one exception, and the exception needs a rule the
precedence table cannot express.**

> After the final prospectus, no document changes a document-owned field **except a corrigendum to
> the prospectus**.

Here is the gap, found by reading the table rather than trusting it: `CORRIGENDUM` is **80** and
`PROSPECTUS` is **100**, so on precedence alone a corrigendum filed *after* the prospectus **loses**
— which is the opposite of what the law of the document says. The design's rule is therefore stated
in terms the numbers cannot carry:

- A corrigendum whose `filing_date` is **after** the prospectus's, and which names the prospectus,
  is treated as **precedence 100 + 1** for the fields it names — an amendment to the terminal
  document, not a lower-ranked filing.
- A corrigendum whose `filing_date` is **before** the prospectus is superseded by it in full, as
  the numbers already say.
- **Named test:** `corrigendum-after-prospectus-wins-for-named-fields`, and its mirror,
  `corrigendum-before-prospectus-is-superseded`.

**Where this lands in the build.** All three are **build item 6**, which owns the plan's state
transitions: rules 1 and 3 change the supersession comparator it consumes, and rule 2 adds a
`frozen_by_document_id` column to the plan row. §2.5's precondition still stands: `decideSupersession` is specified and unit-tested but
**not wired**, and `filing_date` is populated on 24 of 256 documents, so ordering by filing date is a
rule this design creates rather than one it inherits.

### 2.6 When all three sources fail

The first draft said: write null with a reason, never leave a stale value. **That is deleted, for
two reasons.**

It is not implementable through the writer this design keeps. When the incoming value is null and a
value is stored, `consolidatedUpsertIPO` returns the stored value with reason `NO_INCOMING_VALUE`
and logs nothing (`data-consolidation-service.ts:1063-1080`). A null cannot pass through it. The
plan would record `EXHAUSTED` while the stale value kept serving — a silent divergence between what
we believe and what the site shows.

And it is dangerous even if it worked. Any check that is wrong for a class of IPO would delete that
class's correct data. That is not hypothetical: the first draft's `face_value ∈ {1,2,5,10}` is wrong
for an NCD at ₹1,000, and `listing ≤ close + 3 working days` is wrong for anything that listed
before December 2023.

**The rule instead:**

> A field that currently holds a value which passed its check is never blanked. `EXHAUSTED` marks
> the plan row, not the data. A field that has never held a value stays absent.

**Owner decision, 2026-09-08:** confirmed, **with a staleness marker on the page**. A value we could
not reconfirm keeps serving, but once the gap passes the threshold the page shows *last confirmed on
<date>* rather than presenting it as current. That gives the honesty of blanking without the
destruction — nothing vanishes, and nothing pretends to be fresher than it is.

An `EXHAUSTED` row on a live IPO is a visible gap with an owner (§4), not an edit.

### 2.7 Admin overrides

An admin value outranks everything. The first draft stored the field as `NOT_APPLICABLE`, which made
the override a one-way door: clear it, and the field is frozen out of the loop forever, invisibly.

`NOT_APPLICABLE` is **derived, not stored** — the walk checks for a live protection row each time it
reaches the field. Clearing the override returns the field to the loop automatically.

### 2.8 When the plan itself is wrong

The ranks are resolved per IPO type. If the type is corrected, the ranks are wrong and nothing in the
first draft rebuilt them.

**Measured: no IPO has ever had a committed type change** — across all 327 rows, no stored previous
value of `offering_type` or `segment` differs from the current one. But **a wrong type that is later
corrected has happened**: Mopshop Distribution Ltd was stored `FPO` on Moneycontrol's word against
Chittorgarh's `IPO`, logged the same disagreement 24 times, and was corrected by hand to `IPO`/`SME`.

So `offering_type`, `segment` and `listing_exchanges` are **plan-invalidating fields**: a write to
any of them drops and rebuilds that IPO's plan rows, keeping values whose rank-1 source is unchanged.

**Phase-1 precondition: three IPOs have no segment, and our own data already answers it.**

`CENTURY BUSINESS MEDIA`, `OM GALAXY` and `RAKSAN TRANSFORMERS` are UPCOMING with
`segment = NULL`. No rank set resolves for them, because SME and mainboard carry different
lot-value checks — so the walk cannot run on them as they stand.

They do not need a source. **The minimum application value separates the two segments cleanly**,
because SEBI sets it: a mainboard lot is about ₹15,000, an SME lot is about ₹1,00,000–1,50,000.
Measured across the 262 IPO rows that carry both a lot size and a price cap:

| Segment | IPOs | Median lot × cap | Range |
|---|---:|---:|---|
| MAINBOARD | 94 | **₹14,880** | 100 – 360,000 |
| SME | 168 | **₹127,600** | 10,000 – 150,000 |
| **The three unknowns** | 3 | **₹118,400** | 109,200 – 144,000 |

All three sit inside the SME band and roughly **eight times** the mainboard median, and all three
are BSE-only, which no mainboard IPO of that lot value would be. They are SME.

**The rule:** when `segment` is absent, infer it as SME if `lot_size × price_range_max ≥ ₹50,000`
and the IPO lists on a single exchange; otherwise MAINBOARD. Record the inference in provenance as
a derived value, never as a scraped one, and let a later document or exchange value overwrite it
under S-05. Flag any IPO where the inference and a sourced `segment` disagree — that combination
means one of the two is wrong and it is exactly the Qualiance false-alarm shape.

**The data repair itself is a production write and is the owner's call** (finding F-40); the design
only states the rule.

### 2.9 Statuses outside the three the first draft named

The first draft's tiers covered UPCOMING, OPEN, CLOSED and LISTED. The enum has six
(`packages/shared/src/db/schema.ts`, `ipoStatusEnum`). A phase-1 IPO can become either of the other
two at any time:

**Owner decision, 2026-09-08.**

- **POSTPONED — not terminal, it comes back.** Stays in scope at the normal four-slot cadence. A
  relaunched issue almost always carries a revised price band and a new window, so **its
  document-sourced fields are invalidated the moment the relaunch filing arrives** (§2.5 trigger 3)
  — the old terms must not survive the relaunch.
- **WITHDRAWN — terminal.** The walk stops. **Existing values are kept as a record**, because
  someone who applied wants to see what they applied to. The page **stays at its URL** with a clear
  withdrawal notice rather than redirecting — people who applied will search for it. **GMP and
  subscription polling stop**, because a withdrawn issue with a ticking grey-market premium reads as
  live and is actively misleading. And the IPO **leaves the §4 denominators**, so a dead issue does
  not drag the coverage numbers of the live ones.

Neither status appears on production today, but `document-cycle.ts` reserves a slot every cycle for
the withdrawal purge path, so both occur.

### 2.10 What this needs that does not exist yet

Stated plainly, because the first draft buried the largest piece of work inside a sentence saying
nothing changes.

`consolidatedUpsertIPO` consolidates **`tableName: 'ipos'` only**
(`data-consolidation-orchestrator.ts:187`). The eight child tables — `ipo_details`,
`financial_statements`, `ipo_valuation`, `ipo_risk_factors`, `promoters`, `anchor_investors`,
`ipo_intermediaries`, `peer_companies` — are written by `persistFilingExtraction` through their own
repositories, with no priority resolution and no `field_sources` rows. That is *why* they measure as
100% document-sourced: nothing else writes them.

**162 of the 194 fields therefore have no consolidated writer at all.** Extending the consolidation
contract to those eight tables is a first-class piece of work and a hard prerequisite of the walk —
without it, the loop has nowhere to write 84% of what it extracts.

---

### 2.11 What the reader sees (OD-39, OD-40, OD-41)

Everything above this point is about getting the right number into the database. This section is
about the only part a reader ever meets. It exists because the design had a measurable hole: the
system already records where every value came from and when it was last confirmed, and **not one
pixel of that reaches the page**.

**What exists, and what does not — measured, not assumed.**

| Piece | State today | Citation |
|---|---|---|
| A per-field provenance record | **exists and is populated** — `field_sources` (`packages/shared/src/db/schema.ts:1376`) | — |
| A repository to read it | **exists** — `FieldSourcesRepository` (`web/lib/repositories/field-sources-repository.ts:53`), including `getIPOSourceMap(ipoId)` (`web/lib/repositories/field-sources-repository.ts:141`), which returns exactly the per-field summary a page needs | — |
| Any page or component that reads it | **DOES NOT EXIST.** A search of `web/app` and `web/components` for that repository returns zero hits; only two scripts and the integration tests import it | measured 2026-09-09 |
| A confidence badge | exists — `ConfidenceBadge` (`web/components/ipo/ConfidenceBadge.tsx:32`) renders HIGH / MEDIUM / LOW. It says how sure we are; it never says **who told us, or when** | — |
| A "last confirmed" marker | **DOES NOT EXIST** in the UI. §2.6 writes the staleness state; nothing displays it | — |

So the read side is not a new capability. It is a **wire that was never connected**, and OD-39 is
the instruction to connect it.

#### The component (OD-39)

One shared component, rendered under each key-facts block on the IPO detail page:

> **From the offer document, confirmed 6 September 2026**

- **Where the words come from:** `chosen_source`, `chosen_document_type` and the confirmation date on
  the plan row (§2.3), read through `FieldSourcesRepository.getIPOSourceMap(ipoId)`
  (`web/lib/repositories/field-sources-repository.ts:141`) — one query per page, not one per field.
- **A stale value says so, in grey:** *"last confirmed 28 August 2026, being rechecked"*. That is the
  §2.6 state finally becoming visible: a value we could not reconfirm is kept and marked, never
  blanked.
- **A conflict stays admin-only.** An unresolved disagreement (§3.4) is not shown to the public. A
  reader cannot act on "two sources disagree"; showing it converts our internal uncertainty into
  their doubt about every other number on the page.
- **The cache key it lives under:** the detail page's existing key, `getIPODetailKey`
  (`web/lib/cache/cache-keys.ts:47`), at `CacheTTL.IPO_DETAIL = 900` seconds
  (`web/lib/cache/cache-keys.ts:16`) — the provenance line is part of the page payload, not a
  second fetch.

#### Making a correction visible within the cycle, not within the hour (OD-40)

A correction written at 14:20 can currently sit unseen behind **two** independent timers: the Redis
entry for the detail page (15 minutes) and Next's own page cache. The home page sets
`revalidate = 300` (`web/app/page.tsx:28`); the IPO detail page sets **no `revalidate` at all** —
grep for `export const revalidate` under `web/app/ipos/[slug]/` returns nothing — so its rebuild
behaviour is Next's default rather than a decision anyone made. Publishing a fix and having the page
keep the old number for the rest of the afternoon is the failure this rule closes.

> At the end of a cycle that wrote published fields, the writer drops the Redis keys for the touched
> IPOs **and then calls one authenticated endpoint on the site with the touched slugs**. The endpoint
> revalidates those IPO pages and the list pages. **One call per cycle**, not one per IPO or per
> field.

- **The endpoint is new.** A search of `web/` for `revalidatePath` / `revalidateTag` / `/api/revalidate`
  returns **zero** matches: nothing in this application has ever revalidated a path on demand.
- **Authenticated**, because an unauthenticated revalidate endpoint is a free way for anyone to make
  the site rebuild every page on demand.
- **Failure is not fatal.** If the call fails, the timed rebuild still applies and the correction
  appears on the next natural revalidation; the failure is logged with its cause
  (`signal-ownership.md` R6), never swallowed.
- **The detail page also gets an explicit `revalidate`**, so its fallback behaviour is a stated
  number rather than a framework default.

#### After a merge, the old page must not outlive the merge (OD-41)

An automatic merge (§2.3.3.1) retires a slug. Three rules, and one of them is already true:

| Rule | State today |
|---|---|
| **A permanent redirect from the retired slug** | **already true.** `web/app/ipos/[slug]/page.tsx:233` calls `permanentRedirect()` — a real 308, deliberately not `redirect()`, which Next 15.5.4 serves as a 307. The design keeps it and names it rather than reinventing it |
| **The sitemap contains live rows only** | **already true, and worth stating.** `web/app/sitemap.ts` reads every IPO (limit 1000) and excludes any slug present in `ipo_slug_redirects` (`web/app/sitemap.ts:93`). Its own `revalidate` is 900 (`web/app/sitemap.ts:21`) |
| **A canonical tag on every IPO page** | **DOES NOT EXIST.** Eight other pages set `alternates.canonical` (for example `web/app/ofs/page.tsx:69`); the IPO detail page sets none. After a merge, the survivor page has nothing telling a search engine which URL is the real one |

The sitemap is regenerated as part of the OD-40 call, so a merge is reflected in the sitemap on the
same cycle rather than up to 15 minutes later.

#### The post-listing price, on the page (OD-29)

The column already exists: `ipos.current_price` `numeric(10,2)`
(`packages/shared/src/db/schema.ts:329`) with `current_price_updated_at`
(`packages/shared/src/db/schema.ts:332`). So the as-of stamp OD-29 requires is not a schema change —
it is a column nobody displays. The page shows the price **with that timestamp and the word
"delayed"**, and when the 90-day window has closed it shows the last value with its date rather than
an empty space.

## 3. What happens when sources disagree — the re-read loop

### 3.1 Why this cannot be left to chance

We already detect disagreements: `data_conflicts` holds 31,014 rows, **2,398 unresolved**, including
all 578 `leadManagers` conflicts and 495 of the `faceValue` ones. Nothing consumes them.

But a conflict row is only written when a *second* source arrives and disagrees. Under §2.4 a
supplied field is not re-asked, so no second value is produced, so no conflict is written — the
first draft's re-read loop could never have fired on exactly the fields it was meant to protect.

**So verification is scheduled, not accidental.** `verify_due_at` on the plan row: every supplied
field on a phase-1 IPO is checked against its rank-2 source at least weekly, and the fields with
standing conflict counts — `leadManagers`, `faceValue`, `registrar` — every slot.

### 3.2 What happens on a disagreement

```
1. re-fetch the winning document's bytes and re-hash them
2. re-extract only this field, at the recorded page first
3. write an extraction receipt: sha256 computed now, extractor run id, page, timestamp
4. compare:
     same value, check passes -> the document is confirmed; mark the other source
                                 wrong for this field; resolve the conflict
     different, check passes  -> the first extraction was wrong; write the correction
     different, check fails   -> leave the stored value; do not adopt the other source
5. still disagreeing after the bound -> unresolved_disagreement, and it becomes visible (§3.4)
```

**The website's number is never adopted.** That is the whole instruction behind this design.

**But that claim is only safe if the re-read really happened.** If the file is gone and the
re-download fails, an implementation could fall back to the cached extraction, return the same wrong
number, and record "verified against the document" — confirming a wrong value forever and then
defending it against the source that was right. **That is why step 3 exists: a re-read counts only
if it produced a receipt with a hash computed from bytes on disk during this cycle.** No receipt, no
verification.

### 3.3 What stops it looping

| Bound | Value |
|---|---|
| Re-reads per (IPO, field, document `sha256`) | **2** — a third attempt on the same bytes cannot give a different answer |
| Re-reads per document per day | **1** — all of a document's disputed fields are re-read together |
| Re-reads per IPO per slot | **1** |
| Reset | a new `sha256`, or a higher-precedence document type |

Keying on the bytes rather than a retry counter is what makes "we already tried this" a fact about
the evidence instead of a number someone can reset.

### 3.4 Where an unresolved disagreement ends up

`unresolved_disagreement` on the plan row; a line in the nightly report with both values and both
sources, by IPO and field name; and — for a phase-1 IPO — a GitHub issue, because a live IPO with a
disputed price band is a user-facing defect.

---

## 4. How we would know it worked

**The rule this section is built on.** The old version of it opened by warning that a check counting
all-time rows can never alarm on a collapse — and then made the same mistake one level down, by
using ratios whose *denominators* are produced by the machinery under test. If a document type
mis-resolved, fewer fields counted as document-owned, the denominator shrank, and the score went
**up**. The worse the extraction, the better the number.

So every check below obeys four rules:

1. **A named denominator floor, asserted first.** A ratio whose denominator moved more than 5%
   overnight reports UNVERIFIABLE, never PASS.
2. **A type-independent denominator.** What the document *should* print for this offering type — a
   fixed constant — never what the document that happened to resolve says it prints.
3. **An id, an emitting script, and a line in the nightly report** that the existing delta consumer
   reads. A line in a process log is not detection.
4. **Failures resolve to identities.** Never "12 failed" — always which IPO and which field.

| id | What it asks | Healthy | Alarms when |
|---|---|---|---|
| `PULL-PLAN` | plan rows per IPO = the committed manifest, and the manifest hash is unchanged | equal | any mismatch, or a manifest hash that moved without a commit |
| `PULL-WALK` | every phase-1 IPO walked this slot | 19 of 19 | fewer than all, twice running — **and separately, phase-1 count ≥ 1** |
| `PULL-YIELD` | of the fields the offer document should print for a mainboard/SME IPO, how many round 1 supplied | rising toward 100% | falls, **or the denominator moves more than 5% overnight** |
| `PULL-EXCUSED` | `NOT_PRINTED` count per (IPO, document type), NEW vs yesterday by name | stable | a document's excused set grows at all — this is what catches a mis-resolved type |
| `PULL-EXHAUST` | `EXHAUSTED` rows by (IPO, field, reason), NEW vs GONE vs SAME | shrinking | any NEW one on a phase-1 IPO |
| `PULL-NOOP` | writes per cycle ÷ fields re-asked per cycle | near zero on a day with no filings | rises without a matching document arrival — verification is rewriting unchanged values |
| `PULL-NOBLANK` | fields that went from a value to absent this slot | **0** | any non-zero — this is the guard on §2.6 |
| `PULL-WRITE` | plan rows marked `SUPPLIED` whose write returned `skipped` | **0** | any non-zero |
| `PULL-FROZEN` | `SUPPLIED` rows whose `chosen_document_id` has been superseded | **0** | any non-zero — the guard on §2.5 |
| `PULL-ADMIN` | fields skipped for admin reasons with no live protection row | **0** | any non-zero — the guard on §2.7 |
| `PULL-TYPE` | plan rows whose resolved ranks do not match the IPO's current type; IPOs with a null segment | 0 / 0 | any non-zero |
| `E1-SOURCE` | for the ten E-1 fields, `field_sources.source` is never `DRHP` | true | any E-1 field written by the document path — **asserts the outcome, not the declared intent** |
| `REREAD-RECEIPT` | re-reads with a receipt hashed this cycle ÷ re-reads recorded | 1.0 | below 1.0 — the guard on §3.2 |
| `REREAD-VERDICT` | share of re-reads ending `verified_against_document` over 7 days | below 0.95 | at or above 0.95 — a source that is never wrong is a source never actually consulted |
| `REREAD-LATENCY` | oldest actionable disagreement with no re-read attempt | under 48 h | over 48 h, listed by IPO and field |
| `CHECK-ROSTER` | every id above appears in tonight's report | all present | any missing — **a check that crashed must not read as "no findings"** |

`CHECK-ROSTER` exists because the current delta consumer parses only PASS and FAIL: a check that
throws vanishes from the output and is reported as GONE, printed as "no new findings", exit 0. A
check that dies would otherwise look like an improvement.

**None of this is evidence until it has run against real data.** The first proof is a staging slot
whose log line names a counter that moved — `PULL-YIELD` rising and `PULL-EXHAUST` falling on the
same night. A passing unit test is not proof, and neither is a clean read taken immediately after a
repair.

---

### 4.5 The test corpus, and why a fixture without provenance is not evidence (OD-43)

Every check in §4 is only as good as the data it runs against. This design's own history is the
argument: the round that produced it found **51 wrong source ranks**, each built on a confident
sentence about a page nobody had fetched. A test fixture with no record of where it came from is the
same failure wearing a filename.

**What the corpus looks like today, measured 2026-09-09** by counting the files, not by remembering
them:

| | Count |
|---|---:|
| Fixture files under `scraper/tests` | **55** |
| Of those, carrying a URL or a fetch date in their first lines | **13** |
| Carrying no provenance at all | **42** |
| PDFs committed to the repository | **0** |

Two readings of that. The good one: nobody has ever committed a 20 MB prospectus, so the repository
has not been used as a document store. The bad one: **for 42 of 55 fixtures, nobody can now say which
page, from which date, they were cut out of** — so when a source changes its markup, there is no way
to tell a fixture that is stale from one that is correct.

**The rules (OD-43).**

| Rule | What it means |
|---|---|
| **One directory per source** | `scraper/tests/fixtures/<source>/…` — `nse/`, `bse/`, `sebi/`, `chittorgarh/`, `investorgain/`, `registrar/`. A file's directory says who served it, so a source's whole shape can be re-captured in one pass |
| **A header on every fixture** | the URL, the fetch date, the IPO it belongs to, and that IPO's identifier. In JSON as a `_provenance` object; in HTML as a leading comment. A fixture with no header fails the corpus check |
| **PDFs are never committed** | the extracted **text** plus the PDF's sha256 goes in, and the PDF does not. This is the same rule as OD-32 seen from the other side: the words are the evidence, the bytes are a working file |
| **A weekly live shape check, per source** (`CORPUS-SHAPE`) | one scheduled job re-fetches the live page behind each fixture and compares its SHAPE — the labels and the structure the extractor depends on, never the values, which are supposed to change. On a difference it files an issue naming the source, the fixture and the label that moved |
| **The 42 fixtures without provenance are backfilled or deleted** | one pass: if the source page can be re-fetched and still matches, the header is written from that fetch; if it cannot, the fixture is deleted and the test that used it is re-pointed at a fresh capture. There is no third option — an unattributable fixture stays a liability forever |

**Why the weekly check earns its cost.** The alternative is discovering a markup change when a field
silently stops being extracted, which is exactly the class this whole design exists to stop. The
check is a handful of HTTP requests a week, and it fails *loudly*, on a shape, before any value on
the site is wrong. It is registered under OD-42 with a named consumer, like every other check.

## 5. The open comments, answered inside the design

### 5.1 O-1 — when the pull runs, and why

**ANSWERED by the owner on 2026-09-09 (OD-19).** This section used to end with *"what is still owed
to Abhay: a target number."* He gave it. The cadence is now three named jobs and one rule, specified
in full in **§2.1**, and this section only records what changed and why the old answer was wrong.

**What the design proposed before, and what he decided instead:**

| | The design's proposal (2026-09-08) | The owner's decision (2026-09-09) |
|---|---|---|
| Wake | keep the 30-minute wake, make it a no-op when nothing is due | no 30-minute wake for data at all — **three data jobs a day**, 00:00 / 08:00 / 14:00 |
| Documents | processed on the four discovery slots and on state changes | **never on a clock**; read once on arrival, again only on a new reason |
| Live figures | every in-hours wake | **every 30 minutes, 10:00–18:30, only when an IPO is OPEN** |
| Backlog | "its own nightly window", unscheduled | **22:00, at most 10 closed IPOs a night, newest close date first, never repeated** |
| Kill | unaddressed — the cron force-restart stayed | **no job ever kills a running cycle**; a job that finds the lock held skips its turn |

**Why the design's own proposal was the weaker answer.** It kept a 30-minute drumbeat and made the
work inside it conditional. That is the shape that produced the problem in the first place: a
half-hourly process that must decide, every half hour, whether to do nothing — and that gets killed
on the boundary when it decides to do something. The owner's version removes the drumbeat instead of
teaching it restraint. The only thing genuinely lost is latency on a document filed between jobs,
and §2.1 states that cost out loud rather than hiding it.

**What this section still owes.** Nothing to the owner. To the implementer it owes the derivation of
the new budgets, which is in §2.1 under *"the force-kill goes"*, and the completed-extractions
counter that makes the before-and-after comparable, which is a named check in §4.

### 5.2 O-2 — money in crore

**ANSWERED by the owner on 2026-09-09 (OD-20):** *"Crore should be the default for every amount
column."*

#### What counts as an amount column, and who decides

Not a sentence — a probe. `docs/design/probes/amount-columns.mjs` reads
`packages/shared/src/db/schema.ts` and classifies **every** numeric and bigint column into one of
eight classes, and **refuses to finish if a single column is left unruled**. Its saved output
(`amount-columns.out.json`) is the evidence behind the table below, and check **D13** fails the gate
if this table and that output disagree.

The classes, and what happens to each:

| Class | Meaning | Under OD-20 |
|---|---|---|
| `CRORE` | an aggregate rupee amount at company or issue scale | **converted to crore, `numeric(12,2)`** |
| `RUPEES_KEPT` | a rupee amount at retail scale | stays in rupees — see **O-12** |
| `PER_SHARE` | a rupee value per share (price, EPS, NAV, WACA, GMP) | unchanged |
| `PERCENT` · `RATIO` · `MULTIPLE` | percentages, ratios, subscription multiples | unchanged |
| `SHARE_COUNT` | counts of shares or bids | unchanged |
| `NON_MONEY` | numeric but not money (a file size) | unchanged |

Converting a price, a percentage or a share count would make it harder to read, not easier — that
was true in the original comment and the probe does not change it.

#### The columns, and which of them actually move

Generated by the probe; never hand-edited here. **The class says what a column MEANS; the unit says
what it holds today, and only the second decides whether a repair tool goes anywhere near it.** A
first version of this section presented all thirty-seven as "numeric → crore", which would have sent
a repair at twenty-five columns that are already in crore and divided them by ten million a second
time. The build-card round caught it by reading the writers.

| Table | Column | Unit stored TODAY | What OD-20 does to it |
|---|---|---|---|
| `anchor_investors` | `total_amount_raised` | CRORE — already crore - this is the reference the rest converge on | nothing — already crore |
| `financial_data` | `ebitda_fy2022` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `ebitda_fy2023` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `ebitda_fy2024` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `market_cap` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `net_worth` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `profit_fy2022` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `profit_fy2023` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `profit_fy2024` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `reserves_and_surplus` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `revenue_fy2022` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `revenue_fy2023` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `revenue_fy2024` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `total_assets` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `total_borrowing` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `total_borrowings` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `total_income_fy2022` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `total_income_fy2023` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_data` | `total_income_fy2024` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `financial_statements` | `ebitda` | PER_ROW_UNIT — financial_statements carries its own unit column per row and never normalises; it is read correctly at derive time rather than converted | nothing — read via its own `unit` column at derive time |
| `financial_statements` | `net_worth` | PER_ROW_UNIT — financial_statements carries its own unit column per row and never normalises; it is read correctly at derive time rather than converted | nothing — read via its own `unit` column at derive time |
| `financial_statements` | `op_cash_flow` | PER_ROW_UNIT — financial_statements carries its own unit column per row and never normalises; it is read correctly at derive time rather than converted | nothing — read via its own `unit` column at derive time |
| `financial_statements` | `pat` | PER_ROW_UNIT — financial_statements carries its own unit column per row and never normalises; it is read correctly at derive time rather than converted | nothing — read via its own `unit` column at derive time |
| `financial_statements` | `rent_expense` | PER_ROW_UNIT — financial_statements carries its own unit column per row and never normalises; it is read correctly at derive time rather than converted | nothing — read via its own `unit` column at derive time |
| `financial_statements` | `revenue` | PER_ROW_UNIT — financial_statements carries its own unit column per row and never normalises; it is read correctly at derive time rather than converted | nothing — read via its own `unit` column at derive time |
| `financial_statements` | `total_income` | PER_ROW_UNIT — financial_statements carries its own unit column per row and never normalises; it is read correctly at derive time rather than converted | nothing — read via its own `unit` column at derive time |
| `ipo_details` | `fresh_issue` | RUPEES — written in rupees by the filing persister | **converted, and existing rows repaired from source** |
| `ipo_details` | `ofs_issue` | RUPEES — written in rupees by the filing persister | **converted, and existing rows repaired from source** |
| `ipo_financials` | `profit_fy1` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `ipo_financials` | `profit_fy2` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `ipo_financials` | `profit_fy3` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `ipo_financials` | `revenue_fy1` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `ipo_financials` | `revenue_fy2` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `ipo_financials` | `revenue_fy3` | CRORE — already crore at the writer level (financial-data-scraper.ts and the filing persister use toCrore) | nothing — already crore |
| `ipo_valuation` | `mcap_at_cap` | RUPEES — written in rupees by the filing persister | **converted, and existing rows repaired from source** |
| `ipo_valuation` | `mcap_at_floor` | RUPEES — written in rupees by the filing persister | **converted, and existing rows repaired from source** |
| `ipos` | `issue_size` | RUPEES — normalizeCurrency stores rupees; the column comment in schema.ts says so | **converted, and existing rows repaired from source** |

So the honest summary of OD-20's data work is much smaller than the class count suggests: **five
columns hold rupees and need converting with a source-backed repair.** The rest either already hold
crore, or (the `financial_statements` family) carry their own per-row `unit` and are read correctly
at derive time rather than converted at all.

`ipos.objectives` is not in that list because it is not a numeric column: it is a JSON payload whose
*amounts inside* are mixed. It converts too, and the item-11 build card specifies the shape of the
converted payload and the reader that keeps old rows readable.

#### The conversion is not unit-neutral downstream, and that is a live surprise

`web/lib/services/ipo-scoring-realtime.ts:394-396` scores an IPO by issue size against thresholds of
1,000 / 500 / 100 — **crore thresholds, applied to a column holding rupees.** Asset Reconstruction's
stored `issue_size` today is 7,329,740,494, so it clears "greater than 1000" and takes the full half
point, and so does every other IPO on the site. `web/lib/utils/rating-calculator.ts:164-168` does the
same thing.

That means the crore conversion is not only a storage change: **it is the first time this score will
actually discriminate between a 40-crore SME issue and a 3,000-crore mainboard one.** Every IPO's
fundamentals score and rating will move on the day it ships. That is the correct behaviour and it is
still a visible change to what readers see, so it belongs in the release note rather than being
discovered afterwards. Recorded as F-95.

#### The five rupee columns, and the scale they must survive (OD-48, decided)

**DECIDED by the owner, 2026-09-09** (this was O-12; it is now **OD-48** in §0.0.1).

Five columns are rupee amounts by any honest reading, and converting them would make the site worse:
`ipo_details.min_investment` (a retail application of about 15,000 rupees, which in crore reads
`0.0015`), `ipo_details.max_retail_subscription` and `ipo_details.max_employee_subscription`
(the 2-lakh and 5-lakh regulatory ceilings, which people read in lakh), and `gmp_records.kostak_rate`
and `subject_rate` (per-application rates quoted in hundreds of rupees).

**They stay in rupees, each carrying a unit tag on the column**, and "crore is the default" means
exactly that — a default with five named, reasoned exceptions rather than a rule with silent ones.

The owner attached one condition: *"ensure that no error should occur even for world's largest IPOs
in rupees terms."* That is a precision question, and it is answered by arithmetic rather than by
optimism:

| Where the number lives | Type | Largest value it can hold | The largest thing it has to hold |
|---|---|---|---|
| a crore column | `numeric(12,2)` | 9,999,999,999.99 crore | Saudi Aramco at Rs 2,50,000 crore is 0.0000025% of the ceiling |
| a rupee column | `numeric(15,2)` | 9,999,999,999,999.99 rupees (about 10 lakh crore) | Aramco's Rs 2.5 lakh crore = 2,500,000,000,000 — one quarter of the ceiling |
| JavaScript, if a value is ever read as a `number` | IEEE-754 double | 9,007,199,254,740,991 exactly (about 90 lakh crore) | the rupee column's own ceiling is 900 times smaller, so no rupee value can lose a rupee in transit |

**The named test (build item 11) feeds three real scales through every amount column, every
conversion, every API route and every page formatter**, and asserts no overflow, no rounding at the
last rupee, and a correct display string at each:

1. **Aramco scale** — an issue of Rs 2,50,000 crore (`2,500,000,000,000` rupees), the largest IPO ever
   priced anywhere.
2. **Indian largest scale** — Hyundai Motor India at Rs 27,870 crore, the largest issue in this
   market, which the site will actually have a row for.
3. **SME floor scale** — an issue of Rs 5 crore, where the risk is the opposite one: a crore column
   rounding a small number away.

The test also asserts that the numeric guard added in #423 **does not fire** at Aramco scale — a
guard that rejects a legitimate world-record issue is the same defect as one that lets a share count
through as rupees, pointing the other way.

#### How existing rows are repaired

**Never by arithmetic on the stored number.** A row whose unit is unknown cannot be divided by
10,000,000 and trusted — that is precisely how a share count once became a rupee amount. The repair
is a re-runnable tool that, per row, re-reads the value **from its source** (the offer document via
the extractor, or the exchange payload) and writes the crore value with a fresh `field_sources` row;
a row whose source cannot be re-read is left alone and reported, not guessed. Dry-run is the default,
`--apply` is explicit, and the proof that it held is
`scripts/assert-repair-held.mjs <invariant> --cycles 2` on staging, because a clean read straight
after a repair proves nothing about whether the next real scraper cycle overwrites it.

#### What the public sees while this happens

The API serves **both** shapes for one release: the existing field keeps its name and its old unit,
and a new crore field appears beside it. The old field is retired in the following release. The
item-11 build card names every API route and every web formatter this touches, and the release it
happens in.

#### And the defect worth fixing in the same change (§0.9)

`financial_data`'s hard-coded fiscal-year columns already publish a two-year-old figure for a live
IPO. `financial_statements` becomes the source of truth for financials and `financial_data` becomes
a derived projection of its three most recent fiscal years. That removes the hard-coding, fixes Annu
Projects, and gives the unit conversion one place to happen instead of two.

### 5.3 O-3 — one bad field must not discard the row, and must not loop

**ANSWERED by the owner on 2026-09-09 (OD-21):** *"Go with your recommendation"* — per-field
validation before the write. This is no longer "the cheap half" of anything; it is the whole of
build item 4.

#### The rule

1. **Every extracted field is validated on its own, before the write.** Not the document, not the
   row — the field.
2. **A field that fails is dropped from the write** and recorded in a **failure row** carrying:
   the IPO, the table and column, the document id and sha256 it came from, the rule id that
   rejected it, the value as extracted (truncated, never silently reshaped), and the cause in plain
   words. A failure that cannot be classified from its own row is a defect of the logger
   (`signal-ownership.md` R6).
3. **The remaining fields are written.** Rentomojo's lead managers, dates, registrar and ISIN go in
   even when `fresh_issue` is rejected. Nothing is all-or-nothing.
4. **The pull loop then asks rank 2 for the dropped field** (§2.5), and if that fails too the field
   is written null with a reason (§2.8) — *"keep that field blank and get it from other sources"*.
5. **A document is re-extracted only when a new reason exists**: a newer document type arrives, the
   extractor version changes, or the re-read loop asks. **Never on a backoff timer.** Seven
   re-extractions of the same bytes becomes impossible by construction rather than by a retry limit
   somebody remembers to set.

#### The validation rules are configuration, not code

Same file family as the priority configuration (OD-5, §2.3.5), so a rule can be corrected without a
deploy. Each rule carries: the id it reports on failure, the columns it applies to, the offering
types and segments it applies to, **the date range it is valid for**, and the assertion itself.

**The date range is load-bearing, and it is what closes F-10.** `face_value ∈ {1, 2, 5, 10}` is
right for an equity IPO and wrong for an NCD at 1,000. `listing ≤ close + 3 working days` is right
today and wrong for anything that listed before December 2023, when T+6 was the rule. Applied
without effective dates to the closed-IPO backlog, a correct 2022 row would be rejected by a 2026
rule and silently blanked — a check that damages the data it was written to protect. Every rule
therefore states the window it governs, and a value outside every window is **not** a failure: it is
recorded as `NO_RULE_APPLIES` and written.

#### What this does not do

It does not make a doubtful value acceptable. A field that no rank can supply and no rule can pass
stays empty with its reason attached, and §4's checks count it. The purpose is that one bad field
costs one field.

#### 5.3.1 One rule this design owes immediately: `lot_multiple` is a count of LOTS

**F-63, found by the domain review on 2026-09-09 and confirmed against the extraction fixture.**
`docs/design/probes/fixtures/extraction/asset-reconstruction-company-india-ltd-PRICE_BAND_AD.json`
emits `lot_size = 107` **and `lot_multiple = 107`**, and production stores 107 in `lot_multiple` for
an IPO that is open right now.

`lot_multiple` is the number of **lots** in a minimum application: **1** for a mainboard issue, and
**2** for an SME issue since 2025. It is never a share count. With 107 in it, a minimum application
computed as `lot_multiple × lot_size × floor` reads **Rs 15,12,468** instead of **Rs 14,873** — a
hundredfold error on the number a retail reader uses to decide whether they can afford to apply.

The only check the design stated for it was "a positive integer", which 107 passes happily. Under
OD-21 the rule becomes explicit, scoped and effective-dated:

| Rule id | Applies to | Assertion | From |
|---|---|---|---|
| `lot-multiple-range` | `ipo_details.lot_multiple`, all segments | `1 <= value <= 10` | a minimum application is one or two lots; ten is a generous ceiling, and 107 is not a near miss |
| `lot-multiple-sme` | `ipo_details.lot_multiple`, segment SME, effective 2025-01-01 onward | `value = 2` | the SME minimum application became two lots in 2025 |
| `lot-multiple-not-lot-size` | `ipo_details.lot_multiple` | `value != ipos.lot_size` unless `lot_size <= 10` | the specific failure observed: the extractor copying the lot size into the multiple |

The extractor emitting one into the other is a live defect, not a design question. It belongs to
build item 4, which is where per-field validation lands, and the third rule above is what stops it
reaching a reader while the extractor is corrected.

### 5.4 O-4 — the unextracted backlog, drained without starving a live IPO

**Updated 2026-09-09 (OD-19, OD-22).** The backlog tier now has a real window: **22:00 IST, at most
ten closed IPOs a night**, specified in §6. F-35's objection — a third extractor on a 2-vCPU box that
already took a Cloudflare 522 outage from two concurrent ones — is answered by *when* rather than by
*whether*: the 22:00 job runs when neither data job nor live-figures job does, and it skips its turn
outright if the cycle lock is held. The live tier keeps absolute priority, so a live IPO can never
queue behind history. The causes and the answers below are unchanged; only the scheduling is.

**Re-measured this session: 176 unextracted, not 172.** The three causes hold:

| Cause | Documents | The design's answer |
|---|---:|---|
| No extractor exists for the type | 78 | Build **one**: the **ratios / basis-for-offer-price** document (32 pending — it carries the KPIs, the WACA and the peer set, all rank-1 document fields in §1). **Deliberately left unread, and recorded as such:** the basis-of-allotment advertisement (1 — see below), sample application forms (14), bidding centres (8), security parameters (23). All report `NOT_APPLICABLE` in the manifest rather than sitting in a backlog forever. |
| Budget of 3 filings per cycle | 91 | Demand-ordered allocation (§2.7) plus the **22:00 closed-IPO job** (§6). The live tier keeps absolute priority, so a live IPO can never queue behind history. This converts 91 already-downloaded documents into data with no new parsing code — the single biggest win here. |
| 10-minute extraction cap | the Skyways class | A separate, longer budget for large or scanned documents, run in the backlog window only (**the closed-IPO work**), where a 40-minute extraction costs nothing. The live path keeps its 10-minute cap so it cannot blow the wake budget. |

O-4 is already marked APPROVED by the owner, so this section is the *how*, not a request.

**F-27 — the basis-of-allotment advertisement is stored and deliberately not read (owner decision,
2026-09-08).** An earlier draft scheduled an extractor for it. **Nothing exists to hold what that
extractor would produce** — there is no field anywhere for the allotment ratio, applications
received, valid applications, shares allotted per category, or oversubscription per category. Every
column we have with "allot" in its name is about something else: the allotment *date*, the
registrar's allotment-check *URL*, and `retail_max_allottees`.

Building a parser whose output is discarded is waste, and the ordering was my error — the extractor
was scheduled without checking there was a target.

**Why not build the fields either.** We hold **exactly one such document**, and it is published only
*after* an issue closes, so most of the 19 open and upcoming IPOs have not filed one. More
importantly, the question users actually ask — *"did I get shares?"* — **is already answered**: we
link to the registrar's allotment-check page, and 14 of 19 registrars have one with 18 healthy.

The gap is the *other* question — *"what were the odds?"*, the ratio people quote after an
oversubscribed issue. **That is a product decision about what IPODhan publishes, not a sourcing
decision**, and it does not belong in this design.

**So: the document keeps being discovered and stored, and is marked `NOT_APPLICABLE` for
extraction with this reason attached.** If the allotment ratio later becomes a feature, the
documents will have been accumulating rather than being thrown away — and the correct order then is
fields first, extractor second.

### 5.5 O-5 — the document outranks websites: what is inherited and what remains

Merged this morning as 9db4529d. The design inherits all of it: `DRHP` directly after `ADMIN` on
every field the extraction contract says a filing carries; a newer document heals an older one;
document types ranked so an old draft cannot overwrite a final advertisement; timeline dates
deliberately keeping the exchanges first (W-117).

**What remains after it, and why the ranking alone was never going to be enough:**

1. **130 of 194 published fields still have no ranking at all** (§0.6, measured against the live
   `field-priority-matrix.ts`, a different artifact from this design's Appendix A). Appendix A now
   ranks all 240 — but **it resolves only 3 of the 11 offering types phase 1 actually needs
   (MAINBOARD, SME-BSE, SME-NSE)**; the other 8 (F-11) are DROPPED-BY-SCOPE and **reopen for the closed-IPO work**.
2. **The staging-cycle proof for 9db4529d is still owed.** It is listed at 90%, not 100%, for that
   reason.
3. **Nothing re-sources the existing rows.** The flip changes who wins the *next* write. 91% of
   today's data was written before it. That is §6 — **entirely the closed-IPO work** under the owner's
   2026-09-08 scope cut; phase 1 touches no closed IPO's already-written rows.
4. **The duplicate-key problem** (§0.6): 13 matrix keys in snake_case match nothing. They should be
   deleted in the same change that builds the plan, or they will quietly look like coverage.

### 5.6 O-7 — where a language model is genuinely needed, and where it is not

Treated as a constraint the design obeys, per Abhay's conditions: the model never writes a value, it
proposes one with the page number and the exact sentence; every arithmetic check must still pass; a
website disagreement sends it back to the document, never to the website's number; model-sourced
values are marked in provenance so their accuracy is measurable and the whole thing can be switched
off; deterministic extraction is always tried first.

Stated per field group, which is what the brief asked for:

| Field group | Deterministic extraction is enough? | Why |
|---|---|---|
| A Issue terms (price band, lot, face value, issue size, share counts, market cap) | **Yes** | Printed on the cover in fixed labelled forms, with arithmetic that cross-checks itself. Never needs a model. |
| B Timeline | **Yes** | A labelled table. And the exchanges outrank the document here anyway. |
| C Financials (P&L, cash flow, EPS, unit, basis) | **Yes for the tables**, no for the unit line when it is set in prose | `pdfplumber` reads a column-aligned restated statement reliably. The one weak point is the "₹ in million" line when it appears as a sentence rather than a header — and getting that wrong is a 10× error, so it is the single best candidate for a model *proposal* checked against magnitude bounds. |
| D Promoter and WACA | **Mostly** | Two labelled tables. The exception is the footnote defining how the multiple was weighted, which is prose. |
| E Intermediaries, CIN, registered office | **Yes** | Labelled lines with strict formats (CIN has a regex, SEBI registration numbers have a form). |
| F1 Business description | **No — genuine model case** | It is a paragraph. There is no deterministic way to pick the right one, and today we take it from Chittorgarh instead (159 rows), which is exactly the substitution O-8 objects to. |
| F2 Risk factors (headings) | **Yes for headings**, no for summarising bodies | Numbered headings are a regex. We store `seq` and `heading` only, so no model is needed for what we publish today. |
| F4 Objects of the offer | **Yes** | A table with amounts that must sum to net proceeds. |
| F5 Litigation | **No — model case, if we ever publish it** | Prose summary. Not published today; out of scope. |
| Scanned documents with no text layer | **No — OCR, then deterministic** | Not a language-model problem. Recorded as `NEEDS_OCR` and left. |

So: of the document-sourced (class D) fields, **two** are genuine model candidates — the
business description, and the unit line as a proposal-with-check. Everything else is deterministic.
That is the honest answer to "last stretch only": the last stretch is small, and we should not reach
for it until the deterministic 119 are actually being read.

---

## 6. The closed-IPO job — scheduled, capped, and never repeating itself

**This section used to say "not scheduled".** On 2026-09-09 the owner put closed IPOs into the build
(OD-22) with a job of their own:

> *"Add another cycle at ten o'clock at night that deals only with old IPOs, latest closed first, at
> most 10 old IPOs a day, do not repeat which are already done."*

So this is a specification now, not a deferral. It is the third of the three jobs in §2.1.

### 6.1 What the job does

**At 22:00 IST, once a day.** It starts only if the data job's cycle lock is free; if the 14:00 job
is somehow still running, the 22:00 job skips its turn and says so. It never kills anything.

**Which IPOs it picks, in order:**

1. `status` is `LISTED` or `CLOSED`, and `close_date` is before today.
2. Not already marked done, and not marked failed with the **same cause class** as last time.
3. Ordered by `close_date` **descending** — newest closed first, which is the owner's sequence.
4. **At most ten.**

**What it does to each one:** exactly the pull walk of §2.4 over that IPO's field plan, with the
same ranks, the same validation and the same provenance. There is no separate "migration" code path
— a closed IPO is walked by the same walk as a live one, which is the only way the walk stays worth
trusting. The one difference is priority: the closed-IPO job may never take a resource a live IPO
wants, so it runs at 22:00 when the data jobs do not, and it yields the cycle lock rather than
competing for it.

### 6.2 The done-marker, and why a boolean is not enough

*"Do not repeat which are already done"* needs somewhere to record it. One new table,
`closed_ipo_resourcing`, one row per IPO:

| Column | Purpose |
|---|---|
| `ipo_id` (PK) | the IPO |
| `first_attempt_at`, `last_attempt_at`, `attempts` | when, and how often |
| `outcome` | `DONE` · `PARTIAL` · `FAILED` |
| `cause_class` | for `PARTIAL`/`FAILED`: the class of what stopped it — `DOCUMENT_UNOBTAINABLE`, `EXTRACTOR_MISSING`, `VALIDATION_REJECTED`, `SOURCE_UNREACHABLE`, `WRITE_SKIPPED` |
| `cause_detail` | the cause text, so the failure is readable from its own row |
| `fields_written`, `fields_left_empty` | what actually changed, so "we did 10 last night" can be checked against "and 340 fields moved" |
| `resourced_at_version` | the extractor/manifest version it was done under, so a later version can legitimately re-do it |

**Why not a `resourced` boolean on `ipos`.** A boolean answers "have we touched it" and nothing else.
The two questions that actually come up are *"why did that one fail"* and *"which failures are worth
retrying now"*, and a boolean answers neither. The retry rule is precisely the one the owner's words
imply: a `DONE` row is never picked again; a `FAILED` row is picked again **only when its cause class
has changed** — a new extractor exists, the document became obtainable, the rule that rejected it was
corrected. Same cause, same outcome, no retry. That is what stops the job spending all ten of its
nightly slots on the same ten impossible IPOs forever.

### 6.3 The one thing nobody knows yet: are the old documents still there

This was the largest unknown in the whole design, and OD-23 as amended by OD-32 has now removed
**half** of it: from here on, the extracted TEXT of every document is kept for the life of the IPO
row (the PDF for seven days after its last successful extraction, §0.5.1), so no IPO closing today
will ever join this backlog with nothing readable in it. The other half — the IPOs that already lost their files to the seven-day purge
— is a question about the outside world, and it is answered by measurement, not by hope.

`docs/design/probes/old-document-availability.mjs` downloads offer documents for at least twelve
LISTED IPOs on production at three ages (about 1 month, 6 months and 12+ months since listing, four
at each age, mainboard and SME both represented), first from the URL stored in `documents.url`
(there is no `source_url` column — an earlier draft of this section named one that does not exist,
which is exactly the class of error check D11 exists to catch for code citations and which nothing
was catching for column names) and, when that fails, from NSE's, BSE's and SEBI's public document
pages. It
records the HTTP status, the byte size and the first page of text for each attempt. The result — per
source and per age, what is still obtainable — is a table in this design and in the final report.

**If a class turns out to be unobtainable**, those IPOs' fields stay website-sourced and carry a
`source_note` the site can show. That is a worse answer than the document, and it is an honest one.

### 6.4 The preconditions, re-checked against the decisions of 2026-09-09

The five preconditions this section used to list have moved:

| Finding | Was | Now |
|---|---|---|
| **F-09** re-downloaded PDFs deleted by the next purge | blocked the first closed IPO | **answered by OD-23 as amended by OD-32** — the purge stops deleting on a close-date clock and deletes seven days after a successful extraction instead, by which time the text is stored for good; §0.5.1. The code half is build item 18 |
| **F-10** checks wrong for a class silently blank that class | blocked the first closed IPO | **answered by OD-21** — validation rules carry effective dates, and a value outside every window is recorded, not rejected; §5.3. The code half is build item 4 |
| **F-30** four of six gates are prose, not commands | blocked the first closed IPO | **still open**, owned by build item 10: each check becomes a named script with an exit code |
| **F-31** `field_sources` holds one prior value | blocked the first closed IPO | **still open**, owned by build item 17: the snapshot is taken **before** the first closed IPO is walked, not after |
| **F-35** a third extractor on a 2-vCPU box | blocked a backlog drain | **still open**, owned by build item 7: the 22:00 slot is the decided answer, and the lock-skip rule is what enforces it |

### 6.5 The document-type precondition, unchanged

A re-extraction must resolve a **real document type**, or type ranking degrades to
newest-write-wins and an old draft overwrites a final price band advertisement.
`documents.filing_date` is populated on a minority of rows and the healing rule depends on it.
Backfilling it is part of build item 17, not a separate errand.

### 6.6 Switch-over: how the site moves onto the pull model without a bad hour (OD-44)

*(The contract that commissioned this round called this §6.5. That number was already the
document-type precondition, so the section is §6.6 and the register says so — renumbering a section
that other text points at is how a cross-reference quietly starts lying.)*

Nothing above says how the site gets **from** today's push pipeline **to** the pull model. A flag
flipped for everything at once has one certain outcome: some fields improve, some regress, and
nobody can tell which because they all moved together.

**The unit of switch-over is one IPO, and within it, one reconciliation group.**

| Rule | Why |
|---|---|
| **Reconciliation groups flip together, never field by field** | issue size, fresh issue, OFS, price band and lot size are arithmetically tied: `fresh + OFS = total`, `issue size = shares x price`. Flipping `fresh_issue` to the document while `ofs_issue` still comes from the exchange produces a page whose parts do not equal its total — a visible, embarrassing state that no individual field is wrong in |
| **Every member of a group must be answered before the group flips** | if the document gives four of the five, the group waits. A partly-answered group is the same defect as a partly-flipped one |
| **Fields outside a group flip individually** | `registrar`, `isin`, `face_value` and the long tail have no arithmetic partner; flipping them one at a time is safe and keeps the blast radius at one value |
| **Order: open and upcoming IPOs first, one cycle each** | they are the ones being read. A regression there is seen in minutes, which is exactly why they go first — the fastest feedback, on the smallest set (19 rows on production today) |
| **Then the backlog, through the 22:00 job, at ten a night** | the closed and listed IPOs flip on the same schedule that re-sources them, so no separate migration run exists to go wrong |

**The proof that a flip held — and it is not "the tests pass".**

> Two consecutive staging cycles in which the audit's reconciliation failures **for the flipped IPOs**
> go to zero, read from the cycle logs by identity (which IPO, which group), never as a count.

Two cycles, not one, for the reason `.claude/rules/defect-fix-contract.md` gives in its own words: a
clean read straight after a change proves nothing about whether the **next** real cycle overwrites
it. The first cycle shows the flip worked; the second shows the pipeline did not undo it.

**Rollback is per field, and it is data, not a deploy.** Every flipped field's previous value and its
provenance are in `field_sources`, so unflipping is a configuration change plus a restore from the
recorded value — no release, no revert, no waiting for a deploy window (§7.5). That is what makes
this switch-over safe to start before every last question is answered: the cost of being wrong about
one group on one IPO is one config edit.

**What would make this stop.** Two flips rolled back for the same reason is not bad luck, it is a
wrong rule: the switch-over pauses and the rule is fixed in the design before any further IPO flips.

## 7. Cost, sequence, and what I am not sure about

### 7.1 Sequence

**Twenty-two items.** (Eighteen after the first round; the owner's decisions of 2026-09-09 afternoon added four: the merge tool on the shared write path, the traceability check, the read side, and the document-handling and download limits — the last of these because OD-36 and OD-37 otherwise had no implementer, which this section's own rule forbids.) Three of the owner's decisions of 2026-09-09 created work that no
existing item owned: the job scheduler and the budget derivation that comes with removing the
force-kill (folded into item 7, which already owned budgets), the closed-IPO job (item 17) and the
document-retention change (item 18). Item 16 is the Moneycontrol retirement (OD-3). Inventing
nowhere to put them would have left three owner decisions with no implementer.

| # | Piece | Depends on | Tier | Rough size | Module (§7.6) |
|---|---|---|---|---|---|
| 1 | **The child-table consolidated writer** — extend the consolidation contract to `ipo_details`, `financial_statements`, `ipo_valuation`, `ipo_risk_factors`, `promoters`, `anchor_investors`, `ipo_intermediaries`, `peer_companies`: per-field priority resolution, `field_sources` rows, `data_conflicts` rows | — | **A** | **large — and it is the gate on everything below** | `consolidation` |
| 2 | Field manifest + priority configuration: which document type prints which field, and the rank order, as one validated configuration file family | — | B | small — the spec turned into data | `config` |
| 3 | Matrix cleanup: delete the 13 dead snake_case keys, adopt the manifest | 2 | B | medium, mechanical | `config` |
| 4 | **Per-field validation before the write (OD-21)** — the failure row, the rule configuration, and the effective dating that closes F-10 | 2 | **A** | medium — it is a write-path change, not a helper | `validation` |
| 5 | `ipo_field_plan` table + generator | 1, 2, 3 | **A** | medium | `plan` |
| 6 | The pull walk over the plan | 5 | **A** | large — the core | `walk` |
| 7 | **The job scheduler and the budgets** — the three jobs of §2.1 with their cron lines and PM2 change, the removal of the `cron_restart` force-kill, the lock-skip rule, the new extraction/wake/lock budgets and the never-spawn-without-budget invariant; then demand-ordered tiering (O-4) | — (scheduler) · 6 (tiering) | **A** | medium | `schedule` |
| 8 | The ratios / basis-for-offer-price extractor (32 pending documents) | — | B | medium, independent | `extraction` |
| 9 | The re-read loop | 6 | **A** | medium | `re-read` |
| 10 | The verification checks in §4, each a named script with an exit code (closes F-30) | 6, 9 | B | medium — nothing above is proven without it | `verification` |
| 11 | **Crore conversion (OD-20)** for the amount columns §5.2 lists, the source-backed repair tool, the one-release API overlap, and `financial_data` becomes derived | 10 | **A** | large, own release | `consolidation + read-side` |
| 12 | Fold corporate-form words into the name normaliser, and run duplicate detection at discovery on the stricter key in §2.3.3 — F-46, F-55 | — | **A** | small code, high blast radius: it changes what binds to what | `discovery (identity)` |
| 13 | Extract `ofs_issue` in both the rupee form and the share form, fix `fresh_issue`, gate the write on `fresh + OFS = total ±0.5%` — F-51 | 2 | **A** | medium — it is wrong on 6 of 9 live IPOs today | `extraction` |
| 14 | Convert BSE `Issue_Size_No_of_shares` from a share count to rupees, with a conversion test — F-54 | 13 | B | small, but it is the recurrence class the detection gate exists for | `extraction` |
| 15 | Revive `valueActuallyChanged` so no-op suppression can be measured — F-49 | — | B | small; **prerequisite of item 6**, which cannot be verified without it | `consolidation` |
| 16 | **Retire Moneycontrol (OD-3)** — stop scheduling it; keep the enum value and the provenance rows already written | — | C | small | `discovery` |
| 17 | **The closed-IPO job (OD-22)** — the 22:00 schedule, `closed_ipo_resourcing`, the selection query and cap, the `field_sources` snapshot that closes F-31, and the `documents.filing_date` backfill | 6, 7, 10 | **A** | medium | `schedule` |
| 18 | **Document retention (OD-32)** — remove the live window, store the extracted text per page for the life of the IPO row, and re-anchor the purge to last-successful-extraction + 7 days | — | B | small, and it stops the backlog compounding | `download (store)` |

| 19 | **The merge tool on the shared write path (OD-49)** — `scripts/merge-duplicate-ipo.mjs` stops holding raw SQL against `ipos` and writes through the consolidation path, plus the merge log and the `unmerge` command of §2.3.3.3 | 1 | **A** | small code, high blast radius: it is the gate blocking PR #432 | `consolidation` |
| 20 | **The traceability CI check (OD-52)** — `scripts/ci/check-design-traceability.mjs`: every design rule id has a build item, every build item's ids have a test, no test claims an unknown id, and a rule whose text changed drags its card and its test with it (§8.5) | 2 | B | small, and it is what makes "we followed the design" a command rather than a claim | `verification` |
| 21 | **The read side (OD-39, OD-40, OD-41)** — the source-and-confirmed-on line under each key-facts block, the stale marker, the end-of-cycle revalidate call, and the canonical / sitemap / redirect rules after a merge (§2.11) | 1, 6 | B | medium — it is the only item a reader can see | `read-side` |
| 22 | **Document handling and download limits (OD-36, OD-37)** — multi-part filings, OCR routing, the one blank-password attempt, content sniffed before store, the exchange document id; and the host allow-list extended to the registrars, the private-address refusal, the 100 MB cap and the refusal log line (§2.2.1) | — | **A** | medium — it is the network boundary, and it fails closed | `download` |

**Item 1 is first, by owner decision (2026-09-08), and nothing from item 5 onward is contracted until
it lands.**

**Items 12–15 are the code halves of findings this design settled but cannot itself fix.** They are
listed here rather than left in the register because a finding whose fix has no build item is a
finding nobody owns. Two of them are live data defects, not future risks: item 13 is wrong on **6 of
9** live IPOs right now, and item 12 is the gap that let production carry the same mainboard IPO
twice on the day it opened. Item 15 is small and unglamorous and still blocks item 6 — without it,
"verification confirmed 2,850 fields" and "verification rewrote 2,850 fields identically" are
indistinguishable.

`consolidatedUpsertIPO` consolidates **`tableName: 'ipos'` only**
(`data-consolidation-orchestrator.ts:187`) — **32 of the 240 fields.** The eight child tables are
written by `persistFilingExtraction` through their own repositories, with no priority resolution, no
provenance and no conflict rows. That is precisely *why* §0.1 measures them as 100%
document-sourced: nothing else can write them.

So **208 of 240 fields have no consolidated writer at all**, and the pull loop would have nowhere to
put 87% of what it extracts. An earlier draft buried this under a bullet claiming the write path was
unchanged. An implementer trusting that would have built the walk, run it, and found that the walk
works and the writes go nowhere. **It is the largest single piece of work here and it was described
as no work at all.**

**Deliberately not done first: the walk.** Building it early would "work" — on 32 fields — and give a
confident reading on the easiest third of the problem while the hard part is untouched.

Items 4, 8, 16 and 18 are genuinely independent and can start immediately, in parallel with item 1,
without prejudging anything. Item 7's scheduler half is independent too; its tiering half is not.
Everything from 5 onward is one design and should not be half-built.

### 7.2 What is reversible and what is not

- **Reversible:** items 1, 2, 3, 9, 10, 15, 16, 18 — additive or subtractive behind a flag, with no
  stored value rewritten. Item 18 (retention) is reversible only in the sense that the constants go
  back; documents already deleted under the old rule do not come back, which is the argument for
  doing it early rather than late.
- **Reversible with effort:** items 4, 5, 6, 7, 8, 12, 13, 14 — they change what gets written, but
  `field_sources` records the previous value and source for every field, so a bad batch can be rolled
  back per field. Item 7's scheduler half is a configuration change and is reversible immediately;
  its budget half needs the new invariant to go back with it.
- **Not cleanly reversible:** item 11 (the crore conversion) once the public API has served the new
  shape, and item 17 (the closed-IPO job) once website-sourced values on historical rows have been
  overwritten. Both need a staging proof that is real, not a green test, and item 17 additionally
  needs F-31's `field_sources` snapshot taken **before** the first row is walked — that snapshot is
  the only thing that makes "roll it back per field" true past the first overwrite.

### 7.3 What I am not sure about, plainly

1. **Whether the old PDFs are still downloadable.** This was the single biggest unknown in the whole
   document, and it is now half answered and half measured rather than deferred. **Half answered:**
   OD-32 keeps every document's extracted text for the life of its IPO row, so no IPO closing from
   here on will ever reach the backlog with nothing readable — the unknown applies only to the IPOs that already lost
   theirs to the seven-day purge. **Half measured:** `probes/old-document-availability.mjs` (§6.3)
   downloads real documents for LISTED IPOs at three ages from `documents.source_url` and from NSE,
   BSE and SEBI, and reports per source and per age what is still obtainable. Where a class turns out
   to be unobtainable, those fields stay website-sourced with a `source_note`, and the design says so
   rather than promising a number.
2. ~~Whether `ipo_field_plan` should be a new table or columns on `field_sources`~~ **RESOLVED
   2026-09-09: a new table.** `field_sources` records what a *successful write* used; the plan has to
   record what was *asked for and did not come back*, which is a different row with a different
   lifetime — a field never attempted and a field attempted and failed are indistinguishable in
   `field_sources`, both simply absent. Bolting plan state onto it would overload one table with two
   meanings, and the per-field backoff and claim columns would be null for every provenance row. The
   DDL and the two queries the walk runs against it are in the item-5 build card.
3. **The FPO rules are unexercised.** Zero rows on production. They are written from the general
   pattern and have a higher chance of being wrong than anything else in §1.11.
4. ~~The target metric~~ **RESOLVED by the owner, 2026-09-08: the target is 100%, per field, not a
   blended average** (§2.1.1). I had proposed 90% of a chosen denominator; that was the wrong shape,
   because a blended percentage lets the worst fields hide inside a good average and nobody has to
   name which ones. The rule is: if the offer document prints the field, the offer document supplies
   it, and **every fall-through to round 2 or 3 is a named exception with a reason** (§2.5) rather
   than an accepted residue.

   The measured context that remains useful:

   | | Value | Source |
   |---|---:|---|
   | Document-owned fields on a real mainboard IPO (Deepa Jewellers) | 56 of 61 tracked | `field_sources`, this session |
   | Of those, supplied by the document today | 47 (**84%**) | same |
   | Fields it currently loses to a website **that the document prints** | 9 — company name, lead managers, lot size, registrar, symbol, price band low/high, segment, offering type | same |
   | Fields that can never be document-owned | 5 — open date, close date, listing date, status, listing exchange | the W-117 rule (§1.2) |

   So 100% is reachable on the document-owned set; the 5 excluded fields are excluded by our own
   deliberate decision, not by a shortfall. **What still needs the owner's word is whether those 5
   stay excluded** — see item 7.
5. ~~Whether `financial_data` should become derived or be dropped~~ **RESOLVED 2026-09-09: derived.**
   Dropping it is cleaner and breaks the public API shape for every consumer of the three hard-coded
   fiscal-year columns; deriving it from `financial_statements` keeps that shape, fixes the live Annu
   Projects defect (§0.9) and gives the crore conversion one place to happen instead of two. It ships
   inside item 11, not as a separate change, because doing the derivation and the unit conversion in
   two releases would mean converting the same numbers twice.
6. **The cost in wall-clock of draining the closed-IPO backlog.** At the owner's cap of ten IPOs a
   night, 228 historical IPOs is **at least 23 nights** if every night succeeds — and nights on which
   documents turn out to be unobtainable will retry nothing, so the real figure is longer and depends
   on the availability probe of §6.3. That arithmetic is the honest floor; the extraction time per
   IPO is not modelled here and should not be quoted from this document.

7. ~~The timeline fields~~ **RESOLVED by the owner, 2026-09-08.** They stay on the exchanges as
   named exception E-1, NSE first and BSE second, and the owner then directed that the rule apply to
   the **full timetable family**, not only the five he first named. E-1 was established at
   **twelve fields** by testing every date- and schedule-like field among the 194 against one
   question — does this value change when the bidding window changes? — then reduced to **ten**
   closing F-22 (2026-09-08): the two anchor lock-in dates are **derived** (`allotment_date + 30d /
   + 90d`), not independently sourced, so they were never really E-1 members and are now class C
   (§1.2.1).

   The three I had missed at the time were all in `anchor_investors` — the anchor bidding date and
   the two lock-in expiry dates, which move with the allotment date. Two of those three (the lock-ins)
   are the ones since reclassed out of E-1 by F-22.

   **Two judgement calls I made inside that instruction, both flagged rather than silent:**
   `upi_cutoff_time` and `bid_windows` are in the same printed table but hold a **time of day, not a
   date** — when a window is extended the date moves and 5 PM is still 5 PM. I left them
   document-first, because putting fields in an exception list that the exception's reason does not
   cover is how such a list becomes a dumping ground. A two-row change if the owner prefers
   consistency over precision here.

8. **A data-hygiene defect found while doing this, not yet fixed.** `field_sources` holds two
   different keys for the same concept: `ipos.listingExchange` (224 rows) and `ipos.listingExchanges`
   (208 rows). Only the plural matches a real column; the singular writes provenance for a column
   that does not exist. Any per-field report on that concept is currently split across two names.
   Small, but it belongs in the matrix cleanup (§7.1 item 2) rather than being left to be
   rediscovered.

---

### 7.4 What this costs to run (OD-45)

Owner, 2026-09-09: the running cost has to be **measured**, per job, against the box we actually
have. Two cost surprises in one month — a GitHub Actions bill and a VPS disk fill — both came from a
number nobody had ever computed.

#### The box, read from the host rather than remembered

`probes/plan-limits.mjs`, from the Hostinger API payload saved at
`probes/fixtures/hostinger-plan-2026-09-09.json`:

| | |
|---|---|
| Plan | **KVM 2**, Ubuntu 24.04 LTS, `72.61.240.224` |
| CPU | **2 vCPU** |
| Memory | **8 GB** |
| Disk | **100 GB** (102,400 MB) |
| Bandwidth | **7.81 TB/month** (8,192,000 MB) |

One correction falls out of that fetch: this project's own notes described the disk as 96 GB. It is
100 GB. A cost table built on the remembered number would have been wrong before its first row.

#### What each job costs, per day

`probes/job-cost.mjs`. The **request sizes are measured** — every one is the byte size of the real
payload this design's probes fetched on 2026-09-09 and committed under `probes/fixtures/` — and the
**call counts are derived** from the cadence in §2.1 over 19 live IPOs, 10 closed IPOs a night and
about 3 new filings a day.

| Job | Calls/day | Bytes/day | GB/month |
|---|---:|---:|---:|
| Data job (00:00, 08:00, 14:00) | 123 | 22.9 MB | 0.67 |
| Opening-day check (~09:45) | 2 | 0.01 MB | 0.00 |
| Live figures (every 30 min, 10:00–18:30) | 342 | 0.12 MB | 0.00 |
| Grey-market premium (every 30 min, all day) | 48 | 1.6 MB | 0.05 |
| Post-listing price (every 15 min, market hours) | 300 | 0.11 MB | 0.00 |
| Closed-IPO job (22:00, ten a night) | 20 | 25.1 MB | 0.74 |
| **Total** | **835** | **49.8 MB** | **1.46** |

**1.46 GB a month is 0.018% of the plan's bandwidth.** The honest conclusion is that **bandwidth is
not a constraint on this design and never will be** — and saying so is the point of measuring. The
two jobs that carry 96% of the bytes are the two that download documents; everything else is
rounding error.

#### The constraints that ARE real

| Resource | Ceiling | What this design uses | The binding rule |
|---|---|---|---|
| **CPU** | 2 vCPU, shared with the web app and the notifier | a 50-minute wake budget, dominated by PDF extraction | never start an extraction with less than `EXTRACT_TIMEOUT_MS` of wake left (§2.1). CPU seconds per cycle are **not** measured here — a laptop cannot measure them honestly. They are read from a staging cycle log, and the first release that ships item 7 must print them |
| **Disk** | 100 GB, currently 0.74 GB of documents (`probes/document-store-size.out.json`, production) | a working set: the last seven days' PDFs plus anything not yet extracted (OD-32) | the 5 GB store ceiling, now easy rather than tight — OD-32 turned an archive into a working set |
| **Politeness at the source** | not ours to set | 835 requests a day across four hosts, the busiest being 48 GMP page reads | this is well under any published rate limit, and the design's own rule that a refusal is logged with its cause (§2.2.1) is what would tell us if a source disagreed |
| **Paid APIs** | — | **zero** | phase 1 makes no paid call. Any future paid call needs its own line in this table and the owner's approval before it is written into a config |

#### The budgets, and the alarm

Each job carries a **daily call budget and a daily byte budget in configuration** (§7.6), set at
roughly twice the table above so ordinary variation never pages anyone. The alarm is deliberately
slow: **a job over 150% of its line for three consecutive days** posts to the Notifier. One busy day
— five IPOs opening at once — is normal; three in a row is a change in behaviour, and that is what
is worth waking someone for.

The budgets are also the safety net on a bug this design can plausibly write: a walk that re-asks a
field it should have marked supplied would show up here as a call count climbing with no new IPOs,
days before anyone noticed anything on the site.

### 7.5 How this ships (OD-50)

Owner, 2026-09-09: *"Avoid lot of deployments … GitHub starts asking for payment … deployment should
not happen every day. If there is any urgent code change, it should happen the same day in the
evening. If it is a normal code change, then it can be delayed for a week, or maybe it can happen on
weekends."*

A design that produces twenty-one build items and no shipping plan produces twenty-one deploys. This
section is the plan, and it is part of the design because the release grouping decides which items
must land together to keep the site consistent.

#### The branching model, restated (SSOT: `docs/ops/branching-model.md`)

| Branch | Role |
|---|---|
| `main` | integration. Every item lands here by PR. **Every push auto-deploys staging**, so staging is always soaking the next release |
| `release/prod-<date>` | the frozen production line, cut from `main` at a sha that has soaked. **Production deploys only from this branch**, tagged `prod-<date>` after the served sha is verified |
| `feat/*`, `fix/*`, `chore/*` | short-lived work branches in worktrees, PR'd into `main` |
| `hotfix/*` | an outage-class fix for the CURRENT production line: branched from the release branch, deployed from it, then cherry-picked into `main` — never the other way round |

#### The two cadences

| Class | What qualifies | When it ships |
|---|---|---|
| **Urgent** | a live defect on an **OPEN or UPCOMING** IPO (a wrong price band, a wrong issue size, a page that will not render), or an outage | **the same day, in the 21:00–23:30 IST window.** One deploy, complete and locally proven |
| **Normal** | everything else, including every item in §7.1 | **batched into one weekly release**, cut on a weekend or in the owner's named window |

And the rule that binds both: **never two production deploys in one day.** The reason is not
elegance. Five production deploys in a single day in September consumed the scraper's cron slots and
enough GitHub Actions minutes that GitHub asked for billing — a cost the project pays directly.

#### Keeping the Actions bill down, concretely

- **Local gates first.** `npm run lint:ci`, `tsc --noEmit`, the unit suites and the design gate all
  run on the laptop. A push is for work that has already passed, never to see whether it passes.
- **Full suites on `workflow_dispatch`.** Integration and E2E do not run per PR by design; they are
  dispatched once per release bundle.
- **Docs-only commits skip CI** — this design's own PRs are docs-only and cost nothing.
- **One PR per item, one merge per item, one deploy per bundle.** Stacked PRs where items depend on
  each other, so a bundle is reviewed as a set rather than as five separate green checks.

#### The release grouping — which items ship together, and why

Each row is one weekly release. Items are grouped so that no release leaves the site in a state where
a page's parts do not add up to its total.

| Release | Items | Why these together | Reader-visible? |
|---|---|---|---|
| **R1 — foundation** | 1 (child-table writer), 2 (field manifest + priority config), 3 (matrix cleanup), 15 (`valueActuallyChanged`), 20 (traceability CI) | nothing above item 5 can be built or **proved** until the writer, the configuration family and the traceability check exist. Item 15 is here because without it no later release can tell "confirmed 2,850 fields" from "rewrote 2,850 fields identically" | no |
| **R2 — the live defects** | 12 (name normaliser + duplicate detection), 13 (`fresh` / `ofs` / total), 14 (BSE share count to rupees), 19 (merge tool on the shared write path), 16 (retire Moneycontrol) | these are wrong on production **today** — item 13 on 6 of 9 live IPOs. They are grouped because 12 and 19 are the two halves of one story (detect a duplicate, merge it reversibly), and 13/14 are the two halves of the issue-size arithmetic | yes — numbers change |
| **R3 — the loop** | 4 (per-field validation), 5 (`ipo_field_plan`), 6 (the pull walk), 9 (the re-read loop), 10 (the §4 checks as scripts) | the loop is one mechanism. Shipping the plan table without the walk, or the walk without the checks, gives a release nobody can verify | no (behaviour identical until switch-over begins) |
| **R4 — schedule and documents** | 7 (jobs, budgets, force-kill removal), 17 (closed-IPO job), 18 (retention per OD-32), 8 (ratios extractor) | 17 and 18 both depend on 7's scheduler, and 18 changes what 17 can find. 8 rides along: independent, and it unblocks 32 pending documents | no |
| **R5 — money and the reader** | 11 (crore conversion + repair + API overlap), 21 (the read side) | item 11 is the one release the owner asked to keep on its own because it changes every amount on the site; 21 ships with it so the reader learns **where a number came from** in the same release the numbers change shape | yes — the biggest visible change |

**The switch-over (§6.6) is not a release.** It is configuration applied per IPO after R3, so the
riskiest part of this design ships without a deploy at all.

**One rule the grouping must not break:** an item in a later release must never be a prerequisite of
an earlier one. §7.1's `Depends on` column is the check, and item 20's CI job enforces the other
direction — a release is refused while any rule id in its items lacks a green test (§8.5).
### 7.6 Configuration over code, and the modules this splits into (OD-51)

Owner, 2026-09-09: *"For settings, we should use customization not code changes … when I said change
the source of the field from currently one to three, you should just make a small customization
change, not a code change … everything is properly modularized and can easily be updated without
affecting the whole code."*

That is one requirement with two halves. **Half one: every knob is data.** **Half two: the code
behind the knobs is separable enough that turning one does not move the others.**

#### Half one — every tunable this design names, in configuration

Nothing in this table may be a literal in a `.ts` file. Each is loaded at process start, validated
against a JSON schema, and re-read per cycle so a change takes effect on the next cycle rather than
on the next deploy.

| What | Named in | Example of a change that must NOT need a deploy |
|---|---|---|
| Per-field source ranks and per-source capability | OD-5, §2.3.5, Appendix A | *"take `registrar` from three sources instead of one"* — the owner's own example |
| Job cadence and slots | OD-19, OD-31, §2.1 | moving the opening-day check from 09:45 to 09:30 after the probe re-measures |
| Lock names and TTLs | OD-27, §2.1 | raising the heavy lock TTL when the wake budget changes |
| Budgets and caps | §2.1 | extraction timeout, wake budget, spawns per cycle, the 10-a-night closed-IPO cap |
| Validation rules and their effective dates | OD-21, §5.3 | a lot-size rule that changes for issues priced after a date |
| Retention | OD-32, §0.5.1 | the seven-day PDF window, the 5 GB ceiling |
| The download host allow-list | OD-37, §2.2.1 | a new registrar's domain — data, because `registrars` is a table |
| Unit tags per column | OD-48, §5.2 | which columns are rupees and which are crore |
| Reconciliation groups | OD-44, §6.6 | which fields must flip together |
| Per-job cost budgets and the alarm threshold | OD-45, §7.4 | raising a job's daily call budget |
| The lapsed-draft period | OD-35, §2.3.3.2 | SEBI's own relaxation of 2026-04-07 moved this in the real world |

**Two rules keep this honest.**

1. **A schema, validated at start, with the process refusing to run on invalid configuration.** A
   silently-ignored bad rank is worse than a crash: it looks like the change was made.
2. **A config-diff test.** A rank change is reviewed as a **diff of the resolved plan** — "these 14
   fields would now resolve differently" — not as a diff of a JSON file. That is what makes a
   config edit reviewable by someone who did not write it.

**How configuration reaches production without a code release — decided here, with the reason.**
The options were a database-held config with an admin screen, or a config-only deploy path. **The
design takes the config-only deploy path**: the configuration files live in the repository, and a
change to them alone ships through a lightweight path that copies the files and signals a reload,
with no build and no PM2 restart. The reason is that the alternative puts the rules that decide what
gets published into the same database the pipeline writes to — so a bad write, or a restore from a
backup, could silently change what the site believes. Configuration in git also gets what the owner
actually wants from a change: a diff, a reviewer, a date, and a one-command revert. The admin screen
remains available later for the small set of values a non-engineer would genuinely turn (the cap, the
thresholds), and it would write to the same files.

#### Half two — the modules, and the rule that keeps them apart

Ten modules, each with one responsibility and a stable interface. Every build item in §7.1 names the
module it lives in.

| Module | Owns | Must not |
|---|---|---|
| `discovery` | finding that an IPO or a filing exists; identity binding (§2.3.3.2) | fetch a document body, or decide a field's value |
| `download` | fetching bytes, the host allow-list, the limits (§2.2.1), the store and its retention (§0.5.1) | parse a PDF |
| `extraction` | bytes to text to typed values, with page and part provenance | decide which source wins |
| `validation` | per-field rules before the write (§5.3), effective dating | write anything |
| `consolidation` | the single write path: precedence, supersession, `field_sources` | know what a scraper is |
| `plan` | `ipo_field_plan` — what was asked, what came back (§2.3) | fetch |
| `walk` | the per-field pull loop over the plan (§2.4) | contain source-specific logic |
| `verification` | the §4 checks, the re-ask schedule, the audit scripts | fix anything |
| `re-read` | the disagreement loop (§3) | bypass consolidation |
| `read-side` | what the reader sees (§2.11): the provenance line, the revalidate call, canonical and sitemap | write to the pipeline's tables |

**The dependency rule: a lower layer never imports a higher one.** The order is
`discovery → download → extraction → validation → consolidation`, with `plan`, `walk`, `verification`
and `re-read` above them, and `read-side` above everything, reading only through repositories.

**And a test that fails when the rule is broken** — a static import-graph check in CI, not a
convention in a document. Conventions about layering are obeyed until the first deadline; a failing
build is obeyed always. It is part of build item 20, beside the traceability check, because both
answer the same question: does the code still match what this design says it is?

## 8. Definition of done for this document

### 8.1 Where this document stands

Run `node docs/design/check-design-consistency.mjs --gate` for the live position — it is the only
statement of status that cannot go stale, and it fails if any sentence below stops being true. As of
the implementation-ready round of 2026-09-09 it reports **19 checks**, D1 to D16.

**What this document is now:** the mapping for all 240 fields and all IPO types (§1, Appendix A) with
105 of 387 (field, source) pairs backed by a payload this repository holds; the pull loop (§2); the
re-read loop (§3); how we would know it worked (§4); the owner's decisions folded in and enforced by
a check each (§0.0.1, D12–D15); the closed-IPO job specified rather than deferred (§6); the build
sequence (§7.1) with **a build card per item** under `docs/design/build-cards/`, gated by D16; and
two real IPOs walked field by field under `docs/design/walkthroughs/`.

**What it is still not:** proof that the code will behave. §4 is the set of checks that would prove
it. None has been run against a built system, because nothing is built. The walkthroughs are the
closest thing to a rehearsal, and a rehearsal is not a performance.

### 8.2 What is measured, what is cited, what is judgement, and what is provisional

The difference matters more than the page count, and this round moved several rows of this table.

| Rests on | Examples | How far to trust it |
|---|---|---|
| **Backed by a saved payload** | 105 of 387 (field, source) pairs in Appendix A; the unit each amount column holds today; the store size; whether an old document is still downloadable; what the real extractor produces on four real offer documents | Re-runnable: every probe is one command, its output is committed beside it, and D15 ratchets the count |
| **Measured this round** | 27 unreachable matrix keys of 77, 22 of them orphans (§0.6); 149 of 240 fields empty on a live mainboard IPO (walkthrough); the ten-a-night arithmetic behind §7.3 item 6 | Generated, not typed. Where a measured number contradicted an earlier written one, the measurement won — four times |
| **Read from the code, cited** | the cadence, the budget derivation, the write path, the 32-of-240 consolidation gap | 30 citations, each re-resolved by D11 to a file and a line that exists |
| **Judgement** | the build ORDER, the tier sizes, where a re-read stops, what counts as a conflict, which of two owner statements governs when they collide | Argued in place, never measured. This is the part worth disagreeing with |
| **Provisional on an owner fork** | §5.2's five retail rupee columns (O-12); §2.1's grey-market premium (O-13) | Written on a stated recommendation, marked in place, and D14 fails if a marker loses its row |

**The part with the worst track record is still claims about our own code**, and this round added to
the evidence for that. Four separate statements in this document were wrong about our own code and
were caught only because somebody read the code or ran a probe: the amount-column conversion scope,
build item 14 already existing, the count of dead matrix keys, and the root cause of F-46. D7 guards
seven specific disproved claims; it cannot catch an eighth. When a claim about existing behaviour
matters to a decision, open the citation.

**And the checks themselves are not exempt.** D10c has now been wrong in both directions — once
passing while examining nothing, once failing a row that merely quoted history. Every check added
this round was deliberately broken before it was trusted, and both runs are in the progress log.

### 8.3 What is still yours

Findings: **53 fixed, 7 open, 6 deferred with a named trigger, 1 not doing.** The open ones are
each owned by a build item and named in §7.1; none of them blocks scoping.

Owner forks, all in §0.0.2, none of which stops work — each is written on a recommendation and marked
where it applies:

| | Recommendation the design is written on | Blocks |
|---|---|---|
| **O-7** language model | standing constraint; nothing in phase 1 uses one | nothing |

Five of the comments that were open a day ago are now decisions in §0.0.1, each with a check
enforcing it: the cadence, the money unit and partial failure in the morning (OD-19, OD-20, OD-21),
and the five retail rupee columns and the grey-market premium in the afternoon (OD-48, OD-28). O-7,
the language-model constraint, is the only fork left, and nothing in phase 1 depends on it.

#### The one thing that blocks a merge, and it is not a design question (OD-49)

`pr-gate` is red on PR #432, and it is not that branch's doing. `scripts/merge-duplicate-ipo.mjs`
arrived on the base branch and writes to `ipos` with raw SQL, which is exactly what the write
ratchet exists to notice.

**The fix is to route that write through the shared write path** — build item 19. The ratchet's
baseline is shrink-only by its own header, and adding the script to it would be recording that a
one-off tool may write to the core table however it likes. **Never grandfather the script.** Until
item 19 lands on the base branch, PR #432 and this run's PR both meet the same red check, and the
order in which they merge is yours to choose:

1. **Merge #432 first**, then this PR on top of it — two smaller reviews, and the item-19 fix lands
   after both.
2. **Let this PR supersede #432** — one review of the finished design, and #432 closes unmerged.

Either way item 19 is the unblocker, and neither PR changes behaviour, so nothing on the site waits
on this decision.

### 8.4 Done means

You have read it and said it is right, or named what is wrong. Implementation is then a separate
decision with its own contracts, tiers and budgets — item 1 first, by your decision, and nothing
from item 5 onward contracted until it lands.

---

### 8.5 How implementation proves it followed this design (OD-52)

The owner's question, 2026-09-09: *how will the implementation prove it has followed this design, rule
by rule?*

The honest starting point is that it could not. This document states **144 rules** across 41
sections. Nobody can hold that in their head while reading a pull request, so "we built what the
design says" was unfalsifiable — not dishonest, just uncheckable, which over twenty-two build items
is the same thing.

The fix is to give every rule a **name that the design, the build card, the test and CI all use**.

#### (a) Every rule gets a stable id

`docs/design/generate-rule-index.mjs` reads this document and writes `docs/design/rules.json`: one
entry per rule with its id (`R-001` …), its section, a hash of its text, and the date it was first
seen. What counts as a rule is deterministic and written at the top of the generator: a blockquote,
a row of a Rule-headed table, or any paragraph or table row in sections 2–7 carrying **must**,
**never** or **always**.

The extraction is deliberately broad. A false positive costs one line in a build card; a false
negative is a rule nobody has to implement — which is the failure this whole mechanism exists to
prevent. **Measured 2026-09-09: 144 rules, 41 sections.** The first version of the generator found
30, all of them in sections written that same afternoon, and reported itself "in step" — a
traceability index covering a sixth of the design is worse than none, because it hides the gap it
was built to show.

**An id is bound to the hash of its rule text.** Re-running never renumbers an unchanged rule. When a
rule's wording changes it gets a new id and the old one is **retired in place, never reused** — so
the card and the test that named the old id immediately fail, and a changed rule drags its
implementation and its test along with it. That is the property the owner actually asked for.

#### (b) Every build card lists the rules it implements

Each of the twenty-two cards carries a **Rules implemented** heading listing its R-ids, and a
**Known gaps** heading. Check **D19** in the design gate fails when any live R-id is claimed by no
card.

Some rules are not code. §7.5's deploy cadence, §7.3's uncertainties and §5.6's language-model
constraint are rules about **how we work**, and pretending a build item implements them would be the
decoration this mechanism is meant to kill. They are declared instead in
`docs/design/rules-unclaimed.json`, each with a reason, and D19 fails on any id that is neither
claimed by a card nor declared there. Unclaimed is allowed; **unclaimed and silent is not.**

#### (c) Every test declares the rules it covers

A test that implements a rule opens with a header comment:

```
// implements: R-012, R-045
```

One line, greppable, and it survives a file move — which a path-based mapping does not.

#### (d) CI refuses a pull request that breaks the chain

`scripts/ci/check-design-traceability.mjs` (build item 20 — designed here, written by the
implementer) fails a PR when:

1. a live R-id has no build item,
2. a build item's R-id has no test anywhere in the tree,
3. a test declares an R-id that does not exist (a typo, or an id that was retired),
4. a rule's hash changed and neither its card nor its test was touched in the same PR.

Rule 4 is the one that earns the check. The first three catch omissions at build time; the fourth
catches the case that actually happens — someone improves a sentence in the design six weeks from
now, and nothing anywhere notices that the code no longer matches it.

#### (e) A release is refused while a rule in it is unproven

§7.5 groups the items into five releases. A release is not cut while any R-id belonging to its items
lacks **a green test and its staging proof line**. This is the design's own
`defect-fix-contract.md` applied to the build: a merge to `main` is how a proof is obtained, and the
release cut is where the proof is required.

#### (f) Per pull request, a conformance review

The reviewer is given **only the R-ids the PR claims and the diff**, and answers one question: does
this diff implement these rules, all of them, and nothing they do not say? A reviewer holding the
whole design reviews the code they expected; a reviewer holding five specific rules reviews the code
that is there.

#### What this does not do

It proves the code implements the **rules as written**. It cannot prove the rules are right — that is
what the walkthroughs (§8.2), the probes (§0.0.3) and the review rounds are for. A design can be
faithfully implemented and still be wrong about the world, and no amount of id-matching would say so.

## Appendix A — the complete per-field source resolution (all 240 fields, all IPO types)

**This appendix is the implementable form of §1 and, where they differ, it wins.** §1 explains the
reasoning per group; some of its rows resolve a whole table in one sentence ("all of `financial_data`
is rank 1 DOC, rank 2 Chittorgarh, rank 3 Moneycontrol"), which is readable but not something code
can be built from. Every one of the 240 fields below carries its own three sources, its own per-type
variation, and — where there is no rank 2 or 3 — the reason there is none, so a blank is never
mistaken for an omission.

Generated from a single specification: **240 fields — 194 populated on production today, plus 46
published columns the offer document prints that hold no data at all today** (`neverPopulated: true`
in the spec), added closing F-13. Scoping this appendix to only-what's-populated was backwards: a
field is empty precisely because no document was ever read for it. Every populated production field
is still in the spec, zero difference. The 46 never-populated fields cannot be checked against
production the same way — there is nothing on production to check against — so their source ranks are
asserted from the extraction contract (`docs/reviews/wp-c-extraction-contract.md` §1) and stay
unverified until the first document actually populates one. This must be re-run whenever a field is
added.

### A.0 The verification this appendix passed

Reviewed three times on 2026-09-08 at the owner's insistence. Each pass found real defects that
reading the document would not have shown. The current state:

| Check | Result |
|---|---|
| Every populated production field is in the spec, zero difference | **194 = 194** |
| Published columns the document prints with zero rows today (F-13), added to the spec | **46**, each flagged `neverPopulated: true` |
| Sourced fields with fewer than three sources that give **no reason** | **0** |
| Fields where SME silently loses a source mainboard has | **0** |
| Exchange-specific values fetchable for a venue the stock is not listed on | **0** |

**Mainboard source depth, stated plainly rather than claimed complete:**

| | Fields |
|---|---:|
| Three sources | **97** |
| Two sources, reason stated (§A.3) | 22 |
| One source, reason stated (§A.3) | 71 |
| No source — computed (class C) or written by our own pipeline (class I) | 50 |
| **Total** | **240** |

**Not every sourced field has three, and they never will.** 93 of them have fewer (22 two-source, 71
one-source) because a second publisher does not exist, or publishes a *different* number that would
be wrong to substitute — every one carries its reason inline in this appendix's Note column, and the
original 40 (the fields present before this session) are narrated by name in **§A.3**. Claiming three
sources for the anchor investor list or for share counts at the floor price would mean inventing one.

**Three rounds of defects this review caught.** All were in versions already committed, and none was
visible by reading the document:

1. **28 SME fields silently had only two sources.** The resolver deleted the absent exchange and left
   a hole instead of promoting the next real source, so `ipos.symbol` on a BSE-listed SME read
   `DOC · BSE · —` when the answer is `DOC · BSE · CG`. Measured on production, **Chittorgarh covers
   167 of 172 SME IPOs (97%, 3,272 rows) while BSE has written data for only 8** — so the dash was
   discarding SME's most reliable non-document source. Fixed by resolving from an ordered **pool**:
   ranks are the first three sources the IPO type actually has, so a hole cannot appear while a real
   source remains.

2. **An NSE price could be fetched for a stock that does not trade on NSE.** `current_price_nse` on a
   BSE-only SME fell through to Chittorgarh instead of being N/A. Now N/A in both directions.

3. **I asserted "no website publishes a restated financial statement". That was false, and our own
   scraper disproves it.** `scraper/src/scrapers/chittorgarh-detail-fields.ts` reads Chittorgarh's
   restated "Company Financials" table (`getTableById(html, 'financialTable')`) and extracts revenue,
   total income, EBITDA and PAT **per fiscal year**, plus the fiscal years themselves. Six
   `financial_statements` fields had been marked document-only on the strength of my assumption; they
   now carry Chittorgarh at rank 2 and Moneycontrol at rank 3. The five that remain document-only —
   `basis`, `unit`, `eps_basic`, `eps_diluted`, `op_cash_flow` — are the ones Chittorgarh genuinely
   does not print. Three `ipo_valuation` fields were corrected the same way: the price floor and cap
   are the same numbers as `ipos.price_range_min/max` and are published by both exchanges, and the
   market cap at the cap price is the single market-cap figure Chittorgarh prints.

   Mainboard fields with three sources went **68 → 103 → 112** across the three passes.

4. **The pool() resolver silently overrode a field's own `only:` declaration.** Found and fixed
   2026-09-08 while closing F-13. Any field in a WEB_OK table (`ipos`, `ipo_details`,
   `financial_data`, `peer_companies`, `subscriptions`, `listing_performance`, `registrars`,
   `ipo_intermediaries`, `gmp_records`) that carried an explicit `only:` reason for having no rank 2
   still got Chittorgarh/Moneycontrol auto-appended, so the generated row contradicted its own Note
   column — `ipo_details.compliance_officer` read `DOC · CG · MC` next to the note "no rank 2: named
   only in the filing". Ten already-committed fields were wrong this way (`ipos.cin`,
   `compliance_officer`/`_phone`/`_email`, `promoter_shares_held`, `sebi_regulation_cited`,
   `promoter_group_transactions_since_drhp`, `gmp_records.gmp`,
   `listing_performance.current_price_bse`/`_nse`); the 46 F-13 additions would have tripled it.
   `pool()` now returns early when `f.o.only` is set — mainboard three-source count corrected
   **112 → 97** for that reason alone (before the 46 new fields' own contribution).

**Fourth verification round, 2026-09-08/09 — the exchanges and Moneycontrol, against live payloads.**
Chittorgarh had been checked page-by-page; NSE, BSE and Moneycontrol had only been checked by API
shape and code reading. Doing it properly corrected **fifty-one ranks**:

| Source | Claimed | Verified | Correction |
|---|---:|---:|---|
| **Moneycontrol** | 46 fields | **9 + subscription** | Reading all three MC scrapers: they map `closeDate, companyName, issueSize, listingDate, offeringType, openDate, priceRange, segment, status`. **No financials, no peers, no promoters, no valuation, no sector, no description.** All 46 claims were false |
| **NSE** | 53 fields | mostly right, **3 wrong, 6 missing** | `/api/ipo-detail` `issueInfo` genuinely carries registrar, lead managers, issue type, sponsor bank, tick size and market timings — which I had as filing-only or BSE-ranked. It does **not** carry `designated_exchange`, `retail_max_allottees` or the allocation percentages |
| **BSE** | 54 fields | mostly right, **1 wrong** | `GetMkt_ISSUE_BBS_IPO` carries registrar, lead managers, sponsor bank, tick size, market timings — but **not** `issue_type`, which I had ranked to BSE |

**The Moneycontrol result has a consequence worth stating.** After correction, **Moneycontrol earns
zero ranks** — not because it is excluded, but because for all nine fields it serves, the document
and both exchanges are better and already available. It never reaches the top three. It contributes
206 provenance rows today only because the **push** model let it win by arriving first. **Under the
pull model the Moneycontrol scraper would never be consulted.** Whether to keep running it is the
owner's call, not this design's.

**The cause was structural, and it is fixed at the source.** The generator's `pool()` appended
Chittorgarh and Moneycontrol to any field in a "web-covered" table without asking whether either
source serves it. That is the design's own capability-versus-priority rule (§2.3.5) being broken by
the tool that generates the table. `pool()` now filters on an **observed capability list** — on the
way in as well as the way out, because a hand-authored rank naming an incapable source is the same
defect as an auto-appended one.

**One trap this round exposed and did not fix.** BSE's detail payload names its size field
`Issue_Size_No_of_shares` — **a share count, not rupees.** `ipos.issue_size` ranks BSE second. Using
that value directly is precisely the *"share count stored as issue size"* class this repo's own
`recurrence-detection-gate.md` was written for. The rank stays, because BSE does serve the concept;
**the extractor must convert, and the §1 arithmetic check is what catches it if it does not.**

**Class counts (authoritative, superseding the estimate in §1.1): D 162 · T 10 · X 13 · M 4 · W 1 ·
C 13 · I 37 = 240.** Of these, **71 fields have no rank 2 at all** (the one-source row above) — the
reason is stated on each row and is almost always "no website or exchange publishes this" (CIN, the
promoter tables, risk factors, the anchor book, the valuation table, and now the 46 F-13 fields).
That is a finished answer, not a gap.

**Reading the columns.** `R1/R2/R3` are the mainboard IPO order. `SME-BSE` and `SME-NSE` give the
resolved order for those two types, where the absent exchange is dropped rather than left as a dead
rank. `N/A` means the field does not exist for that offering type and is not a gap to chase.

**The SME document-type order is different, and this matters.** Measured on production, SME IPOs have
**zero PRICE_BAND_AD documents** (mainboard has 12) and one DRHP (mainboard has 18); their document
set is dominated by the prospectus (64). So for SME the rank-1 document order is
**PROSPECTUS > RHP > CORRIGENDUM > DRHP**, not the mainboard's
**PRICE_BAND_AD > CORRIGENDUM > RHP > PROSPECTUS > DRHP**. For 173 SME IPOs — over half the site —
the price band, share counts and market cap come from the prospectus. The earlier draft assumed the
advertisement existed everywhere; it does not.

#### The fifth verification round, 2026-09-09 — every rank against a saved payload

The four earlier rounds checked this appendix against itself, against the code, and (in round four)
against live pages read by hand. This round did it mechanically, and the numbers below are generated
by `probes/evidence-map.mjs` rather than counted by a person.

Every (field, source) pair the appendix resolves — across the mainboard, SME-BSE and SME-NSE columns
— was looked up in the **saved payload** for that source: the real NSE and BSE responses, the real
Chittorgarh pages, the real InvestorGain report, and the real output of `extract_filing.py` run on
four real offer documents.

<!-- generated:evidence-summary — regenerate with `node docs/design/generate-appendix-a.mjs --write`. Hand-editing these numbers is what D2 exists to catch: this table said 114 of 386 with NSE 19/38 for hours after the mapper was tightened and the real answer became 105 of 387 with NSE 15/42. -->
| Source | Rank backed by a saved payload | Searched, nothing matched | Not probed this round |
|---|---:|---:|---:|
| `DOC` | 14 | 149 | 0 |
| `NSE` | 21 | 36 | 0 |
| `BSE` | 14 | 41 | 0 |
| `CG` | 22 | 79 | 0 |
| `IG` | 1 | 0 | 0 |
| `REG` | 0 | 0 | 7 |
| `ADMIN` | 0 | 0 | 3 |

**72 of 387 pairs are backed by a payload we hold.** Check **D15** enforces that number as a ratchet: it may rise, and the gate fails if it falls — and since 2026-09-09 it also refuses a reference whose cited label is not actually in the file it points at.

**What the other 315 mean, precisely, because this is where an honest report is easy to fake.**
<!-- /generated:evidence-summary -->
"Searched, nothing matched" is **not** proof that the source lacks the field. It means: in the
payload saved for the two IPOs walked in this round, no label matched that column. Three separate
things produce it, and they need different answers:

1. **The source genuinely does not carry it** — a real rank correction, and the reason to look.
2. **The source carries it for a different IPO type** — see F-58: NSE returns a rich labelled block
   for a mainboard IPO and an empty one for an SME IPO, so an SME-NSE rank can look unproven while
   the mainboard rank is solid.
3. **The source carries it but this page had not filled it yet** — see F-59: Chittorgarh prints a
   peer table with a P/BV column for one IPO and no peer table at all for another that opened three
   days ago. That is `NOT_AVAILABLE_YET` on a plan row, not a missing capability.

**Two sources were not probed at all this round** and say so rather than being credited: the
registrar sites (`REG`, 7 pairs) have no probe yet, and `ADMIN` fields (3 pairs) have no external
source by design.

**A matched pair records the label it matched**, so a reviewer who disagrees can argue with the
evidence rather than with the total. That mattered: the first version of this mapper reported 231
backed pairs by matching loosely, and its matches included `ipos.registrar` against a plausibility
check, `gmp_records.gmp` against a page title and `financial_statements.pat` against "PAT Margin".
Tightening it to full-token matches on real table labels, with a block on tokens that change what a
number means, cut the total to 114 — and made every one of them auditable.

### A.1 The 240 fields

| # | Field | Cls | R1 | R2 | R3 | SME-BSE | SME-NSE | Doc § | Note / why no lower rank |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `ipos.symbol` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E7 cover |  |
| 2 | `ipos.company_name` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | cover |  |
| 3 | `ipos.issue_size` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A5+A6 | BSE RANK CARRIES A TRAP, measured 2026-09-09 on ARCIL: Issue_Size_No_of_shares is the NON-ANCHOR share count. NSE says the offer is 52,731,946 shares including a 15,819,583 anchor portion; BSE reports exactly 36,912,363, the remainder. Multiplying BSE shares by the floor price understates the issue by 33.5 percent, and by the cap price still understates it by 30 percent. The correct total is total shares x cap price = 7,329,740,494, which is what production stores. Any BSE-sourced issue size must add the anchor portion back and use the CAP price - see F-98 |
| 4 | `ipos.lot_size` | D | DOC | BSE | NSE | DOC · BSE · CG | DOC · NSE · CG | A3 |  |
| 5 | `ipos.open_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 6 | `ipos.close_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 7 | `ipos.listing_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 8 | `ipos.status` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 9 | `ipos.registrar` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E3 | VERIFIED: NSE issueInfo returns "Name of the Registrar"; BSE detail returns Registrar with address |
| 10 | `ipos.registrar_id` | C | — | — | — | — · — · — | — · — · — | — | computed: FK resolved from registrar |
| 11 | `ipos.rating_override` | I | ADMIN | — | — | ADMIN · — · — | ADMIN · — · — | — | no rank 2: admin-only by design; no external source exists |
| 12 | `ipos.slug` | C | — | — | — | — · — · — | — · — · — | — | computed: generateIPOSlug(company_name) |
| 13 | `ipos.sector` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | F1 |  |
| 14 | `ipos.price_range_min` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 |  |
| 15 | `ipos.price_range_max` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 |  |
| 16 | `ipos.last_scraped_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 17 | `ipos.listing_exchanges` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 18 | `ipos.face_value` | D | DOC | BSE | NSE | DOC · BSE · CG | DOC · NSE · CG | A2 |  |
| 19 | `ipos.allotment_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 20 | `ipos.company_description` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | F1 |  |
| 21 | `ipos.lead_managers` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E1 | VERIFIED: NSE returns "Book Running Lead Managers"; BSE returns Book_Running_Lead_Manager |
| 22 | `ipos.isin` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E7 |  |
| 23 | `ipos.segment` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A15 |  |
| 24 | `ipos.offering_type` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A11 |  |
| 25 | `ipos.scraper_locked` | I | ADMIN | — | — | ADMIN · — · — | ADMIN · — · — | — | no rank 2: admin-only by design; no external source exists |
| 26 | `ipos.last_manual_edit_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 27 | `ipos.objectives` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | F4 |  |
| 28 | `ipos.bse_ipo_no` | I | BSE | — | — | BSE · — · — | BSE · — · — | — | no rank 2: BSE payload identifier |
| 29 | `ipos.bse_payload_lead_manager_count` | I | BSE | — | — | BSE · — · — | BSE · — · — | — | no rank 2: BSE payload cross-check only |
| 30 | `ipos.company_website` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | E7 |  |
| 31 | `ipos.verifier_url` | I | — | — | — | — · — · — | — · — · — | — |  |
| 32 | `ipos.cin` | D | DOC | — | — | DOC · — · — | DOC · — · — | E7 | no rank 2: no website or exchange publishes the CIN |
| 33 | `ipo_details.company_description` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | F1 |  |
| 34 | `ipo_details.issue_type` | D | DOC | NSE | CG | DOC · CG · — | DOC · NSE · CG | A11 | CORRECTED: NSE returns "Issue Type: Book Building". BSE detail does NOT carry it - an earlier draft ranked BSE here |
| 35 | `ipo_details.fresh_issue` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A5 |  |
| 36 | `ipo_details.ofs_issue` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A6 |  |
| 37 | `ipo_details.face_value` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A2 |  |
| 38 | `ipo_details.basis_of_allotment_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 39 | `ipo_details.initiation_of_refunds_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 40 | `ipo_details.credit_of_shares_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 41 | `ipo_details.exchanges` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A15 |  |
| 42 | `ipo_details.data_source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 43 | `ipo_details.last_verified_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 44 | `ipo_details.compliance_officer` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 45 | `ipo_details.compliance_officer_phone` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 46 | `ipo_details.compliance_officer_email` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 47 | `ipo_details.upi_cutoff_time` | D | DOC | NSE | CG | DOC · CG · — | DOC · NSE · CG | B7 | clock time, not a date — deliberately NOT in E-1 |
| 48 | `ipo_details.designated_exchange` | D | DOC | — | — | DOC · — · — | DOC · — · — | A14 | no rank 2: observed absent from both exchange payloads 2026-09-09 - neither NSE issueInfo nor BSE detail names a designated exchange |
| 49 | `ipo_details.lot_multiple` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A3 |  |
| 50 | `ipo_details.allocation_pct` | D | DOC | — | — | DOC · — · — | DOC · — · — | A13 | no rank 2: observed absent 2026-09-09 - an earlier draft matched "Anchor Allocation Report" and mistook a document link for the allocation percentages |
| 51 | `ipo_details.pre_ipo_placement` | D | DOC | — | — | DOC · — · — | DOC · — · — | D6 | no rank 2: disclosure exists only in the filing; stored as a boolean today, but a pre-IPO placement reduces the fresh issue and should carry an amount — issue-size fields are provisional until sourced from a PROSPECTUS |
| 52 | `ipo_details.bid_windows` | D | DOC | NSE | CG | DOC · CG · — | DOC · NSE · CG | B8 | clock windows, not dates — deliberately NOT in E-1 |
| 53 | `ipo_details.promoter_shares_held` | D | DOC | — | — | DOC · — · — | DOC · — · — | D2 | no rank 2: capital-structure table only |
| 54 | `ipo_details.sebi_regulation_cited` | D | DOC | — | — | DOC · — · — | DOC · — · — | A12 | no rank 2: printed only on the advertisement |
| 55 | `ipo_details.promoter_group_transactions_since_drhp` | D | DOC | — | — | DOC · — · — | DOC · — · — | D7 | no rank 2: disclosure exists only in the filing |
| 56 | `ipo_details.cut_off_price` | D | DOC | — | — | DOC · — · — | DOC · — · — | A13 | no rank 2: the cut-off price is fixed only in the offer document; no website republishes it separately from the price band |
| 57 | `ipo_details.min_investment` | D | DOC | — | — | DOC · — · — | DOC · — · — | A13 | no rank 2: a derived investment-amount display, not separately published elsewhere |
| 58 | `ipo_details.isin` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E7 |  |
| 59 | `ipo_details.registrar_link` | D | DOC | — | — | DOC · — · — | DOC · — · — | E7 | no rank 2: no website separately publishes the per-IPO registrar link |
| 60 | `ipo_details.lead_managers` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | E7 |  |
| 61 | `ipo_details.company_address` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 62 | `ipo_details.company_phone` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 63 | `ipo_details.company_email` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 64 | `ipo_details.company_city` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 65 | `ipo_details.company_state` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 66 | `ipo_details.company_pincode` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 67 | `ipo_details.qib_shares_offered` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A13 | no rank 2: the exchange circular carries the allocation |
| 68 | `ipo_details.nii_shares_offered` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A13 | no rank 2: the exchange circular carries the allocation |
| 69 | `ipo_details.retail_shares_offered` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A13 | no rank 2: the exchange circular carries the allocation |
| 70 | `ipo_details.retail_max_allottees` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 71 | `ipo_details.employee_shares_offered` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 72 | `ipo_details.anchor_shares_offered` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 73 | `ipo_details.max_retail_subscription` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 74 | `ipo_details.max_employee_subscription` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 75 | `ipo_details.employee_discount` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 76 | `ipo_details.sponsor_banks` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E6 | CORRECTED 2026-09-09: BOTH exchanges carry it - NSE issueInfo "Sponsor Bank", BSE detail Sponsor_Bank. An earlier draft called it filing-only |
| 77 | `ipo_details.tick_size` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 | CORRECTED 2026-09-09: BOTH exchanges carry it - NSE "Tick Size", BSE Tick_Size |
| 78 | `ipo_details.ipo_market_timings` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | B8 | CORRECTED 2026-09-09: BOTH exchanges carry it - NSE "IPO Market Timings", BSE IPO_Market_Timings |
| 79 | `ipo_details.category_details` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A13 | no rank 2: the exchange circular carries the allocation |
| 80 | `ipo_details.sub_categories_upi` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | B7 | no rank 2: the exchange circular carries the allocation |
| 81 | `financial_data.revenue_fy2022` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 82 | `financial_data.revenue_fy2023` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 83 | `financial_data.revenue_fy2024` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 84 | `financial_data.profit_fy2022` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 85 | `financial_data.profit_fy2023` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 86 | `financial_data.profit_fy2024` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 87 | `financial_data.net_worth` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C2 |  |
| 88 | `financial_data.eps` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C6 |  |
| 89 | `financial_data.roe` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | — |  |
| 90 | `financial_data.debt_to_equity` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | — |  |
| 91 | `financial_data.reserves_and_surplus` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C2 |  |
| 92 | `financial_data.total_assets` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C2 |  |
| 93 | `financial_data.total_borrowing` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C2 |  |
| 94 | `financial_data.promoter_holding_pre_issue` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | D8 |  |
| 95 | `financial_data.promoter_holding_post_issue` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | D8 |  |
| 96 | `financial_data.market_cap` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | A8 |  |
| 97 | `financial_data.pre_ipo_eps` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C6 |  |
| 98 | `financial_data.post_ipo_eps` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C6 |  |
| 99 | `financial_data.ronw` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | A10 |  |
| 100 | `financial_data.pe_ratio` | D | DOC | — | — | DOC · — · — | DOC · — · — | A9 | no rank 2: observed 2026-09-08: CG prints a PE Ratio column only for OTHER recently listed IPOs in a comparison table, never this IPO own |
| 101 | `financial_data.ebitda_fy2022` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 102 | `financial_data.ebitda_fy2023` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 103 | `financial_data.ebitda_fy2024` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 104 | `financial_data.total_income_fy2022` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 105 | `financial_data.total_income_fy2023` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 106 | `financial_data.total_income_fy2024` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 107 | `financial_data.current_ratio` | D | DOC | — | — | DOC · — · — | DOC · — · — | C9 | no rank 2: KPI table only |
| 108 | `financial_data.quick_ratio` | D | DOC | — | — | DOC · — · — | DOC · — · — | C9 | no rank 2: KPI table only |
| 109 | `financial_data.inventory_turnover` | D | DOC | — | — | DOC · — · — | DOC · — · — | C9 | no rank 2: KPI table only |
| 110 | `financial_statements.fiscal_year` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 | CG restated table carries this per fiscal year |
| 111 | `financial_statements.revenue` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 | CG restated table carries this per fiscal year |
| 112 | `financial_statements.total_income` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 | CG restated table carries this per fiscal year |
| 113 | `financial_statements.ebitda` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 | CG restated table carries this per fiscal year |
| 114 | `financial_statements.pat` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 | CG restated table carries this per fiscal year |
| 115 | `financial_statements.net_worth` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C2 | CG gives the most-recent year only, not the full series |
| 116 | `financial_statements.basis` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C8 | OBSERVED on a live CG page: heading gives restated/consolidated, footer gives the unit, and a note flags a year on a different basis |
| 117 | `financial_statements.unit` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C7 | OBSERVED on a live CG page: heading gives restated/consolidated, footer gives the unit, and a note flags a year on a different basis |
| 118 | `financial_statements.eps_basic` | D | DOC | — | — | DOC · — · — | DOC · — · — | C6 | no rank 2: observed absent from a live CG detail page 2026-09-08 - it prints a single pre/post-issue EPS pair, never the per-fiscal-year basic-vs-diluted split, and no cash-flow line |
| 119 | `financial_statements.eps_diluted` | D | DOC | — | — | DOC · — · — | DOC · — · — | C6 | no rank 2: observed absent from a live CG detail page 2026-09-08 - it prints a single pre/post-issue EPS pair, never the per-fiscal-year basic-vs-diluted split, and no cash-flow line |
| 120 | `financial_statements.op_cash_flow` | D | DOC | — | — | DOC · — · — | DOC · — · — | C3 | no rank 2: observed absent from a live CG detail page 2026-09-08 - it prints a single pre/post-issue EPS pair, never the per-fiscal-year basic-vs-diluted split, and no cash-flow line |
| 121 | `financial_statements.dscr` | D | DOC | — | — | DOC · — · — | DOC · — · — | C4 | no rank 2: DSCR appears only in the Risk Factors financial tables |
| 122 | `financial_statements.rent_expense` | D | DOC | — | — | DOC · — · — | DOC · — · — | C5 | no rank 2: rent expense line appears only in Other Financial Information |
| 123 | `ipo_valuation.price_floor` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 | same number as ipos.price_range_min |
| 124 | `ipo_valuation.price_cap` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 | same number as ipos.price_range_max |
| 125 | `ipo_valuation.mcap_at_cap` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | A8 | CG prints a single market cap, which is the at-cap figure |
| 126 | `ipo_valuation.pe_at_cap` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | A9 | CG prints a single post-issue P/E, which is the at-cap figure (same logic as mcap_at_cap) |
| 127 | `ipo_valuation.mcap_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A8 | no rank 2: CG prints only ONE market cap (the at-cap one); no website prints the value at the floor price |
| 128 | `ipo_valuation.pe_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A9 | no rank 2: CG prints only ONE P/E (post-issue, at cap); no website prints the value at the floor price |
| 129 | `ipo_valuation.ronw_weighted_3y` | D | DOC | — | — | DOC · — · — | DOC · — · — | A10 | no rank 2: CG prints a single-year RoNW; the 3-year WEIGHTED average is a different metric and appears only in the advertisement |
| 130 | `ipo_valuation.pricing_event` | I | DOC | — | — | DOC · — · — | DOC · — · — | — | no rank 2: not a sourced value - it records WHICH document produced the row (PRICE_BAND_AD vs PROSPECTUS) |
| 131 | `ipo_valuation.shares_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 132 | `ipo_valuation.shares_at_cap` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 133 | `ipo_valuation.fresh_shares_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 134 | `ipo_valuation.fresh_shares_at_cap` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 135 | `ipo_valuation.ofs_shares` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 136 | `ipo_valuation.total_shares_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 137 | `ipo_valuation.total_shares_at_cap` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 138 | `ipo_valuation.face_value_multiple_floor` | C | — | — | — | — · — · — | — · — · — | — | computed: price_floor ÷ face_value |
| 139 | `ipo_valuation.face_value_multiple_cap` | C | — | — | — | — · — · — | — · — · — | — | computed: price_cap ÷ face_value |
| 140 | `ipo_valuation.pe_not_ascertainable_reason` | D | DOC | — | — | DOC · — · — | DOC · — · — | A9 | no rank 2: reason text printed only alongside a null PE in the document |
| 141 | `promoters.name` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | D1 | OBSERVED 2026-09-08 on a live CG IPO page: "Company Promoters: <names>". An earlier draft called this document-only; a real fetch disproved it |
| 142 | `promoters.waca` | D | DOC | — | — | DOC · — · — | DOC · — · — | D3 | no rank 2: basis-for-offer-price table only |
| 143 | `promoters.is_promoter_group` | D | DOC | — | — | DOC · — · — | DOC · — · — | D1 | no rank 2: capital-structure table only |
| 144 | `ipo_intermediaries.role` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | E1–E6 |  |
| 145 | `ipo_intermediaries.name` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | E1–E6 |  |
| 146 | `ipo_risk_factors.seq` | D | DOC | — | — | DOC · — · — | DOC · — · — | F2 | no rank 2: risk factors exist only in the filing |
| 147 | `ipo_risk_factors.heading` | D | DOC | — | — | DOC · — · — | DOC · — · — | F2 | no rank 2: risk factors exist only in the filing |
| 148 | `brlm_track_record.brlm_name` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank |
| 149 | `brlm_track_record.as_of_date` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: historical, never moves |
| 150 | `brlm_track_record.issues_3y` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank |
| 151 | `brlm_track_record.closed_below_issue_price` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank |
| 152 | `promoters.shares_held` | D | DOC | — | — | DOC · — · — | DOC · — · — | D2 | no rank 2: capital-structure table only |
| 153 | `promoters.waca_last_year` | D | DOC | — | — | DOC · — · — | DOC · — · — | D4 | no rank 2: basis-for-offer-price table only |
| 154 | `ipo_intermediaries.sebi_reg_no` | D | DOC | — | — | DOC · — · — | DOC · — · — | E3 | no rank 2: SEBI registration number printed only in the intermediaries section |
| 155 | `ipo_intermediaries.contact_person` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 156 | `ipo_intermediaries.phone` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 157 | `ipo_intermediaries.email` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 158 | `ipo_intermediaries.grievance_email` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 159 | `ipo_risk_factors.body` | D | DOC | — | — | DOC · — · — | DOC · — · — | F2 | no rank 2: risk factors exist only in the filing |
| 160 | `ipo_risk_factors.kpis` | D | DOC | — | — | DOC · — · — | DOC · — · — | F3 | no rank 2: concentration KPIs exist only in the filing |
| 161 | `promoter_acquisition_ranges.period` | D | DOC | — | — | DOC · — · — | DOC · — · — | D5 | no rank 2: the WACA 1y/18m/3y table exists only in the filing |
| 162 | `promoter_acquisition_ranges.waca` | D | DOC | — | — | DOC · — · — | DOC · — · — | D5 | no rank 2: the WACA 1y/18m/3y table exists only in the filing |
| 163 | `promoter_acquisition_ranges.cap_multiple` | D | DOC | — | — | DOC · — · — | DOC · — · — | D5 | no rank 2: the WACA 1y/18m/3y table exists only in the filing |
| 164 | `promoter_acquisition_ranges.price_low` | D | DOC | — | — | DOC · — · — | DOC · — · — | D5 | no rank 2: the WACA 1y/18m/3y table exists only in the filing |
| 165 | `promoter_acquisition_ranges.price_high` | D | DOC | — | — | DOC · — · — | DOC · — · — | D5 | no rank 2: the WACA 1y/18m/3y table exists only in the filing |
| 166 | `peer_companies.company_name` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 167 | `peer_companies.is_listed` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 168 | `peer_companies.pe_ratio` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 169 | `peer_companies.eps` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 170 | `peer_companies.diluted_eps` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 171 | `peer_companies.ronw` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 172 | `peer_companies.nav` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 173 | `peer_companies.pbv_ratio` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 | CORRECTED 2026-09-09: a real CG page carries both a company-level Price to Book Value row and a peer-table P/BV Ratio column; the 2026-09-08 absence was one page that had not been filled, not a capability limit (F-59) |
| 174 | `peer_companies.data_source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 175 | `peer_companies.last_updated` | I | — | — | — | — · — · — | — · — · — | — |  |
| 176 | `peer_companies.financial_statement_type` | D | DOC | — | — | DOC · — · — | DOC · — · — | C8 | no rank 2: CG does not print which basis (restated/standalone) the peer figures use |
| 177 | `anchor_investors.bid_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 178 | `anchor_investors.total_shares_offered` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 179 | `anchor_investors.total_amount_raised` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 180 | `anchor_investors.anchor_investors_count` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 181 | `anchor_investors.investor_list` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 182 | `anchor_investors.lock_in_50_percent_date` | C | — | — | — | — · — · — | — · — · — | — | computed: EFFECTIVE 2022-04-01 ONWARD: allotment_date + 30 days (SEBI ICDR 2018 Schedule XIII Part A, the 50/30 and 50/90 split introduced for issues opening on or after 1 April 2022). BEFORE that date the split did not exist and this field must be left empty rather than computed - F-65: an unconditional formula walked backwards by the 22:00 closed-IPO job would publish a lock-in expiry that never legally existed. Live code uses bid_date (anchor-investors-scraper.ts:302) rather than allotment_date: a production bug, about a week early |
| 183 | `anchor_investors.lock_in_remaining_date` | C | — | — | — | — · — · — | — · — · — | — | computed: EFFECTIVE 2022-04-01 ONWARD: allotment_date + 90 days (SEBI ICDR 2018 Schedule XIII Part A, the 50/30 and 50/90 split introduced for issues opening on or after 1 April 2022). BEFORE that date the split did not exist and this field must be left empty rather than computed - F-65: an unconditional formula walked backwards by the 22:00 closed-IPO job would publish a lock-in expiry that never legally existed. Live code uses bid_date (anchor-investors-scraper.ts:302) rather than allotment_date: a production bug, about a week early |
| 184 | `documents.type` | I | — | — | — | — · — · — | — · — · — | — |  |
| 185 | `documents.title` | I | — | — | — | — · — · — | — · — · — | — |  |
| 186 | `documents.url` | I | — | — | — | — · — · — | — · — · — | — |  |
| 187 | `documents.file_size` | I | — | — | — | — · — · — | — · — · — | — |  |
| 188 | `documents.uploaded_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 189 | `documents.exchange` | I | — | — | — | — · — · — | — · — · — | — |  |
| 190 | `documents.media_type` | I | — | — | — | — · — · — | — · — · — | — |  |
| 191 | `documents.sequence_number` | I | — | — | — | — · — · — | — · — · — | — |  |
| 192 | `documents.is_active` | I | — | — | — | — · — · — | — · — · — | — |  |
| 193 | `documents.extraction_status` | I | — | — | — | — · — · — | — · — · — | — |  |
| 194 | `documents.extracted_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 195 | `documents.extraction_error` | I | — | — | — | — · — · — | — · — · — | — |  |
| 196 | `documents.retry_count` | I | — | — | — | — · — · — | — · — · — | — |  |
| 197 | `documents.sha256` | I | — | — | — | — · — · — | — · — · — | — |  |
| 198 | `documents.filing_date` | D | DOC | BSE | — | DOC · BSE · — | DOC · — · — | B9 | historical — never moves; the doc-type healing rule depends on it |
| 199 | `subscriptions.timestamp` | I | — | — | — | — · — · — | — · — · — | — |  |
| 200 | `subscriptions.qib_subscription` | X | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: no document can carry a live figure |
| 201 | `subscriptions.nii_subscription` | X | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: no document can carry a live figure |
| 202 | `subscriptions.retail_subscription` | X | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: no document can carry a live figure |
| 203 | `subscriptions.total_subscription` | X | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: no document can carry a live figure |
| 204 | `subscriptions.employee_subscription` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: no document can carry a live figure |
| 205 | `subscriptions.b_nii_subscription` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: no document can carry a live figure |
| 206 | `subscriptions.s_nii_subscription` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: no document can carry a live figure |
| 207 | `subscriptions.total_shares_bid` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: no document can carry a live figure |
| 208 | `subscriptions.shares_offered` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: no document can carry a live figure |
| 209 | `subscriptions.scope` | I | — | — | — | — · — · — | — · — · — | — |  |
| 210 | `gmp_records.timestamp` | I | — | — | — | — · — · — | — · — · — | — |  |
| 211 | `gmp_records.gmp` | W | IG | CG | — | IG · CG · — | IG · CG · — | — | no rank 2: grey market has no official source, ever |
| 212 | `gmp_records.source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 213 | `gmp_records.gmp_percentage` | C | — | — | — | — · — · — | — · — · — | — | computed: gmp ÷ price_range_max × 100 |
| 214 | `listing_performance.listing_price` | M | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: post-listing market data |
| 215 | `listing_performance.issue_price` | C | — | — | — | — · — · — | — · — · — | — | computed: ipos.price_range_max at listing |
| 216 | `listing_performance.listing_gain_percent` | C | — | — | — | — · — · — | — · — · — | — | computed: (listing − issue) ÷ issue × 100 |
| 217 | `listing_performance.current_price` | M | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: post-listing market data |
| 218 | `listing_performance.current_gain_percent` | C | — | — | — | — · — · — | — · — · — | — | computed: (current − issue) ÷ issue × 100 |
| 219 | `listing_performance.last_updated` | I | — | — | — | — · — · — | — · — · — | — |  |
| 220 | `listing_performance.current_price_bse` | M | BSE | — | — | BSE · — · — | N/A · N/A · N/A | — | no rank 2: BSE quote by definition |
| 221 | `listing_performance.current_price_nse` | M | NSE | — | — | N/A · N/A · N/A | NSE · — · — | — | no rank 2: NSE quote by definition |
| 222 | `listing_performance.symbol` | C | — | — | — | — · — · — | — · — · — | — | computed: copy of ipos.symbol |
| 223 | `listing_performance.company_name` | C | — | — | — | — · — · — | — · — · — | — | computed: copy of ipos.company_name |
| 224 | `listing_performance.listing_date` | C | — | — | — | — · — · — | — · — · — | — | computed: copy of ipos.listing_date (E-1 sourced) |
| 225 | `listing_performance.data_source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 226 | `ipo_demand_graph.timestamp` | I | — | — | — | — · — · — | — · — · — | — |  |
| 227 | `ipo_demand_graph.price_point` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it. Also N/A whenever ipo_details.issue_type = FIXED_PRICE (F-26) — a fixed-price issue has no bid book |
| 228 | `ipo_demand_graph.is_cut_off` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it. Also N/A whenever ipo_details.issue_type = FIXED_PRICE (F-26) — a fixed-price issue has no bid book |
| 229 | `ipo_demand_graph.cumulative_quantity` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it. Also N/A whenever ipo_details.issue_type = FIXED_PRICE (F-26) — a fixed-price issue has no bid book |
| 230 | `ipo_demand_graph.exchange` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it. Also N/A whenever ipo_details.issue_type = FIXED_PRICE (F-26) — a fixed-price issue has no bid book |
| 231 | `registrars.name` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 232 | `registrars.short_name` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 233 | `registrars.email` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 234 | `registrars.phone` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 235 | `registrars.website` | D | REG | DOC | CG | REG · DOC · CG | REG · DOC · CG | E3 | the registrar itself is authoritative for its own URL |
| 236 | `registrars.allotment_check_url` | I | REG | — | — | REG · — · — | REG · — · — | — | no rank 2: the registrar owns this URL |
| 237 | `registrars.address` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 238 | `registrars.active` | I | ADMIN | — | — | ADMIN · — · — | ADMIN · — · — | — | no rank 2: admin-only by design; no external source exists |
| 239 | `registrars.allotment_url_healthy` | I | — | — | — | — · — · — | — · — · — | — |  |
| 240 | `registrars.allotment_url_checked_at` | I | — | — | — | — · — · — | — · — · — | — |  |

### A.2 Offering-type coverage

How many of the 240 fields apply to each offering type. A high `N/A` count is correct, not a
shortfall: a buyback has no price band, no anchor book and no peer comparison.

| Offering type | IPOs on prod | Fields N/A | Fields with a live resolution |
|---|---:|---:|---:|
| FPO | 0 | 0 | 240 |
| RIGHTS | 8 | 35 | 205 |
| OFS | 19 | 35 | 205 |
| NCD | 7 | 86 | 154 |
| INVITS | 3 | 91 | 149 |
| REITS | 2 | 91 | 149 |
| TENDER | 16 | 112 | 128 |
| BUYBACK | 1 | 112 | 128 |


**FPO shows 240 applicable and 0 N/A because it follows mainboard exactly, minus the draft-prospectus
stage. There are zero FPO rows on production, so none of it has ever been exercised — it is the least
trustworthy column in this appendix and is flagged as such in §7.3 item 3.**

**OFS and BUYBACK (20 IPOs) have never had a single provenance row written**, so for them this
appendix describes an intention rather than a correction of existing behaviour.

