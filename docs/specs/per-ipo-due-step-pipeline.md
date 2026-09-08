# SPEC — Per-IPO due-step pipeline (ledger + stage-driven scheduling + source tiers)

Status: **DRAFT, owner-approved for detailed spec 2026-09-02 18:20 IST (D-06); implementation
deferred until the DEEPA walk is complete.** Origin: `docs/walks/2026-09-02-deepa-pipeline-walk.md`
S-01..S-04. This file is appended to as the walk raises new findings; nothing here is built yet.

## 1. Problem (as observed on 2026-09-02)

- Prod runs `--source=all` every 30 minutes, all day, for every IPO. No memory of what was done.
  Purple Style Labs closed on 2 Sep and is still fetched 48 times a day from 6 sources.
- No per-IPO status exists. "Where is DEEPA in the pipeline?" needs a manual look at 8 tables.
- Failures are silent: an extraction that fails leaves no record that it was attempted, so nothing
  retries deliberately and nothing shows it to the owner.
- The only step-aware state is `document_fetch_state` (documents only) and it is switched off.
- Static-field disagreements between sources (DEEPA face value: BSE 2, NSE 10) are resolved
  silently by the priority matrix; no conflict row, nothing visible.

## 2. Goals

- G1. Every run does only the work that is due for each IPO, nothing else.
- G2. At any moment, one query answers "for IPO X, which steps are done / due / failed / not yet
  available", with evidence and timestamps.
- G3. Live numbers (subscription, GMP) are fresh while an IPO is open in market hours, and are not
  fetched otherwise.
- G4. Regulatory filings are the source of truth for static fields; exchanges for live fields and
  document discovery; aggregators verify. A mismatch on a static field is always visible.
- G5. Existing machinery is reused, not duplicated: `stage-reconciler.ts`, `document_fetch_state`,
  the field-priority matrix, `upsertIPO`, `field_sources`, `data_conflicts`.

Non-goals: rewriting scrapers' parsing; changing the public website; multi-tenant concerns.

## 3. Step catalogue (the unit of work)

Steps are the B..J list from the walk ledger. Each step has: id (`B3`, `E3`, ...), a pure or
IO function, its inputs (which prior step outputs), its outputs (which tables/fields), the stage
window in which it is due, and its re-run rule.

| Group | Steps | Due window | Re-run rule |
|---|---|---|---|
| B Discover | B1-B7 | discovery job, not per IPO | board fetch 4x/day; per-IPO row creation once |
| C Find filings | C1-C5 | UPCOMING: DRHP; PRE_OPEN: RHP, PBA; OPEN: corrigendum/addendum; CLOSED..T+5: prospectus | every cycle while NOT_AVAILABLE_YET inside the window; stop at FOUND |
| D Download/store | D1-D6 | when a C-step reports a new link | once per sha256 |
| E Extract | E1-E10 | when a D-step stores a new document | once per document; re-run on extractor version bump |
| F Cross-verify | F1-F6 | after E for the same filing; and daily while OPEN | once per filing version |
| G Persist | G1-G5 | after E/F | idempotent, every time upstream changes |
| H Live numbers | H1, H2, H4 | OPEN, market hours (IST 10:00-17:00) | every 10-15 min; H3 anchor once on T-1 |
| I Lifecycle | I1-I6 | every cycle (cheap, derived) | I3 on supersession; I6 once at close+7d |
| J Show | J1-J3 | after any G write | cache invalidation per slug |

## 4. Data model

### 4.1 `ipo_pipeline_steps` (new)

| column | type | meaning |
|---|---|---|
| id | uuid pk | |
| ipo_id | uuid fk ipos | |
| step_id | text | `B3`, `E3`, ... from the catalogue (enum-checked in code) |
| status | enum | NOT_DUE, DUE, RUNNING, DONE, FAILED, NOT_AVAILABLE_YET, BLOCKED, SKIPPED |
| attempts | int | |
| last_run_at, next_due_at | timestamptz | |
| source | text | which source satisfied it (BSE, NSE, RHP, ...) |
| input_ref | text | sha256 / document id / upstream step run id |
| evidence | jsonb | compact summary (counts, key values, file paths) |
| error | text | last error, cleared on DONE |
| version | text | extractor/parser version that produced DONE |
| created_at, updated_at | timestamptz | |
| unique (ipo_id, step_id) | | one row per IPO per step |

