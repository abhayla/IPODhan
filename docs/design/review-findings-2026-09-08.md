# Pull-model design — consolidated review findings, 2026-09-08

Four independent passes over `docs/design/data-sourcing-pull-model.md`:

| Pass | Lens | Findings | Critical |
|---|---|---:|---:|
| Author self-review | scoping and unstated rules | 7 | 1 |
| Independent reviewer A | Indian IPO domain and edge cases | 16 | 4 |
| Independent reviewer B | engineering, concurrency, feasibility | 17 | 4 |
| Independent reviewer C | verification model and detection | 15 | 4 |
| **Total** | | **55** | **13** |

The three independent reviewers ran with no knowledge of each other and did not see this file.
Where two or more converged on the same defect it is marked **[CONFIRMED ×N]** — those are the ones
to fix first, because independent agreement is the strongest signal available here.

**Verdict, unanimous across all three independent passes: not safe to build from as written.**
All three also agreed the §0 diagnosis is correct and well evidenced. The problem is the mechanism,
not the analysis.

---

## Part 1 — The thirteen critical findings

### C-1. The freeze has no release condition, and it contradicts document healing **[CONFIRMED ×2]**

§2.1 says a CORRECT value is frozen and later rounds are never asked. §2.5's reclaim path exists
only for `NOT_AVAILABLE_YET` — there is no route from `SUPPLIED` back to `PENDING`.

**Trigger.** A DRHP is filed in July. Round 1 extracts `issue_size` from it; the draft is internally
consistent so it passes the check; the field freezes. In September the RHP prints the final, larger
issue size. **The field is never re-asked, so the site publishes the draft number for the life of the
IPO.** Separately, an issuer may revise the price band mid-bidding and file a corrigendum — same
outcome: the page shows the old band beside the new close date.

This re-creates by construction the exact defect class the O-5 review caught and closed.

**Fix.** Freeze on the *evidence*, not the *outcome*. The invariant becomes: a field is not re-asked
while its winning document is still the best available document of the highest-precedence type for
that field. When a higher-precedence or newer document reaches `EXTRACTED`, every plan row it
supersedes flips `SUPPLIED → PENDING` in the same transaction. Requires `frozen_by_document_id` on
the plan row and a nightly check that no `SUPPLIED` row points at a superseded document.

### C-2. The freeze starves the only mechanism that could correct a frozen-wrong value

`data_conflicts` rows are written only when a *second* source arrives and disagrees. Under §2.1,
once round 1 freezes a field, rounds 2 and 3 are never asked, so no second value is ever produced,
so no conflict row is ever written — **so §3's trigger can never fire on exactly the fields the
freeze protects.** The re-read loop, which the design offers as its answer to "can a frozen-wrong
value be corrected?", is unreachable there.

§2.6 makes this worse: it turns the wake into a no-op outside four slots, removing the legacy push
traffic that would otherwise have generated conflicts. The design never says which is true.

**Fix.** Verification becomes a scheduled obligation, not a by-product of collision. Add
`verify_due_at` to the plan; the walk deliberately fetches a rank-2 value for a sampled slice of
frozen fields each cycle — every frozen live-tier field at least weekly, and 100% of the fields §1
names as high-conflict (`leadManagers` has 578 unresolved conflicts today, `faceValue` 495).

### C-3. E-1 points twelve fields at sources that do not carry them, and §2.8 then deletes the data

**Verified in code.** `basis_of_allotment_date`, `initiation_of_refunds_date` and
`credit_of_shares_date` are written by exactly one thing — `filing-persister.ts:867-869`, the
document path. **No NSE or BSE scraper writes any of them.** The three anchor date fields are the
same shape (`anchor-investors-scraper.ts`).

Under E-1 those six fields become NSE-first, BSE-second, Chittorgarh-third, with the document not a
source at any round. Round 1 and round 2 return `NOT_PRINTED`; the value falls to a website — the
substitution O-8 exists to forbid — or exhausts and, per §2.8, **is written null.** That blanks 13
correct, document-sourced dates on live pages on the first run.

