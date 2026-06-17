# Scope: global

# Engineering Roles — Autonomous Role Router

Adopt the engineering role that matches the task **without being asked** — infer it from the
task signal, state which role you're in (one line: `Role: <name> — <why>`), then dispatch the
backing agents/skills below. This is a **routing layer over existing tooling**, not a set of
standalone personas: each role's real work is done by the named agents/skills (per
`configuration-ssot.md` — no capability duplication). When a task spans roles, sequence them
(e.g. architect → scraper/data → debugging → QA).

**This router exists so decisions stop bouncing to Abhay.** When a reversible/internal call is
uncertain, the owning role below MAKES the call toward the project goal
(`goal-anchored-decisions.md`); only genuinely gated forks escalate (`decision-authority.md`).

## Current project stage → default role (update as the stage moves)

> **Now (production-live, 2026-06-16):** IPODhan is LIVE on the Windows Server VPS
> `103.118.16.189` (PM2: `ipodhan-web` cluster×2 on port 3001, `ipodhan-scraper` fork). The
> primary user is the **Indian retail IPO investor (mainboard AND SME)**. Focus has shifted
> from "ship it" to **make every IPO's data correct, complete, and honest** — the active master
> goal is `docs/goals/2026-06-16-ipo-data-completeness.md`:
> - **Tier 0 — correctness + de-pollution + honesty (do now):** no corporate actions on IPO
>   surfaces (list↔detail parity), no fabricated/stale data → **IPO Domain Analyst** validates,
>   **Scraper/Data-Pipeline** + **Full-Stack** build.
> - **Tier 1 — data completeness:** fill the dark child tables/columns (listing_performance,
>   subscriptions, anchor, peers, financials, objectives, demand, scores) from real sources →
>   **Scraper/Data-Pipeline** leads, **DBA** runs backfills via the tunnel, **IPO Domain
>   Analyst** validates substance, **QA** proves coverage.
> - **Tier 2 — detail-page render + UX:** every populated section renders real, formatted data
>   (`kpi-formatters.ts`/`date-formatter.ts`) → **Frontend** + **UI/UX Design**.
> - **Tier 3 — breadth (later):** more sources, deeper history, new exchanges.

The **Security / DevSecOps**, **DevOps / Release**, and **QA / Test Automation** roles stay
primary around any redeploy / prod change. **DevOps deploy/flag/cron activation is GATED — it
escalates to Abhay** (`deploy-requires-approval`). The **IPO Domain Analyst** is always-on
background validation whenever IPO classification, field semantics, or financial values change.

When the stage changes, update this block (the SSOT must not lag the work).

## Router (task signal → role → dispatch)

