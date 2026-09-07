# Pipeline stage harness (test ladder, issue #258)

Implements `docs/reviews/ipo-pipeline-stage-gap-analysis.md` section 6. One test file per
pipeline stage, run in order, each **fixture-in / expected-output-file-out**. End-to-end runs
only ever reveal the *next* stage's defect; isolating stages surfaces every reachable defect in
one pass.

## Layout (part 2 — stages 5–8 — MUST follow this)

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
| 5 | Extract | — | part 2 |
| 6 | Persist with precedence | — | part 2 |
| 7 | Supersede | — | part 2 |
| 8 | Render | — | part 2 |
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

Stage 9 needs `bash` on PATH (Git Bash on Windows) and no VPS access — it drives the real
`scripts/preflight-runtime.sh` against fake executable shims.
