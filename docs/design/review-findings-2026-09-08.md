# Pull-model design — the 2026-09-08 review, and where its findings live now

> **This file is history. It is not the register.**
>
> The register is [`findings.json`](./findings.json). Read it, or run
> `node docs/design/check-design-consistency.mjs` for the live split.

## Why this file was cut back

It used to restate all 55 findings in prose. Nothing generated it, so it drifted — and on 2026-09-09
the drift was measured: it carried its own id scheme (`C-1`…`C-13`) while the register had moved to
`F-01`…`F-57`, it said **55** findings when there were **57**, and it was eleven hours and roughly a
dozen decisions behind. Its own header claimed it was the readable form of `findings.json`. Nothing
generated it from anything.

That is exactly the failure the header warned about — a sixth place to write one thing down. A reader
who opened this file instead of the register got a stale answer with no way to tell. So the
duplicated per-finding prose is gone and the pointer stays, because the walk ledger
(`docs/walks/2026-09-02-deepa-pipeline-walk.md`) links here and that history should keep resolving.

Nothing is lost: every finding, with its full detail and its closing note, is in `findings.json`, and
the git history of this file holds the original prose.

## What the review actually was

Four independent passes over `docs/design/data-sourcing-pull-model.md` on 2026-09-08:

| Pass | Lens | Findings | Critical |
|---|---|---:|---:|
| Author self-review | scoping and unstated rules | 7 | 1 |
| Independent reviewer A | Indian IPO domain and edge cases | 16 | 4 |
| Independent reviewer B | engineering, concurrency, feasibility | 17 | 4 |
| Independent reviewer C | verification model and detection | 15 | 4 |
| **Total** | | **55** | **13** |

The three independent reviewers ran with no knowledge of each other and did not see this file. Where
two or more converged on the same defect the register marks it **CONFIRMED** — independent agreement
is the strongest signal available here.

**Their unanimous verdict at the time: not safe to build from as written.** All three also agreed the
§0 diagnosis was correct and well evidenced — the problem was the mechanism, not the analysis. That
verdict has since been worked through; §0.0 and §8 of the design carry the current position.

Two findings were added afterwards from live work — F-56 (identifier convergence) and F-57 (the
staging duplicate groups) — giving the 57 the register holds.

## The most consequential outcome

Not any single finding. It was **Appendix A.0 of the design: seven assertions the first draft made
about our own code that the code disproves.** An implementer who trusts one of them builds the wrong
thing, so they are now a regression guard (check D7) rather than a note.

## Where each fact lives — one home each

| Fact | Single source of truth | Generated from it |
|---|---|---|
| Which source serves which field | `field-source-resolution.spec.mjs` | Appendix A of the design. Never hand-edited |
| How the loop runs, how we verify it | `data-sourcing-pull-model.md` | nothing — it is prose |
| Findings and their status | `findings.json` | nothing. Read it directly |
| The owner's decisions | §0.0 of the design | checks D10, D10b, D10c |
| Owner comments O-1…O-11 | `docs/ops/work-tracker.md` Part 0 | the design points at it, never copies it |

**No second design document will be created.**
