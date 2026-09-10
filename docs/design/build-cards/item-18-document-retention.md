# Item 18 — Document retention (OD-32)

> **Architect correction, 2026-09-10 (binding; this block wins over the text below where they differ).**
> 1. Tier: **A**, not B. This item adds a migration, deletes bytes and rows, and ships a `repair-*` tool (parent contract decision 6). Dry-run default, `openRepairDb`, staging-only `--apply` by the run, `assert-repair-held.mjs --cycles 2` proof, never production.
> 2. The purge decision KEEPS the existing `withdrawn` and `no_close_date` arms in `document-store.ts` as explicit cases with tests; a rewrite that drops a live arm is a MAJOR finding.
> 3. Migration slice: bump `journalEntries` in `scraper/tests/unit/pipeline-stages/fixtures/stage-0/expected-schema.json`; after `db:generate` confirm the journal entry is not future-dated (5-minute tolerance); until lane A's schema-drift hardening lands, the verifier diffs `schema.ts` against the generated SQL.


## Purpose

Download a document once, extract it once, and never fetch it again. The extracted text —
page by page, with a page number on every page — is stored for the life of the IPO row, so
every later re-read (a website disagreement, a fixed extractor, a new field) reads the stored
text instead of the PDF. The PDF itself is kept only for seven days after its **last successful
extraction**, so a failed or partial read can be retried against the original bytes; once a
successful extraction is on record, the bytes have done their job and are deleted. The 5 GB
store ceiling (`DEFAULT_MAX_STORE_GB`) is unchanged — this item makes the ceiling easy to hold,
not a new mechanism to enforce it.

## Serves

