# Item 21 — the read side: provenance line, cache-busting revalidate, canonical tag (OD-39, OD-40, OD-41)

## Purpose

Every IPO detail page shows, under each key-facts block, where that block's numbers came from and
when they were last confirmed (grey and "being rechecked" when stale); a scraper cycle that writes a
published field makes the correction visible on that page within the same cycle instead of behind up
to two independent cache timers; and the post-listing price carries its as-of timestamp and the word
"delayed". None of this is a new capability — every piece it needs already exists except the wiring.

## Serves

`docs/design/data-sourcing-pull-model.md` §2.11 "What the reader sees" (OD-39 the provenance
component, OD-40 the cycle-end revalidate call, OD-41 the post-merge page rules) and the OD-29
post-listing-price stamp cited inside §2.11. **Depends on item 5** (`ipo_field_plan`, not yet
built) for `chosen_source` / `chosen_document_type` / the confirmation state this item renders —
`field_sources` alone (already live) cannot supply `chosen_document_type`, see Schema.

## Files

**Read this session; every line number below is current. Three of the design's own §2.11 citations
were wrong or stale — corrected inline, marked `[design says X, this session found Y]`.**

| Path | State | Change |
|---|---|---|
| `web/lib/repositories/field-sources-repository.ts` | exists (class at line 53, `getIPOSourceMap` at line 143 `[design says 141]`) | **No change.** `getIPOSourceMap` returns `FieldSourceSummary` (`fieldName`, `source`, `confidence`, `updatedAt`, `updatedBy`) read from `field_sources` — it has no `chosen_document_type` and no column that means "confirmed on", because those live on `ipo_field_plan` (item 5), not `field_sources`. This item does not extend this repository; it adds a new one (below) once item 5 ships. |
| `web/lib/repositories/ipo-field-plan-repository.ts` | **NEW** | Reads `ipo_field_plan` (item 5's table) for one IPO: `chosenSource`, `chosenDocumentType`, `chosenDocumentId`, `verifyState`, `verifyDueAt`, `updatedAt`, keyed by `(tableName, rowKey, fieldName)`. The design names no repository for this — item 5's own `scraper/src/services/field-plan-repository.ts` (NEW) is a **scraper-workspace** file (claim/reclaim for the walk) and is not importable from `web/` (cross-workspace boundary the same way `filing-persister.ts` is called out in item 11's card); a read-only web-side repository is a new, small file, not a reuse of that one. |
| `web/components/ipo-detail/FieldProvenanceLine.tsx` | **NEW** | The shared component (OD-39). Renders "From the offer document, confirmed &lt;date&gt;" (fresh) or "last confirmed &lt;date&gt;, being rechecked" (stale, grey) per field-group. Named and located to match the existing `web/components/ipo-detail/` convention (`FactRibbon.tsx`, `IPODetailsTable.tsx`, `LotDetailsSection.tsx`, `ListingDetailsSection.tsx` all live there). |
| `web/app/ipos/[slug]/page.tsx` | exists (893 lines) | Three changes: **(a)** add `export const revalidate = <N>` — confirmed absent this session, `grep -n "export const revalidate" web/app/ipos/[slug]/page.tsx` returns nothing; every other ISR page in `web/app/` sets one explicitly (`page.tsx:28` is 300, `sitemap.ts:21` is 900, `history/page.tsx:45` is 3600). **(b)** render `<FieldProvenanceLine>` under the key-facts blocks: `<FactRibbon>` (line 599), `<IPODetailsTable>` (line 603), `<IssueStructureSection>` (line 628), `<LotDetailsSection>` (line 639), `<ListingDetailsSection>` (line 817). **(c)** none needed for the canonical tag — see the correction below. |
| `web/lib/seo/metadata.ts` | exists | **No change — the design is wrong here.** §2.11 states *"A canonical tag on every IPO page — DOES NOT EXIST."* This session found `alternates: { canonical: `${BASE_URL}/ipos/${slug}` }` at **line 203**, inside `generateIPODetailMetadata()` (function starts line 161), which `web/app/ipos/[slug]/page.tsx`'s `generateMetadata()` (line 130) calls unconditionally on its happy path (line 166: `return generateIPODetailMetadata(metadataParams);`). **The canonical tag already ships on every live IPO page.** This item does zero work here; it corrects the design record instead of building something that already exists (the card rule this file itself states: *"a card that reinvents working code wastes the implementer's day"*). |
| `web/app/api/admin/revalidate/route.ts` | **NEW** | The authenticated endpoint (OD-40). `POST { slugs: string[] }`. Modeled directly on the sibling route `web/app/api/admin/status/update/route.ts` (line 2 imports `requireAdminAuth`, line 15-16 calls it as the first line of the handler) — same auth call, same directory convention (`/api/admin/*`), so this is not new auth, it is the existing one applied to a new route. |
| `web/lib/auth/admin-auth.ts` | exists | **No change.** `requireAdminAuth()` (line 87) checks `Authorization: Bearer <ADMIN_API_TOKEN>` via constant-time compare (`constantTimeCompare`, line 45); `ADMIN_API_TOKEN` is already a required env var for the scraper's own `triggerStatusUpdate()` call (`scraper/src/index.ts`, see below) — no new secret to provision. |
| `web/lib/cache/cache-keys.ts` | exists | **No change — one correction to the design.** §2.11 says the provenance line lives under *"the detail page's existing key, `getIPODetailKey`"* (line 47, `ipo:detail:${slug}`). **This session found `getIPODetailKey` is not the key the detail page reads.** `IPORepository.findBySlug()` (`web/lib/repositories/ipo-repository.ts:388-389`) caches under `getIPOBySlugKey(slug)` (`ipo:slug:${slug}`) — `getIPODetailKey` has exactly one call site in the whole repo, `web/app/api/admin/ipos/[id]/route.ts:298`, an invalidation-only `redis.del()` on admin edit that nothing currently populates under that key. The new revalidate endpoint (below) must invalidate the key the read path actually uses. |
| `web/lib/repositories/ipo-repository.ts` | exists | **No change.** Cited for the correction above: `findBySlug()` line 388-389 (`getIPOBySlugKey`), used transitively by `findBySlugWithFallback()` (line 1348) which the detail page calls (`page.tsx:238`). |
| `web/app/api/admin/ipos/[id]/route.ts` | exists | **No change.** Cited as the existing cache-invalidation pattern to copy into the new endpoint: lines 295-298 delete `getIPOBySlugKey`, `getIPOByIdKey`, `getIPODetailKey` on an admin edit. **One thing NOT to copy**: line 299, `await redis.del('ipo:list:*')` — `redis.del` takes exact key names, not a glob; that call deletes a key literally named `ipo:list:*`, not the list cache. This item's revalidate endpoint must not repeat that bug for its own list-page invalidation; it revalidates the list pages via Next's `revalidatePath`, not via a Redis glob-delete. |
| `scraper/src/index.ts` | exists | Add `triggerPageRevalidation(touchedSlugs: string[])`, modeled on the existing `triggerStatusUpdate()` (function starts ~line 798: `const baseUrl = process.env.WEB_INTERNAL_URL \|\| 'http://localhost:3001'`, `const token = process.env.ADMIN_API_TOKEN`, `fetch(\`${baseUrl}/api/admin/status/update\`, { method: 'POST', headers: { Authorization: \`Bearer ${token}\` } })`) — same env vars, same non-fatal try/catch-and-log shape, POSTing to the new `/api/admin/revalidate` route with `{ slugs: touchedSlugs }` in the body. Wired into the same `source === 'all'` post-steps chain as `triggerStatusUpdate` (the `runStep(cycleId, 'statusUpdate', ...)` list, ~lines 828-843), added as one more `await runStep(cycleId, 'pageRevalidation', () => triggerPageRevalidation(touchedSlugs))` — **once per cycle**, matching OD-40's "one call per cycle, not one per IPO or per field." |
| `scraper/src/services/touched-ipos-tracker.ts` | **NEW** | The piece the design assumes exists and does not name. §2.11 says *"the writer drops the Redis keys for the touched IPOs and then calls one authenticated endpoint... with the touched slugs"* — no accumulator that collects "which IPOs did this cycle actually write to" exists today (`grep -rn "touchedSlugs\|touchedIpo\|writtenSlugs" scraper/src` returns nothing this session). A minimal in-process module: `recordTouched(slug: string)` appends to a `Set<string>` for the running process; `drainTouched(): string[]` empties it and returns the list, called once by `triggerPageRevalidation` at cycle end. Hooked from `DataConsolidationOrchestrator.consolidatedUpsertIPO()` (`scraper/src/services/data-consolidation-orchestrator.ts:90`, `slug` computed at line 107) — the single write choke point CLAUDE.md names ("never write scraped data directly to the DB bypassing the consolidation/priority logic") — called only when the result indicates a field actually changed, not on a no-op re-verify (§2.5.2's "a re-ask must not rewrite an unchanged value" — this item reuses that signal, does not redefine it; see item 15, "value actually changed", for the exact predicate). **Flagged, not invented**: the design does not name this file or its shape; this is the smallest mechanism that satisfies OD-40's sentence. |
| `web/app/sitemap.ts` | exists | **No change — one correction to the design.** §2.11 cites the redirect-exclusion filter at line 93; this session found it at **line 99** (`allIPOs = allIPOs.filter((ipo) => !redirectedOldSlugs.has(ipo.slug));`). The behaviour itself is exactly as §2.11 describes (already correct, already excludes retired slugs, `revalidate = 900` confirmed at line 21) — only the design's line citation was stale. |
| `web/app/ipos/[slug]/page.tsx` (redirect) | exists | **No change.** §2.11's third claim verified: `permanentRedirect()` at line 233 (import at line 19), a real 308 per the code's own comment (lines 228-232). |
| `packages/shared/src/db/schema.ts` | exists | **No change.** `ipos.currentPrice` at line 329, `ipos.currentPriceUpdatedAt` at line 332 — both confirmed present, matching §2.11's citation exactly. `fieldSources` table at line 1376, also matching. |
| `web/components/ipo/ConfidenceBadge.tsx` | exists (88 lines) | **No change.** Confirmed: takes only `confidence: 'HIGH' \| 'MEDIUM' \| 'LOW'` (line 21-26) — no source, no date. Cited as the component §2.11 contrasts against, not reused (it answers "how sure", this item answers "who said so and when"). |

## Schema

**No new table or column in this item.** It reads two existing/planned structures and writes none:

1. `field_sources` (exists, `packages/shared/src/db/schema.ts:1376`) — read via the existing
   `FieldSourcesRepository`, unchanged.
2. `ipo_field_plan` (item 5, **not yet built** — this item is written against item 5's card as the
   schema it will read: `chosenSource`, `chosenDocumentType`, `verifyState`, `verifyDueAt`,
   `updatedAt`). **Item 21 cannot ship its "confirmed on &lt;date&gt;" wording until item 5 ships.**

**A genuine cross-item gap, flagged not invented:** item 5's schema (as written in its own card) has
no column that means *"the date this specific value was last confirmed correct"*, distinct from the
row-level `updatedAt` (bumped by ANY write to the row — a failed re-attempt, an unrelated
`verifyState` change — not only a successful reconfirmation). Using `updatedAt` as the "confirmed on"
date would make the marker drift forward on churn the row itself does not consider a reconfirmation.
The precise fix (a `chosenConfirmedAt` column, set only when `chosenSource`/`chosenDocumentId`
changes or `verifyState` reaches `CONFIRMED`) belongs to item 5's schema, not this item's — this card
does not edit item 5's card (out of scope for this task) and instead names the gap here so it is not
silently absorbed into "confirmed" meaning "touched." **Flagged as a fork for owner sign-off before
item 5 is built**, not resolved here.

**No destructive DDL.**

## Interfaces

```typescript
// web/lib/repositories/ipo-field-plan-repository.ts — NEW (depends on item 5's ipoFieldPlan table)
export interface FieldProvenance {
  fieldName: string;
  tableName: string;
  rowKey: string;
  chosenSource: string | null;       // scraperSourceEnum value, e.g. 'DRHP'
  chosenDocumentType: string | null; // documentTypeEnum value, e.g. 'RHP'
  confirmedAt: Date | null;          // see Schema — provisionally `updatedAt` until item 5 adds a
                                      // dedicated column; PROVISIONAL, not a final answer
  isStale: boolean;                  // verifyState === 'DUE' for longer than the configured threshold
}

export class IpoFieldPlanRepository extends BaseRepository {
  // mirrors FieldSourcesRepository's constructor/cache-aside pattern exactly
  async getIPOProvenanceMap(ipoId: string): Promise<Record<string, FieldProvenance>>;
}
```

```typescript
// web/components/ipo-detail/FieldProvenanceLine.tsx — NEW
export interface FieldProvenanceLineProps {
  provenance: FieldProvenance | null; // null = nothing to show, renders nothing (never a placeholder)
}
export function FieldProvenanceLine(props: FieldProvenanceLineProps): JSX.Element | null;
// Fresh: "From the offer document, confirmed 6 September 2026"
// Stale (isStale): grey, "last confirmed 28 August 2026, being rechecked"
// A data_conflicts-sourced disagreement is NEVER passed to this component — admin-only per OD-39.
```

```typescript
// web/app/api/admin/revalidate/route.ts — NEW
// POST body: { slugs: string[] }
// Auth: requireAdminAuth() (web/lib/auth/admin-auth.ts:87), same as /api/admin/status/update.
// For each slug: redis.del(getIPOBySlugKey(slug)); redis.del(getIPODetailKey(slug));
//   revalidatePath(`/ipos/${slug}`).
// Once per call (not per slug): revalidatePath('/'); revalidatePath('/mainboard-ipos');
//   revalidatePath('/sme-ipos'); revalidatePath('/sitemap.xml').
// Returns { success: true, data: { revalidated: slugs.length } }; a slug that does not
// resolve to a live IPO is skipped and counted, never a 500 for the whole batch.
export {};
```

```typescript
// scraper/src/services/touched-ipos-tracker.ts — NEW
export function recordTouched(slug: string): void;
export function drainTouched(): string[]; // empties the set, returns what it held
```

## Feature flag

**None new for the component or the redirect/canonical/sitemap pieces** — they render unconditionally
once shipped, matching every other read-side UI element on the page (no flag gates `ConfidenceBadge`
either). The revalidate call is gated the same way its sibling already is: `triggerPageRevalidation`
runs only inside `if (source === 'all')` (existing guard, `scraper/src/index.ts`), and is **non-fatal**
like every other post-step in that chain — a failed call logs and lets the timed
`revalidate = <N>` on the page still apply, per OD-40 ("failure is not fatal"). No env var newly
required beyond `WEB_INTERNAL_URL` and `ADMIN_API_TOKEN`, both already mandatory for
`triggerStatusUpdate` today (`assertRequiredEnvForCycle`, T-340, per the comment at
`scraper/src/index.ts` around `triggerStatusUpdate`).

**The staleness threshold itself is an open fork.** §2.6/§2.11 says the marker appears "once the gap
passes the staleness threshold" and OD-51 requires it be configuration with a dated reason, but **the
design names no number of days anywhere this session searched** (`grep -n "threshold" docs/design/
data-sourcing-pull-model.md` — the only threshold values found are the unrelated 180-day
same-offering window and the 12-month SEBI observation-validity window). This item adds a config key
(e.g. `PROVENANCE_STALE_AFTER_DAYS` in `scraper/src/config/feature-flags.ts`, per OD-51's own
instruction that every tunable be a small customization, not a code change) with **no default this
card is authorized to invent** — flagged for owner sign-off, not guessed.

## Tests

- `web/tests/unit/components/ipo-detail/FieldProvenanceLine.test.tsx` (NEW) — red before the change:
  fresh provenance renders the "From the offer document, confirmed &lt;date&gt;" string; stale
  provenance renders the grey "being rechecked" variant; `provenance: null` renders nothing (no
  placeholder, no layout shift); a conflict-shaped input is never accepted by the prop type (compile
  check, not just a runtime assertion) — enforces the admin-only rule at the type level.
- `web/tests/unit/lib/repositories/ipo-field-plan-repository.test.ts` (NEW) — `getIPOProvenanceMap`
  returns one entry per `(tableName, rowKey, fieldName)`, `isStale` true only when the configured
  threshold is exceeded (mock the config value, do not hardcode a number in the test either).
- `web/tests/integration/api/admin/revalidate.test.ts` (NEW) — red before the change: a request with
  no/invalid `Authorization` header gets 401 (mirrors the existing pattern already covered for
  `/api/admin/status/update` — check for a sibling test there and follow its shape); a valid request
  deletes both `getIPOBySlugKey` and `getIPODetailKey` for each slug (assert against a Redis test
  double, not production Redis) and calls `revalidatePath` for each slug plus the fixed list-page set.
- `scraper/tests/unit/services/touched-ipos-tracker.test.ts` (NEW) — `recordTouched` then
  `drainTouched` returns exactly what was recorded, deduplicated, and empties the set (a second
  `drainTouched()` call returns `[]`).
- `scraper/tests/unit/index-page-revalidation-wiring.test.ts` (NEW, or extend the existing
  `index-due-step-scheduler-wiring.test.ts` if one covers this chain already — **check before
  writing**) — asserts `triggerPageRevalidation` is called exactly once per `source === 'all'` cycle
  with the slugs `drainTouched()` returned, and that a fetch failure does not throw out of the
  post-steps chain (non-fatal, matches `triggerStatusUpdate`'s own catch block).
- Tier: unit for all of the above except the integration test, per
  `.claude/rules/scraper-test-layout.md` for the scraper-side files.

## Detection

**New check**, `docs/reviews/detection-checks/c_provenance_line_present.json` (NEW) — on staging, for a
sample of IPO detail pages whose IPO has at least one `ipo_field_plan` row in `SUPPLIED` state,
asserts the rendered HTML contains the provenance component's marker text (`"confirmed"` or
`"being rechecked"`) at least once. This is the check that would catch the exact class §2.11 opens
with — a provenance record that exists in the database and reaches no pixel of the page — recurring
after this ships (a future refactor of the key-facts blocks that drops the `<FieldProvenanceLine>`
render call). Runs in the nightly audit alongside the other `c_*` checks
(`scripts/audit-detection-floor.mjs`).

`No detection change` does not apply here — this item creates exactly the write-then-never-read class
the detection-gate rule exists to prevent, so it gets its own check rather than a declared exemption.

## Staging proof

- **Provenance line, per `defect-fix-contract.md` item 5:** deploy to staging, wait for one full
  scraper cycle to write a field on a phase-1 IPO, then load
  `https://staging.ipodhan.com/ipos/<that-slug>` and confirm the rendered page contains
  `"From the offer document, confirmed"` for a field that cycle wrote — the exact string, not an
  approximation.
- **Revalidate call:** the staging scraper log for that cycle carries one `pageRevalidation` step
  result (via `runStep`'s existing logging shape) naming the slugs it sent, and the
  `/api/admin/revalidate` route's own log line (added as part of this item) names the slugs it
  actually revalidated — the two counts must match, or the mismatch is the proof something silently
  dropped a slug between the tracker and the endpoint.
- **Canonical tag:** already provable today, no deploy needed — `curl -s
  https://ipodhan.com/ipos/<any-live-slug> | grep 'rel="canonical"'` returns the tag now. This item's
  proof obligation here is zero; it is recorded as a confirmation, not a change.

## Rollback

Revert the commit. The component renders nothing when its data source (`ipo_field_plan`, item 5)
does not yet exist — no destructive DDL, no data written by this item, no admin-visible value
changed. The `revalidate = <N>` export and the new `/api/admin/revalidate` route are both purely
additive; removing them returns the page to Next's current default rebuild behaviour, which is the
status quo this item is measured against, not a regression from some other known-good state.

## Tier, budget and cost

**Tier B** (ordinary app code, CI green + tests — merge on PASS), **except the authenticated
endpoint**, which reuses the existing `requireAdminAuth()` Bearer-token gate already protecting
`/api/admin/status/update` and every other `/api/admin/*` route — no new auth mechanism is designed
or reviewed here, only a new call site of one already in production. This keeps the item out of
Tier A (no new secret, no new access-control decision).

`Budget: 30 min wall-clock, 60 tool calls` for the implementation task that follows this card. Depends
on item 5 (`ipo_field_plan`) for the provenance data and is otherwise independent — the revalidate
endpoint, cache-key fix, and canonical-tag confirmation can all ship before item 5 lands; only the
`FieldProvenanceLine` component's live data needs to wait, and it degrades to rendering nothing until
then (see Rollback). Cost: one review round expected; the touched-slugs tracker and the staleness
threshold are the two genuine forks in this item and should be resolved before implementation starts,
not discovered mid-review.

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

10 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §2.11 | R-081, R-082, R-083, R-085, R-086, R-087, R-162, R-163, R-164, R-165 |

## Status of this card's corrections (2026-09-10, implementation session)

This card was written against an earlier `§2.11` and flags three places as "the design is wrong".
**All three have since been corrected in the design itself**, and the card's wording is now stale in
the opposite direction. Verified by reading `docs/design/data-sourcing-pull-model.md` directly rather
than through this card's quotation of it:

| Card says | Design today |
|---|---|
| "§2.11 states *a canonical tag — DOES NOT EXIST*" | line 2141 already says **"already true"**, citing `metadata.ts:203`, and explicitly records that the first draft grepped the page file instead of the metadata helper |
| "§2.11 says the provenance line lives under `getIPODetailKey`" | the design now names `getIPOBySlugKey` as the real key and calls `getIPODetailKey` the one that "looks like the obvious choice" but has only an admin-edit caller |
| "sitemap filter cited at line 93, actually 99" | behaviour was always correct; only the citation was stale |

**Reading a document through someone's quotation of it is not reading it.** Recorded here because the
implementation session repeated exactly that mistake before checking, and it is the same class as two
other corrections made the same evening.

## Dependency, pinned by column name

**Item 21's stale-marker slice is BLOCKED-DEPENDENCY on item 5.** Measured against `origin/main`
today, not against item 5's card: `ipo_field_plan` does not exist in
`packages/shared/src/db/schema.ts` at all, and no migration journal entry mentions it. The specific
column this item reads is **`verify_due_at`** (item 5's card, line 103, with
`idx_ipo_field_plan_verify_due` at line 133).

**The column is not to be stubbed.** A stub would make the provenance line render a date it invented,
which is worse than rendering nothing — the whole point of the line is that the reader can trust it.

## The two open forks are now closed

**1. The staleness threshold — no number is needed, and no config key should be created.**
The card proposed `PROVENANCE_STALE_AFTER_DAYS` with "no default this card is authorized to invent".
That fork dissolves: item 5 already carries `verify_due_at` per field, so **stale is
`now > verify_due_at`** — per field and per status by construction, because whatever sets that column
already knows a GMP is due in hours and a listed issue price is never due again.

Reusing the nightly audit's numbers was considered and rejected. `g_freshness_per_type` uses "3 days
(IPO/SME) or 21 days (OFS/NCD/RIGHTS)", but it measures whether a whole offering type's calendar has
stopped updating — feed liveness, not per-field reconfirmation. At 3 days a LISTED IPO's issue price
would read "being rechecked" forever, three days after listing, because nothing re-reads a final
price and nothing should. That puts the marker under nearly every block on most pages and trains
readers to ignore it. **A single global constant is wrong at every value it could take.**

**2. Which list pages the endpoint revalidates — resolved by classifying all of them.**
The design names four (`/`, `/mainboard-ipos`, `/sme-ipos`, the sitemap); the app has **29 page
routes**, and far more than four are driven by IPO rows. Shipping the named four would leave a
corrected IPO fixed on its own page and stale on the calendar that links to it.

A longer guess fails the same way one release later, so the list is exhaustive by construction:
`web/lib/services/page-revalidation-targets.ts` classifies **every** route as refreshed or excluded
with a reason, and a test fails when a route is neither. That guard caught its own author within a
minute of being written — it failed on `/tools/lot-calculator`, missed because the directory listing
consulted was truncated, and checking that then revealed `/tools/compare` was wrongly in the
refreshed list too (both are `'use client'` and fetch at request time, so `revalidatePath` on them is
a no-op that reads like coverage).

## Known gaps

- **The "confirmed on" date is provisional.** Item 5's schema (as currently written) has no column
  meaning "the date this value was last reconfirmed", distinct from row-level `updatedAt`. Until item
  5's card is corrected or a follow-up item adds `chosenConfirmedAt`, this item's date is an
  approximation, named as such in Interfaces above.
- **The staleness threshold has no value.** OD-51 requires it be configuration; no card, including
  this one, has been given a number of days. The config key exists; its value is an open owner
  decision.
- **The touched-slugs tracker is a new, small mechanism this card designed, not one the source design
  specified.** It is the minimum that satisfies OD-40's sentence; a future item could replace it with
  something that survives a scraper process restart mid-cycle (this version does not — a crash after
  writes but before the `pageRevalidation` step loses that cycle's touched-slug list, and the affected
  pages simply wait out their `revalidate = <N>` timer instead, which is the pre-existing behaviour,
  not a regression).
- **List-page and sitemap revalidation are named but not fully specified.** §2.11 says "the endpoint
  revalidates those IPO pages and the list pages" — this card revalidates `/`, `/mainboard-ipos`,
  `/sme-ipos` and the sitemap by name because they are the pages an IPO's status/segment change would
  affect, but the design does not enumerate the exact list, and other list-shaped pages
  (`/mainboard-ipo-listings`, `/sme-ipo-listings`, `/mainboard-ipo-calendar`, `/sme-ipo-calendar`)
  exist and are not named here — left for the implementer to confirm against the design owner rather
  than guessed at exhaustively in this card.
- **OD-29's "delayed" word and the 90-day window logic are not designed in this card** — §2.11 names
  the existing columns (`current_price`, `current_price_updated_at`) but the exact display rule
  (what counts as the 90-day window, where it starts) is not restated here; this card covers only
  that the timestamp and the word "delayed" must appear, not the window's exact boundary condition.
