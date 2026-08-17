# The "Session 5" webpack error — root cause, and why Sentry + GA4 were dark

**Task:** T-178 · **Date:** 2026-08-17 · **Scope:** `web/` only (the scraper has no Sentry)
**Outcome:** Branch A — root cause identified, both subsystems re-enabled, full local gate green.

---

## TL;DR

The "Session 5 webpack error" was **already root-caused on 2025-11-13** — and it was
**neither Sentry nor GA4**. It was `react-icons@5.5.0`'s pure-ESM exports failing webpack's
ESM interop in Next.js 15.5.4.

Sentry and GA4 were disabled during that investigation as *elimination probes* for a
hypothesis (`Phase 1: Client Components`) that the investigators themselves **explicitly
rejected** in writing. The real fix — migrating every icon to `lucide-react` — landed in
commit `182ccf6c`, but the two probes were **never reverted**. The result was ~9 months of
zero error tracking and zero analytics in production, caused by leftover debugging scaffolding
rather than by any real incompatibility.

Verified in this task by controlled re-enable: **each subsystem alone builds green, and both
together build green** on current dependencies.

> **Read before merging — the two subsystems do NOT ship symmetrically.**
> `deploy.yml` already injects `NEXT_PUBLIC_GA_MEASUREMENT_ID`, so **GA4 starts reporting the
> moment this deploys** — that is this PR's one live behaviour change. `deploy.yml` injects **no**
> `SENTRY_*` variable at all, so **Sentry ships inert** (no DSN → no `init()` → no events, and no
> source-map upload). Wiring the Sentry secrets is the P2 rollout task; until then a green build
> here must not be read as "error tracking is on." See *Deployment status*.

---

## The falsifiable root-cause claim

> **Claim:** The webpack error `TypeError: Cannot read properties of undefined (reading 'call')`
> (preceded by `TypeError: __webpack_require__.n is not a function`) was caused by
> `react-icons@5.5.0` being a pure-ESM package whose dynamic per-icon-set exports were not
> correctly interop'd by the webpack bundler in Next.js 15.5.4. It was **not** caused by
> `withSentryConfig`, and **not** by the GA4 `next/script` block.
>
> **This claim is falsifiable and was tested two ways:**
>
> 1. **Contemporaneous evidence (2025-11-13).** `docs/08-troubleshooting/REACT_ICONS_WEBPACK_FIX.md`
>    records that in Phase 1 the investigators removed the Header, Toaster, **Google Analytics
>    Scripts**, AsyncErrorBoundary and AffiliateCTAWrapper — and *"Result: Error still present -
>    hypothesis rejected."* Removing GA4 demonstrably did **not** fix the error. The error was
>    finally traced to `HiArrowRight` (`react-icons/hi2`) in `IPOListTable.tsx` /
>    `UpcomingIPOTable.tsx`, and replacing that import fixed the page.
> 2. **Direct re-enable on current deps (this task, 2026-08-17).** Re-enabling each subsystem
>    independently produces a green `next build`. See the experiment log below.
>
> **What would refute the claim:** a green build with `react-icons@5.5.0` restored, or a red
> build from re-enabling Sentry or GA4 alone. Neither occurred.

### Why the root cause is no longer present

`react-icons` was fully removed from the codebase in commit `182ccf6c`
(*"refactor: migrate from react-icons to lucide-react (150+ icon mappings)"*, 2025-11-13) and is
**absent from `web/package.json` today**. The offending dependency is gone; the workarounds that
outlived it were the only remaining damage.

| Dependency | Session-5 state | Today | Relevance |
|---|---|---|---|
| `react-icons` | `5.5.0` (**the root cause**) | **not installed** | removed in `182ccf6c` |
| `lucide-react` | — | `^0.552.0` | the replacement |
| `next` | `15.5.4` | `^15.5.4` | unchanged — so the fix is *not* "a Next.js upgrade fixed it" |
| `react` | `18.3.1` | `^18.3.1` | unchanged |
| `recharts` | `2.12.7` (a red herring in Session 5) | `^2.12.7` | unchanged |
| `@sentry/nextjs` | installed, wired out | `^10.17.0` (resolved `10.25.0`) | re-enabled here |

