# 12-B build card — identity re-keyed, in ONE pull request

**Status:** not started. Build deliberately; open the PR after 00:00 IST on the fresh budget.
**Tier A.** It changes an identity function, rewrites 544 stored keys, and deletes a file.

This card exists because 12-B's constraints accumulated across a dozen exchanges and were nowhere
in one place. Building a Tier A slice from scattered messages is how a constraint gets dropped.

---

## Why this is ONE pull request, not two

`normalized_name` is a **persisted** column on `promoters`, `peer_companies` and
`ipo_intermediaries` (`schema.ts:862`, `:1832`, `:1906`), each under `UNIQUE (ipo_id, normalized_name)`.

Measured, not assumed: **544 rows** (29 + 321 + 194 on staging) go stale the instant the deriving
function changes. Proven by mutating `rowKeyForName` and watching the invariant go red at exactly
544, every row named.

Split across two merges, there is a window where every stored key is stale, the UNIQUE constraint
guards a key nothing computes any more, and a live extraction writes the duplicate the constraint
exists to stop. **Function change and re-key ship together or not at all.**

This deliberately overrides the lane's own "a data write gets its own slice" rule. That rule stops
an *independent* write being buried in a code review. This write is not independent: it restores the
invariant its own commit breaks.

## Steps, in order, all inside one PR

1. **Change the pair together.** `normalizeCompanyNameForMatching` (suffix chain to whole-word
   strip, run AFTER the paren-to-space step) **and** `normalizedCompanyNameSql`. Both live in
   `packages/shared/src/utils/company-name-normalizer.ts`, so one commit, no cross-file rebase.

2. **Re-key in TypeScript. Never a SQL UPDATE.**
   Re-run `scraper/scripts/backfill-normalized-name.ts` **unchanged** — it already imports
   `rowKeyForName` (`:34`) and calls it (`:84`).

   **The trap:** the stored key is written by `rowKeyForName`, which has a branch the SQL twin
   cannot have. A name normalising to empty but not blank becomes `junk:` plus a sha1; a blank name
   returns null and the caller skips. The SQL twin returns the empty string for both. A SQL-UPDATE
   re-key would collapse every junk-name row under one IPO to the empty string, collide them under
   E1, and light up lane A's s8b guard on all of them.

   Staging `--apply` is **permitted** by the contract, line 95: *except a repair tool's guarded
   staging apply*. Then `node scripts/assert-repair-held.mjs normalized-name-current --cycles 2`.
   The prod command is **listed for the owner, never run here**.

3. **Re-scan duplicates under the new function, BEFORE E1 is applied anywhere.**
   Baseline is **0 / 0 / 5** (promoters / peer_companies / ipo_intermediaries). Those **5 are
   CORRECT rows** — one bank in two roles on one issue: ICICI sponsor plus public-issue, Kotak
   sponsor plus escrow, Axis sponsor plus public-issue, Centrum BRLM plus syndicate. The
   three-column key exists to KEEP them. **Never "fix" them by merging.** If the count rises above
   5, E1 cannot be applied until each new one is resolved, and I report **identities, not a count**.

4. **Ship the TS-vs-SQL agreement test.** Nothing in CI checks the two agree today — measured:
   `normalize-company-name-parity.test.mjs` contains **zero** occurrences of `sql`; it compares the
   hand copy against the TypeScript SSOT, not the SQL twin.
   - runs against the **pr-gate Postgres service**, never the tunnel, never `web/.env.local`
   - fixture: the 30-plus names from the broken tunnel file, **plus a junk-only name and a blank name**
   - asserts `rowKeyForName(name)` equals the SQL twin for every non-junk, non-blank name, and
     documents that junk and blank are wrapper-only and inexpressible in SQL
   - **wired onto the pr-gate allow-list**, and the PR body says so

5. **Delete `scraper/tests/integration/company-name-normalizer-agreement.integration.test.ts`** in
   this same PR. Grounds for the PR body — **not** the "production hazard" framing I used and
   withdrew, since it runs two SELECTs of bound literals with no FROM, no table and no write:
   - its pool carries **no read-only guard**, unlike `openReadOnlyPool`, which sets
     `default_transaction_read_only=on` and then proves it
   - it is the **only** test reading `web/.env.local`, so it is the template the next person copies
   - it buys nothing in CI, where it cannot run at all

## Before trusting ANY local green

Run the marker probe **in 12-B's own worktree**, under **vitest** (the runner whose result is being
defended), against **its own changed function** — not inherited from another tree. Insert a marker
into the worktree's `packages/shared` copy, run an alias-importing suite, confirm the marker is
seen, restore from `.bak`, confirm `git status` is clean.

Tonight's probe proved `wt-link-modules.ps1` re-points the shared alias at the worktree. 12-B is the
most exposed slice in the run because it changes shared code, so it gets its own probe regardless.

## Detection

`No detection change: guard owned by lane A item 1 slice s8b under issue #506`.

Valid **only while s8b is real.** Verified tonight: `derived-key-recompute-guard.integration.test.ts`
imports `rowKeyForName` at `:12`, uses it as the derive at `:88`, `:95`, `:102`, encodes the
stored-empty vs recomputed-null no-identity rule at `:35-38`, and **is wired** into the pr-gate
integration list. **Re-check at build time** — a declaration pointing at a guard that never lands is
a paper check, and it would be lane C's PR carrying it.

## Cross-lane

12-B lands **before** lane A's item 1 writer slices (s5b, s7a, s7b): item 1 reads
`company-name-normalizer` as its row-key function while 12-B changes it. Announce the merge in the
ledger so lane A re-runs its row-key tests.

## Hazard nobody else raised

This repo has **five** functions named `normalizeCompanyName` (`slug.ts:250`,
`normalization-engine.ts:301`, `nse-past-issue-matcher.ts:53`, `scraper-utils.ts:150`) plus
`normalizeCompanyNameForMatching`. "Change the normaliser" is ambiguous across five call graphs.
**12-B touches `company-name-normalizer.ts` only, and its PR body must say which one moved.**

## What 12-B does NOT do

- It does **not** touch `foldCompanyIdentity`. Different function, deliberately kept independent so
  a change here cannot silently re-scope a row-deleting repair tool.
- It does **not** repair the #515 face-value-in-price-band class. That is slice 2-S6, after this.
- It does **not** apply E1. Lane A owns that.

## Prod note carried forward

Production has **no `normalized_name` column at all** (prod rows 27 + 326 + 178 = 531, column
absent). Staging has it. So the prod path is add column, then backfill, then constrain — three
steps, not the single step it is on staging. Anyone planning the prod apply from staging's shape is
planning against a database that does not exist.
