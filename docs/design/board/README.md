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
| `patch-plan.py` | Re-renders the status section into a saved copy of the page. |

## Landing checklist — same step as the ledger line

Whenever a slice lands (merged, proof read, gate PASS), in the SAME step you write the ledger row:

1. Read the clock: `date` (IST). Never type a stamp from memory.
2. Edit `docs/design/board/status.json` — set `stamp` to that clock reading, update the changed
   slice row (`state`, `status`, `pr`, `sha`, `review`, `proof`, `gate`) and the `now` block.
3. Save the live page: `Artifact` `read_file` with `url` = the board URL and `path` = `index.html`.
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