Note the two unchanged rows: because `next` and `react` are the **same versions** as during the
incident, this is *not* a case of "an intervening dependency upgrade silently fixed it." The
cause was removed directly, by the icon migration.

---

## Reproduction procedure (exact commands)

Run from the repo root. `packages/shared` must be compiled before any web build.

```bash
npm ci
cd packages/shared && npx tsc          # emits dist/db/schema.d.ts
cd ../../web
rm -rf .next && npm run build          # control / each experiment
```

Each experiment below was run from a clean `.next` and captured in full.

| # | Change under test | Result |
|---|---|---|
| **Control** | current `main` — both subsystems disabled | **exit 0 — green** |
| **A** | `withSentryConfig` re-enabled in `web/next.config.mjs`, **alone** | **exit 0 — green** |
| **B** | GA4 `<Script>` block re-enabled in `web/app/layout.tsx`, **alone** | **exit 0 — green** |
| **C** | **both** + full Sentry init wiring (see below) | **exit 0 — green** |

A and B were run in isolation (B with A stashed) precisely so neither could mask the other.

### Captured output

**Control (baseline, both disabled)** — tail:

```
+ First Load JS shared by all               102 kB
ƒ Middleware                               33.8 kB
BUILD_EXIT=0
```

**Experiment A — Sentry alone.** Green. The only Sentry-related output was one advisory:

```
[@sentry/nextjs] It seems like you don't have a global error handler set up. It is
recommended that you add a 'global-error.js' file with Sentry instrumentation so that
React rendering errors are reported to Sentry.
```

```
+ First Load JS shared by all               104 kB   (was 102 kB)
ƒ Middleware                               41.5 kB   (was 33.8 kB)
BUILD_EXIT=0
```

No `__webpack_require__.n is not a function`. No `Cannot read properties of undefined (reading 'call')`.

**Experiment B — GA4 alone.** Green. Bundle sizes are byte-identical to the control, which is
expected by construction rather than independent evidence — the GA4 tags are external
`next/script` tags and add no bundled JS. The load-bearing result here is simply the green exit:

```
+ First Load JS shared by all               102 kB
ƒ Middleware                               33.8 kB
BUILD_EXIT=0
```

**Experiment C — both + full Sentry init.** Green, and the `global-error` advisory is resolved:

```
+ First Load JS shared by all               178 kB   (Sentry SDK now actually loaded)
ƒ Middleware                               90.4 kB   (edge SDK loaded)
BUILD_EXIT=0
```

**Control for build noise.** Both the control and Experiment C emit exactly **10** occurrences of
`Database configuration missing! Set DATABASE_URL…`. That noise is pre-existing (this worktree has
no `.env.local`), affects prerender data-fetch only, does not fail the build, and is **unchanged**
by this work — so it is not attributable to re-enabling either subsystem.

---

## A second, larger finding: Sentry was never actually initialised

Re-enabling `withSentryConfig` alone would have produced a **green build and still zero error
reporting.** Investigating for this task found:

- **No `Sentry.init()` existed anywhere in the repo.** No `sentry.server.config.ts`, no
  `sentry.edge.config.ts`, no client init. `grep -rn "Sentry.init"` matched only the *validator
  script that checks for it*.
- `web/instrumentation.ts` existed but loaded no Sentry config, and its `onRequestError` took a
  truncated `(error: Error)` signature — dropping the `request`/`context` arguments Next.js passes
  and that `Sentry.captureRequestError` requires.
- `lib/monitoring/sentry-utils.ts` (`captureAPIError`, `captureDatabaseError`, …) was fully
  written and calling into an SDK that was never initialised — every call a silent no-op.