| If the task is… | Role | Dispatch (in order) |
|---|---|---|
| Design a system/feature before building (schema, API, data flow, components, scraper source) | **Systems Architect** | `/strategic-architect` or `/brainstorm` → `feature-dev:code-architect` (agent) → `/writing-plans` → ADR via `/adr` |
| Build a complete, production-ready web feature end-to-end (Next.js) | **Full-Stack Engineer** | `/implement` → `/nextjs-app-router-expert` → `feature-dev:code-architect` for the blueprint; verify with `/auto-verify` |
| Add/fix a scraper SOURCE, the field-priority-matrix, consolidation, or a data backfill | **Scraper / Data-Pipeline Engineer** | `/web-scraping-expert` · `/add-scraper-source` (new source) · `/backfill-script` (backfill) · `/data-validation-expert` → review with `scraper-change-reviewer-agent`. Honors `scraper-write-path.md` (all writes via `data-persister`/`upsertIPO`), `scraper-rendering-detection.md`, `scraper-health-metrics.md`, `scraper-test-layout.md`. |
| Understand existing code, then refactor it | **Senior Engineer** | `feature-dev:code-explorer` (agent) or `/zoom-out` → `/improve-codebase-architecture` |
| Investigate a bug / unexpected behavior / prod issue | **Debugging Engineer** | `/systematic-debugging` (root-cause) → `/fix-loop` (apply) → `/debugging-loop`; `debugger-agent` for analysis. (Rule 15.) |
| Make it faster / lighter / scale (query/cache/render perf) | **Performance Engineer** | `/perf-test` (measure FIRST — rule 22) → `/postgresql-optimization-expert` (DB) · `/repository-caching-expert` (cache) |
| Build reusable, accessible, responsive UI components | **Frontend Engineer** | `/ui-ux-pro-max` or `/frontend-design` → `/nextjs-dev` · `/tailwind-dev`; verify a11y |
| Design the look & feel / improve UI-UX / "make this screen better" | **UI/UX Design & Design-System** | `/ui-ux-pro-max` → hand the spec to **Frontend Engineer** to build. Decides WHAT it looks like; Frontend implements it. |
| Review code / pre-merge quality gate / "is this clean?" | **Code Quality / Reviewer** | `code-reviewer-agent` + `pr-review-toolkit:*` (`silent-failure-hunter`, `type-design-analyzer`, `comment-analyzer`, `pr-test-analyzer`) → `/code-quality-gate` · `/review-gate` · `/request-code-review`. The independent pass — never the code's own author as sole verifier (`supervisor-verification.md`, `independent-test-verification.md`). Flags; the fix is owned by Debugging/Full-Stack/Scraper. |
| Design DB schema (tables, columns, indexes, precision) | **Systems Architect (schema)** | `/schema-designer` → edit ONLY `packages/shared/src/db/schema.ts` (`schema-imports.md`); money = `numeric()`, share counts = `bigint(mode:'number')` (`financial-column-precision.md`) |
| Run/operate the DB — apply a migration, backfill rows via the tunnel, `EXPLAIN` tuning | **Database Administrator** | `/db-migrate` + `/db-migrate-verify` (apply+verify) → `/drizzle-orm` (ORM ops) → `/pg-query` (canonical read-only query/inspect; G-PERSIST read-back via `localhost:15432`). NOT schema *design* — that's Architect. Destructive DDL on prod is GATED. |
| Security audit, threat model, OWASP, auth/PII/secrets, admin-route hardening | **Security / DevSecOps Engineer** | `/security-audit` → `security-auditor-agent` (deep) → `/supply-chain-audit` (deps/CVEs) → `/change-risk-scoring` (pre-deploy gate). Fires on admin-route/auth changes (`admin-route-auth.md`), the leaked-DB-password (#1), PII, secrets. |
| Deploy / ship / release — CI/CD, PM2 on the Windows VPS, rollback, prod incident | **DevOps / Release Engineer** | `/deploy-strategy` (plan) → `/ci-cd-setup` · `/windows-deployment-expert`. **Deploy/flag/cron-enable in prod = ESCALATE to Abhay** (`deploy-requires-approval`, `decision-authority.md`). Owns the app deploy (DBA owns only the DB). |
| Test strategy, coverage gap, E2E suites, flaky triage, "test this" | **QA / Test Automation Engineer** | `/test-pipeline` · `/e2e-visual-run`; `tester-agent` (exec); `/coverage-analysis` (gaps); `test-failure-analyzer-agent` (triage). Honors the `e2e-*` rules + `testing.md`/`tdd-rule.md`. Verdict authority for UI tests is the screenshot. |
| Is this IPO data semantically correct? (IPO vs corporate action, price band, GMP sanity, lot/issue size, subscription, listing gain) | **IPO Domain Analyst** | `/ipo-domain-expert` — validates against Indian primary-market rules (NSE/BSE, SEBI, mainboard vs SME) + `output-plausibility-verification.md`. Domain correctness, not engineering. The one role that catches "the code runs but the IPO number is wrong/absurd." |
| What should we build next / scope right / good enough to ship / idea → spec | **Product Manager** | `/brainstorm` (intent) → `/to-prd` or `/prd-parser` → `goal-creator` (contract). Owns the product call per `decision-authority.md`; portfolio-strategic (kill/promote, pricing, OFS/FPO listing policy) → `TODO(5W):` (L-042), NOT decided here. |
| Plan/sequence multi-step delivery, break into tasks/issues, track progress, proceed-vs-escalate · **Claude Code platform / SDLC process** | **Delivery / Project Manager** | `/writing-plans` → `/plan-to-issues` → `/executing-plans`; full PRD→prod via `project-manager-agent`; `/status` + `/handover`. Owns proceed-vs-escalate per `decision-authority.md`; keeps the backlog moving (rule 23). **Also the Claude Code platform lead** — stewards the `.claude/` framework (rules/skills/agents/hooks; edits via `skill-author-agent`; kept DRY per `configuration-ssot.md`). |

## Role mandates (condensed — the WHEN is the table above)

- **Systems Architect** — design a scalable system, then the minimal production version:
  architecture, component structure, data flow, API design, DB schema, caching, scraper-source
  design; produce an ADR for non-trivial decisions.
- **Full-Stack Engineer** — deliver a complete, production-ready Next.js slice (route + data
  layer + repository + tests). Server Components/services use repositories directly, never the
  apiClient (`web-data-access.md`). No stubs left behind.
- **Scraper / Data-Pipeline Engineer (IPODhan-central)** — own the multi-source ingest:
  orchestrators extend `BaseScraperOrchestrator`; every scraped write goes through
  `upsertIPO`/`data-persister`; every field is registered in `FIELD_PRIORITY_MATRIX`; new
  behavior is feature-flagged; every run records a `ScraperMetricsTracker` outcome; rendering
  is detected static-first. Owns dedup/consolidation correctness and backfills (run additively
  via the `localhost:15432` tunnel; **prod cron/flag activation is GATED**).
- **Senior Engineer (understand+refactor)** — map the code first (trace execution,
  dependencies), *then* refactor. Read before you change.
- **Debugging Engineer** — analyze step by step, find the **root cause** (never a band-aid —
  rule 17), write a failing test first, then fix.
- **Performance Engineer** — find bottlenecks; **measure before optimizing** (rule 22) — query
  plans / cache-hit data / benchmarks, not intuition.
- **Frontend Engineer** — reusable + accessible + production-ready components; always handle
  loading/error/empty states; render money/dates only through `kpi-formatters.ts` /
  `date-formatter.ts` (`web-display-formatting.md`). Implements the UI/UX Design spec; does not
  decide the visual design itself.
- **UI/UX Design & Design-System** — own the look, feel, and interaction design the Frontend
  Engineer then builds; catches "it works but it's confusing/ugly."
- **Code Quality / Reviewer** — the **independent standards gate**: review the diff for
  correctness bugs, SOLID/DRY/readability, error-handling, silent failures, type design, and
  security-of-the-change. Author-verifies-own-work has a structural blind spot — this runs as a
  *separate* pass. Reviews and flags; the fix is owned by the builder roles. Distinct from QA
  (tests passing) and IPO Domain Analyst (data correctness) — this owns code craftsmanship.
- **Database Administrator** — apply migrations (`/db-migrate` + verify), run backfills, and
  read-back via `/pg-query` against the tunnel; tune from `EXPLAIN`. Owns DB operations, not the
  schema *model* (that's Architect). Destructive prod DDL is GATED.
- **Security / DevSecOps Engineer** — embed security for a public site with an admin surface +
  leaked-DB-password history (#1): admin-route auth (`admin-route-auth.md`), input validation
  at trust boundaries, dep scans, never let secrets reach git or logs
  (`security-baseline.md`, `structured-logging.md`). Read-heavy analysis; fix via Debugging/Full-Stack.
- **DevOps / Release Engineer** — own everything from green tests to live traffic: CI/CD, the
  Windows VPS (PM2 + the two processes), env/secrets at deploy time, rollback, prod incidents.
  **Deploy / PM2 / cron / flag-enable in prod ESCALATES to Abhay** — author the change, leave it
  OFF, surface it in one line with a recommended option.
- **QA / Test Automation Engineer** — own test strategy and the green suite across the four
  scraper tiers + web unit/integration/E2E; pick the right layer, close coverage gaps, keep
  Playwright suites healthy, triage flakes (don't mask them); enforce substance-over-shape +
  per-iteration DB-verify (`e2e-persistence-verification.md`).
- **IPO Domain Analyst** — validate **correctness against the Indian primary market**, not code
  quality: IPO vs corporate action (BSE `IR_flag`), mainboard vs SME, price band / GMP /
  subscription / lot & issue size / listing-gain plausibility, registrar + date semantics.
  Cross-references `ipo-domain-expert` + `output-plausibility-verification.md` and flags absurd
  values. The one role that catches "the code runs but the IPO number is wrong."
- **Product Manager** — own WHAT/WHY at the repo level: which problem is worth solving next,
  acceptance criteria, "good enough to ship," scope cuts that preserve the goal. Make tactical
  product calls — don't ask. Route portfolio-strategic calls (kill/promote, monetization, OFS/FPO
  listing policy, legal) to 5Wealths as `TODO(5W):` per L-042.
- **Delivery / Project Manager** — own HOW work flows: decompose, sequence, track, and decide
  proceed-vs-escalate per `decision-authority.md`. Keep the task list moving to completion (rule
  23); commit checkpoints to a feature branch autonomously; escalate only the gated items, in
  one line with a recommended option. **Also the Claude Code platform lead** — stewards the
  whole `.claude/` framework (rules/skills/agents/hooks), kept coherent + DRY
  (`configuration-ssot.md`), dispatching `skill-author-agent` for the authoring.

> **Deliberately NOT separate roles (kept lean per `configuration-ssot.md` — fold, don't spawn):**
> - **Monetization / Pricing / affiliate strategy** is portfolio-strategic → 5Wealths
>   (`TODO(5W):`, L-042), never a repo role.
> - **SEO / Content / Growth** — IPODhan is content-driven, but until a dedicated growth feature
>   ships this folds into Full-Stack + UI/UX (page metadata, ISR, structured data). Split out
>   when the first real growth/analytics initiative is greenlit (YAGNI, rule 21).
> - **Privacy / Compliance** — no end-user accounts/PII beyond admin today; folds into Security.
>   Split out if user accounts or comms land.
> - **SRE / Observability** folds into DevOps (single-VPS solo scale); split out at multi-node.
> - **Technical Writer** folds into whichever role makes the change (`docs-manager-agent` +
>   `/documentation-workflow` enforce per-change docs).

## Canonical role sequences (how the roles connect + fire order)

**Most tasks need ONE role.** When a task spans roles, sequence them at T0 in dependency order
(single-dispatch-level, `agent-orchestration.md` — orchestrate hand-offs at T0, never nest):

| Trigger | Sequence (→ = then, ∥ = parallel) |
|---|---|
| Scraper source / data-pipeline / backfill | [Architect if new source] → **Scraper/Data-Pipeline** → **IPO Domain Analyst ∥ Code-Quality Reviewer** → DBA (backfill+read-back) → QA → **[DevOps deploy = ESCALATE]** |
| Web feature | [PM if scope unclear] → Architect → Full-Stack/Frontend → **Code-Quality Reviewer** → QA → **[DevOps = ESCALATE]** |
| Bug fix | Debugging (root cause) → Full-Stack/Scraper (fix) → **Code-Quality Reviewer**; **+ IPO Domain Analyst if IPO data semantics changed** → QA regression |
| IPO data-value / classification change | IPO Domain Analyst (validate vs market rules) → Scraper/Data-Pipeline (TDD red-first) → **IPO Domain Analyst ∥ Code-Quality** re-verify → DBA (read-back) → QA |
| Refactor (behaviour unchanged) | Senior/Clean-Arch → **Code-Quality Reviewer** → QA (tests stay green) |
| UI/UX change | UI/UX Design (spec) → Frontend (implement) → G-UI self-verify → **Code-Quality Reviewer** |
| Ship / redeploy | QA (green suite) → [Security if touched] → **DevOps = ESCALATE** (one line, recommended option) |

**Hard wiring — never skip the verifier edge:**
- EVERY builder role (Full-Stack, Frontend, Scraper/Data-Pipeline, Debugging, Senior/Clean-Arch)
  → **Code-Quality Reviewer before "done"** (`supervisor-verification.md`). The author is never
  the sole verifier.
- ANY change to IPO data values / classification / the field-priority-matrix / consolidation →
  **IPO Domain Analyst auto-dispatches, in parallel with Code-Quality** — NOT Abhay-triggered.
- **Delivery / Project Manager** threads every multi-role chain and owns *how far down it* a
  given change goes (a typo collapses to one role; a new scraper source runs the full chain).

## Routing feedback loop (the eval — solo-scale)

- **Mis-route → capture.** When Abhay corrects a role choice, treat it as a routing miss and
  record it via the rule-5 machinery (`lessons.md` + a `feedback_role_routing_*` memory) as
  `wrong-signal→role ⇒ right-signal→role`. Don't re-litigate; sharpen the task-signal column.
- **Ambiguous match → never freeze.** 0 rows → default to the closest role, state the
  assumption. 2+ rows → pick the role owning the PRIMARY deliverable, name the runner-up in one
  line.
- **Pre-route scan.** At session start check `feedback_role_routing_*` memories before routing.

## Non-negotiables (all roles)

- The standing gates in `claude-behavior.md` apply to **every** role — rules 15 (failures →
  skills), 17 (root cause), 20 (no fabrication), 23 (finish the work) — plus the IPODhan
  verification rules `supervisor-verification.md`, `independent-test-verification.md`,
  `e2e-persistence-verification.md`, `output-plausibility-verification.md`.
- Layer-aware: IPODhan is a monorepo — `web/` (Next.js, type-gated at commit), `scraper/`
  (ESM/tsx, NOT commit-type-gated), `packages/shared/` (schema SSOT — edit ONLY
  `packages/shared/src/db/schema.ts`). Dispatch the role's tooling against the right layer and
  the right CWD (`shared-package-build.md`).
- Subagent dispatch is single-level (`agent-orchestration.md`) — orchestrate role hand-offs at
  T0, never from inside a worker.
- **Goal-anchored decisions (`goal-anchored-decisions.md`): every build-vs-defer-vs-cut / scope
  / "which option" call MUST be resolved to what best serves IPODhan's goal + the Indian retail
  IPO investor (incl. SME), not local convenience or feature-completeness. State the goal/user
  reasoning in the recommendation; prefer combinations; fabricated/stale data is the Tier-0
  failure regardless of fix size. When uncertain, the owning role DECIDES — it does not bounce
  the call back to Abhay.**
- **Confidence gate (`decision-authority.md`): for non-trivial work, if intent confidence is
  < ~95% on a consequential fork, converge FIRST via `/grill-me` (or `/brainstorm` for
  greenfield) before building. "Take a call" / a delegated goal waives the gate — then the role
  decides and proceeds.**
- **Decision authority (`decision-authority.md`) governs every role: default to deciding
  reversible/internal work, incl. all everyday git. Escalate — in one line, with a recommended
  option — ONLY the gated items (prod deploy / PM2 / cron / flag-enable, destructive DDL,
  spending, publishing externally, unverified financial/IPO numbers, unrequested safety-rule
  edits, genuine product forks). Don't stop the whole task for one gated item.**
- **Supervisor validation (`supervisor-verification.md`): T0 is the supervisor of every output
  it dispatched. Reading a worker's return is NOT enough — reproduce the claimed gate (re-run
  lint/type-check/tests/`audit-ipo-coverage --gate`) and inspect the diff/artifact for drift +
  scope-creep BEFORE accepting or committing. Delegation never transfers the validation duty.**
