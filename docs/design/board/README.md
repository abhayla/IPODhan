# The board artifact and how it is kept current

The board is https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM — the page the owner reads to
see where the stage stands. It is the owner-facing status surface, not a log.

Until 2026-09-19 the tooling that rewrote it lived only in per-session scratchpads (five stale
copies), and `patch-plan.py` hard-coded one session's path. That is why the owner had to ask for
an update three times (2026-09-10, 09-17, 09-19). The tooling now lives here.

## Files

| File | What it is |
|---|---|
| `status.json` | The data: `stamp`, the `now` three-line summary, and one row per slice. **This is the file you edit.** |
| `status.css` | The styles the status section depends on; already inside the published page. |
| `body-fixes.json` | Idempotent prose corrections applied on each render. |
| `plan-sections.generated.html` | **Generated — never hand-edit.** The three tracking sections (29 build items, 63 owner decisions, 190 sourced fields), built by `scripts/ops/build-plan-board.mjs` from their sources. |
| `patch-plan.py` | Re-renders the status section AND splices the generated tracking sections into a saved copy of the page. |

## The three tracking sections (owner ask, 2026-09-20)

> "Every feature from the spec should be tracked in this artifact so that we do not miss anything.
> And I always see what is the current status. It should be user friendly and updated without
> consuming too many tokens."

`scripts/ops/build-plan-board.mjs` derives all three lists from their sources, so the page cannot
drift from the spec:

| Section | Rows | Source | Status derivation |
|---|---|---|---|
| Build items | 29 | `docs/design/pull-model-completion-state.md` | the verdict is IN the markdown; read, never recomputed |
| Owner decisions | 63 | `docs/design/data-sourcing-pull-model.md` (`OD-*` rows) | **all `unverified`** — implementation status is not mechanically knowable; the spec's own acceptance condition is shown instead |
| Sourced fields | 190 | `scraper/config/field-manifest.json` | class + ranked sources from the manifest; "being written" is **`unmeasured`** (needs a DB read this generator deliberately does not do) |

Every count is asserted. A parse yielding anything other than 29 / 63 / 190 exits non-zero rather
than emitting a short table — a tracker that silently drops rows looks authoritative and lies.

**Token cost.** Updating the board does not mean reading the 52KB page. A status change is one line
in one source file plus `node scripts/ops/build-plan-board.mjs`; none of the 282 rows passes through
a model. `--check` fails if the committed generated file is stale.

Tests: `node scripts/tests/build-plan-board.test.mjs` (13 tests — count assertions fire, malformed
rows are caught not skipped, no unescaped `<` reaches the output).

## Landing checklist — same step as the ledger line

Whenever a slice lands (merged, proof read, gate PASS), in the SAME step you write the ledger row:

1. Read the clock: `date` (IST). Never type a stamp from memory.
2. Edit `docs/design/board/status.json` — set `stamp` to that clock reading, update the changed
   slice row (`state`, `status`, `pr`, `sha`, `review`, `proof`, `gate`) and the `now` block.
3. Save the live page: `Artifact` `read_file` with `url` = the board URL and `path` = `index.html`.
3b. If a build item, an OD row or a manifest field changed, edit that SOURCE file and re-run
   `node scripts/ops/build-plan-board.mjs` (commit the regenerated file).
4. Render: `python docs/design/board/patch-plan.py --html <that saved index.html>`
   (writes `<html>.patched.html`; `--out` overrides).
5. Republish: `Artifact` publish with `file_path` = the patched html AND `url` = the board URL.
   Without `url` you create a second artifact and the owner's link goes stale.

## The hook contract

`~/.claude/hooks/board-owed-guard.py` (user-level, wired in `~/.claude/settings.json`) makes the
checklist non-optional:

- **PostToolUse / Bash** — a `merge-if-current.mjs` or `gh pr merge` command in an IPODhan
  checkout writes the marker `~/.claude/.board-owed.ipodhan`.
- **PostToolUse / Artifact** — a publish whose `url` names the board clears the marker.
- **Stop** — if the marker is still there, the turn is blocked (exit 2) with the checklist above.
  A marker older than 12 h warns instead of blocking, so a dead marker cannot lock a session.

Fail-open everywhere: any error exits 0 and appends one line to
`~/.claude/.board-owed-guard.errors.log`. It never fires outside an IPODhan checkout.
Self-tests: `python ~/.claude/hooks/tests/board-owed-guard.test.py`.

**Live copy vs. versioned copy.** The hook that actually runs is the user-level file at
`~/.claude/hooks/board-owed-guard.py` (wired in `~/.claude/settings.json`, outside this repo by
design — user-level hooks are not checked in). `hooks/board-owed-guard.py` and
`hooks/tests/board-owed-guard.test.py` in this directory are the versioned mirror: how the
mechanism is reviewed, diffed and PR'd. When the live copy changes, copy it here in the same
change so the two never drift.

**Tier A review lesson (2026-09-19): the guard parses statements, not text.** The first version
matched a merge pattern against the raw command STRING, so a comment, an `echo`, or a `grep`
mentioning `gh pr merge` or `merge-if-current.mjs` armed the marker — proven live, during the
review itself, by the reviewer's own probe commands. The fix splits the command into statements
(on `;`, `&&`, `||`, `|`, `(`, and newlines) and only matches a statement that IS the merge
invocation, never one that mentions it. The same round also stopped a FAILED merge attempt from
arming the marker (a merge that never happened owes nothing) and added flags-before-the-PR-number
parsing and a `session_id` on each marker record.
