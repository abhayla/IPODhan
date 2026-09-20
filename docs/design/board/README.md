# The board artifact and how it is kept current

The board is https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM — the page the owner and the team
read to see where the stage stands. It is a status surface, not a log.

**It is generated.** Nothing on the published page is typed into HTML. Run one command and publish
the output. That is the whole update procedure.

```bash
node scripts/ops/build-plan-board.mjs   # ONLY if a spec source changed (see below)
node scripts/ops/render-board.mjs       # always — writes docs/design/board/index.html
# then: Artifact publish, file_path=docs/design/board/index.html, url=<the board URL>
```

## Why it is generated, and what that fixed

Until 2026-09-20 the page was hand-maintained and `patch-plan.py` spliced new blocks into a saved
copy of the **live page**, asserting on that page's structure. Two failures followed from that one
design choice:

- **The renderer depended on its own output.** The 2026-09-20 restructure replaced both anchors
  `patch-plan.py` asserted on, so its next run would have died on an `assert`.
- **Hand-typed counts drifted.** The published page said "12 built, 12 partial, 5 not built" while
  the source said **16 / 10 / 3**. Items 18 and 22 had been re-measured as already BUILT (#848) and
  nobody retyped the tile. A reader trusted a number that was three items wrong.

`render-board.mjs` reads data files and emits the complete page. Counts are parsed from the
generated tracking section **per row**, so a verdict word appearing inside a row's evidence prose
cannot inflate them — a document-wide grep over the source markdown returns 31 verdicts for 29
items for exactly that reason.

## Files

| File | What it is | Who edits it |
|---|---|---|
| `board-data.json` | The hand-owned judgements: stamp, decisions waiting on the owner, environments, release + rollback, gates, reader impact, dependency chain, changed-since. | **You.** This is the file you edit. |
| `status.json` | The 16 stage-3 slice rows. | You, when a slice lands. |
| `board-prose.json` | The 10 explanatory sections (architecture, guardrails, the review, …). | Rarely — only when the plan itself changes. |
| `plan-sections.generated.html` | **Generated.** 29 build items + 63 owner decisions + 190 sourced fields. | Never by hand — `build-plan-board.mjs`. |
| `board.css` | The stylesheet, inlined into the page at render. | You, for design changes. |
| `index.html` | **Generated.** The page that gets published. | Never by hand. |
| `patch-plan.py` | Retired shim that names the new command. | — |

## The three tracking sections

`scripts/ops/build-plan-board.mjs` derives all three from their sources, so the page cannot drift
from the spec:

| Section | Rows | Source | Status derivation |
|---|---|---|---|
| Build items | 29 | `docs/design/pull-model-completion-state.md` | the verdict is IN the markdown; read, never recomputed |
| Owner decisions | 63 | `docs/design/data-sourcing-pull-model.md` | **all `unverified`** — implementation status is not mechanically knowable; the spec's own acceptance condition is shown instead |
| Sourced fields | 190 | `scraper/config/field-manifest.json` | class + ranked sources; "being written" is **`unmeasured`** (needs a DB read this deliberately does not do) |

Every count is asserted at both stages. A parse yielding anything but 29 / 63 / 190 exits non-zero
rather than emitting a short table — a tracker that silently drops rows looks authoritative and lies.

## The nine roles the page is built for

The owner's bar (2026-09-20): every role rates it above 9/10. Each block exists for a named role,
so an edit that removes one knows whose question it just broke.

| Role | The question they open the page with | The block that answers it |
|---|---|---|
| Owner | What needs a decision from me? | **Waiting on you** — first thing on the page, each with a recommendation |
| Product manager | What does a person using the site actually see? | **What a reader sees** — impact in plain language and rupees |
| Senior architect | What depends on what? | **The order the remaining work runs in** |
| Implementation | What do I pick up next? | **Next up** tile + the chain's first row |
| Delivery / PM | What moved since I last looked? | **Changed since `<date>`** |
| Deployment | What would a release contain, and how do I undo it? | **Release and rollback** |
| Environments | What is running where, with which flags? | **Environments** table |
| QA | Which gates ran, and which never ran? | **Gates and proofs** — names what has NEVER run, not just what is red |
| Data / domain | Are the published numbers right? | Reader impact, top row, stated as a wrong rupee figure |

`scripts/tests/render-board.test.mjs` asserts every one of those blocks is present (36 tests). A
refactor that drops the environments table fails the suite rather than silently failing a role.

## When to update — not on every merge

The owner's constraint (2026-09-20): *"do not use too much tokens to keep updating it — whenever
some stage crosses, then only update."*

**Update when a stage crosses:**
- a slice or build item changes verdict (queued → building → landed)
- an environment changes what it serves (a staging or prod deploy)
- a decision lands, or a new one starts waiting on the owner
- a gate changes state — especially one that has never run starting to run
- the reader-facing impact changes

**Do not update for:** an ordinary merge that changes no verdict, a docs commit, a CI re-run, a
review round that found nothing. The board is a status surface; a merge is not automatically a
status change.

## Landing checklist

When a stage crosses, in the same step you write the ledger row:

1. Read the clock: `date` (IST). Never type a stamp from memory.
2. Edit `board-data.json` (and `status.json` if a slice moved). Set `stamp` to that clock reading.
3. If a build item, an OD or a manifest field changed, edit that **source** file and run
   `node scripts/ops/build-plan-board.mjs`.
4. `node scripts/ops/render-board.mjs`
5. `node scripts/tests/render-board.test.mjs` — 36 tests, under a second.
6. Publish `docs/design/board/index.html` with `url` = the board URL. **Without `url` you create a
   second artifact and the owner's link goes stale.**

## Token cost

Updating the board never means reading the page. It is one edit plus one command; none of the 282
tracked rows or the 10 prose sections passes through a model. Reading this README and the header of
`render-board.mjs` is the whole context cost of knowing how to do it.

`node scripts/ops/render-board.mjs --check` exits 1 if `index.html` is stale — wired into CI so a
data edit that never got rendered cannot merge.

## The hook contract

`~/.claude/hooks/board-owed-guard.py` (user-level, wired in `~/.claude/settings.json`) makes the
checklist non-optional:

- **PostToolUse / Bash** — a `merge-if-current.mjs` or `gh pr merge` in an IPODhan checkout writes
  the marker `~/.claude/.board-owed.ipodhan`.
- **PostToolUse / Artifact** — a publish whose `url` names the board clears it.
- **Stop** — if the marker is still there, the turn is blocked with this checklist. A marker older
  than 12 h warns instead of blocking, so a dead marker cannot lock a session.

**A merge is not automatically a stage change.** The marker asks "did a stage cross?", and the
honest answer is often no — an ordinary merge that changed no verdict, a docs commit, a CI re-run.
The Stop message says so and names the escape: `rm -f ~/.claude/.board-owed.ipodhan`, with the
reason stated in the same turn. Clearing it silently disables a Tier A guard; clearing it with a
stated reason is the intended path.

**Known false positive (2026-09-20).** A marker was armed by a `cat > …board-artifact-paused….md`
heredoc — not a merge at all. The guard's statement-splitting fix (2026-09-19) stopped a *comment*
mentioning `gh pr merge` from arming it, but a heredoc whose BODY contains merge-ish text still
slips through, because the body is part of the same statement. The recorded `command` field in the
marker is what exposes it: read that field before assuming a merge happened.

Fail-open everywhere. Self-tests: `python ~/.claude/hooks/tests/board-owed-guard.test.py`.

**Live copy vs. versioned copy.** The hook that runs is the user-level file; `hooks/` here is the
versioned mirror for review. When the live copy changes, copy it here in the same change.

**Tier A review lesson (2026-09-19): the guard parses statements, not text.** The first version
matched a merge pattern against the raw command string, so a comment or a `grep` mentioning
`gh pr merge` armed the marker — proven live by the reviewer's own probe commands. The fix splits
the command into statements and only matches a statement that IS the merge invocation.
