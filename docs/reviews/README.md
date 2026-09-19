# docs/reviews

Review reports, failure-class RCAs, and the two detection registries this repo's recurrence
loop depends on.

## Add a check = add one file, run the generator (T-487)

`docs/reviews/detection-checks.json` and the table inside `docs/reviews/failure-classes.md` are
**generated aggregates** — do not hand-edit them. Their source of truth is one file per entry:

- A detection check lives at `docs/reviews/detection-checks/<id>.json`, carrying its normal fields
  plus `"section": "checks"` or `"section": "notCoveredByThisManifest"`.
- A failure class lives at `docs/reviews/failure-classes/<slug>.json`, carrying the eight table
  columns (`class_id`, `feature`, `symptom`, `first_seen`, `fix_prs`, `detection_check`, `status`,
  `spec_ref`). `spec_ref` is an array of the spec sections the class touches (e.g. `["§2.5"]`), or
  `[]` for a class that touches no part of the pull model — never a missing key, because a missing
  key and a deliberate "none" must not read identically. Every section named is validated against
  the real heading list of `docs/design/data-sourcing-pull-model.md`; a reference to a section that
  does not exist (e.g. a renumbered or invented section) makes the generator refuse, naming the file
  and the bad reference.

To add or edit either:

1. Add/edit the per-entry `.json` file under `docs/reviews/detection-checks/` or
   `docs/reviews/failure-classes/`.
2. Run `node scripts/build-detection-registry.mjs` to regenerate
   `docs/reviews/detection-checks.json` and the generated table in
   `docs/reviews/failure-classes.md` (between the `BEGIN/END GENERATED TABLE` markers).
3. Commit the per-entry file AND the regenerated aggregate(s) together.

`node scripts/build-detection-registry.mjs --check` fails (exit 1) if the committed aggregate has
drifted from the per-entry sources — it runs in `scripts/tests/build-detection-registry.test.mjs`
and in the `detection-change-gate` CI job (`.github/workflows/pr-gate.yml`), so a stale aggregate
never merges.

Why: every PR that adds a check or a failure class used to edit the same two shared files
(`detection-checks.json`'s ~400-line array, `failure-classes.md`'s markdown table), so parallel
PRs constantly conflicted on the same lines. One file per entry means two PRs adding different
checks touch disjoint files and merge cleanly; only the generator run (a mechanical,
conflict-free regeneration) touches the aggregate.

See `.claude/rules/recurrence-detection-gate.md` for the detection-change gate this registry
protects.
