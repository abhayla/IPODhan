# Baked-in rules block (paste into every IPODhan contract)

This is the standing-rules block every `/goal` contract carries. Paste it into the
contract's "Verification gates" section (STEP 4), then adapt **only the mechanics** to the
target workspace (see "Workspace-specific mechanics" at the bottom). Keep the mandate intact —
the whole reason these contracts produce proven-working results is that the verification
gates are non-negotiable, not advisory prose.

The named rules live in `.claude/rules/`. The contract names them so they load transitively.

---

## §0.2 Preflight — read what is already done FIRST (idempotency · NO duplication)

Paste this as the contract's first numbered section (before any stage). It makes the
contract safe to run at any time, even while a parallel session implements part of it.

> **This is the first action of the run, before ANY stage. Non-negotiable.** A parallel
> session may already have implemented part of this contract. This contract must be **safe to
> run at any time without redoing finished work.**
>
> 1. **Read the project's state-of-record** — the relevant `memory/*.md` notes (the SSOT for
>    what's already done across sessions), the prior `docs/goals/.run/*-PROGRESS.md`, and any
>    issue/ledger named in the contract.
> 2. **For every item in this contract, check the code + `git log` + a live tunnel DB read
>    before building it.** If it is already done (grep/read to confirm — don't trust a memo
>    blindly; scan `git log --oneline -25` + the relevant branch), **SKIP the build** — do a
>    verify-only pass and move on. If partially done, build only the missing delta.
> 3. **Record every skip** in the final report's "skipped (already covered)" list.
>
> This makes the contract **idempotent**: a re-run after partial progress produces only the
> remaining delta — never a duplicate.

---

## Process bar (carry forward verbatim)

> **All rules in `.claude/rules/` are operative for this run.** The gates below are called out
> because they are the load-bearing ones for an autonomous `/goal` run. **G-UI, G-PERSIST, and
> G-INDEPENDENT are MANDATORY at every task AND every stage boundary** (a standing Abhay
> mandate). Do not skip, soften, or defer them. They are why this contract yields
> *proven-working* output, not *claimed-working* output.

---

## The named gates

### G-UI — drive the running app (per UI-changing task, MANDATORY) — `supervisor-verification.md`

For any change that alters rendered UI, verify by DRIVING the app, never by code inspection.
Self-heal: if the dev server isn't up, start `npm run dev` once in the background (capture the
PID), wait for port 3000, then drive **Playwright MCP** against the affected route:
`browser_navigate` → `browser_take_screenshot` → `browser_snapshot` (ARIA) → `browser_console_messages`.
**Pass = all three:** (a) the intended element/value is visible in the screenshot; (b) present in
the ARIA snapshot; (c) **no NEW console errors** from the change. ≤3 iterations → `/fix-loop` →
`/systematic-debugging`. MCP unavailable after self-heal → "UI verification skipped because
<reason>", mark `completed (deferred — G-UI)`; never claim complete.

### G-PERSIST — write→persistence verification (per DB write, MANDATORY) — `e2e-persistence-verification.md`

After any write (scraper run, backfill, applied migration), confirm it persisted — exit code /
"it ran" do **not** count. Two signals: (1) the run's count/log reflects the write; (2)
**independent DB read-back via `node`+`pg` to `localhost:15432`** confirms the row/column
shape+values. For multi-row loops verify **per batch**, then a final coverage query. ≤3 attempts
→ `/fix-loop`. Degrade → "persistence verification skipped because <reason>"; never claim complete.

### G-INDEPENDENT — post-stage independent + substance verification (ALWAYS fires) — `independent-test-verification.md` + `supervisor-verification.md` + `output-plausibility-verification.md`

After a stage is otherwise green, re-verify with FRESH eyes BEFORE marking complete: **reproduce
the gate** (re-run the exact lint/test/coverage command — never trust a reported exit code) AND
**inspect substance** (is the value domain-sane on the DEFAULT path — money/dates/sizes/rates not
absurd?). Sibling-sweep the same output class. 3 reconcile cycles → `/systematic-debugging`;
unresolved → log DEFERRED, proceed with state noted — never silently mark green.

