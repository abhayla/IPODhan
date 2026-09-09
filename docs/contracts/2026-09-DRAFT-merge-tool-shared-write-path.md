# Contract (DRAFT — not dispatched, owner approval required): the merge tool on the shared write path

**Executor:** /goal (built-in autonomous run) · **Created:** 2026-09-09 · **Slug:** `merge-tool-shared-write-path`
**Status:** **DRAFT — not dispatched, owner approval required.** No T-id is allocated. Nothing is written to the fleet bus.
**Mission:** Make `scripts/merge-duplicate-ipo.mjs` write to `ipos` through the shared write path instead of raw SQL, and make every merge it performs **reversible**: both original rows stored whole with their provenance, an `unmerge <merge-id>` command that restores them and re-points the slug redirect, and a Notifier post when a merge touches an OPEN or UPCOMING IPO. Build item 19 of `docs/design/data-sourcing-pull-model.md` §7.1; owner decision **OD-49**; design §2.3.3.3 and §8.3. "Done" is the Definition of Done below, in full.

**Why this is not a tidy-up.** `node scripts/check-write-ratchet.mjs` exits 1 today with
`NEW: scripts/merge-duplicate-ipo.mjs [raw_sql]`, and that is the red check on PR #432 and on every
PR raised off that base since. The ratchet baseline is **shrink-only by its own header**. Adding the
script to it would record that a one-off tool may write to the core table however it likes, which is
the opposite of what the ratchet exists to say. **The fix is routing. The baseline is never edited.**

---

## §0.1 Worktree isolation

> **First action of the run, before §0.2 and any stage. Non-negotiable.**
>
> 1. From the primary checkout: `powershell -File $HOME/.claude/tools/wt-new.ps1 -Repo D:/Abhay/Ventures/IPODhan -Name mergetool -Branch fix/merge-tool-shared-write-path -Base origin/main -Purpose "build item 19: merge tool on the shared write path" -TtlHours 72`. Fallback if it refuses: `git fetch origin && git worktree add ../IPODhan-mergetool -b fix/merge-tool-shared-write-path origin/main`, plus a hand-written `.worktree-meta.json`.
> 2. Run every stage inside that worktree. Assert `git rev-parse --show-toplevel` ends in the worktree name before every stage; a mismatch is a hard halt.
> 3. Claim it: `RUN_TOKEN=mergetool-$(date +%s)`; `printf '%s\n' "$RUN_TOKEN" > "$(git rev-parse --show-toplevel)/.run-active.lock"`. Release it as the final action, on success or on any halt.
> 4. **Never self-remove the worktree.** Removal is the owner's, via `~/.claude/tools/wt-rm.ps1`.

## §0.2 Idempotency preflight

> **First action after §0.1.**
>
> 1. Read `docs/contracts/.run/merge-tool-shared-write-path-PROGRESS.md` if it exists, and `git log origin/main --oneline -30`.
> 2. Record the starting exit codes of: `node scripts/check-write-ratchet.mjs` (expected **1**, naming this file), `npm run test:unit`, `cd web && npm run lint:ci`, `cd packages/shared && npx tsc`. A red that this run did not cause is the starting state, not a reason to halt.
> 3. Read the tool itself end to end before changing a line: `scripts/merge-duplicate-ipo.mjs` (347 lines). It already discovers child tables from the live foreign-key graph, re-points person-created data, writes `field_sources` provenance by hand and takes a JSON backup before writing. **None of that trips the ratchet.** Only the two `ipos` statements do — the `update` at line 268 and the `delete` at line 316.

## §0.3 Progress log

> Append-only at `docs/contracts/.run/merge-tool-shared-write-path-PROGRESS.md`. First line: slug · branch · worktree · start time · contract path · mission. Two-line entries at stage start and stage done (with the gate result), and at every DEFECT, EVENT, DECISION, REVIEW, BLOCKER, DONE. Timestamps from `date` in the same command, never estimated. Run-end SUMMARY: DONE · PENDING(+reason) · BLOCKED(+why) · NEXT(action+owner).

