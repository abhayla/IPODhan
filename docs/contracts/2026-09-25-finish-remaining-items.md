# Contract: finish the remaining pull-model items (delta of 2026-09-24)

**Executor:** /goal (owner-present session, Fable supervising)   ·   **Created:** 2026-09-25
**Supersedes the running work of:** `docs/contracts/2026-09-24-finish-pending-build-items.md`. That
file stays unedited; read it for every mechanic this contract does not restate.

**Mission.** Close the 11 items still PARTIAL in `docs/design/pull-model-completion-state.md`, in the
owner's order. Anything blocked or not progressing is PARKED, tracked, and left behind. The owner's
words (2026-09-25 01:20 IST): *"Do not spend more time on 957, whatever is blocking or not
progressing even after multiple tries. Leave it behind. Just track it … update them in the tracker so
that we do not forget them. But keep dragging them is not a good idea. First, focus on completing all
the pending ones."*

**The /goal line (type this in the new window; never the bare path):**

```
/goal Close every PARTIAL item in docs/design/pull-model-completion-state.md following docs/contracts/2026-09-25-finish-remaining-items.md. Complete ONLY when the final line of docs/contracts/.run/finish-remaining-items-PROGRESS.md is "ALL ITEMS CLOSED" and every item row on origin/main reads BUILT with a "Staging proof:" line, or states that its remainder is PARKED with an open issue number. Reading or complying with the contract is not completion. Waiting on the owner, a staging window or a market event is neither completion nor impossibility.
```

---

## §0 Start-of-run (in this order)

1. **Only one goal session may run.** Read the end of
   `docs/contracts/.run/finish-pending-items-PROGRESS.md`. The old session was told at 01:20 IST
   2026-09-25 to finish its in-flight work, write a run-end SUMMARY and stop. If its last entry is
   not that SUMMARY, the old session may still be running: ask the owner to close that window before
   building anything.
2. **Worktrees, reads and merges:** exactly as in the 2026-09-24 contract, §0.1 and Pre-made
   decisions 4–11. In short:
   - never edit or run anything in the main checkout;
   - use `wt-new.ps1` / `wt-rm.ps1`;
   - read origin/main with `MSYS_NO_PATHCONV=1 git show`;
   - merge with `node scripts/ops/merge-if-current.mjs <PR> > /dev/null 2>&1 && gh pr merge <PR> --squash`.
     Use `&&`, never `;`: on 2026-09-24 a `;` merged a PR the gate had refused.
3. **Preflight (idempotency).** For every item below, read its row on origin/main, the old SUMMARY,
   `gh pr list --state open` and `git worktree list`. Skip anything already done, and record the skip.
4. **Progress log:** `docs/contracts/.run/finish-remaining-items-PROGRESS.md` (gitignored). Stamp
   every line from `date` (IST), keep each line to 2 or fewer, and use the entry types STAGE,
   PROGRESS, DEFECT, DECISION, PARKED, BLOCKER, DONE.

## The PARK rule (new, from the owner; it overrides the 2026-09-24 contract's retry budget)

A piece of work is **PARKED** as soon as any of these is true:
- (a) two fix rounds failed on it;
- (b) a staging proof needs a real-world event (an IPO opening, a missed live slot in market hours, a
  new prospectus, a real duplicate) that has not happened within **2 market days** of the code being
  on staging;
- (c) it is blocked by something outside this contract's items;
- (d) it is the owner-parked #943 / #957 (slot never closes; see item 7).

Parking means doing all four of these, in the same turn:
1. an open GitHub issue, with label `parked`, holding the evidence and what is left;
2. a `PARKED (#NNN): <what is left>` sentence in that item's evidence cell in
   `pull-model-completion-state.md`;
3. a `PARKED` line in the PROGRESS log;
4. moving on.

Never keep a parked piece in a retry loop. The parked list is the tracker the owner will return to.

An item whose built part is proven on staging and whose remainder is PARKED stays **PARTIAL**, with
its PARKED line. Its verdict is **not** flipped to BUILT, because the tracker must stay honest. Its
work under this contract is still finished.

## Order (the owner's, 2026-09-25)

