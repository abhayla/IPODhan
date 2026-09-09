# Item 18 — Document retention (OD-23)

## Purpose

Offer documents are never deleted for being old: the seven-day purge and the ten-day live window
both stop existing, documents survive for the life of the IPO row, and the 5 GB store ceiling is
honoured by compressing already-extracted PDFs in place instead of deleting them.

## Serves

`docs/design/data-sourcing-pull-model.md` §0.5.1 (OD-23, owner 2026-09-09: *"Offer documents, and
the data taken from them, survive close and listing."*), §6.3 ("OD-23 has now removed half" of the
old-document-availability unknown), §6.4 (F-09, "answered by OD-23"), §7.1 item 18, §7.2
(reversibility). Also serves the store-size probe's own finding: `document-store-size.out.json`
projects the store at 500 IPOs to **8.25 GB estimated** (`projection.at_500_ipos.gb_estimated`),
which **exceeds** the 5 GB ceiling (`fits_under_ceiling_at_500_estimated: false`) — so compression
is the mechanism that keeps OD-23's "keep everything" promise inside the existing disk-safety rule,
not a nice-to-have.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/services/document-state-machine.ts` | exists | `LIVE_WINDOW_DAYS_AFTER_LISTING = 10` (line 749) and `isInLiveWindow` (lines 751-765) — `isInLiveWindow` stops being a gate on document work. Either delete the function and its callers' conditional, or change it to always return `true` for any status past `LISTED` (keeping the function as a documented no-op is safer for callers not touched by this item — see Rollback). |
| `scraper/src/services/document-cycle.ts` | exists | Line 768's call `return isInLiveWindow({ status: ..., listingDate: ... });` inside `loadCandidateIpos`'s `.filter(...)` (lines 762-770) — remove the live-window filter entirely; every non-WITHDRAWN/POSTPONED status becomes eligible the way WITHDRAWN/POSTPONED already are (lines 764-766: "must still be visited once"). |
| `scraper/src/services/document-cycle.ts` | exists | `PURGE_CANDIDATES_SQL` (line 1410) and `runDocumentPurge` (lines 1434-1469) — deleted. This is the query and function the purge cycle step calls; both go, not just their caller. |
| `scraper/src/services/document-store.ts` | exists | `isPurgeDue` (line 231, through the `PurgeDecision` type at line 243), `decidePurge` (line 264, through `hasStoredFile` at line 295), `PurgeResult`/`purgeIpoDocuments` (line 314 through end of file, line 372) — deleted. `getRetentionDays` (line 63), `getMaxRetentionDays` (line 58), `DEFAULT_RETENTION_DAYS` (line 32), `DEFAULT_MAX_RETENTION_DAYS` (line 45) are deleted with them — nothing else in the codebase reads `PROSPECTUS_RETENTION_DAYS`/`PROSPECTUS_MAX_RETENTION_DAYS` once the purge functions that read them are gone (confirmed: `getRetentionDays`/`getMaxRetentionDays` have no other callers — grepped this session). `getMaxStoreBytes` (line 68) and `DEFAULT_MAX_STORE_GB` (line 46) are **kept** — the 5 GB ceiling itself stays; only the deletion mechanism it used to trigger is what goes. |
| `scraper/src/index.ts` | exists | `triggerDocumentPurge` (lines 1228-1245) and its wiring `await runStep(cycleId, 'documentPurge', triggerDocumentPurge)` (line 834) — deleted. Replaced by a new `triggerDocumentCompaction` step (see Interfaces) at the same call site, so the cycle still does *something* to manage store size, just compression instead of deletion. |
| `scraper/src/services/document-compaction.ts` | NEW | The compression pass: selects the oldest already-extracted, not-yet-compressed PDFs when the store is approaching the ceiling, gzips each in place, and updates its `documents` row so the extractor knows to decompress before reading. See Interfaces. |
| `packages/shared/src/db/schema.ts` | exists | `documents.fileSize` (line 631, `bigint('file_size', { mode: 'number' })`) — no type change, but see Schema below for the new `compressed` marker and the backfill this item owns. |
| `scraper/scripts/backfill-document-file-size.ts` | NEW | Backfills `documents.file_size` for the 163 of 265 active rows the probe found with no size recorded (`document-store-size.out.json`: `"file_size_unknown": 163`, `"active_documents": 265`) — see Interfaces. |
| `scraper/tests/unit/services/document-store.test.ts` | exists (assumed — confirm at implementation time; grep this session found no file by this exact name, only inline references in `document-cycle.ts` and `filing-auto-persist.ts`) | Any existing test exercising `decidePurge`/`isPurgeDue`/`purgeIpoDocuments` is deleted alongside the functions, not left red. **The design does not name this file** — confirm its actual path with `grep -rl "decidePurge\|isPurgeDue" scraper/tests` before deleting anything; this card names the functions to remove, not a verified test-file path, and that gap is flagged rather than guessed. |

## Schema

**New column**, `documents` table (`packages/shared/src/db/schema.ts:615-670`):

```ts
export const documents = pgTable('documents', {
  // ...existing columns...
  compressedAt: timestamp('compressed_at'), // NEW — null = stored uncompressed, as today
});
```

Migration SQL (non-destructive ADD COLUMN, journal-eligible, matching the style of
`web/drizzle/migrations/0035_add_document_fetch_state.sql`'s `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS`):

```sql
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "compressed_at" timestamp;
```

`compressedAt` rather than a boolean: it records *when* compaction happened, which is what the
detection check below needs to distinguish "compressed last night" from "compressed six months ago
and possibly stale" — a boolean would need a second column to carry that anyway.

**No change** to `fileSize` (`bigint`, line 631) — it keeps recording the **original**,
uncompressed byte count, because that is the number every existing consumer of the field (the
store-size probe, any future size-based reasoning) means by "how big is this document." The
*on-disk* compressed size is not persisted anywhere in this design — **the design does not say**
whether it should be, and inventing a second size column nobody asked for is exactly the
speculative-generality YAGNI rules out. Fork, not invented: if disk-usage reporting later needs the
post-compression size specifically, that is a new column added when that caller exists.

**Backfill target**: `documents.fileSize IS NULL` — 163 of 265 active rows per the probe. The
backfill script stats the locally-stored file at `documentPath(ipoId, type, sha256, storeDir)`
(`document-store.ts:78-85`) for every such row where the file still exists locally, and sets
`fileSize` to the real byte count. For a row whose local file is already gone (deleted by the old
seven-day purge before this item lands, or never downloaded), the byte count cannot be recovered
without a re-fetch; the backfill records those separately (see Interfaces —
`unresolvableNoLocalFile`) rather than leaving them silently unexplained, per
`.claude/rules/signal-ownership.md` R1 ("a failure counter... MUST be resolved to identities").

## Interfaces

```ts
// scraper/src/services/document-compaction.ts (NEW)