---

## Scope boundary

- **In scope:** `scripts/merge-duplicate-ipo.mjs` (or its replacement under `scraper/src/scripts/`), the merge-log table and its migration, `packages/shared/src/db/schema.ts` for that table only, the tests for both, and the design's §2.3.3.3 if the build proves a sentence there wrong.
- **Out of scope, HARD:** `config/write-ratchet-baseline.json` — **never edited, for any reason**; `scraper/scripts/merge-duplicate-ipos.ts` (the older PLURAL clustering tool, already baselined, its own job); any other write path; any deploy; any production write outside an explicitly approved `--apply` run.
- **Goal type:** a write-path change to the core table. **Tier A.**

## Context to read first

- `docs/design/data-sourcing-pull-model.md` §2.3.3.3 (the merge log, the unmerge command, the Notifier rule), §2.3.3.1 (why merges are automatic at all), §8.3 (why the baseline is never edited).
- `docs/design/build-cards/item-19-merge-tool-shared-write-path.md` — the card, which names the files and the line ranges.
- `scripts/check-write-ratchet.mjs` and the HEADER of `config/write-ratchet-baseline.json` — read the header, then leave the file alone.
- `packages/shared/src/repositories/ipo-repository.ts` `update()` / `delete()` — the shared path, already baselined, already invalidating Redis.
- `scraper/src/scripts/backfill-stuck-listing.ts` and `backfill-description-sector.ts` — two scripts that already construct `new IPORepository(db, redis)` from outside the main write path and are **not** in the ratchet baseline. That is the precedent to follow.
- `GLOBAL.md` §2 (Notifier), `.claude/rules/defect-fix-contract.md`, `.claude/rules/signal-ownership.md`.

## Pre-made decisions (the run must NOT pause on these)

1. **The tool moves to `scraper/src/scripts/merge-duplicate-ipo.ts`** and uses `new IPORepository(db, redis)`, following the two backfill scripts. A `.mjs` shim at the old path may remain for one release so a runbook does not break; it forwards and does nothing else.
2. **The whole merge is one `db.transaction()`** — the `ipos` write, the `field_sources` rows, the child-table re-points, the slug redirect and the merge-log insert. A merge that half-happens is worse than one that fails.
3. **The merge log is a table, not a file.** A JSON backup on the operator's laptop is not a rollback path for production.
4. **`unmerge` is a first-class command**, not a runbook. It restores both rows from the log, re-points the slug redirect, and is itself transactional.
5. **The Notifier post fires only for OPEN or UPCOMING IPOs**, at the moment of the merge, with both slugs and the merge id in the body.
6. Dry-run is the default; `--apply` is explicit; a prod `--apply` needs the owner's word on the day.

## Stages

### Stage A — route the write
- **Do:** move the tool, replace the raw `update`/`delete` with the repository calls, wrap in a transaction, keep every existing behaviour (FK-graph discovery, provenance, redirect) intact.
- **Acceptance:** `node scripts/check-write-ratchet.mjs` exits **0** with no baseline edit (`git diff --exit-code config/write-ratchet-baseline.json` is clean); the tool's dry run on staging prints the same plan as before the change, line for line.

### Stage B — the merge log
- **Do:** add the table (merge id, both row snapshots as JSONB with their `field_sources`, who/when/why, the redirect that was created), its migration, and the insert inside Stage A's transaction.
- **Acceptance:** a dry run shows the rows it WOULD store; an `--apply` on staging stores them; the snapshot round-trips to an identical row.

### Stage C — `unmerge`
- **Do:** `unmerge <merge-id>` restores both rows and re-points the redirect, transactionally, refusing when either row has been written since the merge (that is a conflict, not an undo).
- **Acceptance:** on staging, merge two rows then unmerge them; both rows and the redirect are byte-identical to their pre-merge state; the refusal path is tested with a deliberate post-merge write.