`document_fetch_state` stays as the detail table for C/D steps; the ledger rows for C/D are
derived from it by the reconciler (no double bookkeeping of document state).

### 4.2 Existing tables reused

- `field_sources`: per-field provenance + confidence (F6 writes `confidence`).
- `data_conflicts`: F5 writes one row per static-field mismatch, severity CRITICAL for
  filing-vs-exchange, WARNING for exchange-vs-aggregator. Never auto-resolved.
- `documents` + `document_fetch_state`: unchanged.
- Untracked values (rows written before source tracking): a value with no `field_sources` row is replaced only by a source ranked strictly above the field's weakest listed source (D-10). A replacement is recorded as a `field_sources` row with `previous_value` set and `previous_source` NULL, reason `UNTRACKED_EXISTING_VALUE_REPLACED`; a confirmation by a ranked source creates the provenance row (W-25). The admin surface lists `field_sources WHERE previous_value IS NOT NULL AND previous_source IS NULL` as "replaced values of unknown origin". A one-off backfill job writes provenance rows for existing values (source = best guess, low confidence) so old rows unfreeze; that job is part of the implementation, not the walk.

### 4.3 Subscription scope (W-03)

`subscriptions.scope` enum: BSE_ONLY, NSE_ONLY, CONSOLIDATED. Charts use CONSOLIDATED;
exchange-only rows are kept for audit.

## 5. Scheduling

- **Discovery job**: BSE board + NSE lists, 4x/day (08:30, 11:00, 14:00, 17:30 IST). New name
  creates the `ipos` row plus ledger rows for all steps at NOT_DUE. Withdrawn/status flips are
  detected here too.
- **Aggregators (Chittorgarh, Moneycontrol) may also CREATE a row** (T-484, #351, 2026-09-07,
  architect, owner go): for a name whose validated status is UPCOMING/OPEN and that the
  discovery job has not yet created — typically an early-announced SME name Chittorgarh/
  Moneycontrol sees before it reaches the NSE/BSE board, once-daily aggregator cadence. Every
  validation guard still runs before the create (long-window/no-substance, corporate-action
  shape, bare-scrip-code name, offering_type, name sanitizer, identity resolver) — this is not a
  bypass of discovery's checks, only a second row-creating source honouring the same guards.
  Counted per cycle as `createdUnderRestriction` in the aggregator summary log. Decided after
  prod was found to have silently missed 6 live IPOs this way.
- **Reconcile job** (every cycle): for each IPO not LISTED+10d: derive stage (existing
  `deriveLifecycleStage`), set DUE on steps whose window is open and whose status is NOT_DUE,
  NOT_AVAILABLE_YET, or FAILED past its backoff; then execute due steps in catalogue order.
- **Live job**: market hours only, every 10-15 min, H-steps for OPEN IPOs only.
- **Purge job**: I6 daily.
- Backoff: FAILED sets next_due_at = now + 2^attempts x 15 min, capped at 6 h; after 10 attempts
  the step becomes BLOCKED and an owner alert goes through the Notifier gateway.
- The flat 30-min `--source=all` PM2 cron is replaced by these jobs behind a feature flag;
  rollback = flip the flag.

### 5.1 Document cycle cadence (D-13 conformance — cycle-overrun fix, 2026-09-07)

