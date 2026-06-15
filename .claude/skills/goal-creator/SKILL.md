---
name: goal-creator
description: >
  Authors a "goal contract" — the dense, zero-user-input markdown spec that Abhay
  feeds to the built-in `/goal` command, which then runs autonomously until its
  Definition of Done is met. Use this skill WHENEVER Abhay wants to CREATE, DRAFT,
  WRITE, or PUT TOGETHER a goal / goal contract / goal spec to hand to `/goal` —
  e.g. "create a goal to…", "draft a /goal contract for…", "make a goal that…",
  "write me the contract to feed /goal", "set up an autonomous goal", "new goal: …"
  — or describes a build / fix / migration / audit he wants `/goal` to run
  unattended, even if he doesn't say the word "skill". Interview-first: it grills
  Abhay one question at a time (each with a recommended answer) until every design
  fork is resolved, THEN writes the contract to docs/goals/YYYY-MM-DD-<slug>.md.
  It NEVER runs `/goal` and NEVER commits — those are Abhay's. This is contract
  *authoring*, not *execution*. Do NOT use it to: create an in-app FIRE / financial
  goal record (an app data entry with a target amount or year); execute or run an
  already-written contract (that is the `/goal` command itself, not this skill);
  review or critique an existing contract; directly build something when no
  contract was requested; or write a different artifact (a PRD → /to-prd, a GitHub
  issue → /create-github-issue).
type: workflow
allowed-tools: "Read Write Edit Grep Glob Bash"
argument-hint: "[one-line description of the goal, optional]"
version: "1.0.0"
---

# Goal Creator

## What this is

`/goal` is a built-in Claude Code command Abhay runs himself. You feed it a markdown
**contract** and it executes end-to-end with **zero user input** until the contract's
Definition of Done is met — possibly for hours. This skill's only job is to **author
that contract**. It does not run `/goal`, and it does not simulate it.

Because the `/goal` run is autonomous and long, **every design decision must be made
*before* the run starts**. A single unresolved fork baked into the contract becomes an
hours-long run that builds the wrong thing. That is why this skill is interview-first:
front-load the questions, resolve every branch, and only then write a contract in which
literally every decision is pre-made.

The canonical examples of the house format already live in `docs/goals/` — study them,
they are the spec for what you produce. The two best references are
`docs/goals/2026-06-14-gmp-coverage-revival.md` (a fix/migration contract) and
`docs/goals/2026-06-15-bse-ipo-enrichment.md` (a rebuild/enrich contract).

## The cardinal rules (read before anything)

1. **Never invoke `/goal`.** You author the contract and stop. Abhay runs `/goal` himself.
2. **Never commit.** You write the file and stop. Committing the contract is Abhay's call.
3. **Interview-first, always.** Resolve every fork via the Clarification Gate (STEP 2)
   before writing a single line of the contract. The output must be zero-user-input.
4. **Bake in the standing rules.** Every contract folds in the IPODhan verification rules
   (supervisor-verification, independent-test-verification, e2e-persistence-verification,
   output-plausibility-verification) + claude-behavior rules 15, 17, 20, 23, plus the
   failure-recovery budget block — see `references/baked-in-rules.md`. These
   are why these contracts produce *proven-working* results, not *claimed-working* ones.
5. **Default to a NEW contract file. NEVER edit a contract that may already be running.** A
   `/goal` run loads its contract at launch — editing a live contract is both useless (the
   in-flight run never sees the edit) and dangerous (a later re-run of the mutated file
   duplicates finished work). When Abhay asks to change/extend an existing goal, create a
   SEPARATE delta contract covering only the net-new work. Edit an existing contract in place
   ONLY when Abhay explicitly confirms it has never been run and is not currently running.
6. **Every contract is idempotent (no duplication across parallel sessions).** Its first
   action is a ledger-aware preflight — read the project's coverage/gap ledger + the code +
   `git log`, SKIP anything already done (verify-only, never rebuild), build only the missing
   delta, and report what was skipped. Parallel sessions are normal; no run may redo another's
   work. Paste the "§0.2 Preflight" block from `references/baked-in-rules.md` into every contract.

---

## STEP 0: Load context

Before interviewing, ground yourself so your recommended answers are real, not guesses.

1. **Read the two reference contracts** named above to refresh the exact house format,
   tone, and section set.
2. **Read `references/contract-template.md`** (the skeleton you will fill) and
   **`references/baked-in-rules.md`** (the standing-rules block you will paste).
3. **Recall the relevant project memory** — especially `feedback-goal-creator-workflow.md`
   (you author, Abhay runs in a separate session, you monitor), `deploy-requires-approval.md`,
   `detailed-plan-before-coding.md`, `vps-db-tunnel-setup.md`, and the project CLAUDE.md +
   `.claude/rules/`.
