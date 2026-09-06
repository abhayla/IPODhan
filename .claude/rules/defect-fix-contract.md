# Scope: global

# Defect-fix contract — every defect is fixed for the CLASS, proven on real data

version: "1.0.0" (owner directive 2026-09-06 22:55 IST: "ensure the RCA is identified, fixed, retested, and fixed
for ALL the IPOs — previous, new and upcoming, all types — not just that one IPO")

A defect found in one IPO, one document, one row or one night is a SAMPLE of a class. The instance is never the
unit of work. Every defect fix (worker brief, PR body, ledger line) MUST carry these six items, in this order:

1. **RCA** — one sentence naming the mechanism, not the symptom ("the discovery budget trips before the LISTED
   tier", not "ESDS never gets visited").
2. **Class** — the population the defect can hit, stated as a filter over the data: statuses (UPCOMING / OPEN /
   CLOSED / LISTED / WITHDRAWN), segments (MAINBOARD / SME), offering types, document types, sources, slots
   (prod / staging), time (rows written before the fix AND rows the pipeline will write after it). A fix that
   covers only the sample (a slug list, one segment, one source, "the September rows") is a defect in the fix.
3. **Failing test first** — a unit/integration test that reproduces the CLASS on the real function (not a
   re-implementation) and is red before the change; kept as the regression guard.
4. **Fix at class level** — the code path that serves the whole class; existing bad rows are repaired by a
   productized, source-backed, re-runnable tool (dry-run default, prod guard), never by hand arithmetic or a
   one-off SQL.
5. **Retest + one REAL-DATA proof** — the failing test green PLUS one run against real data before merge: a
   staging cycle whose log line names the counter that moved, a real page/PDF fixture, or the audit script run
   against the staging DB via the tunnel. A unit-tested predicate proves nothing about the SQL, markup or budget
   around it (2026-09-06: an audit crashed for three nights; a parser sourced 0 of 4 rows; a counter that could
   never fall was accepted as proof for two rounds).
6. **Detection upgrade or declaration** — the nightly audit / CI test that will catch the NEXT member of the
   class, named (check id) or an explicit `No detection change: <reason>` (the recurrence gate enforces this for
   scraper write paths; for everything else the reviewer checks it).

Worker briefs for fix tasks MUST carry `Class:` and `Proof:` lines (the user-level hook
`agent-fix-contract-required.py` refuses a fix brief without them, fail-open). Reviews (Tier A/B) MUST verdict
on item 2 explicitly, and any change to scheduling, budgets, cron cadence or wake logic MUST be checked against the
owner's cadence decision (2026-09-03, ledger 13:44 IST 2026-09-06; scraper/src/scheduler/due-step-cycle.ts is its code): "covers the class: yes/no + why". A brief that ships a parser or extractor MUST include a
REAL fixture captured from the live source, never a format typed from memory.

Item 5 timing: when the only real-data bench is staging and staging deploys only from `main`, the merge to `main` is HOW the proof is obtained; the gate that REQUIRES the proof is then the release cut (`release/prod-<date>`), never the merge. The ledger line for such a merge names the proof still owed and the cycle that will carry it. (2026-09-06: the extraction-timeout fix was merged with its staging proof owed; the comprehensive review flagged it, correctly, as an unproven merge.)

Project specifics (IPODhan): the real-data proof for scraper behaviour is a staging cycle read (`docs/ops/
prod-ops-recipes.md` §2); for audit checks it is the script run against `ipodhan_staging` through the tunnel; for
repairs it is a dry run on staging followed by `--apply` on staging, then prod on the owner's word.