The document cycle (`scraper/src/services/document-cycle.ts` `runDocumentCycle`, wired as the
`primarySourceDiscovery` step in `scraper/src/index.ts`) runs on every 30-min PM2 wake — see that
file's own doc comment for why per-cycle (not daily) is correct once the state machine makes a
no-change cycle free. Two gaps against the owner's D-13 cadence decision (2026-09-03, walk row
`docs/walks/2026-09-02-deepa-pipeline-walk.md:200`) were fixed here after the 2026-09-06
cycle-overrun RCA (observed 1,210-1,278s cycles, 105-115 network calls on a Sunday):

- **Calendar gate.** D-13 says a Sunday wake does DB reads and no network calls. The document
  cycle previously had no such gate at all. `document-cycle-calendar-gate.ts` now checks, using
  `due-step-cycle.ts`'s IST weekday helpers (`istWeekday`/`istDateIso` — the SSOT for this repo's
  IST calendar arithmetic) plus the `market_holidays` table: on Sunday, Saturday (assumption —
  treated the same as Sunday; nothing in this repo's calendar treats Saturday as a trading day
  either), or an NSE holiday, only `UPCOMING`/`PRE_OPEN`/`OPEN` candidates stay eligible for
  network work. `CLOSED`/`LISTED`/`WITHDRAWN` candidates are skipped that wake (`calendarSkipped`
  in the cycle summary, one `Document cycle: calendar gate — live-only` log line) and picked up
  the next non-gated cycle — the state table remembers where each one is. A holiday-lookup failure
  fails OPEN (treated as a normal trading day), never gates a real business day on an outage.
- **Wake budget.** Discovery (`CYCLE_BUDGET.DISCOVERY_MS`, 60s) and extraction
  (`DEFAULT_EXTRACTION_BUDGET_MS`, 25min) used to be two independent budgets that could together
  exceed a 30-min wake with no shared ceiling. `DOCUMENT_CYCLE_WAKE_BUDGET_MS` (env override,
  default 20 min — `getWakeBudgetMs()`) is now the ONE budget the two share: extraction gets
  whatever discovery did not use, minus a fixed `PURGE_RESERVE_MS` (2 min) held back for the purge
  step (`triggerDocumentPurge`) that runs later in the same wake. `index.ts`'s whole-cycle Redis
  lock TTL (`CYCLE_LOCK_TTL_MS`) is derived from the same wake budget plus 5 minutes of slack,
  instead of a separately-hardcoded number that could silently drift out of sync with it.
- **Detection.** `m_cycle_overrun` (`scripts/lib/document-state-checks.mjs`, wired in
  `scripts/audit-detection-floor.mjs`) reads the `scraper_steps` step-ledger rows for
  `primarySourceDiscovery` and FAILs when a cycle ran longer than 25 minutes or two cycles'
  wall-clock windows overlapped — see `docs/reviews/failure-classes.md`'s "document cycle overrun"
  row and `docs/reviews/detection-checks.json`'s `m_cycle_overrun` entry.

## 6. Source tiers (S-03) and conflict rule (S-04)

| Tier | Sources | Truth for | Never used for |
|---|---|---|---|
| 1a Filings | DRHP, RHP, PBA, Corrigendum, Anchor report, Prospectus | every static field (terms, financials, promoters, intermediaries, objects, risks) — and the timeline, subject to S-05 below | live numbers |
| 1b Exchange APIs | BSE JSON, NSE JSON | subscription, anchor allocation, listing price/ISIN, status flips, document links — and the bidding timetable per S-05 | overriding a filing value on anything S-05 does not name |
| 2 Aggregators | Chittorgarh, Moneycontrol, InvestorGain | verification of tier-1 values; GMP (only source); peers by sector as fallback | writing a static field when a tier-1 value exists |

Conflict rule: tier-1a vs tier-1b mismatch on a static field writes a `data_conflicts` CRITICAL
row, the filing value is kept, admin sees it. Tier-2 mismatch writes WARNING, the tier-1 value is
kept, confidence is lowered. The priority matrix's per-field order stays, but "newest wins" is
limited to live fields; a static field is only overwritten by a higher tier or a newer filing
(E2 supersession). Listing exchange (W-01) is a merged set, not a single value.