export interface CompactionCandidate {
  documentId: string;
  ipoId: string;
  filePath: string;
  bytes: number;
  extractedAt: Date; // only EXTRACTED documents are compaction candidates
}

export interface CompactionSummary {
  storeBytesBefore: number;
  storeBytesAfter: number;
  ceilingBytes: number;
  candidatesConsidered: number;
  compressed: number;
  bytesReclaimed: number;
  skippedAlreadyCompressed: number;
}

/**
 * Runs when the store is within a headroom margin of the ceiling (recommend
 * 90% — the design does not name a trigger percentage, see Feature flag).
 * Selects the OLDEST already-extracted, not-yet-compressed documents first
 * (oldest by `documents.extractedAt`, per §0.5.1: "the oldest already-extracted
 * PDFs are compressed in place"), gzips each `<name>.pdf` to `<name>.pdf.gz`
 * via `<name>.pdf.gz.tmp-<pid>` then an atomic rename (mirroring
 * `storeDocument`'s temp-then-rename discipline at `document-store.ts:186-195`),
 * deletes the original only after the gzip is confirmed readable, and sets
 * `documents.compressedAt`. Stops once back under the ceiling or candidates
 * are exhausted.
 */
export async function compactDocumentStore(deps: {
  storeDir?: string;
  maxStoreBytes?: number;
  headroomFraction?: number; // default 0.9
}): Promise<CompactionSummary>;