4. **Identify the target workspace + prod path early.** IPODhan is a monorepo:
   `web/` (Next.js, type-gated), `scraper/` (ESM/tsx, not commit-type-gated), and
   `packages/shared/` (schema SSOT — edit ONLY `packages/shared/src/db/schema.ts`). The
   DB is **prod Postgres reached via the SSH tunnel at `localhost:15432`** — local runs hit
   prod additively; **deploy is GATED** (no prod deploy without Abhay's OK). Verification
   gates must match: DB persistence is read-back via `node`+`pg` to the tunnel; UI is driven
   with Playwright MCP against the live/dev site. Mind the CWD: root proxies only
   dev/dev:scraper/lint/build/test:unit; the rest run from `web/`; scraper tests from `scraper/`.

If Abhay gave a one-line goal as an argument, use it to seed the interview — don't re-ask
what he already told you.

---

## STEP 1: Map the fork inventory

Before asking anything, privately enumerate every decision the contract must pin down.
This is the "enumerate before greenfield" discipline — surface the full inventory first,
then march through it. A complete contract resolves at minimum:

- **Mission** — the one-paragraph objective. What does "done" look like?
- **Target workspace + scope boundary** — `web/` / `scraper/` / `packages/shared/`; what
  files/dirs are in vs out; the boundary (IPODhan repo only — never write `5Wealths\`;
  schema only in `packages/shared/src/db/schema.ts`; scraper writes only via `data-persister`).
- **Type of goal** — fresh build, propagation/refactor, bug-fix loop, migration, audit.
- **Context-to-read-first** — the exact files/services/scrapers the run must study, with
  import paths and any gotchas (CWD: root vs `web/` vs `scraper/`; the tunnel `localhost:15432`).
- **Pre-made design decisions** — every design fork the run must NOT pause on. This is
  the bulk of the interview for build contracts. Each must be a decision, not a menu.
- **Stage breakdown** — how the work splits into stages, and the per-stage acceptance.
- **Verification gates** — the static gates (lint/build/tsc/test) for the workspace, plus
  the IPODhan named verification rules (supervisor-/independent-/e2e-persistence/output-plausibility)
  adapted to it (DB read-back via tunnel; Playwright MCP for UI).
- **Failure-recovery budgets** — per-task fix budget, MCP-hang recovery, hard-halt list.
- **Commit + push policy** — how many commits, message format, branch, push target,
  what NOT to stage (the working tree often has unrelated untracked items).
- **Definition of Done** — the checkbox list that gates completion.
- **Final report** — what the closing report must contain.
- **Guardrails** — the hard stops (no new deps, no design reinvention, honesty/no-fake-data,
  TODO(5W) boundary, etc.).

Some of these you can answer yourself by reading the codebase (STEP 0) — do that and
don't ask. Only the genuine forks go to the interview.

---

## STEP 2: Interview (Clarification Gate)

Grill Abhay **one question at a time**, each with an explicit **recommended answer**, until
you reach high confidence that every fork is resolved. This mirrors his prompt-auto-enhance
Clarification Gate and the way every good contract here was authored.

Rules for the interview:

- **One question per turn.** Never batch. Wait for the answer before the next question.
- **Always recommend.** Frame as "Should X be A or B? Recommended: A, because Y." Abhay
  often just confirms the recommendation — a good recommendation makes the interview fast.
- **Read code before asking.** If the codebase answers it, read it and state the answer as
  an assumption to confirm, rather than asking an open question.
- **Highest-leverage first.** Ask the fork that constrains the most downstream decisions
  first (usually: target tree → goal type → mission → scope → design decisions).
- **No upper limit, but no padding.** Keep going until confident; stop when confident.
  Don't invent questions to hit a count, and don't stop early at a comfortable point.
- **Track an authorization trail.** As each fork resolves, note the decision. The contract
  will include this trail (see the template's "Authorization trail" table) so the run — and
  Abhay later — can see what was decided and why.

When you believe the tree is resolved, **summarize the resolved decisions back to Abhay as
a final checkpoint** and get a go-ahead before writing. If new forks surface mid-write,
return to the interview — never paper over a gap with a guess.

---

## STEP 3: Confirm the output path

**First, the in-flight check (cardinal rule 5).** If this work extends or overlaps an
existing goal, determine whether that goal is running or has run:
- Ask Abhay, or infer from context (he said "I'm running it", a parallel session exists,
  the file has matching `feat(...)` commits in `git log`).
- **If it is running / has run → author a SEPARATE delta file. Do NOT edit the existing
  contract in place.** The delta covers only net-new work and relies on the §0.2 preflight
  (cardinal rule 6) to skip anything already done.
- Only edit an existing contract in place when Abhay explicitly confirms it has never been
  run and is not running.

Then derive a kebab-case slug from the mission and propose the path:

```
docs/goals/YYYY-MM-DD-<kebab-slug>.md
```

For a delta of an existing goal, make the slug make that explicit, e.g.
`docs/goals/YYYY-MM-DD-<base-slug>-delta.md`. Use today's date (get it with
`date +%Y-%m-%d` if unsure). Confirm the exact path with Abhay before writing — a one-line
confirmation, not a full question round.

---

## STEP 4: Write the contract

Fill `references/contract-template.md` with the resolved decisions. Then **paste the
standing-rules block** from `references/baked-in-rules.md`, adapting only the
workspace-specific mechanics (the right static-gate commands per CWD; DB persistence =
read-back via the `localhost:15432` tunnel; UI = Playwright MCP). Do not water the rules
down — adapt the *mechanics*, keep the *mandate*.

Quality bar for the contract you write (this is what separates a good contract from a
vague one):

- **Zero open questions.** Every design fork is a stated decision. The run must never
  need to ask Abhay anything. If you wrote "decide whether to…", you failed — go decide.
- **Concrete, not abstract.** Real file paths, real component/import names, real prop
  shapes, real commands with the right CWD. "Use the shared components" is weak; naming
  each component + its import + its props is strong. The reference contracts show the bar.
- **Verification is load-bearing, not decorative.** The IPODhan verification rules
  (supervisor-verification = drive the UI; e2e-persistence-verification = DB read-back via
  the tunnel; independent-test-verification + output-plausibility = blind re-check + substance)
  appear as MANDATORY per-task/per-stage gates with explicit pass criteria and the exact
  `node`+`pg` / Playwright-MCP calls — not a hand-wave. This is the entire reason the format exists.
- **Honest defaults.** No synthetic/fake data; remove fakery rather than carry it forward.
  Surface uncertainty as an explicit assumption in the contract, never as fiction.
- **Self-contained.** The run should not need to consult this skill or any chat history —
  everything it needs is in the contract (plus the rule files it names, which load
  transitively). List those references explicitly (see the template's References section).

Match the density and structure of `docs/goals/2026-06-15-bse-ipo-enrichment.md`. It is
long on purpose: length here buys an unattended run that builds the right thing.

---

## STEP 5: Stop — hand off, don't execute

Print, and then stop:

1. The path you wrote, e.g. `docs/goals/2026-05-29-<slug>.md`.
2. The ready-to-paste invocation line:
   ```
   /goal docs/goals/2026-05-29-<slug>.md
   ```
3. A one-line note: the contract is written but **not committed** — committing it is
   optional and yours to trigger, and **you run `/goal` yourself** when ready.

Do **not** invoke `/goal`. Do **not** `git add`/`git commit`. Do **not** start building.
The skill's deliverable is the contract file and the invocation line — nothing more.

---

## CRITICAL RULES

- **NEVER invoke `/goal` and NEVER commit.** Author the contract, print the invocation
  line, stop. (Memory: `feedback-goal-creator-workflow.md`.)
- **NEVER edit a contract that may be running — default to a new delta file.** Editing a
  live contract is ineffective (the run already loaded it) and causes duplication on re-run.
  Edit in place only when Abhay confirms the goal has never run and is not running.
- **Every contract opens with the §0.2 ledger-aware idempotency preflight** (read ledger +
  code + `git log` → skip done → build only the delta → report skips). No run duplicates
  another parallel session's work.
- **Interview-first, one question at a time, each with a recommended answer**, until every
  fork is resolved. The contract must be zero-user-input.
- **Every contract bakes in the IPODhan verification rules (supervisor-/independent-/
  e2e-persistence/output-plausibility) + claude-behavior rules 15, 17, 20, 23 + the
  failure-recovery budget block** (`references/baked-in-rules.md`), mechanics adapted to the workspace.
- **Match the house format** in `docs/goals/` and the skeleton in
  `references/contract-template.md`. Concrete paths/services/commands, never abstractions.
- **Resolve the target workspace first** — `web/` (Next.js, type-gated) vs `scraper/` (ESM)
  vs `packages/shared/` (schema SSOT) — and match the gates to it. DB is prod via the
  `localhost:15432` tunnel; deploy is GATED.
- **No open questions in the output.** "Decide whether to…" in a finished contract is a bug.
- **Honor the boundary contracts** the contract operates under (IPODhan repo only; never
  write `5Wealths\`; surface strategic items as `TODO(5W):`).