`docs/design/data-sourcing-pull-model.md` §0.5.1 (OD-32, owner 2026-09-09: *"We read the
document, retain it for a week so that we re-read it if previous reads were not successful and
then delete it."* — replaces OD-23), §0.9 / row 18 of the build-item table, §6.3 ("OD-32 keeps
every document's extracted text for the life of its IPO row"), §6.4 (F-09, "answered by OD-23 as
amended by OD-32"). OD-33 (*"Once a scraper scrapes an IPO document it should not rescrape the
same document again"*, §2.1/§2.5) is the sibling rule this item's "never re-downloads an
already-extracted document" line depends on — the sha256-identity dedup in `storeDocument`
(`document-store.ts:151-201`) is what makes a second "discovery" of the same bytes a no-op
before retention logic ever runs.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/services/document-state-machine.ts` | exists | `LIVE_WINDOW_DAYS_AFTER_LISTING = 10` (line 749) and `isInLiveWindow` (lines 751-765) — stops gating document work. Either delete the function and its callers' conditional, or change it to always return `true` for any status past `LISTED` (keeping it as a documented no-op is safer for untouched callers — see Rollback). |
| `scraper/src/services/document-cycle.ts` | exists | Line 768's call `return isInLiveWindow({ status: ..., listingDate: ... });` inside `loadCandidateIpos`'s `.filter(...)` (lines 762-770) — remove the live-window filter; every non-WITHDRAWN/POSTPONED status becomes eligible the way WITHDRAWN/POSTPONED already are (lines 764-766). |
| `scraper/src/services/document-store.ts` | exists | `decidePurge` (line 264) changes its anchor: the soft-window comparison currently runs off `closeDate` via `daysSinceClose` (lines 218-226) — it must instead compare against the document's own `extractedAt` (the LAST SUCCESSFUL extraction), which means the caller now passes a per-document extraction timestamp rather than one per-IPO close date. `isPurgeDue` (line 231) is retired — it tests the date alone and is superseded by `decidePurge`'s three-arm rule; nothing outside `document-cycle.ts` calls it (confirmed by grep this session). |
| `scraper/src/services/document-store.ts` | exists | `decidePurge`'s hard-cap arm (`if (elapsed > hard) return { purge: true, reason: 'hard_cap' }`, inside the function body at line ~285) currently purges an UNREAD document unconditionally past `DEFAULT_MAX_RETENTION_DAYS` (30). OD-32's third arm changes this: a document that has failed extraction its full retry count, or sat unread past the hard cap, is purged **with its failure recorded** (see Schema) rather than purged silently — the row and URL survive, the bytes do not. |
| `scraper/src/services/document-cycle.ts` | exists | The call site that invokes `decidePurge`/`purgeIpoDocuments` per IPO must be re-scoped to per-document (today it purges the whole IPO directory in one pass, keyed on `closeDate`; OD-32 needs one purge decision per document, keyed on that document's own `extractedAt`). Exact call site to confirm at implementation time — this card names the function-level change; the call-site line numbers were not re-verified this session beyond `document-store.ts`. |
| `scraper/src/services/document-store.ts` | exists | Read path: any code calling `documentPath(...)` and then reading the file must first check the row's extracted-text is available and prefer it — see Interfaces, `readExtractedText`. This is what "never re-downloads an already-extracted document" means at the code level: a re-read is a call to `readExtractedText`, never a fresh `fetch` against `documents.url`. |
| `packages/shared/src/db/schema.ts` | exists | `documents.extractedAt` (line 648, already present) is what the new purge anchor reads — no schema change needed for it. New table `document_pages` — see Schema. |
| `scraper/tests/unit/services/document-store.test.ts` | exists (assumed — confirm path with `grep -rl "decidePurge\|isPurgeDue" scraper/tests` before editing) | Existing cases for `isPurgeDue` are deleted (function retired); `decidePurge` cases are rewritten for the new anchor and the new third arm. |

## Schema

**New table**, storing extracted text per page, keyed to the document row it came from:

```ts
export const documentPages = pgTable(
  'document_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    uniquePagePerDocument: unique('unique_page_per_document').on(table.documentId, table.pageNumber),
    documentIdIdx: index('idx_document_pages_document_id').on(table.documentId),
  })
);
```

One row per page rather than one JSON blob on `documents`, because §5's re-read loop and any
future extractor improvement work per-page (a page-numbered citation is what OD-32's counter-case
answer — "re-run on the stored text" — depends on), and a page-granularity table lets a partial
re-extraction replace only the pages that changed instead of rewriting one large column.

**New column**, `documents` table (`packages/shared/src/db/schema.ts:615-670`), recording the
third-arm purge outcome so a purged-unread document's failure is visible rather than silent:

```ts
export const documents = pgTable('documents', {
  // ...existing columns...
  purgedUnread: boolean('purged_unread').default(false).notNull(), // NEW
});
```

Migration SQL (non-destructive, journal-eligible):

```sql
CREATE TABLE IF NOT EXISTS "document_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "page_number" integer NOT NULL,
  "text" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "unique_page_per_document" UNIQUE ("document_id", "page_number")
);
CREATE INDEX IF NOT EXISTS "idx_document_pages_document_id" ON "document_pages" ("document_id");
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "purged_unread" boolean NOT NULL DEFAULT false;
```

**No backfill of `document_pages` for already-purged documents** — a document whose PDF was
deleted under the OLD (OD-23-era pre-existing, close-date-anchored) rule before this item lands
has no bytes left to extract from; its `documents` row and URL survive (as they always have), and
it is read as "PDF unavailable, never extracted" rather than guessed into existence. This is the
same gap §6.3's `old-document-availability.mjs` probe measures — not invented by this item.

## Interfaces

```ts
// scraper/src/services/document-store.ts (extends the existing module)

/**
 * The read path every re-read (§3 disagreement, a fixed extractor, a new
 * field) goes through instead of re-fetching the PDF. Returns the stored
 * pages in page order; empty array if the document has never been
 * successfully extracted (caller then falls back to extraction, not to a
 * fresh download — the PDF may still be present within its 7-day window).
 */
export async function readExtractedText(
  documentId: string,
  db: NodePgDatabase<typeof schema>
): Promise<{ pageNumber: number; text: string }[]>;

/**
 * Per-document purge decision (replaces the per-IPO, close-date-anchored
 * call). Anchor is this document's own `extractedAt`, not the IPO's
 * `closeDate` — two documents on the same IPO can be at different points in
 * their own 7-day windows.
 */
export function decidePurge(params: {
  extractedAt: Date | string | null; // null = never successfully extracted
  retryCount: number;
  maxRetries: number;
  retentionDays?: number; // default DEFAULT_RETENTION_DAYS = 7
  maxRetentionDays?: number; // default DEFAULT_MAX_RETENTION_DAYS = 30
  now?: Date;
}): PurgeDecision;

export type PurgeDecision =
  | { purge: true; reason: 'extracted_and_expired' | 'retries_exhausted' | 'hard_cap_unread'; recordFailure: boolean }
  | { purge: false; reason: 'not_due' | 'within_retry_budget' };