1. **Finish:** 3, 7, 9, 11, 19, 21, 22, cheapest proof first.
2. **Then complete the builds of** 6 and 10.
3. **Then** 17 and 32.

At most two builders at once, never on the same files. Tiers, models and brief lines are as in the
2026-09-24 contract (decision 2: `Budget:`, `Report: evidence-table`, `Core:`/`Proof:` or
`Class:`/`Proof:`, a spec citation, and a `Why Opus:` line for Opus).

## Owner delegation (in force since 2026-09-24 18:59 IST)

Where you would ask the owner, take your own recommendation **if it conforms to**
`docs/design/data-sourcing-pull-model.md`.
- Record it as an OD row in §0.0.1 with the quote *"owner delegation 2026-09-24: go with the
  recommendation if it conforms to the spec"*, plus a DECISION line.
- A **SPEC CHANGE** still goes to the owner (AskUserQuestion, with a `Spec basis:` line).
- Excluded from the delegation: production (never), destructive or irreversible operations, and
  opening the DB tunnel (ask once per day, in one line).
- Staging configuration flips are allowed for a named proof, e.g. `ENABLE_CLOSED_IPO_JOB` in staging
  `web.env.local` / the scraper environment. Each flip needs a timestamped `.bak` backup and a
  staging-only reload, and gets logged. The admin panel is already on on staging (owner, 2026-09-24
  23:38).

## Items: what is left and what closes each

Each row's current evidence cell on origin/main is the source of truth. The lines below are the
2026-09-25 01:15 IST reading.

**Item 3 (matrix / one source table)**
- Left: a Swap Test inside a live data slot on staging, using the item 3 card's procedure; the
  14:40 run on 2026-09-24 used a hand-set override before #968/#1005 landed.
- Also: re-run the item 3 repair dry run. Apply only if it finds rows. The "6,718 rows" figure in
  the row is from 2026-09-23 and stale; the 2026-09-24 dry run found 77 and they were applied.
- Close: `Staging proof:` line → BUILT.

**Item 7 (scheduler)**
- Left:
  - S4 opening-day check proof: the 09:40 IST staging run on a day an IPO opens logs its rows.
  - S5 price job proof: a market-hours staging run writes `current_price` for a listed IPO with the
    right series.
  - S2b proof: list scrapers run only in slots.
- **#943 / #957 (the data slot never logs "complete") is PARKED by the owner:** label it `parked` and
  write its PARKED sentence. Do not work on it.