### S-05 — the re-filing test (owner decision, 2026-09-08)

S-03 originally read "tier 1a is truth for every static field (terms, **timeline**, …)". That was
too strong for one group of fields, and the reason is not that dates are special:

> **The filing wins wherever a change to the fact forces a new filing.
> The exchange wins where it does not.**

The offer document is authoritative about what was true when it was filed. For almost everything,
a change to the fact obliges the issuer to file again — so the document stays current by
construction and tier 1a is correct. The exception is the bidding timetable: **a price band
advertisement is printed once and is never reprinted when a company extends its bidding window.**
NSE and BSE publish the new dates the same day; the document cannot. Applying S-03 unmodified
would publish a closed-looking IPO that is still open, and a reader would miss the window.

Worked examples of the test:

| Fact changes | Does a new filing follow? | Who wins |
|---|---|---|
| Price band revised | Yes — a corrigendum is filed | **Filing** |
| Issue size, lot size, registrar, lead managers, objects | Yes — any change means a new filing | **Filing** |
| Bidding window extended | **No** — nothing is re-filed | **Exchange** |
| Allotment / refund / credit dates move with the window | **No** | **Exchange** |
| Status flips (OPEN → CLOSED → LISTED) | No | **Exchange** |

**Current members of the exchange-wins set** — and the owner's confirmation covers these and no
others (`docs/design/data-sourcing-pull-model.md` §1.2.1 holds the per-field detail and is generated
from `docs/design/field-source-resolution.spec.mjs`):

`ipos.open_date` · `ipos.close_date` · `ipos.listing_date` · `ipos.allotment_date` ·
`ipos.status` · `ipos.listing_exchanges` · `ipo_details.basis_of_allotment_date` ·
`ipo_details.initiation_of_refunds_date` · `ipo_details.credit_of_shares_date` ·
`anchor_investors.bid_date` — **ten sourced fields**, plus
`anchor_investors.lock_in_50_percent_date` and `lock_in_remaining_date`, which are **computed**
from `allotment_date` (+30 / +90 days) and therefore inherit the rule through their input rather
than being sourced themselves. The owner's decision named twelve fields; ten are sourced and two
are derived from one of the ten, so the twelve facts he named are all governed.

Adding a field to this set is an owner decision recorded here, never a change made in passing.
`ipo_details.upi_cutoff_time` and `bid_windows` are deliberately NOT members: they hold a time of
day, and an extended window moves the date, not the hour.

## 7. Owner-facing view

Admin page `/admin/pipeline`: grid IPO x step, colour by status, click for evidence, error and
timestamps; filter by stage; a "re-run step" button that sets DUE. This replaces "ask Claude".

## 8. Acceptance (to be run on DEEPA after the walk)

- A1. After discovery, DEEPA has one ledger row per step; all NOT_DUE except B-steps DONE.
- A2. Reconcile at PRE_OPEN sets C1/C2 DUE; after the run, RHP/PBA are FOUND and D/E rows are
  DONE with evidence.
- A3. A second reconcile run makes zero network calls for DEEPA's documents.
- A4. Face value 2 vs 10 produces exactly one `data_conflicts` CRITICAL row and the RHP value wins.
- A5. During OPEN market hours, subscription rows arrive at most 15 min apart with scope
  CONSOLIDATED; none between 17:00 and 10:00 IST.
- A6. Ten days after listing, DEEPA generates zero fetches per day.
- A7. The admin grid shows all of the above with no manual SQL.

## 9. Open questions (filled in as the walk answers them)

- W-14 (B5): domain validation (lot, band width, dates) must run on the merged record after consolidation, where segment AND lot AND band are all present, in addition to the per-source pre-check. Today each rule is effectively checked by at most one source and band width by none for BSE.

- Exact market-hours window for H-steps (10:00-17:00 IST assumed).
- Whether E-steps re-run automatically on an extractor version bump or only on owner request.
- Where the 18 missing columns (W-09) land: `ipo_details` vs new tables (inventory draft exists).
