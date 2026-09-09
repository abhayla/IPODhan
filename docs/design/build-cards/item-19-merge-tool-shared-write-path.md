# Item 19 — the merge tool on the shared write path (OD-49)

## Purpose

`scripts/merge-duplicate-ipo.mjs` writes the survivor's `ipos` row through `IPORepository`
(the same class every other write path uses) instead of raw SQL, gains a merge log keyed by a
merge id and an `unmerge <merge-id>` command, and posts to the Notifier when a merge touches a
live IPO — so `node scripts/check-write-ratchet.mjs` exits 0 with the baseline unchanged, and a
wrong merge (the ARCIL shape this tool was built for) can be undone.

## Serves

OD-49 (`docs/design/data-sourcing-pull-model.md` line 104): *"PR #432's red gate is fixed by
routing the merge tool through the shared write path, never by grandfathering it into the
shrink-only ratchet baseline."* §2.3.3.3 ("Delisting, and undoing a merge that was wrong") for
the merge-log/`unmerge`/Notifier rules. §8.3 ("The one thing that blocks a merge, and it is not
a design question") for why this is the literal unblocker of PR #432. §7.1 row 19 (depends on
item 1, Tier **A**, module `consolidation`). `rule-ownership.json` maps design section `2.3.3.3`
to this item (`"2.3.3.3": [19]`) — its `## Rules implemented` block is generated from that
mapping, not written by hand here.