/**
 * Read path counterpart: any code that currently calls `documentPath(...)`
 * and reads the result with `fs.readFile`/passes it to a subprocess (the three
 * call sites this session found: `anchor-investors-scraper.ts`,
 * `document-cycle.ts`, `filing-auto-persist.ts:1581,1650`) must go through
 * this instead of reading the path directly, so a compressed document is
 * decompressed to a temp file transparently before extraction.
 */
export async function readStoredDocument(
  ipoId: string,
  docType: string,
  sha256: string,
  storeDir?: string
): Promise<Buffer>;
```

**Fork, not invented — the compression scheme itself.** The design says only "compressed in place"
and "still there and still re-readable" (§0.5.1); it does not name gzip, a PDF-structure-aware
recompressor (e.g. Ghostscript downsampling embedded images), or anything else. This card
recommends **gzip of the raw PDF bytes** (`node:zlib`, already a runtime dependency, zero new
packages) because: (a) RHPs/DRHPs are text- and image-heavy PDFs that gzip well without touching
PDF internals, so no new binary dependency (Ghostscript/qpdf) is needed on the 2-vCPU box F-35
already flags as resource-constrained; (b) it is trivially reversible (gunzip reproduces the exact
original bytes, byte-for-byte, which a lossy PDF image-recompressor would not guarantee); (c) it
requires exactly one new function (`readStoredDocument`) at the read boundary rather than
PDF-format-aware tooling. **This is a recommendation, not a decision the design makes** — flag as
O-nn if the owner wants a different scheme.

```ts
// scraper/scripts/backfill-document-file-size.ts (NEW)
export interface FileSizeBackfillSummary {
  documentsConsidered: number;
  fileSizeSet: number;
  unresolvableNoLocalFile: number;
}
export async function backfillDocumentFileSize(deps: {
  db: NodePgDatabase<typeof schema>;
  storeDir?: string;
  dryRun?: boolean;
}): Promise<FileSizeBackfillSummary>;
```

## Feature flag

`ENABLE_DOCUMENT_COMPACTION` (**NEW**, `scraper/src/config/feature-flags.ts`, same
`process.env.ENABLE_DOCUMENT_COMPACTION === 'true'` pattern as every other flag in that file).
Default: the design does not state one — recommended `false` until the read-path change
(`readStoredDocument`) is verified against a real compressed file in staging, then `true`
everywhere, since the alternative (no compaction, purge already removed) risks the store-full
write-refusal at `document-store.ts:174-184` firing in production once the store crosses the
ceiling with nothing shrinking it. This is a recommendation; the design leaves the default open.

`compactionHeadroomFraction` (the 90% trigger threshold) is not itself owner-decided — **the
design does not say** what threshold should trigger compaction, only that it happens "when the
store approaches the ceiling" (§0.5.1). 90% is this card's recommendation, overridable via an env
var (`PROSPECTUS_COMPACTION_HEADROOM_FRACTION`) rather than hard-coded, so the owner's actual
number (once given) is a config change, not a redeploy.

The existing `PROSPECTUS_STORE_MAX_GB` / `DEFAULT_MAX_STORE_GB = 5` (`document-store.ts:32`) is
**unchanged** — the ceiling itself is not moving; only how it is enforced is.

## Tests

Red before the change:

- A unit test asserting `loadCandidateIpos` (`document-cycle.ts`) includes a `LISTED` IPO with a
  `listingDate` more than `LIVE_WINDOW_DAYS_AFTER_LISTING` (10) days in the past — today this test
  would fail (excluded); after the change it must pass (included). Directly closes the 228-IPO gap
  §0.5 measured ("LISTED more than 10 days ago (no document work at all)").
- `scraper/tests/unit/services/document-store.test.ts` (or wherever `decidePurge`/`isPurgeDue` are
  currently tested — confirm path) — every existing red/green case for those functions is deleted,
  not left to fail against removed exports.
- `scraper/tests/unit/services/document-compaction.test.ts` (NEW) (**NEW**) — asserts: (a) compaction is
  a no-op when store size is below the headroom threshold; (b) when above threshold, the
  **oldest** `extractedAt` candidate is compressed first, not an arbitrary one; (c) a document
  still `NOT_APPLICABLE`/unextracted is never selected (mirrors the old `decidePurge`'s
  `allDocumentsRead` guard, now applied to compression instead of deletion); (d) `readStoredDocument`
  returns byte-identical content whether the file is currently `.pdf` or `.pdf.gz`.
- `scraper/tests/unit/scripts/backfill-document-file-size.test.ts` (NEW) (**NEW**) — asserts: rows with a
  non-null `fileSize` are never touched; rows with a locally-stored file get the real stat size;
  rows with no local file are counted under `unresolvableNoLocalFile`, not silently skipped.
- Tier: unit, per `.claude/rules/scraper-test-layout.md`.

## Detection

**NEW check**, `docs/reviews/detection-checks/document_compaction_progress.json` (NEW) (id
`document_compaction_progress`): asserts the nightly `documents` count with `compressed_at IS NOT
NULL` is non-decreasing and that store size (from the same probe methodology as
`document-store-size.mjs`) stays under `PROSPECTUS_STORE_MAX_GB` — a FAIL here means compaction has
stopped keeping pace with growth, which is exactly the class this item exists to prevent (the
projection already shows the honest estimate crossing the ceiling at 500 IPOs). Per
`.claude/rules/recurrence-detection-gate.md`, this PR touches `scraper/src/services/**`, so a
detection change is required, not optional — this is it.

## Staging proof

Per `.claude/rules/defect-fix-contract.md` item 5:

1. Deploy to staging with `ENABLE_DOCUMENT_COMPACTION=true` and a lowered `PROSPECTUS_STORE_MAX_GB`
   (e.g. the current staging store size + 50 MB) so compaction actually triggers within one cycle
   rather than waiting months for real growth.
2. The exact log line: `document-compaction: storeBytesBefore=<n> storeBytesAfter=<n> ceilingBytes=<n>
   compressed=<n> bytesReclaimed=<n>` — healthy value is `storeBytesAfter < ceilingBytes` after the
   run, where before the change the equivalent purge log line (`Purged local IPO document PDFs`)
   would have shown files deleted instead.
3. Confirm at least one compressed document is still extractable: re-run the extractor against an
   IPO whose document was just compressed and confirm `readStoredDocument` decompresses it and the
   extraction succeeds identically to a pre-compaction run on the same document (same field count
   written).
4. `node scripts/assert-repair-held.mjs <invariant> --cycles 2` is **not** required for this item
   specifically — it is a data-repair proof requirement (`defect-fix-contract.md`), and this item
   does not repair a data value, it changes storage format. The proof that matters here is #3
   (extractability survives compaction), which is a correctness proof, not a repair-durability one.

## Rollback

Code: revert the commit. `compactDocumentStore` and `readStoredDocument` are new, additive
functions behind `ENABLE_DOCUMENT_COMPACTION`; turning the flag off stops new compaction runs
immediately.

**Not cleanly reversible once compaction has run on prod**: a compressed file (`.pdf.gz`) is
byte-identical to the original once gunzipped (gzip is lossless), so the *document* is fully
recoverable — but any code path that still reads `documentPath(...)` directly instead of through
`readStoredDocument` would silently fail against a `.gz` file after rollback, unless the rollback
also reverts every caller back to expecting a plain `.pdf`. §7.2 of the design lists item 18 as
"reversible only in the sense that the constants go back; documents already deleted under the old
rule do not come back" — this card's addition is that documents *compressed* under the new rule
also do not un-compress themselves on a code revert; a rollback script (`gunzip` every
`.pdf.gz` back to `.pdf`) would need to run alongside reverting the code, not instead of it.

Data: the file-size and filing-date backfills are additive corrections (fill nulls only, never
overwrite a non-null value) — reversible by clearing the backfilled column, though nothing in this
design asks for that.

## Tier, budget and cost

**Tier B** — per the design's own item table (§7.1: "18 | Document retention (OD-23) ... | B |
small, and it stops the backlog compounding"). Ordinary app code behind a flag, no auth/payments/
migration-of-existing-values beyond additive columns; CI green + Tier-B diff-only review (10 min
cap, no mutation testing) is the gate, merge on PASS.

`Budget: 30 min wall-clock, 60 tool calls.`

Cost: small, and independent of items 1–17 — §7.1 lists item 18 among the four items ("4, 8, 16 and
18") free to start immediately in parallel with item 1. One review round expected.

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

1 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §0.5.1 | R-151 |

## Known gaps

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