### Stage D — the Notifier post, tests, and the gates
- **Do:** the live-IPO Notifier post; unit tests for the transaction, the refusal and the redirect; the detection registry entry for the merge check.
- **Acceptance:** `npm run test:unit`, `web && npm run lint:ci`, `packages/shared && npx tsc` all exit 0; the ratchet exits 0; `node scripts/build-detection-registry.mjs --check` exits 0.

## Verification gates

| Gate | Here |
|---|---|
| Write ratchet | `node scripts/check-write-ratchet.mjs` exits 0 **and** `config/write-ratchet-baseline.json` is untouched. Both, every stage. |
| Supervisor verification | every worker return is reproduced at T0: re-run the gate, read the diff (`.claude/rules/supervisor-verification.md`) |
| Independent review | Tier A: a fresh reviewer with no part in the build, mutation-testing each new guard |
| Real-data proof | a merge and an unmerge performed on **staging**, with the before/after rows printed, then `node scripts/assert-repair-held.mjs <invariant> --cycles 2` — a clean read straight after a merge proves nothing about the next scraper cycle |
| Static | unit tests, `lint:ci`, `tsc` on `packages/shared` |

## Failure-recovery budget

Ten attempts per stage on a red gate, then DEFECTED with the failing check named, and move on. Never `--no-verify`. Never edit the baseline to make a gate pass — that is a hard halt and an owner escalation, not a recovery.

## Commit + push policy

One commit per stage, Conventional Commits (`fix(scripts):`, `feat(db):`), body says why. Branch → PR into `main`, opened not merged. The PR body states: the ratchet exit code before and after, that the baseline is unchanged, and the staging merge/unmerge proof lines.

## Definition of Done

- [ ] `check-write-ratchet.mjs` exits 0 with `config/write-ratchet-baseline.json` unchanged (`git diff --exit-code` proves it).
- [ ] The `ipos` write and delete go through `IPORepository`, inside one transaction with the child-table work, the redirect and the merge-log insert.
- [ ] The merge log stores both original rows whole, with provenance.
- [ ] `unmerge <merge-id>` restores both rows and the redirect, and REFUSES when a row has changed since the merge.
- [ ] A merge touching an OPEN or UPCOMING IPO posts to the Notifier with both slugs and the merge id.
- [ ] Tests for the transaction, the refusal, the redirect and the Notifier call; `npm run test:unit`, `lint:ci` and `tsc` green.
- [ ] A staging merge AND unmerge performed, with the before/after rows in the PR body, plus the two-cycle repair-held proof.
- [ ] PR open, not merged, naming PR #432 as the thing it unblocks.

## Guardrails (hard stops)

- `config/write-ratchet-baseline.json` is never edited. If a stage seems to need it, stop and escalate.
- No production write without the owner's word on the day.
- No change to `scraper/scripts/merge-duplicate-ipos.ts` (the plural tool) — it is a separate, already-baselined job named in §8.3.
- No deploy. This contract ends at an open PR.

## Authorization trail

| Fork | Decision | Why |
|---|---|---|
| Baseline vs routing | **route the write** | the baseline is shrink-only by its own header; grandfathering records that a one-off tool may write to `ipos` however it likes (OD-49, owner 2026-09-09) |
| Where the tool lives | `scraper/src/scripts/` | two backfill scripts already use `new IPORepository(db, redis)` from there and are not in the baseline — precedent, not invention |
| Transaction | one for the whole merge | a half-merged IPO is worse than a failed one |
| Merge log | a table, not a JSON file | a file on a laptop is not a production rollback path |
| Notifier | live IPOs only | a wrong merge on an OPEN IPO is visible to readers within the hour |

## References

- `docs/design/data-sourcing-pull-model.md` §2.3.3.1, §2.3.3.3, §8.3; `docs/design/build-cards/item-19-merge-tool-shared-write-path.md`
- `.claude/rules/{defect-fix-contract, signal-ownership, supervisor-verification, git-collaboration, branching-model}.md`
- `docs/ops/prod-ops-recipes.md` (staging reads), `GLOBAL.md` §2 (Notifier)
