# Contract template (house format)

Fill every `<…>` placeholder with a resolved decision. Delete sections that genuinely
don't apply (e.g. a pure process/loop contract has no "design decisions" stage), but
never leave an open question. The two live references this skeleton is distilled from:

- `docs/goals/2026-06-15-bse-ipo-enrichment.md` — a rebuild/enrich contract
- `docs/goals/2026-06-14-gmp-coverage-revival.md` — a fix/migration contract

Match their density. Long is correct — length buys an unattended run that does the right thing.

---

```markdown
# GOAL — <one-line title of what this run achieves>

**Type:** Autonomous <build | propagation | fix-loop | migration | audit> contract
(run via `/goal`). Execute end-to-end with **zero user input**. Every design decision is
pre-made below — do not pause to ask; make the call the contract specifies and keep going
until the Definition of Done is fully met.

**Owner:** Abhay · **Created:** <YYYY-MM-DD> · **Scope:** `<app tree / dir>` ONLY
**Invocation:** `/goal docs/goals/<YYYY-MM-DD-slug>.md`

---

## 0. Mission

<One tight paragraph: the objective and what "done" looks like. State whether this is a
fresh build vs a propagation/refactor vs a fix loop, and the one non-negotiable outcome.>

---

## 0.2 PREFLIGHT — read the coverage ledger FIRST (idempotency · NO duplication)

← PASTE the "§0.2 Preflight" block from `references/baked-in-rules.md` HERE, naming this
project's actual coverage/gap ledger doc. This is the run's FIRST action, before any stage.
It makes the contract safe to run while a parallel session implements part of it: read the
ledger + code + `git log`, SKIP anything already done (verify-only), build only the delta,
and report skips. (Omit only for a true greenfield goal with no prior/parallel work.)

---

## 1. Context you need (read first)

<The exact files / components / stores / composables the run must study, with import
paths. Include any gotchas — e.g. the CWD (root vs `web/` vs `scraper/`), the `localhost:15432`
tunnel, the scraper write-path. Use a table for thing → path → why when there are many.>

| Thing | Path / import | Why it matters |
|---|---|---|
| <…> | <…> | <…> |

**Gotchas:** <CWD, persistence key shape, ports, anything that silently misfires.>

---

## 2. STAGE <A> — <name>

**File(s):** `<path>` (<create | rewrite | edit>). **Keep untouched:** `<files the run
must NOT touch>`.

### Pre-made design decisions (do NOT deviate)

1. <Decision, stated as a fact — not a menu. Repeat for every fork: layout, data source,
   props, colors, copy, empty-state, edit/add flow, etc.>
2. <…>

### <Stage> acceptance (run the §<N> gate sweep before committing this stage)
- <Concrete, checkable acceptance criteria.>
- **Stage gate sweep:** static → G-PERSIST (if DB writes) → G-UI (if UI) → G-INDEPENDENT
  (always). All green or DEFERRED-with-reason before the stage's commit.

<Repeat STAGE B, C, … as needed.>

---

## <N>. Verification gates  ← PASTE references/baked-in-rules.md HERE, adapted to the workspace

<Insert the standing-rules block. Adapt only the mechanics to the target workspace:
- static-gate commands + the CWD they run from (root / `web/` / `scraper/` / `packages/shared/`);
- G-PERSIST = DB read-back via `node`+`pg` to the `localhost:15432` tunnel;
- G-UI = Playwright MCP against port 3000.
Keep the mandate intact — do not soften G-UI / G-PERSIST / G-INDEPENDENT.>

---

## <N+1>. Commit + push

<Number of commits and their boundaries. Conventional-commit messages (the right scope
prefix — e.g. `feat(scraper): …` / `fix(web): …`). What to stage (NEVER `git add -A` — name
the files; a stray `gmp-staleness-header.png` exists). Feature branch + DRAFT PR; never merge
to main or deploy (GATED). Co-author trailer.>

---

## <N+2>. Definition of Done (all MUST be true)

**Build / change:**
- [ ] <…>

**Static gates:**
- [ ] type-check 0 errors · unit tests no regression · build succeeds <+ bundle budget if any>.

**G-UI (per UI screen, if any):**
- [ ] Playwright MCP: screenshot + ARIA snapshot + console_messages pass; intended value visible; zero NEW console errors.

**G-PERSIST (per DB write):**
- [ ] dual-signal: the run/log reflects the write AND `node`+`pg` read-back to `localhost:15432` confirms expected shape/values.

**G-INDEPENDENT (every stage):**
- [ ] gate reproduced (re-ran the command, not trusted exit code) AND substance is domain-sane on the default path; sibling-swept.

**Ship:**
- [ ] <N> conventional commits pushed to `<branch>`.
- [ ] Any deferrals logged in `docs/goals/.run/<slug>-DEFERRED.md` with rule status + reason.

---

## <N+3>. Final report (required on completion)

Produce a closing report containing: commit SHAs + per-stage gate results; G-UI verdict
per screen + screenshot paths; G-PERSIST verdict per write path (with read-back values);
G-INDEPENDENT result; coverage before/after if relevant; the §GATE list awaiting Abhay
(deploy/migrations); skipped (already-covered) list; DoD tally; DEFERRED entries with reason.

---

## <N+4>. Guardrails (hard stops)

- **<tree> only.** Never write outside it; never write `D:\Abhay\VibeCoding\5Wealths\`.
- **No new dependencies** unless the contract explicitly authorizes one.
- **No design reinvention** — reuse the named shared components; extend over inline.
- **Honesty:** no synthetic/fake data — remove fakery rather than carry it forward.
- **Stop only on a true blocker** (missing token, OS denial, decision contradiction in this
  contract, irrecoverable build break after the full fix budget). Context-budget anxiety is
  NOT a blocker — hand off via a one-line continuation note, never fake-complete.
- **Strategic items are `TODO(5W):` notes**, not handled here — repo-level work only.

---

## Authorization trail

| # | Decision | Choice |
|---|---|---|
| 1 | <fork> | <resolved choice> |
| … | <…> | <…> |

---

## References (loaded transitively by the skills this contract invokes)

- `.claude/rules/claude-behavior.md` — rules 15, 17, 20, 23
- `.claude/rules/supervisor-verification.md` · `independent-test-verification.md` · `e2e-persistence-verification.md` · `output-plausibility-verification.md` — the G-UI / G-PERSIST / G-INDEPENDENT gates
- `.claude/rules/tdd-rule.md` — red-green-refactor (if the contract does TDD)
- <the workspace rule files relevant to this goal — e.g. `scraper-write-path.md`, `scraper-test-layout.md`, `schema-imports.md`, `shared-package-build.md`, `web-data-access.md`, `react-nextjs.md`>
- <the skills this contract drives: /fix-loop, /systematic-debugging, /auto-verify, /backfill-script, /playwright, etc.>
```