- No `app/global-error.tsx`, so React render errors could never reach Sentry.

So the `next.config.mjs` TODO — *"Migrate to instrumentation-based Sentry setup per Next.js 15"* —
was the correct instruction, and it had never been carried out. This task carries it out.

---

## What changed (Branch A)

| File | Change |
|---|---|
| `web/next.config.mjs` | Un-commented the `withSentryConfig` import; wrapped the exported config via `withSentryConfig(configWithAnalyzer, {...})`, preserving the `ANALYZE` bundle-analyzer path. |
| `web/app/layout.tsx` | Un-commented the GA4 `<Script>` block. Still gated on `NEXT_PUBLIC_GA_MEASUREMENT_ID` — unset means no tags, exactly as before. |
| `web/sentry.server.config.ts` | **New.** `Sentry.init()` for the Node runtime. |
| `web/sentry.edge.config.ts` | **New.** `Sentry.init()` for the edge runtime. |
| `web/instrumentation-client.ts` | **New.** Client init + `onRouterTransitionStart` for navigation tracing. |
| `web/instrumentation.ts` | `register()` now imports the server/edge configs per `NEXT_RUNTIME`; `onRequestError` takes the full `(error, request, context)` signature and forwards to Sentry **and** the existing structured logger. |
| `web/app/global-error.tsx` | **New.** Root error boundary reporting React render errors — resolves the build advisory from Experiment A. Also `console.error`s unconditionally, so a page-destroying render error is never silent when no DSN is set. |
| `web/app/api/sentry-test/route.ts` | **Both** `GET` and `POST` gated off in production unless `ADMIN_PANEL_ENABLED=true` — see "Security" below. |
| `web/next.config.mjs` | Also dropped the stale `'react-icons'` entry from `transpilePackages` (the package no longer exists — leftover Session-5 scaffolding from the rejected Phase 2). |
| `web/middleware.ts` | CSP `connect-src` extended with the Sentry ingest origins and the GA4 region-sharded hosts — without this the browser blocks every client-side event. See "The CSP trap" below. |
| `web/lib/monitoring/sentry-env.ts` | **New.** Single source of truth for DSN resolution + trace sample rate, shared by the server/edge/client configs and `isSentryInitialized()`. |
| `web/lib/monitoring/sentry-utils.ts` | `isSentryInitialized()` now uses the shared resolver, so a server-only `SENTRY_DSN` setup is no longer misreported as "not initialized". |
| `web/.env.example` | Documented `SENTRY_ORG` / `SENTRY_PROJECT` (read by `withSentryConfig`) and the DSN resolution order. |

**Two deliberate safety properties:**

1. **DSN-gated / fail-open.** Every `Sentry.init()` is wrapped in `if (dsn)` on
   `NEXT_PUBLIC_SENTRY_DSN`. With no DSN — local dev, CI, this worktree — Sentry never
   initialises and makes no network calls, so behaviour is identical to the disabled state.
   No DSN is hardcoded; it comes from the environment only.
2. **Monitoring can never swallow logging.** In `onRequestError`, the `Sentry.captureRequestError`
   call is `try`/`catch`-wrapped and tagged non-fatal, so a Sentry failure cannot suppress the
   structured log line operators depend on. The error value is narrowed with `instanceof Error`
   rather than cast — Next.js types it `unknown` and means it, and destructuring a thrown string
   or `null` would crash the handler and lose the log line entirely.

Server and edge read `SENTRY_DSN` first, falling back to `NEXT_PUBLIC_SENTRY_DSN` (both are already
documented in `web/.env.example`). Only the browser needs the `NEXT_PUBLIC_` prefix, which Next.js
inlines into the client bundle.

### The CSP trap: a green build that would have reported nothing