- Delisting is its own issue (#983), outside item 7.
- Close: proofs → PARTIAL with the #943 PARKED line (see the PARK rule).

**Item 9 (re-read loop / corrigenda → admin suggestions)**
- Already proven 2026-09-25 00:49: veegaland-developers-ltd's stored corrigendum produced 1 admin
  suggestion.
- Left: an admin accepts one suggestion through the staging admin page, and the value lands with its
  provenance (the admin panel is enabled). Drive the page with browser automation, then read the
  written row back.
- Close: `Staging proof:` → BUILT.

**Item 11 (crore conversion)**
- The row owes nothing new. The 23:38 headless-Chrome proof on staging (label "₹ (rupees)", the
  under-₹10-crore warning) is logged but maybe not yet in the row.
- Verify against the card, add the `Staging proof:` line, flip to BUILT.

**Item 19 (merge tool / unmerge)**
- Left: unmerge a merge made after migration 0058 on staging. A dry run is enough.
- If no post-0058 merge exists within 2 market days, PARK the proof piece (rule b).

**Item 21 (read side)**
- Left: the missed-slot admin alert fires on a real missed slot in market hours. It's an event; rule
  b applies.
- The read-date line is already proven on staging (armee-infotech, 22:38).

**Item 22 (documents and download limits)**
- Left:
  - #806, the real-network staging proof.
  - A zip-member proof with `membersStored > 0` on a zip that has an unread member. The 00:45 run
    stored 0, which proves nothing.
  - The OCR-page-loses-a-disagreement rule: building since 00:50 under the 00:53 delegation
    decision; finish or park.
- **Check against the spec:** "a CORRIGENDUM extractor" is probably superseded by OD-90 (corrigenda go
  to the admin suggestion queue). If OD-90 covers it, correct the row. If not, it is a SPEC question
  for the owner.

**Item 6 (pull walk)**
- Left:
  - #1010 / #993: `ipos` rows written from a filing name their document. It was in fix round 2 at
    handover; the old session finishes or drafts it.
  - #998: stuck-reopen detection.
  - #762: 12,480 parked plan rows (the fix #763 is merged). Measure what is still parked on staging.
  - The GMP walk proof: a live walk re-asking `gmp_records.gmp`.
  - A new prospectus reopening a receipted field. It's an event; rule b applies.
- Note (measured 01:01): of the 264 NO_DOCUMENT_PROVENANCE rows, 213 are fields no source ever wrote
  and 51 are owned by Chittorgarh. That is honest absence, not a defect to chase.

**Item 10 (verification checks)**
- Left: the nightly detection floor runs the new checks (pull_noblank, pull_frozen, t_source_local_time_shift, …).
  Read one night's floor output for them: each ran, and each PASS/FAIL is explained by identities.
- `zip_member_rows` follows item 22 (or is parked with it).

**Item 17 (closed-IPO job)**
- After 6 and 10, flip `ENABLE_CLOSED_IPO_JOB` on staging (a config flip under the delegation, with a
  backup).
- Read a real 22:00 IST night: the picked IPOs, DONE/PARTIAL with cause classes, and no zero-work
  DONE.
- Close: `Staging proof:` → BUILT.

**Item 32 (status line on every card)**
- Last. Resolve each of the 10 `unknown` cards to DONE or NOT STARTED from their item verdicts. Then
  make `check-build-cards.mjs` refuse `unknown` outright, and empty `UNKNOWN_ALLOWED`.
- Close: BUILT.

## Deferred (do not work these; they are the owner's later "IPO fine-tuning" list)

#928, #932, #933, #936, #938, #947, #951, #954, #979, #983 (delisting), #1002, #1003, plus everything
labelled `parked`.

## Verification, board, findings

- As in the 2026-09-24 contract: the supervisor reproduces every gate and reads every diff. Tier A /
  B reviewers are fresh agents. Every done / merged / proven claim ends with an evidence table.
- **A proof must be able to fail.** "It ran" or "0 stored" is not proof. Name the counter that moved,
  with identities.
- **Board:** republish only on a verdict change or when staging's served commit changes. If the
  publish is refused because a newer version exists, re-read it and merge. Clear the marker only when
  no stage crossed and the last publish is under 24 h old.
  Board: https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM
- **Findings:** the next F-id goes to `docs/design/findings.json` plus a spec cite, and defect classes
  to `docs/reviews/failure-classes/`, in the same turn.
- **Migrations:** two open PRs claiming the same number means the second to merge renumbers it.
  Rule-index churn (spec wording edits retire and mint rule ids) means moving card claims in the same
  PR.
- **Never production.** Staging deploys use the 13:30 / 21:30 IST windows, plus the manual button, at
  most 2 a day, with the reason logged.

## Definition of Done

- [ ] Every one of the 11 rows is either BUILT with a passing `Staging proof:` line, or PARTIAL with
      each unfinished piece in a `PARKED (#NNN)` sentence, and each of those issues open and labelled
      `parked`.
- [ ] #943 / #957 carries the `parked` label and a PARKED sentence in item 7's row.
- [ ] Zero production deploys or production writes. Every owner or delegated decision is an OD row.
- [ ] The board is republished at the last verdict change.
- [ ] PROGRESS ends with `ALL ITEMS CLOSED`, followed by a list of the PARKED issues (the tracker for
      the owner's return).

## Authorization trail

| Fork | Decision | Why |
|---|---|---|
| Keep fixing #957, or park it | Park, track, move on | Owner, 2026-09-25 01:20 IST |
| Anything else stuck | PARK rule (2 rounds / 2 market days / outside blocker) | Owner: "keep dragging them is not a good idea" |
| Order | 3, 7, 9, 11, 19, 21, 22 → 6, 10 → 17, 32 | Owner, 2026-09-25 |
| Old session vs new | New session; the old one winds down first | Owner: the old window is compacted many times |
| Parked item's verdict | Stays PARTIAL with a PARKED line | Honest tracker; the owner returns to it |