**Root cause of the error:** E-1 was applied by category (the owner's instruction, correctly given)
without checking which source actually carries each member. Same failure mode as five other findings
in this register.

**Fix.** No E-1 field ships until it is proven, field by field, against a real NSE and BSE payload
sample the scraper can actually read. Where the exchange does not carry it, the field stays
document-first with a staleness rule (invalidate on any E-1 date change), recorded as a
sub-exception. And §2.8 gains a hard rule: **a field currently holding a value that passed its check
may never be blanked by an `EXHAUSTED` state.**

### C-4. §2.8's "write null with a reason" is impossible through the writer the design keeps

**Verified at `data-consolidation-service.ts:1063-1080`.** When the incoming value is null and a
value is stored, the service returns `finalValue: storedValue`, `reason: 'NO_INCOMING_VALUE'`, and
logs no conflict. A null cannot pass through `consolidatedUpsertIPO`.

So §2.8 is not implementable through the writer §2.7 mandates, **and the failure is silent**: the
plan row records `EXHAUSTED` while the stale value keeps serving on the page, and check 4.3 reads
the plan row and reports success.

**Fix.** Prefer: drop the null-write entirely and make `EXHAUSTED` a *display* suppression driven by
the plan row, leaving the stored value in place. The alternative — a `RETRACT` sentinel with its own
priority rule — is more code and more risk.

### C-5. Round-1 yield rises when extraction gets worse

The denominator is "fields the document owns", derived from the manifest of the document type that
*resolved*. If a type mis-resolves (and §6.2 shows type resolution is already weak — `filing_date`
populated on 24 of 256 rows), the manifest names fewer fields, those fields become `NOT_PRINTED`,
leave the denominator, and are served by round 3. **Yield reads 100% while a website supplies
everything**, and the alarm clause explicitly excuses it because `NOT_PRINTED` is on the allowed list.

**Fix.** Compute yield against a **type-independent** denominator — the union of fields any document
type of this offering type prints, a per-offering-type constant. Add a separate alarm on the
manifest itself: `NOT_PRINTED` count per (ipo, document_type), NEW versus yesterday by identity,
alarming when a document's excused set grows at all.

### C-6. Four checks are vacuous when their input collapses to zero

§4 applied "no all-time counters" to totals and not to denominators.

- **4.2** `live-tier walked ÷ live-tier`: status is an E-1 field. If exchange status scraping breaks,
  every IPO ages into LISTED, live tier is 0, and 0/0 is not "< 100%".
- **4.13** document share: if discovery dies, the doc-eligible denominator shrinks to the few IPOs
  that already have documents and **the share rises**. The alarm was "flat or falling".
- **4.3** and **4.8** have the same shape.

**Fix.** Every ratio carries a mandatory denominator floor, asserted separately and alarming first.
A ratio whose denominator moved more than 5% night-over-night is reported UNVERIFIABLE, never PASS —
a status `audit-detection-floor.mjs` already supports and this design never used.

### C-7. Nothing proves the re-read actually opened a file

§3.3 says "ensure the file is present … re-extract". If the PDF was purged and the re-download 404s,
an implementation can fall back to the cached extraction and return the same wrong number, recorded
as `verified_against_document`. **The design's strongest safety claim — the website's number is
never adopted — becomes its most dangerous failure**: a wrong document value is confirmed forever
and then actively defended against the website that was right. Check 4.9 only alarms on 100%
unresolved.

**Fix.** A re-read counts only with a **fresh extraction receipt**: `sha256` re-hashed from bytes on
disk at re-read time, extractor invocation id, page number, all written to the plan row. Then check:
receipts within this cycle ÷ re-reads recorded = 1.0. And separately alarm when
`verified_against_document ÷ all outcomes > 0.95` over 7 days — a source that is never wrong is a
source that is never actually consulted.

### C-8. Five checks are written to "cycle summary", which has no consumer that diffs it

Directly violates `signal-ownership.md` R3 — the rule this design quotes approvingly two pages
earlier. `floor-delta.mjs` reads only `audit-detection-floor.mjs` output; a line in a pm2 log is not
detection.

**Fix.** Delete "cycle summary" as a recording location. Every check emits a
`[PASS]/[FAIL]/[UNVERIFIABLE] <checkId> <detail with quoted identities>` line into the nightly floor,
and registers its per-cycle counter with `failure-delta.mjs`.

### C-9. Backlog re-download is undone by the purge on the next cycle

**Verified at `document-store.ts:279`:** `decidePurge` returns `{purge: true, reason: 'hard_cap'}`
unconditionally past `DEFAULT_MAX_RETENTION_DAYS (30)`. Every backlog IPO is far past that. So M5 is:
re-download a 2025 RHP → extract one field group → the purge pass deletes it → the next pass needs it
again → re-download. The 5 GB store cap makes it thrash, and nothing protects the live tier's files
from being the ones evicted.

**Fix.** A migration hold the store does not have today: `retain_until` on `documents`, honoured by
`decidePurge` ahead of `hard_cap`, plus a per-night store budget sized under `MAX_STORE_GB` minus a
reserved live-tier allocation. And the walk must complete all four passes for one IPO from one
download.

### C-10. A check that is wrong for one class of IPO silently blanks that class

Combined with §2.8, any check that fails at every rank nulls the field. Four checks already in §1 are
wrong for a whole class:

| Check | Wrong for | Effect |
|---|---|---|
| `face_value ∈ {1,2,5,10}` | NCDs (face value ₹1,000); some equity at ₹100 | blanks 7 NCD rows |
| `listing ≤ close + 3 working days` | pre-Dec-2023 issues, which listed at T+6 | fails most of the 228 backlog |
| SME two-lot minimum | SME IPOs that closed before the 2025 rule | fails historical SME |
| `QIB + NII + retail ≤ 100` | any offer with an employee or shareholder reservation — those are percentages of the **net** offer | a correct extraction fails and is nulled |

**Fix.** Every check carries (a) an `effective_from` evaluated against the IPO's own close date, not
today's, and (b) an applicability scope over `segment` / `offering_type` / `issue_type`. Add a check:
count of fields that went from a value to null this cycle — non-zero blocks the migration stage.

### C-11. Appendix A, declared authoritative, resolves only 3 of 11 offering types

A.1's columns are mainboard, SME-BSE, SME-NSE. RIGHTS / OFS / NCD / INVITS / REITS / BUYBACK /
TENDER / FPO exist only as §1.11 prose, which §1.1 says the appendix overrides. The plan generator
would have no resolution for 56 of 327 IPOs.

Worse: for 51 of those, **the rank-1 document does not exist as a storable type.** `documentTypeEnum`
has no `LETTER_OF_OFFER` (rights), no `SHELF_PROSPECTUS` / tranche prospectus (NCD), no
`PUBLIC_ANNOUNCEMENT` (buyback/tender). Round 1 answers "not printed" forever, websites supply 100%,
and round-1 yield reports **perfect** because the denominator is empty.

Also unnamed anywhere: IPP, QIP, PREFERENTIAL, BONDS, DELISTING — zero rows today, zero resolution
if one appears, and field 24's check would pass them.

**Fix.** Either extend A.1 with a resolved column per offering type, or state explicitly that these
types are out of the pull model's rank-1 scope, exclude them from the 4.3 denominator, and label
their pages website-sourced. The current middle position is the dangerous one.

### C-12. "The consolidation service stays the only writer" is false for 162 of the 194 fields

`consolidatedUpsertIPO` consolidates `tableName: 'ipos'` only. The eight child tables —
`ipo_details`, `financial_statements`, `ipo_valuation`, `ipo_risk_factors`, `promoters`,
`anchor_investors`, `ipo_intermediaries`, `peer_companies` — are written by `persistFilingExtraction`
through their own repositories. That is *why* §0.1 measures them as 100% document-sourced: no other
writer exists.

So §2.7's "nothing changes about the writer" hides **the largest single piece of build work in the
design** — a per-field, multi-table consolidated write path — inside a bullet that says nothing
changes. Without it the pull loop has nowhere to write 84% of what it extracts.

**Fix.** A new first-class item in §7.1 between items 2 and 4: extend the consolidation contract to
the eight child tables with per-field priority resolution, `field_sources` rows and `data_conflicts`
rows. Tier A, large, and a hard dependency of item 5.

### C-13. The mapping is scoped to fields populated today, so document-only facts can never enter it **[CONFIRMED ×2]**

Scoping to the 194 populated columns is backwards for a design whose purpose is to start reading
documents: **a field is empty precisely because no document was read.** About 46 published columns
that the offer document prints are entirely empty and therefore absent from the mapping —
`promoter_acquisition_ranges` (all 5 columns, the §D5 WACA table), `ipo_risk_factors.body` and
`.kpis`, the `ipo_intermediaries` contact and SEBI-registration columns, 18 `ipo_details` columns
covering the category allocations, employee reservation and discount, sponsor banks and the
registered-office block, `financial_statements.dscr` and `rent_expense`,
`ipo_valuation.pe_not_ascertainable_reason`.

The pull model would run, report a high yield, and those 46 fields would still show nothing.

**Fix.** Generate the plan from `schema × document manifest` — what the document prints — not from
currently-populated columns. Appendix A grows from 194 rows to roughly 240.

---

## Part 2 — Major findings, grouped

**Concurrency and crash safety (none of which the design mentions — the words "lock", "concurrent",
"transaction" and "idempotent" appear nowhere).**

- **M-1.** No lock is specified for the walk, and the existing Redis lock does not cover it: on
  failure to acquire, `document-cycle.ts:926-931` logs "skipping extraction" and **continues the rest
  of the cycle**. Worst case for the filing pass is 3 × 10 min = 30 min against a `*/30` wake, so an
  overrun into the next wake is guaranteed by construction, and two walks race on the same plan rows.
  Fix: a per-IPO Postgres advisory lock, stated granularity and TTL, and every plan mutation as a
  single conditional UPDATE with the expected prior state in the WHERE clause.
- **M-2.** No crash recovery. `consolidatedUpsertIPO` returns `skipped: true,
  skipReason: 'LOCK_NOT_ACQUIRED'` **silently**; a plan row marked `SUPPLIED` against a write that
  was dropped is a false-clean state that check 4.3 reads as 100% yield. Fix: write the plan row from
  the *result* of the upsert; a skipped return leaves it `PENDING`; add `claimed_at`/`claim_token`
  with a staleness rule mirroring `isStaleInProgress`.

**The state model.**

- **M-3.** `NOT_PRINTED` versus `NOT_AVAILABLE_YET` is undecidable from the per-type manifest the
  design specifies — the two states have opposite permanent consequences, and §2.5 gives the same
  example for both. Fix: derive it from (field, best document type, **and the IPO's lifecycle
  stage**), which `document-state-machine.ts` already models.
- **M-4.** The `NOT_AVAILABLE_YET` reclaim has no bound and no backoff: on a withdrawn or
  perpetually-postponed IPO it re-asks four times a day forever, across ~40 never-available fields ×
  228 backlog IPOs. Fix: the same exponential backoff the state machine already uses, plus a terminal
  transition to `EXHAUSTED` on WITHDRAWN/POSTPONED or `listing_date + 10 days`.
- **M-5.** WITHDRAWN and POSTPONED IPOs match none of the three tiers and are never walked
  **[CONFIRMED ×3]**. A withdrawn issue keeps a live-looking page with a ticking GMP; a relaunched
  postponed issue publishes its pre-postponement band forever. Fix: name both — POSTPONED stays in
  the live tier with class-D fields invalidated on the next filing; WITHDRAWN gets a terminal tier,
  excluded from the 4.2/4.3 denominators, with GMP and subscription polling stopped.
- **M-6.** No trigger rebuilds the plan when `offering_type`, `segment` or `listing_exchanges`
  changes — and the Mopshop/Sarda class is exactly a mis-typed IPO later corrected. Fix: name those
  three as plan-invalidating fields.
- **M-7.** An ADMIN override is a one-way door: the design marks the field `NOT_APPLICABLE` and never
  says what happens when the override is cleared. Fix: derive `NOT_APPLICABLE` from the live presence
  of a protection row rather than storing it.

**Domain modelling.**

- **M-8.** Anchor lock-in dates: three contradictory answers in the design, and the live code
  computes them from the **bid date** (`anchor-investors-scraper.ts:302`) when the rule is 30 and 90
  days from **allotment** — an existing production bug of roughly a week. *(Unverified: the
  regulation is taken from the reviewer and memory; check the circular before acting.)*
- **M-9.** Pre-IPO placement and green-shoe change the issue size after the RHP; the design stores a
  boolean. An overstated issue size then propagates into market cap, shares-at-cap and P/E, which
  cross-check against each other and therefore agree while all being wrong.
- **M-10.** NCD structure cannot be represented at all: base versus retained issue size, series,
  coupon, tenor, rating — the only numbers that matter for a debt instrument.
- **M-11.** InvIT/REIT: §1.11 says out of scope, A.2 assigns them 117 resolvable fields. The appendix
  wins, so the loop walks unit-based instruments through a share-based model and blanks the pages.
- **M-12.** Fixed price is treated as an SME property; it is a property of `issue_type`. A
  fixed-price mainboard issue fails the QIB check and has no bid book for the demand-graph fields.
- **M-13.** The basis-of-allotment extractor is scheduled in §5.4/§7.1 with **nowhere to write** —
  no field exists for the allotment ratio, valid applications, or shares allotted per category.

**Verification and migration.**

- **M-14.** A check that crashes reads as an improvement: `floor-delta` parses FAIL/PASS only, so an
  `UNVERIFIABLE` or a vanished check appears as GONE, printed as "no new findings", exit 0. Fix:
  three-state diff plus a check-roster invariant.
- **M-15.** Check 4.8's healthy value contradicts §3.4's own bounds — one re-read per IPO per cycle
  against an IPO with nine disagreements gives 0.11 forever. A permanently red check is not
  detection. Fix: measure latency, not ratio.
- **M-16.** Four of the six migration gates are prose, not commands. M1 has no threshold at all, so
  nothing can fail it; M3 — the irreversible stage — is gated on an aggregate share the design itself
  argues is the wrong instrument, set 40 points below the owner's target.
- **M-17.** §7.2's per-field rollback claim is false past one overwrite: `field_sources` has a single
  `previous_value` column under a unique constraint. After M3 then M4, the pre-migration website value
  is gone. Fix: snapshot `field_sources` before each stage (6.6k rows, cheap) or add an append-only
  history table.
- **M-18.** Check 4.6 asserts on the plan's declared ranks, not on `field_sources.source`, so it
  reads intent rather than outcome — the "silent check" the design's own 4.5 warns about.
- **M-19.** The public API ships 19 fields that are null on all 327 IPOs; the design does not say to
  retire them. A pull loop that ever targeted `ipos.subscription_total` would write to a column
  nothing reads, beside the `subscriptions` table everything reads.
- **M-20.** Not one of the thirteen checks has an id, an emitting script, a host or an owner, so
  §3.5's tier-differentiated issue routing cannot be built on the existing per-check-id path — as
  written, the first migration run files the two hundred issues §3.5 says it must not.

---

## Part 3 — Things I asserted about our own code that are false

Recorded separately because the pattern matters more than the individual errors. In every case the
disproof was one file read away.

| # | I wrote | The code says |
|---|---|---|
| 1 | "no website publishes a restated financial statement" | `chittorgarh-detail-fields.ts` reads CG's restated table per fiscal year |
| 2 | `CYCLE_BUDGET.EXTRACTIONS_PER_CYCLE = 1` is one of "the three hard limits this design must live inside" (§0.5) | **Dead code.** Only two references anywhere: its definition and a test asserting it equals 1. Nothing enforces it |
| 3 | "the consolidation service stays the only writer" (§2.7) | True for `ipos` only — 32 of 194 fields. The eight child tables have their own writers |
| 4 | §2.8 writes null with a reason | `data-consolidation-service.ts:1063-1080` returns the stored value on a null incoming. A null cannot pass through |
| 5 | E-1's twelve fields move to NSE then BSE | Six of them are written only by `filing-persister.ts`; no exchange scraper writes them |
| 6 | The state machine progresses `WANTED → NOT_YET_FILED → FOUND → EXTRACTED` (§2.7) | Nine states, including `NOT_FOUND`, `BLOCKED_ALL`, `SUPERSEDED`, `NOT_APPLICABLE` — and the code carries an explicit comment that `NOT_FOUND` is emphatically not `NOT_YET_FILED`. The 9→5 mapping the design promises is never given |
| 7 | "a newer document can heal an older one" is inherited from 9db4529d (§1.1, §5.5) | `decideSupersession` is specified, unit-tested, and **not called by the runner** — the code says so in a comment. It is unbuilt, not inherited |

---

## Part 4 — What all three reviewers agreed is right

Worth recording so the rewrite does not discard it:

- The §0 diagnosis. Push-versus-pull is the correct framing, the measured tables hold up under
  independent checking, and reach rather than ranking is genuinely the right problem.
- The `NOT_PRINTED` / `NOT_AVAILABLE_YET` split with a reclaim rule — called "the single best idea in
  the document" by the domain reviewer — once its decision procedure is fixed (M-3).
- The measured SME document-type correction (zero price-band ads on SME, so prospectus-first).
- Keeping the bidding timetable on the exchanges, with the stated reason.
- Excluding `upi_cutoff_time` and `bid_windows` from E-1 because a clock time cannot go stale.
- Bounding re-reads on `sha256` rather than a retry counter.
- The `EXHAUSTED` / `CHECK_FAILED` state split, which makes failure recordable at all for the first
  time.
- Check 4.5's silent-check heuristic ("a check that has never failed in 30 days is probably not
  wired") — called the strongest idea in §4.
- Appendix A's own verification history, which caught three real defect classes.

---

## Part 5 — What happens next

**Sections that survive as written:** §0 (diagnosis and measurement), Appendix A.0/A.3 (the
verification history and the under-three-source reasoning), §5.2 (the unit analysis).

**Sections that need re-cutting, not patching:** §1.2.1 (E-1), §2 (the pull loop), §3 (the re-read
loop), §4 (the verification model), §6 (migration). Roughly 60% of the document.

**Independent of the rewrite, and safe to start now** — all three reviewers agreed on this list:
§7.1 items 1 (the field manifest), 2 (matrix cleanup), 3 (per-field validation before write) and 7
(the two missing extractors). Nothing from item 4 onward should be contracted until §2 is re-cut.