The single most consequential defect in this change was invisible to all four gates.
`web/middleware.ts` sets a `Content-Security-Policy` whose `connect-src` listed only
Google Analytics and Cloudflare. Sentry's browser SDK POSTs its envelopes to
`https://<orgId>.ingest.sentry.io`, and `default-src 'self'` does **not** act as a fallback
for `connect-src`. So with the DSN configured, the client SDK would have initialised, the
build would have been green, the bundle would have grown by 76 kB — and **every browser-side
event would have been silently blocked**, leaving only a console CSP violation.

That is the exact failure mode of Lesson 4 below (*config-wired ≠ working*), one layer further
out: not merely "no `Sentry.init()`", but "init runs and the network egress is denied." It was
found by adversarial code review, not by any gate, because no gate in this repo exercises a
browser against a live DSN.

`connect-src` now allows `https://*.ingest.sentry.io` (plus the `us`/`de` regional variants) and
the region-sharded GA4 hosts `https://*.google-analytics.com` / `https://analytics.google.com`,
which the previous single-host entry did not cover either.

**The P2 rollout task must still verify events actually arrive in the Sentry UI** — a corrected
CSP header is necessary, not sufficient.

### Findings from independent review (all fixed in this PR)

The first pass of this change was green on build, lint, type-check, and unit tests, and still
carried four real defects. Each was found by reading, not by a gate:

| # | Defect | Why the gates missed it |
|---|---|---|
| **1** | CSP `connect-src` blocked all Sentry ingest (above) | No gate drives a browser against a live DSN |
| **2** | `POST /api/sentry-test` was left **ungated** — the production gate was added to `GET` only, so an anonymous caller could still burn the event quota via `captureAPIError` and get a `400` + `eventId` existence oracle | No test exercises the route's auth posture |
| **3** | `isSentryInitialized()` still read `NEXT_PUBLIC_SENTRY_DSN` only, while the new configs prefer `SENTRY_DSN` — so the *recommended* server-only setup would report "Sentry is not initialized" while Sentry was in fact running | Both branches type-check; only a DSN-configured run reveals it |
| **4** | `register()` awaited the Sentry config imports **unguarded** — a malformed DSN would throw out of the instrumentation hook, failing Next.js startup, which PM2 `autorestart` converts into a restart loop | Never exercised without a DSN set |

Defect 4 is the sharpest: monitoring taking down the app it monitors. The same file already
applied non-fatal discipline to `onRequestError` (with a comment explaining why) but not to
`register()` — the rule was written down and then not applied one function higher.

### Security: the Sentry test endpoint

`web/app/api/sentry-test/route.ts` pre-dates this task and was harmless while Sentry was never
initialised. Re-enabling Sentry is what would have armed it: it is **not** under `app/api/admin/`,
so `withAdminAuth()` never applied, and with a DSN configured any anonymous caller could hit
`?test=all` repeatedly to burn the Sentry event quota and write a fake user into the server scope
via `Sentry.setUser`. It is now gated to non-production unless `ADMIN_PANEL_ENABLED=true`.

The gate is a shared `isTestRouteDisabled()` applied to **both** `GET` and `POST`. The first pass
gated `GET` alone, which left the quota-exhaustion path fully open: `POST` reaches
`captureAPIError` on every malformed body and returns `400` with a real `eventId` — both an
event-emitting path and an existence oracle that defeats the 404-as-concealment intent. Gating one
verb of a two-verb route is not gating the route.

It returns **404, not 403**: a diagnostic endpoint should not confirm its own existence to an
anonymous caller.

### Bundle-size cost (accepted, worth tracking)

Enabling Sentry is not free: First Load JS shared by all goes **102 kB → 178 kB** and middleware
**33.8 kB → 90.4 kB**. That is the real cost of the SDK actually being present, and it is a
user-facing weight increase against `CLAUDE.md`'s LCP < 2.5s target. Accepted here because the
alternative is no error tracking at all, but the P2 rollout task should measure LCP before/after
and consider trimming (dropping unused integrations, or `tunnelRoute`).

---

## Verification (all green, both subsystems enabled)

