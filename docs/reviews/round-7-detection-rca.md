# Round-7 Detection-gap RCA (T-335)

Authoritative source table (Fable-authored, 2026-08-26 09:50 IST):
`D:\Abhay\GetWorkDone\evidence\2026-08-26-T-322\DETECTION-RCA.md`. Reproduced below verbatim,
followed by this task's ITEM 0 finding (why `audit-substance-plausibility.mjs` did not catch
P1-3/P1-4, established by reading the code AND by SSH-ing into the box and reading the actual
2026-08-26 03:45 IST cron run log).

## Systemic root cause (applies to every row below)

The fresh review is the ONLY process that executes the full coverage floor (every page type,
every live IPO vs an external tracker, every public API route, reverse sweep, mechanism
reachability). The nightly audit runs a narrow subset (row counts, a few hard gates) and prints
WARN with no thresholds for the rest. So any defect class that appears between reviews — a newly
scraped IPO, a new route, a new env flag — survives until the next reviewer stumbles on it. The
detection upgrade is therefore mostly ONE thing: promote the review coverage floor into the
nightly audit as FAIL-level checks, item by item, and make the audit page the owner on FAIL
(Notifier is already wired).

## Per-finding RCA (Fable table, verbatim)

| # | Finding (round 7) | Should have been caught by | Why it was not | Detection upgrade (machine, daily) |
|---|---|---|---|---|
| P1-1 | NSE dates stored 1 day early (Lumino, Annu live) | Round 6 (dates vs Chittorgarh 14/14 exact); nightly audit; `data_conflicts` (it DID record the 4 disagreements at 00:01Z) | Lumino/Annu were scraped AFTER round 6 (timing); the audit never cross-checks dates against a second source; the disagreement monitor detected but nothing FAILS on "HIGH_VALUE disagreement on a live IPO" | Audit: for every OPEN/UPCOMING IPO, open/close date vs at least one non-NSE source (Chittorgarh, already fetched by the scraper) — any delta = FAIL naming the row; plus TZ-parse ratchet in CI (T-327) |
| P1-2 | Detection decoupled from correction (P1 alert fired, wrong value published) | Cross-source monitor + Notifier page — it fired, but as an FYI | The page says "disagreement" not "wrong value published"; no check asserts that a flagged HIGH_VALUE field on a live IPO is NOT the currently published value | Audit: count of live IPOs whose published HIGH_VALUE field equals a value that has an unresolved conflict against it = must be 0 (FAIL otherwise); T-328 HOLD mechanism makes the count structurally 0 |
| P1-3 | `issue_size` holds a share count (19 rows, 3 live) | `audit-substance-plausibility.mjs` (exists!), field-priority matrix validation, round 6 daily gate (`[FAIL] issue_size > 0` for 3 rows) | The plausibility audit was either not scheduled in the cron or has no issue_size magnitude rule (T-335 must establish which); matrix validation is a type check (0..999999990000); round 6 reported the ZERO half and never asked why the non-zero values were absurd | Audit: issue_size plausibility per segment (MAINBOARD >= Rs10 Cr, SME >= Rs1 Cr) AND consistency with shares x price within 25% when both exist = FAIL naming rows; T-329 rejects at write time |
| P1-4 | lot x band impossible (10 rows) + 7 corporate actions typed IPO | `NON_IPO_SHAPE_GUARD` (Rule 8), plausibility audit, round 6 P2-4 (same pollution class, marked "partly ineffective" and left) | Guard condition could never fire on rows WITH lot+issue size; nobody turned the round-6 "partly ineffective" note into a check | Audit: lot_size x upper_band within the SEBI retail window for book-built IPOs = FAIL otherwise; offering_type=IPO rows matching the corporate-action shape = FAIL; T-329 fixes the guard |
| P2-1..P2-4 | Four public API routes return 500 for everyone (score, subscriptions/latest, calendar matview, metrics) | Nothing — the audit never calls API routes; CI has no route smoke; the on-box prod-verify cron checks pages, not APIs | No machine ever exercised the API surface; schema drift (varchar 10 vs 50; missing matview; missing columns) had no gate | Audit: hit EVERY `web/app/api/**` route (enumerate from the filesystem, no hand list) with a representative slug — any 5xx = FAIL; deploy-time schema-drift gate (T-330) |
| P2-5 | Error bodies leak SQL + params | web-api-routes rule (prose only) | Rule had no check | Audit: the route sweep above greps every error body for SQL keywords / bound-param shapes = FAIL |
| P2-6 | 86% of `data_conflicts` are noise | Nothing | No metric on conflict quality | Audit: noise ratio (empty value2 or value1==value2 among unresolved) must be < 5% = FAIL; T-331 stops writing noise |
| P2-7 | `ecosystem.config.js` dead; TZ never reaches pm2 | `assert-env-keys.sh` (had no TZ key) | Config file read as live but never applied; no test asserts what pm2 actually receives | `assert-env-keys` requires TZ (T-327); deploy test exercises the REAL pm2 path with a recording fake (T-327F); audit logs `pm2 env` TZ per process = FAIL if absent |
| P2-8 | Tiered scheduler still never scheduled (THE recurrence) | T-311 wire-or-retire (round 6) — applied to jobs, not the scheduler tree | Class fixed for one artifact type only | T-331 wire-or-retire on the tree + a test that every scheduler/cron definition in the repo is referenced by the prod entrypoint or deleted (wire-or-retire lint, CI) |
| P2-9 / P3-4 | 0-row content tables, fieldCompleteness 0.7% passes | Nightly audit prints 0.0% as WARN | No thresholds | T-331: thresholds (fieldCompleteness < 5% FAIL; any content table 0 rows > 30 days FAIL) |
| P2-10 | OFS frozen 78 days | Freshness monitor (per-source) | OFS has no source in the freshness set | Audit: newest row age per offering_type (IPO/SME/OFS/NCD/RIGHTS) vs a per-type max age = FAIL |
| P2-11 | pm2 logs unrotated, +68 MB/day | deploy-linux.sh WARN | WARN never fails | T-331: deploy FAILS without pm2-logrotate; audit: largest pm2 log < 100 MB = FAIL |
| P3-1..P3-7 | sector empty, name glyph, always-red prod-verify workflow, cron script perms, dead API_FALLBACK, empty segment | Various WARN-level or nothing | Same pattern: no FAIL thresholds, no machine | Audit rows for each (sector populated %, glyph regex on names, executable bit on cron scripts, dead-source retire-by date, segment NOT NULL for IPO/SME); prod-verify workflow owned by T-326 |