### Rules 15 / 17 / 20 / 23 (`.claude/rules/claude-behavior.md`)

- **15** — test failures → use the skills (`/fix-loop`, `/systematic-debugging`); no ad-hoc retrying.
- **17** — no laziness; fix the root cause, not a band-aid.
- **20** — epistemic honesty; no synthetic/fake data; surface `**Assumption:** X` / `**Unverified:** X`, never fiction. Remove existing fakery rather than carry it forward.
- **23** — standing directive; keep going through the full DoD; context-budget anxiety is NOT a stop condition.

---

## Failure-recovery budget block (carry forward verbatim, tune the numbers per goal)

- **Per-task fix budget:** ~15 attempts (≈5 inline → `/fix-loop` → `/systematic-debugging`)
  → then DEFER the task and continue; do NOT halt the whole run.
- **MCP browser hang recovery:** 3 cycles — (1) wait 10s + retry; (2) `browser_close` + re-navigate;
  (3) kill the background dev server (captured PID) + restart + retry. All 3 fail → log DEFERRED +
  mark `completed (deferred)` + continue.
- **Tunnel recovery:** if `localhost:15432` drops, re-establish:
  `ssh -i ~/.ssh/ipodhan_vps -N -L 15432:127.0.0.1:5432 administrator@103.118.16.189`.
- **Hard halt ONLY:** `npm install` failure; a decision contradiction inside the contract; an
  irrecoverable build break after the full fix budget; an OS permission denial; a missing
  required token/credential or a dead tunnel that won't re-establish. Context-budget anxiety is
  NOT a halt — hand off via a one-line continuation note in the PROGRESS file, never fake-complete.

---

## Conditional gating (for fix/process contracts where not every task touches UI/DB)

| Gate | Trigger | Behavior on skip |
|---|---|---|
| **G-INDEPENDENT** | **ALWAYS fires** | n/a — non-skippable |
| **G-UI** | diff touches `web/` UI (page/component) | commit msg: `G-UI skipped: no UI change` |
| **G-PERSIST** | task writes to the DB (scraper/backfill/migration) | commit msg: `G-PERSIST skipped: no write` |

If a fix produces a surprise change to product/write-path code, the gates fire even when expected to skip.

---

## Workspace-specific mechanics (adapt these, keep the mandate)

| Concern | `web/` (Next.js, port 3000) | `scraper/` (ESM/tsx) | `packages/shared/` |
|---|---|---|---|
| Static gates (CWD) | root: `npm run lint && npm run build`; `cd web && npx vitest run tests/unit` (type-gated at commit) | `cd scraper && npx vitest run tests/unit/...` (NOT commit-type-gated) | `cd packages/shared && npx tsc && test -f dist/db/schema.d.ts` (compile FIRST) |
| G-PERSIST signal | `node`+`pg` read-back to `localhost:15432` (tunnel) | same | schema = edit ONLY `src/db/schema.ts`; `db:generate` from `web/` |
| Write path | repositories via `BaseRepository`; never the apiClient in Server Components | ALL scraped writes via `data-persister.upsertIPO`; new fields in `field-priority-matrix.ts`; flag-gate new behavior | n/a |
| Prod path | DB is prod via the `localhost:15432` tunnel; **deploy is GATED** (no prod deploy without Abhay) | scraper runs locally against prod via tunnel (`DATABASE_URL='…@localhost:15432/ipodhan'`, additive) | — |
| Boundary | IPODhan repo only; never `5Wealths\`; secrets stay in `.env` (prod DB password is the known-leaked one — never echo/commit) | same | same |

There is one app (not three trees). The tunnel + the GATED deploy are the two facts every IPODhan contract must encode.