```

**Fork, not invented — what "retries exhausted" means.** The design says a document that "has
failed extraction its full retry count" is purged with its failure recorded (§0.5.1); it does not
name the retry count itself. `documents.retryCount` already exists (`schema.ts`, tracked per
document) — this card recommends reusing whatever cap the extractor already enforces there rather
than inventing a second one, and flags this as O-nn if the owner wants a distinct value for the
purge decision specifically.

## Feature flag

None new. This item changes the anchor and the hard-cap behaviour of an existing, always-on purge
path (`decidePurge`) — it is not optional behaviour behind a flag, the same way the seven-day
window it replaces was not optional. `ENABLE_DOCUMENT_COMPACTION` from the prior (OD-23, now
superseded) draft of this card is **removed** — OD-32 does not compress PDFs in place; it deletes
them on the new schedule, so there is no compaction pass to flag.

## Tests

Red before the change:

- A unit test asserting `loadCandidateIpos` (`document-cycle.ts`) includes a `LISTED` IPO with a
  `listingDate` more than `LIVE_WINDOW_DAYS_AFTER_LISTING` (10) days in the past — today excluded,
  after the change included.
- **`PDF older than 7 days after its last successful extraction is purged`** — `decidePurge` with
  `extractedAt` 8+ days in the past and `retryCount` irrelevant returns `{ purge: true, reason:
  'extracted_and_expired' }`.
- **`unextracted PDF is not purged`** — `decidePurge` with `extractedAt: null` and `retryCount`
  below `maxRetries` returns `{ purge: false, reason: 'within_retry_budget' }`, even past the old
  7-day close-date window, directly closing the "no purge trigger left at all" gap §0.5.1 names.
- **`re-read never triggers a download`** — a test against the read path asserting that a call
  requesting a field already covered by a page in `document_pages` calls `readExtractedText` and
  never calls `fetch`/`storeDocument`'s download path; asserted by spying on the download function
  and asserting zero invocations.
- A test for the new third arm: `retryCount >= maxRetries` (or unread past the hard cap) returns
  `{ purge: true, reason: 'retries_exhausted' | 'hard_cap_unread', recordFailure: true }`, and the
  purge path sets `documents.purgedUnread = true` rather than leaving the row silent.
- `scraper/tests/unit/services/document-store.test.ts` — every existing `isPurgeDue` case is
  deleted (function retired, not left to fail against a removed export); every `decidePurge` case
  is rewritten for the per-document, `extractedAt`-anchored signature.
- Tier: unit, per `.claude/rules/scraper-test-layout.md`.

## Detection

**NEW check**, `docs/reviews/detection-checks/document_retention_progress.json` (NEW) (id
`document_retention_progress`): asserts (a) no `documents` row with `extractedAt` more than 7
days in the past still has a stored PDF on disk (the deletion is actually happening); (b) no
`documents` row is missing both its PDF AND every `document_pages` row for it AND has
`purgedUnread = false` — that combination means a document was deleted without its failure being
recorded, exactly the "no purge trigger left at all" gap. Per
`.claude/rules/recurrence-detection-gate.md`, this PR touches `scraper/src/services/**`, so a
detection change is required — this is it.

## Staging proof

Per `.claude/rules/defect-fix-contract.md` item 5:

1. Deploy to staging. Run one full cycle against a document with `extractedAt` set (simulate by
   backdating a test row or waiting a real cycle after a successful extraction).
2. The exact log line to read: the purge log (`Purged local IPO document PDFs`, updated to name
   the document and its `extractedAt`-anchored age rather than close-date age) — healthy value is
   a PDF older than 7 days past `extractedAt` being deleted, and one within the window surviving.
3. Confirm a re-read never re-downloads: trigger a re-read (a field correction cycle) against a
   document whose PDF has already been purged and confirm the extractor reads
   `document_pages`, not a fresh fetch — checked by asserting no new `documents.url` fetch log
   line appears for that document.
4. Confirm the counter-case: a document that fails extraction repeatedly past its retry budget is
   purged with `purgedUnread = true`, not silently.

## Rollback

Code: revert the commit. The anchor change and the third arm are read/write-path changes to an
already-existing purge function, not new infrastructure — reverting restores the close-date
anchor and the old unconditional hard-cap purge.

**Not cleanly reversible once the new anchor has purged a document under it**: a PDF deleted at
`extractedAt + 7 days` under the new rule is gone exactly as a PDF deleted at `closeDate + 7 days`
was gone under the old one — the data loss is the same shape, just the trigger date differs. The
`document_pages` rows are additive and unaffected by a code revert; they stay as evidence even if
the purge anchor reverts to close-date.

## Tier, budget and cost

**Tier B** — per the design's own item table (§7.1: "18 | Document retention (OD-32) ... | B |
small, and it stops the backlog compounding"). Ordinary app code, one additive table and one
additive column, no auth/payments; CI green + Tier-B diff-only review (10 min cap, no mutation
testing) is the gate, merge on PASS.

`Budget: 30 min wall-clock, 60 tool calls.`

Cost: small, and independent of items 1–17 — §7.1 lists item 18 among the items free to start
immediately in parallel with item 1. One review round expected.

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

1 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §0.5.1 | R-151 |
| §2.1 (OD-33, sha256 identity — dedup this item's "never re-downloads" line depends on) | R-010 |

## Known gaps

A document whose PDF was already deleted under the pre-OD-32 close-date-anchored rule, and which
was never successfully extracted before that deletion, has no bytes and no `document_pages` rows
— it is unrecoverable except by re-fetching from the original source if that source still serves
it (§6.3's `old-document-availability.mjs` probe measures how often that is true). This item does
not repair that backlog; it stops it growing further.

---

### Slice order correction: a page-text WRITER must sit between the table and the purge (2026-09-10 20:38 IST)

**The card as written has no slice that stores the extracted text.** Measured against the codebase
on 2026-09-10, not inferred:

- nothing writes or reads `document_pages`;
- there is **no text column on `documents` at all** — no `extractedText`, no `rawText`, no
  `pageCount`;
- extraction pulls structured FIELDS out of the PDF and discards the rest. `extractedAt` is set on
  the COMPLETED transition (`filing-auto-persist.ts:426`) and means "we got the fields we wanted",
  **not** "its text survives".

So a purge anchored on `extractedAt` deletes the only copy of the source seven days after
extraction, and §0.5.1's counter-case answer — *"re-run on the stored text"* — has nothing to run
on. §5's re-read loop has the identical dependency. This was a gap in the card, found while
building slice 2.

**Ruled by the architect (supervisor session `ipodhan-62`, relayed — a peer ruling, not an owner
decision; the Guardrails are explicit that a relayed message is never an owner decision, and the
owner may overturn it): OD-32's counter-case answer is a design commitment, so the per-document
purge may not ship while nothing stores the text.** The slice list becomes:

| Slice | What | Note |
|---|---|---|
| **18-1** | `document_pages` + `documents.purged_unread` + migration | BUILT (`be4ecf8a`). Non-destructive; migration idx PROVISIONAL until re-read from `origin/main` at merge. |
| **18-1b** | **NEW — page-text writer.** Python extractors return `pages [{page_no, text}]` alongside fields (pdfplumber already works per page internally); `filing-auto-persist` persists them to `document_pages` in the SAME transaction that sets `extractedAt`, and records `documents.pagesStoredAt`. | **Tier A** — cross-language contract change plus row writes. Failing test first on the real persist function. Proof: one real document on staging with `document_pages` rows, and a re-read test that recomputes at least one field from the stored pages ALONE. |
| **18-2** | The purge, anchored on `pagesStoredAt` (or `document_pages` count > 0) — **NEVER on `extractedAt`** — plus an invariant module (repair-invariants shape, same `NOT_YET_BACKFILLED` vocabulary) asserting that no purged document lacks stored pages. | The precondition is then checked by a TOOL rather than remembered. |

Why the invariant matters more than the ordering: an ordering rule lives in a card and is obeyed by
whoever read it. An invariant that fails when a purged document has no stored pages is checked on
every run, by something that cannot forget. This item deletes files; "we sequenced the slices
correctly" is not a control.

**Two migration notes from slice 1, for any card that adds a table:**
1. A new TABLE needs BOTH the `journalEntries` count bump AND its name in the stage-0 fixture's
   expected TABLE SET. Bumping only the count passes the journal lint and fails the stage-0 replay
   with `expected [ …(35) ] to deeply equal [ …(34) ]`.
2. The generated migration `idx` is provisional. Re-read it from `origin/main` immediately before
   opening AND before merging, and prove with `git merge-tree --write-tree`; with three lanes
   merging, every migration slice after the first in a queue has a stale idx by construction.