## ITEM 0 — T-335 finding: why `audit-substance-plausibility.mjs` did not catch P1-3/P1-4

**It was scheduled.** This is the first thing to correct in the Fable RCA's phrasing ("either not
scheduled in the cron or has no issue_size magnitude rule"). `audit-substance-plausibility.mjs` is
never invoked directly by cron, but its `SUBSTANCE_CHECKS` array (`scripts/lib/substance-checks.mjs`)
is imported and folded into `scripts/audit-ipo-coverage.mjs --gate` (lines 219-256 of that file,
"SUBSTANCE GATE ... folded in from audit-substance-plausibility.mjs"), and THAT script is what
`scripts/vps-data-audit-cron.sh` runs at `45 3 * * *` (confirmed live on the box: `crontab -l` shows
the line; the box's `run-2026-08-26.log` for today's run shows the substance section actually
executing and printing `[FAIL]`/`[PASS]` lines).

**It ran green on the exact defects because each check is a type/shape check, not a magnitude
check.** Read directly from today's real run log on the box:

```
[PASS] lot_size in [1..100000]                          violations: 0
[FAIL] issue_size > 0                                   violations: 1
       - "Rays of Belief Ltd." — issue_size (0) must be > 0
[PASS] price band (min>0, min<=max)                     violations: 0
```

- `checkIssueSize` (`scripts/lib/substance-checks.mjs:102`) is `size <= 0 ? FAIL : PASS`. Every one
  of the 19 share-count-as-rupees rows (Annu 17,683,000; Priority Jewels 4,575,000; ICICI Pru AMC's
  ~10,600 Cr true value stored as a small number) is a large POSITIVE number, so it passes. The
  check has never compared magnitude against segment norms (a MAINBOARD issue under Rs10 Cr is as
  absurd as one that is exactly zero) or against `lot_size x price_range_max` as an independent
  estimate. This is the review's own diagnosis in different words: `min: 0, max: 999999990000` in
  the field-priority matrix, and `size > 0` here, are both TYPE checks dressed as validation.
- `checkLotSize` (`substance-checks.mjs:76`) is `lot in [1, 100000] ? PASS : FAIL`. A `lot_size=100`
  passes regardless of what `price_range_max` is, so ICICI Prudential AMC's `lot=100 x band=Rs2,165`
  (Rs2,16,500 per lot — twelve times the SEBI retail application limit) is invisible to this check.
  There is no check anywhere in the audit that multiplies `lot_size x price_range_max` and compares
  it to the SEBI retail window.
- `checkPriceBand` (`substance-checks.mjs:88`) is `min > 0 AND min <= max` — again a shape check, not
  a magnitude-vs-segment check.
- There is NO check in `SUBSTANCE_CHECKS` (or anywhere in the nightly audit) for "this row's shape
  matches a corporate action, not an IPO" — that logic exists ONLY as `NON_IPO_SHAPE_GUARD`
  (`scraper/src/services/data-validation.ts` Rule 8), a WRITE-TIME guard, not an audit check, and
  the review already found its condition (`window > 10 days AND no lot size AND no issue size`) can
  never fire on a row that has both a lot size and an issue size — which every one of the seven
  polluting rows does.

**Conclusion:** the audit ran, on schedule, against the correct data, and reported an honest `PASS`
for exactly the checks that needed to say `FAIL`. The gap is not scheduling — it is that
`SUBSTANCE_CHECKS` validates domain SHAPE (non-null, non-degenerate, internally ordered) but never
domain MAGNITUDE relative to a second, independent field or an external source. Item 1 below closes
this by adding magnitude/cross-field/cross-source checks that Fable's RCA table calls for in the P1-3
and P1-4 rows.
