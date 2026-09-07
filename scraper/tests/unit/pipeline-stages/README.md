# Pipeline stage harness (test ladder, issue #258)

Implements `docs/reviews/ipo-pipeline-stage-gap-analysis.md` section 6. One test file per
pipeline stage, run in order, each **fixture-in / expected-output-file-out**. End-to-end runs
only ever reveal the *next* stage's defect; isolating stages surfaces every reachable defect in
one pass.

## Layout (MUST follow this)

```
scraper/tests/unit/pipeline-stages/
  stage-<N>-<slug>.test.ts          one file per stage, N = 0..9
  fixtures/
    stage-<N>/
      <input fixtures>              real captured payloads only, never synthetic
      expected-*.json               the golden, written BEFORE the stage code runs
```

Rules, all load-bearing:

1. **The expected file is written from the SPEC before the stage is run.** Regenerating a
   golden from live output is the after-the-fact acceptance test the T-403 round-2 review
   rejected. If the code disagrees with the golden, that is a finding, not a stale file.
2. **Input fixtures are real captured payloads** (NSE/BSE JSON, a stored RHP PDF, a real
   journal), never hand-typed formats.
3. **The test drives the real function/CLI/script**, never a re-implementation of it, so
   deleting a check in the production path turns the stage red.
4. **A stage that needs a live resource has two arms**: an offline arm that always runs (this
   is what CI gates on) and an opt-in live arm gated on an env var, `describe.skipIf(...)` —
   skipped, never failed, when the resource is absent.
5. Every golden carries a `_spec` field saying where its values came from.

## Stages

| # | Stage | File | Status |
|---|---|---|---|
| 0 | DB rebuild from journal | `stage-0-db-rebuild.test.ts` | done (part 1) |
| 1 | Discover IPO | — | existing orchestrator unit tests |
| 2–4 | Resolve links / download+verify / state machine | — | on the T-403 branch |
| 5 | Extract | `stage-5-extract.test.ts` | done (part 2) |
| 6 | Persist with precedence | `stage-6-persist-precedence.test.ts` | done (part 2) — 4 red-by-design |
| 7 | Supersede | `stage-7-supersede.test.ts` | done (part 2) — 2 red-by-design |
| 8 | Render | `web/tests/unit/pipeline-stages/stage-8-render.test.tsx` | done (part 2) — 2 red-by-design |
| 9 | VPS runtime preflight | `stage-9-runtime-preflight.test.ts` | done (part 1) |

## Running

```bash
cd scraper && npx vitest run tests/unit/pipeline-stages          # offline arms (what CI runs)

# stage 0 live arm — the sanctioned throwaway test DB over the SSH tunnel ONLY.
# Never create a database (owner rule 2026-08-28); the test refuses any target that is not
# a *_test database on localhost.
STAGE0_DATABASE_URL='postgresql://<user>:<pw>@localhost:15432/ipodhan_test' \
  npx vitest run tests/unit/pipeline-stages/stage-0-db-rebuild.test.ts
```

Stage 8 lives under `web/`, not here: it is the only rung that renders React, and web's vitest
config is the jsdom + `@vitejs/plugin-react` one. It follows the same layout rules and is gated
the same way — pr-gate.yml already runs `npm run test:unit` in `./web`, whose include glob is
`tests/unit/**/*.test.{ts,tsx}`.

```bash
cd web && npx vitest run tests/unit/pipeline-stages                # stage 8 offline arm
STAGE8_LIVE_URL='https://staging.ipodhan.com/ipos/<slug>' npx vitest run tests/unit/pipeline-stages   # stage 8 live arm (read-only)
# from scraper/: STAGE5_RHP_PDF='D:/path/to/a-real.pdf' npx vitest run tests/unit/pipeline-stages/stage-5-extract.test.ts
```

## Red by design

Stages 6, 7 and 8 assert spec requirements the product does not meet yet — issue #258 is the
HARNESS, and it says explicitly: "Out of scope: building stage 6 persistence-precedence logic
itself". Those cases are `test.fails` with the golden id and the spec line they come from
(`S6-R1..R4`, `S7-R1..R2`, `S8-R1..R2`, and `S5-R1` for a metric the extractor never emits).
`test.fails` inverts the verdict: the case reports green while the product is broken, and turns
RED the day someone implements it — which is the signal to delete the `.fails` and keep the
assertion. The `redByDesign` block in each golden is the readable list.

Stage 9 needs `bash` on PATH (Git Bash on Windows) and no VPS access — it drives the real
`scripts/preflight-runtime.sh` against fake executable shims.