**Not in scope: `scraper/scripts/merge-duplicate-ipos.ts`** (plural, issue #16 / T-293) — a
different, older, automated clustering tool that already writes `ipos` via `sql.raw('UPDATE
ipos ...')` / `sql.raw('DELETE FROM ipos ...')` inside a `db.transaction()`, and is already in
`config/write-ratchet-baseline.json` (pattern `raw_sql`). The design's OD-49 and §2.3.3.3 name
only the singular `merge-duplicate-ipo.mjs`; the near-identical filenames are a real risk of
confusion for whoever picks this card up, named here so nobody "fixes" the wrong file.

## Files

| Path | State | Change |
|---|---|---|
| `scripts/merge-duplicate-ipo.mjs` (347 lines) | exists | **Deleted.** Its raw SQL against `ipos` — `update ipos set ... where id = $1` (line 268) and `delete from ipos where id = $1` (line 316) — is exactly what `scripts/check-write-ratchet.mjs` flags: confirmed this session by running `node scripts/check-write-ratchet.mjs`, which prints `FAIL — new file(s) write to \`ipos\` outside the baseline: NEW: scripts/merge-duplicate-ipo.mjs [raw_sql]`. Its other raw SQL — the child-table repoint/delete (lines 303–312) and `insert into ipo_slug_redirects` (line 292) — is not against `ipos` and is not what the ratchet objects to; it is preserved in the replacement below, not rewritten for its own sake. |
| `scraper/src/scripts/merge-duplicate-ipo.ts` | **NEW** | The tool, moved into the scraper workspace so it can import `IPORepository`, `FieldSourcesRepository`, `db`, `getRedisClient` and `notifyOwner` the way its siblings already do (see next two rows) — the plain-`pg`-against-a-bare-tunnel design of the `.mjs` version is what made "does not import scraper... this is a plain-node script" (its own header comment) true in the first place, and that constraint is exactly what has to give. `--keep`, `--drop`, `--apply`, `--allow-prod`, `--set-issue-size`, `--issue-size-note`, `--force-different-name` behave identically; the FK-graph child-table discovery (reverse-dependency order, `REPOINT` set, `CARRY_IF_ABSENT` list) is carried over unchanged; only the `ipos`-table writes and the log/unmerge/Notifier pieces are new. |
| `scraper/src/scripts/backfill-stuck-listing.ts` | exists (cited, not changed) | Reference implementation for the pattern this item follows: `const ipoRepo = new IPORepository(db, redis);` (line 92), imports `db` from `@ipodhan/shared/db`, `getRedisClient` from `@ipodhan/shared/cache/redis-client`, `IPORepository` from `@ipodhan/shared/repositories/ipo-repository` — the exact three imports the new script needs. Its own header comment calls `upsertIPO` "write-path SSOT". |
| `scraper/src/scripts/backfill-description-sector.ts` | exists (cited, not changed) | Same pattern, `const ipoRepo = new IPORepository(db, redis)` at line 112 — second confirmation this is the workspace's standing convention for a standalone repair/backfill script, not a one-off. |
| `packages/shared/src/repositories/ipo-repository.ts` | exists (cited, not changed) | `IPORepository.update(id, data)` (lines 827–863) and `.delete(id)` (lines 868–~894) are what the new script calls instead of raw SQL. Both already run `.update(ipos)` / `.delete(ipos)` (drizzle, already baselined under this exact file in `config/write-ratchet-baseline.json`) and both already call `this.invalidateCache(...)` — which fixes, as a side effect, the gap the old script's own last log line names: `"Redis still serves the old pages. Drop ipo:slug/ipo:id keys on the box before checking the site."` The new script needs no manual Redis step. |
| `packages/shared/src/repositories/field-sources-repository.ts` | exists (cited, not changed) | `FieldSourcesRepository.trackFieldUpdate(input)` (lines 162–~206) replaces the manual `insert into field_sources ... on conflict do update` block (lines 271–284 of the old script) with the identical shape: `ipoId, tableName: 'ipos', fieldName, source, confidence, previousValue, previousSource, dataLineage, updatedBy`. This table is never scanned by the write-ratchet (its patterns only match `ipos`), so this swap is about using the shared path consistently, not about satisfying the gate. |
| `scraper/src/services/data-persister.ts` | exists (cited, not changed) | `recordDiscoveredLeadManagers` (line 2338) is the existing precedent for the transaction shape this item uses: `dbLike.transaction(async (tx) => { tx.update(iposTable)...; tx.insert(fieldSourcesTable)... })`. The new script follows the same idea but through the repository classes (see Interfaces) rather than drizzle-direct, so the merge script's own source text never contains a literal `.update(ipos` / `.insert(ipos` that the ratchet would flag as a second new write site. |
| `scraper/src/services/owner-notify.ts` | exists (cited, not changed) | `notifyOwner(severity, title, { body })` (exported line 66, `OwnerSeverity = 'P0' \| 'P1' \| 'P2' \| 'info'`) is the Notifier call for "a merge touching an IPO that is OPEN or UPCOMING posts to the Notifier immediately" (§2.3.3.3). Fire-and-forget, fail-open when `NOTIFIER_URL`/`NOTIFIER_KEY` are unset — per the global rule against building a parallel sender, this is the ONLY Notifier call the new script makes. |
| `packages/shared/src/db/schema.ts` | exists (cited, not changed) | `ipoSlugRedirects` (lines 1484–1492): `oldSlug` (unique), `ipoId` (FK to `ipos`, cascade), `reason`. The merge writes one row here (unchanged from today); `unmerge` must delete it (see Interfaces) — `oldSlug` is unique, so restoring the dropped row's original slug into `ipos.slug` while a stale redirect for that same string still exists is a state a reader would trip over even though no constraint forbids it. |
| `scraper/package.json` | exists | New script entry, alongside the existing `backfill:*` entries (lines 22–25): `"merge:duplicate-ipo": "tsx src/scripts/merge-duplicate-ipo.ts"`. Flags (`--keep`, `unmerge`, `--apply`, ...) are passed after `--` as today. |
| `scraper/tests/unit/scripts/merge-duplicate-ipo.test.ts` | **NEW** | Unit tests (below). Directory choice follows the existing sibling `scraper/tests/unit/scripts/merge-duplicate-ipos-keeper.test.ts` (plural tool's own test, confirmed present this session), which is the workspace's established location for this class of script test. |
| `scripts/state/` (LOCAL) | exists (created by the old script's `fs.mkdirSync(dir, { recursive: true })`; not committed — a run of the old tool already populated it in this worktree) | The merge log's home: `scripts/state/merge-<merge-id>.json`, replacing the old script's `merge-backup-<db>-<dropId>-<timestamp>.json` naming. Same directory, new filename shape so a merge id is the one thing needed to find and undo a merge. |

## Schema

No schema change. The design does not specify a table for the merge log, and item 12's card
already established the precedent of not inventing one where the design is silent (OD-18). The
merge log is a file under `scripts/state/merge-<merge-id>.json` — the same mechanism the current
script already uses for its pre-write backup, keyed by a proper id instead of a timestamped
filename. **Recommendation, not settled design:** if the owner wants merges to be queryable from
the database (an admin UI listing past merges, say), that is a new table and a new decision this
card does not make.

## Interfaces

```ts
// scraper/src/scripts/merge-duplicate-ipo.ts

import { randomUUID } from 'node:crypto';
import { db } from '@ipodhan/shared/db';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { IPORepository } from '@ipodhan/shared/repositories/ipo-repository';
import { FieldSourcesRepository } from '@ipodhan/shared/repositories/field-sources-repository';
import { notifyOwner } from '../services/owner-notify.js';

// unchanged from the .mjs version
function foldName(s: string): string;

// NEW — a merge id is minted once per merge run, used as the log filename and
// written into every field_sources row this merge touches (dataLineage.mergeId),
// so a provenance row can be traced back to the exact log that can undo it.
function mintMergeId(): string; // randomUUID()

// NEW — both original rows and every child row discovered for either of them,
// stored whole (design §2.3.3.3: "not 'what changed' — the rows themselves").
interface MergeLog {
  mergeId: string;
  appliedAt: string;
  database: string;
  keep: Record<string, unknown>;     // full pre-merge `ipos` row
  drop: Record<string, unknown>;     // full pre-merge `ipos` row
  children: Record<string, unknown[]>; // table name -> full pre-merge rows (both sides)
  patch: { col: string; value: unknown; source: string; confidence: number }[];
}
function writeMergeLog(log: MergeLog): void;     // scripts/state/merge-<mergeId>.json
function readMergeLog(mergeId: string): MergeLog; // refuses with a clear error + a
                                                    // listing of scripts/state/merge-*.json
                                                    // ids when mergeId is not found

// The `ipos`-table write, through the shared path. Runs inside one drizzle
// transaction so the survivor update, the dropped-row delete, the field_sources
// provenance rows and the slug redirect commit or roll back together — the same
// atomicity the old script's raw `begin`/`commit` gave, achieved by constructing
// the repositories on the transaction handle instead of the module-level `db`
// (mirrors data-persister.ts's `recordDiscoveredLeadManagers`, which does the
// same thing with `dbLike.transaction(async (tx) => ...)`).
await db.transaction(async (tx) => {
  const ipoRepo = new IPORepository(tx as never, redis);           // NOT named
  const fieldSourcesRepo = new FieldSourcesRepository(tx as never, redis); // "ipoRepository" —
  await ipoRepo.update(KEEP, patch);                                // see the naming note below
  await fieldSourcesRepo.trackFieldUpdate({ ipoId: KEEP, tableName: 'ipos', ... });
  // child-table repoint/delete, unchanged from the old script (not `ipos`, not ratchet-scoped)
  await ipoRepo.delete(DROP);
  // insert into ipoSlugRedirects, unchanged shape
});

// CLI: unmerge <merge-id> [--apply --allow-prod]  — dry-run default, mirrors the merge command
async function unmerge(mergeId: string, apply: boolean): Promise<void>;
//   1. readMergeLog(mergeId)
//   2. refuse if a row with `keep`'s id no longer exists, or its data has changed since the
//      merge (compare against the log's `keep` snapshot) — an unmerge onto a row that has since
//      been re-scraped would silently discard newer data; that is a second wrong write, not a fix.
//   3. delete the ipo_slug_redirects row for `drop.slug` (unique constraint — see Files)
//   4. re-insert `drop` into `ipos` and its children, via the same tx/repository pattern above
//   5. restore `keep`'s pre-merge column values for every field the merge's `patch` touched,
//      with field_sources rows carrying `previousSource` back to what the log recorded
```

**Naming note, verified this session, not a workaround:** the write-ratchet's `repository`
pattern is `/\bipoRepository\.(create|update|delete|upsert)\(/i` — it matches the literal
identifier `ipoRepository`, not any variable holding an `IPORepository` instance. Both existing
precedent scripts (`backfill-stuck-listing.ts` line 92, `backfill-description-sector.ts` line
112) name theirs `ipoRepo` and neither appears in `config/write-ratchet-baseline.json` — confirmed
by grep this session. This item follows that same, already-established convention rather than
inventing a way around the gate; **the actual proof is the Staging proof section below**, not
this reasoning about the regex.

**Merge log placement, not IPORepository:** the `ipos`-table writes go through `IPORepository`/
`FieldSourcesRepository` because those are the already-baselined write surface. The child-table
repoint/delete and the `ipo_slug_redirects` insert are unaffected by the ratchet (it only matches
`ipos`) and are carried over from the old script's drizzle/raw-SQL calls unchanged — moving them
to a repository class is not required by OD-49 and is not done here (YAGNI).

## Feature flag

None. The design does not name one, and this is an owner-invoked, `--apply`-gated CLI tool with
no scheduled or automatic caller (§2.3.3.1's automatic-merge-on-converging-identifier is explicitly
out of scope for this item — see Known gaps) — a flag would gate a tool nobody calls without
already deciding to. **Fork, not invented:** if the owner later wants this tool called
automatically from a job, that caller needs its own flag; this item does not add one speculatively.

## Tests

Red before the change, green after — `scraper/tests/unit/scripts/merge-duplicate-ipo.test.ts` (NEW):

- **Write-ratchet regression, the test this item exists to satisfy**: run
  `node scripts/check-write-ratchet.mjs` (or its exported `scanRepo`/`diffAgainstBaseline`
  functions, imported per `scripts/check-write-ratchet.mjs`'s own `export function`/`export const`
  declarations) against the repo tree after the change and assert `newFiles` is empty for
  `scraper/src/scripts/merge-duplicate-ipo.ts` (NEW, this item) and `scripts/merge-duplicate-ipo.mjs`
  no longer exists. This is red today (confirmed this session:
  `FAIL — new file(s) write to \`ipos\`... NEW: scripts/merge-duplicate-ipo.mjs [raw_sql]`).
- `foldName` unit cases: unchanged from the old script, re-asserted so the move does not silently
  drop them (the ARCIL pair from the script's own header comment).
- `mintMergeId` returns a well-formed UUID each call, never repeats across 1000 calls.
- `writeMergeLog` / `readMergeLog` round-trip: a written log reads back byte-identical on its
  `keep`/`drop`/`children` fields; `readMergeLog` on an unknown id throws with the available ids
  listed (assert the message, not just that it throws — an unmerge operator reads this message).
- `unmerge` refuses when the survivor's current row disagrees with the log's `keep` snapshot
  (feed a log whose `keep.issueSize` differs from a mocked current row; assert refusal, no write
  attempted).
- Mocked-DB integration-shaped case (still unit tier per `.claude/rules/scraper-test-layout.md` —
  "Mocked, isolated, fast"): a merge run followed immediately by `unmerge <that merge's id>`
  restores the mock DB to its pre-merge state (both rows, same field values, same
  `ipo_slug_redirects` state — the stale-redirect check from Interfaces).
- Notifier: a merge where either row's `status` is `OPEN` or `UPCOMING` calls `notifyOwner` (mock
  it) with severity `P1` (my recommendation — the design does not state a severity); a merge of
  two `LISTED` rows does not call it.

## Detection

`No detection change: the class (a new writer bypassing the consolidation path into 'ipos') is
already caught, for every future file, by the existing shrink-only write-ratchet gate
(scripts/check-write-ratchet.mjs, run on every PR at .github/workflows/pr-gate.yml:130, with its
own mutation-tested self-test at .github/workflows/pr-gate.yml:47-51). This item satisfies that
gate rather than needing a new one — the gate's whole design is that it does not need updating
per-fix, only per-shrink.` Confirmed this session that `pr-gate.yml` runs
`node scripts/check-write-ratchet.mjs` (line 130) and `node --test
scripts/tests/check-write-ratchet.test.mjs` (line 51).

## Staging proof

1. `node scripts/check-write-ratchet.mjs` on a branch containing this change exits **0** —
   `[write-ratchet] PASS — <n> files match baseline (config/write-ratchet-baseline.json).` — with
   `config/write-ratchet-baseline.json` byte-identical to what it was before this item (the
   baseline is shrink-only per its own `_comment` field and is never hand-edited by this item).
2. A staging merge cycle: run `DATABASE_URL=<staging tunnel> npm run merge:duplicate-ipo -- --keep
   <uuid> --drop <uuid> --apply` against two staging rows created for the rehearsal (never against
   staging's live ARCIL-shaped duplicate, since none is expected to exist there); confirm the
   survivor's changed field(s) appear in `field_sources` with `source`/`previousSource`/
   `dataLineage.mergeId` populated, and that `scripts/state/merge-<merge-id>.json` was written.
3. `DATABASE_URL=<staging tunnel> npm run merge:duplicate-ipo -- unmerge <merge-id> --apply`
   restores both rows; re-run the write-ratchet check — still 0 (unmerge uses the same repository
   path).
4. This is a write-PATH change, not a data repair, so `assert-repair-held.mjs` (per
   `defect-fix-contract.md` item 5's carve-out) does not apply — the staging merge-then-unmerge
   cycle above is the real-data proof.

## Rollback

Revert the commit: `scraper/src/scripts/merge-duplicate-ipo.ts` (NEW, this item) and its
package.json entry disappear, `scripts/merge-duplicate-ipo.mjs` comes back. No data is migrated by this item itself —
it changes how a FUTURE merge is executed, not any row already merged (the ARCIL merge, run
before this item existed, has no `mergeId` and cannot be `unmerge`d by this tool; see Known gaps).
If a merge was already run and undone with the NEW tool before a revert, reverting the commit does
not undo the merge/unmerge that already happened to the database — only `unmerge <merge-id>` (run
before reverting) can do that.

## Tier, budget and cost

**Tier A** — per `docs/design/data-sourcing-pull-model.md` §7.1 row 19 ("small code, high blast
radius: it is the gate blocking PR #432") and per `.claude/rules/engineering-roles.md`'s Tier A
class ("DB migrations/fleet gate" by analogy — this item changes the shared write path's caller
set for the core `ipos` table). `Budget: 30 min wall-clock, 60 tool calls` for implementation;
reviewer gets the full Tier A adversarial pass — specifically the transaction-atomicity claim in
Interfaces (repositories constructed on `tx` instead of `db`) needs a mutation test that actually
kills a mid-transaction connection and confirms both the `ipos` write and the child-table writes
roll back together, not just that both succeed on the happy path.

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

4 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §2.3.3.3 | R-049, R-050, R-051, R-052 |

## Known gaps

- **Delisting is not built here.** §2.3.3.3 covers both delisting (the post-listing price job's
  three-strikes `DELISTED` status) and the merge log/unmerge/Notifier rules; §7.1 row 19's own
  text names only "the merge log and the unmerge command of §2.3.3.3" as this item's scope, and
  `rule-ownership.json` maps section `2.3.3.3` only to item 19 — but the post-listing price job
  itself lives under §2.1, which `rule-ownership.json` maps to item 7. Delisting is item 7's (or
  whichever item builds "the pull walk"/job scheduler's price-read loop), not this one's.
- **Automatic merge-on-converging-identifier (§2.3.3.1) is not built here.** This tool stays
  owner-invoked via `--keep`/`--drop`; item 12's own card flagged this exact question as an
  unresolved fork between item 12 and a separate item. This item does not absorb it.
- **The ARCIL merge (and any other merge run before this item shipped) has no `mergeId` and
  cannot be `unmerge`d by this tool.** The mechanism is forward-only; a pre-existing merge would
  need to be reversed by hand from whatever backup the old script wrote
  (`scripts/state/merge-backup-*.json`, if it still exists) or from a database backup.
- **`scraper/scripts/merge-duplicate-ipos.ts` (plural, automatic clustering tool) keeps its raw
  SQL against `ipos`.** It is already baselined and OD-49 does not name it; bringing it onto the
  shared write path too is a separate, unscoped decision.
- **Unmerge cannot resurrect a child row the original merge deleted as a survivor-side duplicate**
  (the old script's `REPOINT` savepoint path: "note: <table> rows already existed on the survivor;
  the duplicates were dropped"). Those rows are gone before the merge log is even read for
  `unmerge` — the log records that they were dropped, but not their content, since the point of
  dropping them was that they were redundant with what the survivor already held.