All four re-run from a clean `.next` **after** the independent-review fixes above, not just
before them:

| Gate | Command | Result |
|---|---|---|
| Build | `npm run build` (from `web/`) | **exit 0** |
| Lint | `npm run lint` | **exit 0** |
| Unit tests | `npm run test:unit` | **exit 0** — 135 files / 2190 tests passed, 1 file / 17 skipped |
| Type-check | `npx tsc --noEmit --project web/tsconfig.json` (the pre-commit gate) | **exit 0** |

Bundle sizes are identical before and after the review fixes (First Load JS 178 kB, middleware
90.3 kB), confirming the fixes changed behaviour and configuration rather than what is bundled.

**Turbopack dev verified separately.** Because `npm run dev` uses Turbopack and the previous author's
comment warned that Sentry's webpack config could cause Turbopack warnings, `next dev --turbopack`
was run explicitly. It compiled `instrumentation Node.js`, `instrumentation Edge`, and `middleware`
and reached `✓ Ready` with **no configuration warnings** — so `withSentryConfig` is applied
unconditionally rather than being gated to production.

**One pre-existing flaky test, unrelated to this change.** During one run,
`tests/unit/scrapers/gmp-api-scraper.test.ts > sleep utility > should sleep for specified
milliseconds` failed with `expected 125 to be less than 120`. It is a wall-clock assertion on a
~100 ms sleep and trips under machine load; all 31 tests in the file pass in isolation, and the
full suite passes on a clean run. It is scraper code untouched by T-178, but it violates the
"Repeatable" FIRST principle in `.claude/rules/testing.md` and should be given a tolerance or fake
timers in its own task.

---

## Known-stale tooling: `npm run validate:sentry`

`web/scripts/validate-sentry-setup.ts` is **out of date and will report false failures** against
this (correct) setup. It was written for the pre-v8 Sentry layout:

- it checks for `next.config.**ts**` — this repo uses `next.config.**mjs**`, so every Next-config
  assertion fails regardless of content;
- it requires `sentry.client.config.ts`, which Sentry SDK v10 + Next.js 15 **replaces** with
  `instrumentation-client.ts`;
- it asserts `.env.local` exists, which is correctly absent from a clean checkout.

It is left unmodified here (out of scope for T-178) but **must not be treated as a gate** until
updated. Recommended as a small follow-up: point it at `next.config.mjs`, accept
`instrumentation-client.ts`, accept `SENTRY_DSN` as well as `NEXT_PUBLIC_SENTRY_DSN` (matching
`lib/monitoring/sentry-env.ts`), and treat a missing `.env.local` as a warning rather than a
failure.

This is a real trap rather than a cosmetic one: the script is exposed as `npm run validate:sentry`,
so the next operator who reaches for the obvious verification command will be told the setup is
broken when it is correct. Fixing it belongs with the P2 rollout task that will actually need it.

---

## Residual Session-5 scaffolding still in the tree

The same rejected Phase-1 hypothesis disabled a **third** component that is still commented out
and is **outside T-178's scope**:

- `web/app/layout.tsx` lines ~5-6 and ~96-97 — `Toaster` (`@/components/ui/toaster`), marked
  *"TEMP: Toaster commented out - testing if it causes webpack error (Session 5)"*.

Given both other Session-5 probes were proven false here, `Toaster` is almost certainly a false
positive too — but it was not re-enabled or tested in this task, and no claim is made about it.
It should be picked up as its own small task, verified the same controlled way (re-enable alone →
build) rather than assumed safe.

Also still disabled, for an unrelated stated reason (OpenTelemetry build issues, not Session 5):
the `startInstrumentation()` call in `web/instrumentation.ts`. Left untouched.

Two further Session-5 residues were found and handled/noted:

- `transpilePackages: ['recharts', 'react-icons', 'date-fns']` in `web/next.config.mjs` still
  listed `react-icons` — a package that no longer exists in the tree. Added during the rejected
  Phase 2 (`REACT_ICONS_WEBPACK_FIX.md`), never cleaned up. **Removed in this PR.**
- `web/components/ipo-detail/KPICard.tsx` and `KPIComparisonCard.tsx` still carry `react-icons`
  references in doc-comments. Cosmetic only; left untouched.

### Known-stale tooling, part 2

`npm run lint` runs bare `eslint` (flat config) and passes. Note that `npx next lint` — the older
invocation — fails with `Invalid Options: Unknown options: useEslintrc, extensions`. That is a
pre-existing Next 15.5 / ESLint 9 incompatibility and is exactly why `next.config.mjs` sets
`eslint.ignoreDuringBuilds: true`; linting is not skipped, just moved out of `next build`. Use
`npm run lint`, not `next lint`.

---

## Deployment status

**Not deployed.** Per T-178 this ends at a green local build plus an open PR. Production rollout of
re-enabled Sentry + GA4 is a later P2 task and requires:

1. **`deploy.yml` currently injects no `SENTRY_*` variables at all** (`grep -rn "SENTRY"
   .github/workflows/*.yml` returns nothing). Until that is fixed, Sentry ships **inert**: no DSN
   means no init, and `withSentryConfig` runs with `org`/`project` undefined so source-map upload
   silently no-ops. The rollout task must add `SENTRY_DSN` (or `NEXT_PUBLIC_SENTRY_DSN`),
   `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN` as GitHub Secrets **and** add them to
   the `.env.local` here-string in `deploy.yml` — per `.claude/rules/self-hosted-windows-vps-deploy.md`,
   a variable set only in the committed config is overwritten at deploy time.
   By contrast `deploy.yml` **already** injects `NEXT_PUBLIC_GA_MEASUREMENT_ID`, so **GA4 will begin
   reporting as soon as this ships** — that is the one live behaviour change from this PR;
2. post-deploy verification that events actually arrive (`/api/sentry-test` exists for this, and is
   reachable in production only with `ADMIN_PANEL_ENABLED=true`) — an HTTP 200 is not proof of
   ingestion;
3. confirming GA4 tags fire in the browser on the live origin;
4. **checking the browser console for CSP violations** on the live origin once a DSN is set. This
   PR extends `connect-src` to the Sentry ingest and region-sharded GA4 hosts, but a Sentry
   org on a non-standard ingest domain would still be blocked — and the block is silent
   server-side. If events do not arrive, check CSP before suspecting the SDK.

Until a DSN is configured, the Sentry code ships inert by design.

---

## Lessons

1. **A rejected hypothesis must be reverted.** Both disablements came from a probe the
   investigators wrote down as rejected in the same document. The elimination was correct science;
   leaving the scaffolding in place was the defect.
2. **A `TEMP:` comment with no owner, date, or tracking id becomes permanent.** Three such
   comments survived ~9 months. Temporary disablements of production-observability code need a
   tracking id and an expiry, not a comment.
3. **"Disabled because it broke the build" deserves a one-command check before it is believed.**
   Re-enabling and building took minutes; the claim went unverified for months.
4. **Config-wired ≠ working.** `withSentryConfig` builds cleanly with no `Sentry.init()` anywhere —
   a green build would have looked like success while capturing nothing. Re-enabling a monitoring
   subsystem must be verified by *events arriving*, not by the build passing.
5. **A four-gate green is not a review.** Build, lint, type-check, and unit tests all passed on a
   version of this change that would have blocked every browser event at the CSP, left a
   quota-exhaustion endpoint open to anonymous `POST`, misreported the recommended DSN setup as
   uninitialised, and crash-looped the app on a malformed DSN. Every one of those was found by
   reading the diff. Gates catch what they were written to catch.
6. **Egress is part of "enabled."** Turning on a subsystem that talks to a third party means
   allow-listing that third party at every layer that can deny it — CSP here, and the deploy
   pipeline's env injection next. Code-enabled and network-permitted are different states.
