# Production ops recipes (living runbook)

Owner rule 2026-09-06 20:52 IST: "keep recording the specific things you do within this project, like SSH,
so that you don't have to reinvent the wheel." Every operational recipe used on prod/staging goes here the
same turn it is used. Secrets never appear here; they live in `D:\Abhay\GLOBAL.env` (key NAMES may be
cited). Hosts: Linux VPS `72.61.240.224` (nginx + pm2, prod + staging), Windows VPS `103.118.16.189`
(PostgreSQL 16 for both slots).

## 1. Shell access

| Target | Command | Notes |
|---|---|---|
| Linux VPS | `ssh -o BatchMode=yes rfp-vps '<cmd>'` | alias in `~/.ssh/config` (`Host rfp-vps`, key auth). Pipe through `grep -vi kex` to drop the post-quantum KEX warning. Read paths only (owner rule: the VPS is production, no ad-hoc runs). |
| DB tunnel | `bash scripts/ops/db-tunnel.sh start` (then `status` / `stop`) | `localhost:15432` then reaches prod Postgres. **Never start this tunnel as a harness background task** — a bare `ssh ... -N -L 15432:localhost:5432 ...` launched by the session harness has no live Windows parent under Git Bash (MSYS), so TaskStop cannot kill it by walking the process tree and the port is left open across sessions (measured 2026-09-25, twice in one afternoon — full RCA in the script's own header comment, `scripts/ops/db-tunnel.sh`). `db-tunnel.sh start` records the owning session and PID; a project SessionEnd hook (`.claude/hooks/db-tunnel-session-end.py`) stops it automatically when that session ends. Shared across worktrees via `~/.claude/.ipodhan-db-tunnel.json`. |

## 2. Reading prod / staging state (read-only, safe any time)

```bash
# served release per slot (name ends with the short sha)
basename $(readlink -f /var/www/ipodhan/current)            # prod
basename $(readlink -f /var/www/ipodhan/current-staging)    # staging
cat /var/www/ipodhan/DEPLOYED_SHA-prod /var/www/ipodhan/DEPLOYED_SHA-staging
# pm2 apps with cron (prod scraper */30, staging 15,45)
pm2 jlist | python3 -c "import json,sys; [print(p['name'], p['pm2_env']['status'], p['pm2_env'].get('cron_restart')) for p in json.load(sys.stdin)]"
df -h / | tail -1; uptime; ls /var/www/ipodhan/releases | wc -l
# scraper cycle summaries (document discovery counters incl. listedSkippedUnenriched)
grep -h "listedSkippedUnenriched" ~/.pm2/logs/ipodhan-scraper-staging-out.log | tail -2 | grep -o '"listedCap[^}]*'
# failure identities, NEW/GONE/SAME vs the last tick — never a bare "extractionFailed: N" count (T-496, signal-ownership R1/R2)
node scripts/ops/failure-delta.mjs --slot prod       # or --slot staging; exit 3 = NEW failure with no issue number
# --track <ipoId>|<errorClass>=<#issue>: a class-level track (errorClass) persists to state.classIssues and
# covers every later key of that class automatically, including one first seen on a future run — no need to
# repeat --track per key; a per-key --track still wins over the class track (T-502, #413)
# extractor priority on the next cycle (expect ni=10 after the 2026-09-06 release)
ps -o ni=,pid=,args= -p $(pgrep -f venv/prod/bin/python) 2>/dev/null
# tick step (T-498, signal-ownership R5): fix/feat commits merged to main but not yet on the prod tag
node scripts/ops/merged-not-deployed.mjs --brief
```
Env files: `/var/www/ipodhan/shared/env/{prod,staging}/{web,scraper}.env`. Never print a URL value: values are quoted, so mask with `sed -E 's#://[^@]*@#://***@#'` AFTER stripping the key, or print only `grep -c`/key names. Edits: `cp -p $f $f.bak-<date>-<reason>` then append; a scraper.env change takes effect at the next pm2 start.
Standing lines added 2026-09-06: `DSN_ASSERT_REDIS_DB=0` (prod) / `=1` (staging).
Layout: `/var/www/ipodhan/{releases,releases-staging,current,current-staging,shared,repo}`.

## 3. Deploy (only from a frozen release branch, one prod deploy per day, 21:00-23:30 IST)

**Timers are set 30 minutes early and never wait for an idle session** (signal-ownership.md R7; T-501).
Incident: on 2026-09-07 the 20:30/21:00 session crons fired at 22:29 (90 min late) because they only
fire when the session is IDLE, and the session was busy through the window.
- The deploy reminder cron/todo is created **30 minutes before the window** (20:30 for a 21:00 deploy),
  not at the window start.
- The Rule-6 pre-deploy brief carries a `session idle since HH:MM` line so a busy session is visible
  BEFORE the window, not discovered after it's missed.
- The deploy step itself is `scripts/ops/deploy-and-watch.sh <date> <sha>`, started with the harness's
  run-in-background so dispatch + watch run inside the window regardless of what else the session is
  doing — it never depends on the session going idle.

```bash
# brief step (T-498, signal-ownership R5): what's fixed on main but still failing on prod, before naming the cut
node scripts/ops/merged-not-deployed.mjs --brief
git fetch origin && git rev-parse --short origin/release/prod-<date>          # must equal the brief sha
# single dispatch+watch command (T-501) — start in the background, do not block the session on it:
scripts/ops/deploy-and-watch.sh <date> <sha>
#   refuses if origin/release/prod-<date> != <sha>; dispatches gh workflow run deploy-linux.yml
#   --ref release/prod-<date> -f slot=prod -f ref=<sha>; watches with gh run watch <id> --exit-status;
#   prints the proof-line grep; writes the run id to scripts/ops/state/last-deploy-run.json;
#   on a failed run, exits non-zero and prints the rollback command with -f ref=<previous prod tag sha>
```
Rollback = the same command with `-f ref=<previous sha>` (must be an ancestor on the same release branch),
or `scripts/ops/deploy-and-watch.sh <date> <sha> --rollback-to <prev-sha>` to control which sha the
printed rollback command names.
The deploy log IS the Actions run log (`scripts/deploy-linux.sh` prints `==> ...` lines); nothing is written on the box.
NEVER push a non-md file straight to `main`: the write-ratchet (`scripts/check-write-ratchet.mjs`) scans the whole tree incl. docs/, and a raw-SQL template pushed to main on 2026-09-06 turned every open PR gate red. Code-like files go through a PR. Staging no longer auto-deploys on push at all — see §14 for the current cadence (windows at 13:30/21:30 IST, plus a manual button capped 2/day).
Tag after verification: `git tag -a prod-<date> <sha> -m "..." && git push origin prod-<date>` (a tag push does not deploy).

## 4. Post-deploy verification

```bash
curl -s -o /dev/null -w '%{http_code}' https://ipodhan.com/
cd web && npm run test:prod-verify          # laptop, needs >= 2.5 GB free
npm run audit:data                          # root; expect only the known legacy reds
# audit:coverage needs a DB: web/.env.local is git-ignored and may be missing on the laptop; supply the tunnel instead:
#   PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"'); DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan" npm run audit:data
```
Then on the VPS: served sha (section 2), pm2 web x2 online, scraper `stopped` between runs, next cycle
`extractionFailed 0`, extractor `ni=10`.

## 5. Reading and repairing prod rows

Public read: `curl -s https://ipodhan.com/api/ipos/<slug>` returns `{"ipo":{...}}` (camelCase; `issueSize` is
rupees as a numeric string).
DB read/write via the tunnel with the least-privilege app role (password key `IPODHAN_APP_DB_PASSWORD` in
GLOBAL.env; `DATABASE_URL` there points at the firewalled public port and does NOT work from the laptop):
```bash
PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"\r')
DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan" node <script>.cjs [--apply]
```
**Every read script MUST issue `SET TIME ZONE 'UTC';` as its first statement.** The app's own pools set
`options: '-c timezone=UTC'`; an ad-hoc tunnel session does NOT, and inherits `Asia/Calcutta`. Several
columns are `timestamp WITHOUT time zone` (`documents.extracted_at` among them), so a `Z`-suffixed
literal compared against one is silently out by 5h30m. On 2026-09-10 that returned rows whose minimum
value was EARLIER than the `>` cutoff that selected them — an impossible result, which is the only
reason it was caught rather than published. The safe pattern is either the `SET TIME ZONE` above or, for
a one-off reading, no date filtering at all: list the rows and let the ordering speak.

`pg` is hoisted at the repo root (`require('<repo>/node_modules/pg')`, not `web/node_modules`). A repair
script must: print `current_database()` first, select by slug, refuse on id/cap mismatch, update with
`WHERE id AND slug AND issue_size = <old>` and `RETURNING`, dry-run by default. Template used 2026-09-06:
`docs/ops/templates/repair-row-template.cjs.txt`.
After any manual ipos row change, drop the web cache on the SLOT's Redis (Linux VPS, auth from the
slot's scraper.env `REDIS_URL`; prod = db 0, staging = db 1): `redis-cli -n 0 -a <pw> DEL ipo:slug:<slug> ipo:id:<id>`;
documents rows: `DEL documents:<ipoId>` or use `scraper/scripts/reset-document.ts` (`docs/ops/reset-document.md`).
Confirm on `/api/ipos/<slug>?cb=<random>` (cache-busted): the API sends `s-maxage=300, stale-while-revalidate=600`, so the plain URL keeps serving the OLD value from the Cloudflare edge for up to 15 min (`cf-cache-status: HIT`, `Age:`). No purge needed for a data fix; wait it out.
Redis auth on the box: `redis-cli -u "$REDIS_URL"` fails with NOAUTH on this redis-cli; extract the password (`pw=${u#redis://:}; pw=${pw%%@*}`) and use `redis-cli -a "$pw" --no-auth-warning -n <db>`. The web slot has no separate env file (`web.env.local` in the same dir); both slots share one Redis, prod db 0 / staging db 1.

## 6. Worktrees (owner lifecycle rule)
```bash
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Users/itsab/.claude/tools/wt-new.ps1" -Repo "D:/Abhay/Ventures/IPODhan" -Name <task> -Branch fix/<x> -Purpose "..." -TtlHours 6
#   -> tree lands at D:\Abhay\Ventures\IPODhan-<task> (the tool prefixes the repo name; pass forward slashes from bash or PowerShell eats the backslashes)
cd /d/Abhay/Ventures/IPODhan-<task> && for d in . web scraper; do cmd //c mklink //J "$(cygpath -w $PWD/$d/node_modules)" "$(cygpath -w /d/Abhay/Ventures/IPODhan/$d/node_modules)"; done
cd packages/shared && npx tsc          # or scraper tsc reports 217 errors instead of the 87 baseline
powershell -NoProfile -ExecutionPolicy Bypass -File "C:/Users/itsab/.claude/tools/wt-rm.ps1" -Path "D:/Abhay/Ventures/IPODhan-<task>"   # after merge; prints links-removed + main tracked count proof
```
Scraper tsc baseline on 2026-09-06: 87 errors (`cd scraper && npx tsc --noEmit -p tsconfig.json | grep -c 'error TS'`). Scripts tests run with `node --test scripts/tests/<file>.test.mjs`, not vitest.

## 7. Gotchas learned
- Naive `timestamp` columns hold UTC wall-clock (the app pins session timezone=UTC and installs a UTC parser). An ad-hoc `pg` reader parses them as LAPTOP-local time (IST) and shows every value 5 h 30 min early; read `col::text` or set `types.setTypeParser(1114, s => new Date(s + 'Z'))`. The DB server default timezone is Asia/Calcutta, so any pool without `options: '-c timezone=UTC'` gets an IST `now()` against UTC columns (the audit scripts had exactly this, found 2026-09-06).
- `git stash` is blocked in linked worktrees by a user hook (escape `GIT_STASH_GUARD_ALLOW=1`).
- Laptop below ~0.5 GB free makes every hook time out; check memory before blaming hooks.
- Timestamps in ledger lines come from `date`, never estimated.
- The `postgres` superuser is localhost-only on the DB host; through the tunnel it still works, but use
  `ipodhan_app` for app tables anyway.
- Widening a Postgres enum (e.g. `scraper_source`, S0d #740) is additive and needs no data backfill: the
  generated migration is one `ALTER TYPE ... ADD VALUE IF NOT EXISTS '<v>'` per new value, applied inside the
  drizzle migration transaction. It **cannot be rolled back by dropping the value** — Postgres has no
  `DROP VALUE` for enums. Rollback is reverting the code (schema.ts, the TS unions, the test); the extra
  enum values stay in the type, permanently unused, and touch no existing rows.

### Running a scraper integration test against `ipodhan_test` (item 5 slice s4, 2026-09-16)
There is **no `scraper/.env.test` file, and there never was one to find** — `vitest.integration.config.ts`
does load `.env.test`, but the credentials for this laptop live in `GLOBAL.env` above every repo, not in a
repo-local dotenv. Looking for the file is a reasonable instinct that wastes time here.

```bash
cd scraper
PW=$(grep '^IPODHAN_APP_DB_PASSWORD=' /d/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"')
DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_test" \
REDIS_URL="redis://localhost:6379/15" \
npx vitest run -c vitest.integration.config.ts tests/integration/<file>.integration.test.ts
```

Four traps, each of which looks like a broken suite rather than a mistake:
1. Use `localhost:15432` — the sanctioned tunnel. Pointing at the DB host directly is refused by a
   non-overridable denylist; a second tunnel on 5432 is undocumented — do not use it.
2. `REDIS_URL` is required **even for suites that never touch Redis**.
3. **The one that matters most:** with `DATABASE_URL` unset the suite prints "Tests  no tests" and
   **exits 0**. A run that executed nothing looks like a pass to anything checking only the exit code —
   always read the test COUNT, never just the exit status; "no tests" is a skipped suite, not a green one.
4. Files sharing a table must run ONE AT A TIME — `ipo_field_plan`'s `FOR UPDATE SKIP LOCKED` claim is
   designed to return nothing under contention, so a parallel run of two suites hitting the same table
   produces a fake failure.

## 8. Data repair tools (productized; never hand SQL)

### 8a. Migration journal date repair (GitHub #442) — supersedes the T-403 round-3 exemption

**What T-403 round 3 chose, and why.** `web/drizzle/migrations/meta/_journal.json` idx 32-34
(`0049_ipo_details_ad_fields`, `20260906090638_icy_firelord`, `20260908004955_left_loners`) carried
hand-typed `when` values dated into the future (up to 2026-09-10T09:20:00.500Z), because drizzle's
migrator only applies a journal entry whose `when` is STRICTLY GREATER than the last-applied
`created_at` — idx 33's real authoring `when` (~1788685598881, 2026-09-06) sorted BELOW idx 32's
future-dated `when`, so idx 33 would be silently skipped by `db:migrate` on any slot that hadn't
already applied it. Round 3 (T-403) fixed the ordering by pushing idx 33's `when` to just above idx
32's — restoring monotonic order — and then set `MONOTONIC_CHECK_FROM_IDX` / `FUTURE_CHECK_AFTER_IDX`
in `scripts/lib/migration-journal-lint.mjs` to 33, so CI would not fail on the still-future-dated
result.

**Why that was not enough.** The exemption hid the mistake instead of fixing it: idx 32-34 stayed
future-dated, and any slot that had already applied a migration with `created_at` in that future range
silently skipped every migration generated before 2026-09-10T09:20:00.500Z — demonstrated on
`ipodhan_test`, where `db:migrate` exited 0 while three rows in `drizzle.__drizzle_migrations` still
carried the future `created_at`.

**What this change does instead.** `web/drizzle/migrations/meta/_journal.json` idx 32-34 now carry
their honest, real-authoring `when` values (2026-09-06T09:06:30.000Z / :38.000Z, 2026-09-08T00:49:55.000Z).
`FUTURE_CHECK_AFTER_IDX` is lowered to `-1` (no idx-based exemption at all — every entry, at any idx,
is checked for a future-dated `when` from here on). `MONOTONIC_CHECK_FROM_IDX` stays at 33: the real
journal has a second, unrelated hand-typed anomaly at idx 31 (`0048_ipo_valuation_share_legs`, dated
above idx 32's honest value) that is out of this change's scope to correct, and lowering the boundary
below 33 would fail CI on that entry — see the comment above `MONOTONIC_CHECK_FROM_IDX` in
`scripts/lib/migration-journal-lint.mjs` for the exact pair and how the boundary was verified.

**Residue an operator should know about.** Idx 25-31 still carry a fabricated one-per-day ladder
(`when` hand-typed to an exact `09:20:00.000Z`, one day apart) rather than real authoring times, and
correcting idx 32 pulled it below idx 31, leaving exactly one known monotonic drop (idx 31 -> idx 32,
pinned by a regression test in `scripts/tests/check-migration-journal.test.mjs` so a second one fails
CI). This is harmless only because idx 32-34 are already applied on every slot; it would stop being
harmless for a database whose recorded state sits precisely between idx 31 and idx 32 (0048 applied,
0049 not yet run), which no known slot is in today but a partial restore could create.

**What an operator must do on staging and production.** Fixing the journal file alone does nothing for
a database that already applied idx 32-34 with their future `created_at` — the DB rows need the same
correction, per slot:
```bash
cd scraper
# Durable backup location — the tool's default (OS temp dir) can be cleared by the OS before anyone
# reads it, and this backup is the only record of the pre-change rows for a production --apply.
export MIGRATION_JOURNAL_REPAIR_EVIDENCE_DIR=/root/evidence/migration-journal-dates-442
# 1. staging (tunnel env — see section 4/5 for the PW= line): dry run, then apply
DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 DATABASE_USER=ipodhan_app DATABASE_PASSWORD="$PW" DATABASE_NAME=ipodhan_staging \
  npx tsx scripts/repair-migration-journal-dates.ts            # dry-run, prints the plan + backup path
  ... --apply                                                  # writes staging
# 2. production — ONLY on the owner's word, after the staging run is read and clean:
DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 DATABASE_USER=ipodhan_app DATABASE_PASSWORD="$PW" DATABASE_NAME=ipodhan \
  npx tsx scripts/repair-migration-journal-dates.ts --allow-prod          # dry-run
  ... --apply --allow-prod                                                # prod write (owner word only)
```
Idempotent (a second run against an already-corrected slot finds 0 rows to repair) and scoped to
exactly the three rows named in #442, matched by `sha256(<migration .sql file content>)` — the same
hash drizzle-orm's own migrator computes — never by a slot's possibly-drifted `created_at`. Backup of
the pre-change rows defaults to the OS temp directory (`MIGRATION_JOURNAL_REPAIR_EVIDENCE_DIR` to
override); it must never default to a path outside this repo — set the override above before any
production `--apply` so the backup survives on durable storage, not somewhere the OS may sweep it.

**Shared guards (T-490):** every repair/backfill tool imports `scraper/scripts/lib/repair-tool.ts` - `openRepairDb()`
(prints `current_database(): <name>` from the WRITING pool and refuses a prod `--apply` without `--allow-prod`),
`upsertFieldSource()` (keeps `previous_source`, takes `previous_value` from the caller's ledger),
`buildAlreadyRepairedSet()` (per-field idempotency) and `writeLedgerFile()`. CI enforces it:
`scripts/ci/require-repair-tool-module.mjs` fails a PR whose new `scraper/scripts/{repair,backfill}-*.ts` neither
imports the module nor carries `// repair-tool-exempt: <YYYY-MM-DD> <reason>`.

**8a-i. Line-ending-safe matching (GitHub #449).** The row-matching hash above is taken over the
migration `.sql` file exactly as `readMigrationFiles()` (drizzle-orm) and this tool both read it — and
that byte content depends on which platform wrote/checked it out. A migration applied by the Linux
deploy runner writes an LF hash into `drizzle.__drizzle_migrations`; the same logical file read from a
Windows checkout (git `core.autocrlf` converting to CRLF) hashes differently, so the tool matched zero
of the three named rows and printed "nothing to repair" — indistinguishable from the healthy case, in
EITHER direction (a Windows checkout could not see a Linux-written row; a Linux checkout could not see
a Windows-written row). The tool now computes all THREE of {raw (file as this checkout reads it),
LF-normalized, CRLF} for every target, and accepts a `drizzle.__drizzle_migrations` row matching **any**
of them — normalizing only one direction was rejected because a slot whose migrations were applied from
a Windows checkout would then fail the same way in the opposite direction. The CRLF variant is always
built by normalizing to LF first and then expanding, never by converting as-read content directly,
so an already-CRLF file is never turned into CRCRLF. When two or three variants collapse to the same
value (the common case), a row is matched (and counted) once, never twice.
**A zero — or partial — match is now a loud failure**, not a quiet "0 rows to repair": if the tool
matches fewer of `TARGET_ENTRIES` than it was asked to find, it prints every unmatched tag with all three
hashes it tried and exits **1**; only when every target resolves to a row (whether or not that row still
needs a `created_at` correction) does it exit 0. Re-run the dry run in section 8a above from a Windows
checkout against `ipodhan_staging`/`ipodhan` any time the previous run reported "nothing to repair" from
this checkout — that message is no longer trustworthy from before this fix, and any future zero-match
run now fails loudly instead of looking healthy.

```bash
# issue_size below the segment floor (share counts / zeros): source = Chittorgarh detail page, cross-checked shares x cap
cd scraper && PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"')
DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_staging" DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432   DATABASE_USER=ipodhan_app DATABASE_PASSWORD="$PW" DATABASE_NAME=ipodhan_staging   npx tsx scripts/backfill-issue-size-chittorgarh-detail.ts                     # dry run (staging)
  ... --apply                                                                    # write on staging
  ... --allow-prod            (DATABASE_NAME=ipodhan)                            # prod dry run
  ... --allow-prod --apply                                                       # prod write (owner word)
  ... --recheck-above-floor [--allow-prod]                                       # FLAG rows >= floor diverging >40% from source (no write)
  ... --recheck-above-floor --apply --overwrite-above-floor --slug a,b --allow-prod   # write named flagged rows only
```
The tool drops `ipo:slug/ipo:id` (+ the invalidation set) itself when REDIS_URL is reachable; from the laptop it is not, so
drop the printed keys on the box (section 5). FLAG can mean fresh-issue vs total (incl. OFS): triage before writing.

**Field definition:** `ipos.issue_size` = TOTAL issue size in rupees INCLUDING the offer-for-sale portion (fresh issue + OFS), as printed in the offer document / Chittorgarh "Total Issue Size"; NOT the fresh-issue-only figure and NOT the net public offer x price (owner decision 2026-09-07; provenance ADMIN rows written by the backfill tool; matrix ranks CHITTORGARH printed total above the exchanges' share-count derivation since PR #337; c_issue_size_consistency band 0.75x-3.0x of shares_offered x price cap since PR #338).
Audit scripts through the tunnel (report mode; add `--gate` for exit codes): `audit-ipo-coverage.mjs`,
`audit-detection-floor.mjs`, `audit-substance-plausibility.mjs`, all with `DATABASE_URL=...` as above; a findings file
for the issue sync: `DETECTION_FLOOR_STATE_DIR=<dir> node scripts/audit-detection-floor.mjs` then
`node scripts/audit-findings-to-issues.mjs --dry-run <dir>/findings-latest.json`.

```bash
# ipo_financials empty while financial_data is populated: productized migration/repair (T-477, #224)
# site reads ipo_financials (FinancialTable.tsx, PeerCompaniesList.tsx, ComparisonTable.tsx via
# ipo-repository.ts ~415-422) but no scraper writes it; financial_data (DRHP/pdfplumber, C3b) is the source.
cd scraper && PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"')
DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_staging" \
  npx tsx scripts/migrate-financial-data-to-ipo-financials.ts                  # dry run (staging)
  ... --apply                                                                  # write on staging
  ... --slug a-ipo,b-ipo                                                       # scoped dry run/apply
  ... --apply --allow-prod   (DATABASE_NAME=ipodhan)                           # prod write (owner word only)
```
Idempotent — skips IPOs that already have an `ipo_financials` row; a re-run writes 0. Copies `financial_data`'s own
`field_sources` provenance per field (defaults to `DRHP`, the C3b extractor, when no field_sources row exists) into new
`field_sources(table_name='ipo_financials', ...)` rows with `dataLineage.method='MIGRATION'`. `pbRatio`, `rocePercentage`,
`industryPe`, `peerCompanies`, `financialYearEnd` are NOT in `financial_data` and stay NULL — a named follow-up
(issue #224), not built by this migration. Drops `ipo:detail:<slug>`/`ipo:slug:<slug>` cache keys for migrated IPOs when
Redis is reachable (it is, from the box — this tool ran there for the staging proof).

**Mandatory last step of every data-repair fix task (#192, T-466, `defect-fix-contract.md` item 5):** a
row is not "repaired" on the strength of one clean read — three separate repairs regressed within
minutes-to-cycles of deploy (T-281 price-band collapse re-minted 11 min later; T-282's correct guard
never ran because `CONSOLIDATION_PERCENTAGE=0`; T-277C merged duplicates were re-created next cycle).
`scripts/assert-repair-held.mjs` closes this: it records the invariant's violation count now (must be
0), records a cycle marker, polls until N real scraper cycles have passed, and re-runs the invariant
after each — FAIL loudly on any regression, UNVERIFIABLE if the scraper never touched live data in the
window.
```bash
PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"')
DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_staging" \
  node scripts/assert-repair-held.mjs scripts/lib/repair-invariants/issue-size-t451.mjs --cycles 2 --timeout-min 40
# generic form — any command whose stdout's LAST line is a bare integer violation count:
DATABASE_URL="..." node scripts/assert-repair-held.mjs "node scripts/audit-ipo-coverage.mjs --gate | tail -1" --cycles 2
```
Staging cycles land at :15/:45, so 2 cycles takes up to ~35 min — launch it in the background
(`nohup ... > .tmp/proof.log 2>&1 &`) and keep working; do not block a PR gate on it (risk noted in the
#192 plan). Exit 0 = held; exit 1 = regressed (per-cycle counts printed); exit 2 = UNVERIFIABLE (the
invariant crashed, or the cycle marker never advanced within the timeout — never a silent pass).

### Merging two rows that are one IPO (duplicate rows)

Used 2026-09-09 on Asset Reconstruction Company (India) Ltd, which production carried twice (`ARCIL`
plus a nameless `asset-reconstruction-co-india-ltd`) because the name normaliser folds `Ltd` but not
`Company` vs `Co.`. Tool: `scripts/merge-duplicate-ipo.mjs` — dry-run by default, refuses a prod
`--apply` without `--allow-prod`, backs up both rows and every child to `scripts/state/` first, and
runs the whole merge in one transaction.

```bash
PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"')
# 1. rehearse on staging (it usually carries the same pair)
DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_staging"   node scripts/merge-duplicate-ipo.mjs --keep <uuid> --drop <uuid> [--set-issue-size <rupees>]
#    ... then the same line with --apply
# 2. prod dry run (no DATABASE_URL = the prod tunnel)
node scripts/merge-duplicate-ipo.mjs --keep <uuid> --drop <uuid> --set-issue-size <rupees>   --issue-size-note "<the evidence that proves the number>"
# 3. prod write (owner word only)
  ... --apply --allow-prod
```

It refuses the merge unless the two rows share an open date and their names fold together, and it
refuses outright when a strong identifier (`cin`/`isin`/`symbol`/`bse_ipo_no`/`bse_scrip_code`)
**disagrees** — that proves two offers rather than one row twice. It carries a column onto the
survivor only where the survivor is empty, writes a `field_sources` row (camelCase `field_name`)
keeping `previous_source` for every column it writes, repoints person-created children
(`user_watchlist`, `affiliate_clicks`, `ipo_reviews`, `audit_logs`, `brlm_track_record`) and deletes
only scraper-derived ones. Child tables are discovered from `information_schema` — 30 tables carry an
`ipo_id`, and a hand-typed list missed 11 of them on the first attempt.

Then drop the cache and verify:

```bash
ssh rfp-vps 'u=$(grep -h "^REDIS_URL=" /var/www/ipodhan/shared/env-prod/scraper.env | head -1 | cut -d= -f2- | tr -d "\"");
  pw=${u#redis://:}; pw=${pw%%@*};
  redis-cli -a "$pw" --no-auth-warning -n 0 DEL "ipo:slug:<old>" "ipo:slug:<new>" "ipo:id:<oldid>" "ipo:id:<newid>"'
curl -s "https://ipodhan.com/api/ipos/<new-slug>?cb=$RANDOM"     # the merged row
curl -s "https://ipodhan.com/api/ipos/<old-slug>?cb=$RANDOM"     # 200, serving the SURVIVOR via ipo_slug_redirects
```

(The env file is `shared/env-prod/scraper.env`, not `shared/scraper.env`.)

**The merge alone does not hold.** Discovery is what minted the duplicate, so unless the normaliser
is fixed the row can be re-created next cycle — `assert-repair-held.mjs` records that happening to
T-277C's merged duplicates. The held-proof is:

```bash
DUPLICATE_INVARIANT_FOLDS=<foldedname> node scripts/assert-repair-held.mjs   scripts/lib/repair-invariants/duplicate-ipo-rows.mjs --cycles 2
```

Without `DUPLICATE_INVARIANT_FOLDS` that invariant reports every duplicate group table-wide, which is
the right shape for detection but useless as a per-repair proof: staging carries 12 unrelated groups
(finding F-57), so an unscoped run is permanently red there.

### 8c. Row-key UNIQUE constraints on promoters / peer_companies / ipo_intermediaries (item 1 slice s2, gated)

`web/drizzle/migrations/_gated/E1_row_key_unique_constraints.sql` is deliberately kept OUT of
`meta/_journal.json` (see that file's own header and `_gated/README.md` entry 10) — it is
owner-applied per slot, in this exact order, never skipped:

1. **Add the column via a release.** `normalized_name` (`NOT NULL DEFAULT ''`) already ships in
   journaled migration `20260909153933_sloppy_morph` — this step is done once the release
   carrying that migration has deployed to the slot.
2. **Run the backfill.** `scraper/scripts/backfill-normalized-name.ts` against the slot — dry run
   first, then `--apply` — until it reports 0 rows still at `''`.
3. **Apply this gated file** (`E1_row_key_unique_constraints.sql`) by hand, through the tunnel.
4. **Verify.** `npx tsx scripts/assert-row-key-constraints.ts "$DATABASE_URL"` (read-only; queries
   `information_schema.table_constraints` for the three constraint names and exits 1 naming any that
   are missing). Run this against the SAME slot step 3 was just applied to — an operator's memory of
   having run step 3 is not proof, and nothing else checks whether it actually landed (F-2 / item 1
   slice s2 fix round: `assert-schema-drift.ts` cannot see this — it reads only column shape, never
   constraints).

**Not wired into the nightly audit.** Unlike `assert-schema-drift.ts` (which runs every night against
prod), `assert-row-key-constraints.ts` is NOT called from the nightly audit cron. The gated file is
applied per-slot, on the owner's own schedule, and there is no `KNOWN_GATED_TYPE_DRIFT`-style allow-list
here yet — an unconditional nightly call would report FAIL every night on any slot the owner has not
yet hand-applied it to, which is not a defect, just an unfinished rollout. Running it manually as step 4
above, right after step 3, is the intended cadence. Revisit once every slot has the constraint applied:
at that point a nightly check earns its keep (catching a FUTURE regression, e.g. a restore from an older
backup) and should be added then, not before.

**Precheck before step 3 — all three MUST read 0:**
```bash
cd scraper && PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"')
DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_staging" psql "$DATABASE_URL" -c "
  SELECT 'promoters' AS t, count(*) FROM promoters WHERE normalized_name = ''
  UNION ALL SELECT 'peer_companies', count(*) FROM peer_companies WHERE normalized_name = ''
  UNION ALL SELECT 'ipo_intermediaries', count(*) FROM ipo_intermediaries WHERE normalized_name = '';
"
```

**If the precheck reports a non-zero count for any table:** do NOT apply the gated file — go back to
step 2 (`backfill-normalized-name.ts --apply`) for that table and re-run the precheck. Applying the
file first fails immediately: every pre-existing `''` row on that table collides on the very first
`ADD CONSTRAINT` (27 promoters, 326 peer_companies, 178 ipo_intermediaries in prod as of this slice),
and the migration — and the deploy, if it were journaled — dies mid-flight.


### 8c-note. field_sources row_key — deferred to the slice that ships the constraint swap (item 1 slice s3)

Slice s3 added `field_sources.row_key` (column + widened non-unique index) but does NOT ship the
constraint swap or retarget any upsert's `ON CONFLICT` — see this slice's commit body and
`docs/design/build-cards/item-01-child-table-consolidated-writer.md` for the re-scope rationale
(the original F1-gated design created a broken window: `ON CONFLICT` naming a constraint that
doesn't exist yet before F1 is applied, and two untouched upsert paths breaking the other way once
it is). For the slice that DOES ship the swap, record here:

- **Four `field_sources` upsert sites must ALL retarget together**, in the same change that swaps
  the constraint: `packages/shared/src/repositories/field-sources-repository.ts` and its `web/lib/`
  copy (`trackFieldUpdate`'s `onConflictDoUpdate` target), `packages/shared/src/repositories/
  ipo-repository.ts:1143` (the duplicate-IPO merge provenance upsert, an owner-run production
  repair), and `scraper/scripts/lib/repair-tool.ts:222` (the shared upsert every field-repair
  script uses). Retargeting only the repository copies while the DDL is live reproduces this
  slice's original finding on the two paths this diff never touches.
- **`web/scripts/apply-phase0-direct.ts:88` creates the OLD three-column constraint by hand** —
  a bootstrap run on a fresh slot would recreate the wrong key unless that script is updated in
  the same change.
- **A real row key of `''` is indistinguishable from the singleton sentinel.** Nothing today
  rejects an empty row key for a table known to hold multiple rows per IPO (e.g.
  `financial_statements`) — the slice that ships the constraint swap must reject `rowKey === ''`
  for such tables, or a caller that forgets to pass one silently collides with the sentinel
  convention instead of failing loudly.

### 8d. Risk-factor row key: `(ipo_id, seq)` -> `(ipo_id, heading_hash)` (item 1 slice s6, gated)

`web/drizzle/migrations/_gated/E2_risk_factor_heading_hash_key.sql` is kept OUT of
`meta/_journal.json` (see its header and `_gated/README.md` entry 11). The journaled migration
`20260910121813_cooing_manta` ships ONLY the `ALTER TABLE ... ADD COLUMN heading_hash varchar(32)
NOT NULL DEFAULT ''`, which is safe unattended. The constraint swap is owner-applied per slot, in
this order, never skipped:

1. **Deploy the column.** Once the release carrying `20260910121813_cooing_manta` is on the slot.
2. **Backfill the hash.**
   ```bash
   cd scraper && npx tsx scripts/repair-risk-factor-heading-hash.ts --backfill          # dry run
   npx tsx scripts/repair-risk-factor-heading-hash.ts --backfill --apply
   ```
   Re-run until it prints `written=0`. Idempotent — a row whose stored hash already matches is
   not touched.
3. **Delete the duplicates** (same tool, second phase). Surplus rows sharing
   `(ipo_id, heading_hash)` go; the LOWEST `seq` survives, so the risk factor as it appeared
   earliest in the document is the one kept.
   ```bash
   npx tsx scripts/repair-risk-factor-heading-hash.ts --dedupe                          # dry run
   npx tsx scripts/repair-risk-factor-heading-hash.ts --dedupe --apply
   ```
   The dry run names every row it would delete (ipo, seq, heading) — read that list before
   applying. Re-run until it prints `deleted=0`.
4. **Precheck — BOTH counts MUST read 0:**
   ```sql
   SELECT 'blank_hash' AS check, count(*) FROM ipo_risk_factors WHERE heading_hash = ''
   UNION ALL SELECT 'surplus_duplicates', coalesce(sum(n-1),0) FROM (
     SELECT count(*) n FROM ipo_risk_factors GROUP BY ipo_id, heading_hash HAVING count(*) > 1) d;
   ```
   Run it against the slot through the tunnel (connection recipe: §1 and §8c).
5. **Apply the gated file** by hand, through the tunnel.
6. **Verify:** `npx tsx scripts/assert-row-key-constraints.ts "$DATABASE_URL"` against the SAME
   slot — an operator's memory of having run step 5 is not proof. That tool carries
   `unique_ipo_risk_factors_ipo_heading_hash` in its expected list, so a slot where step 5 was
   skipped reports `[MISSING]` and exits 1.

**If the precheck reports a non-zero count:** do NOT apply the gated file. A non-zero
`blank_hash` means step 2 has not finished on this slot; a non-zero `surplus_duplicates` means
step 3 has not. Go back to that step, re-run it with `--apply`, and re-run the precheck. Applying
first hits a duplicate-key violation on the very first `ADD CONSTRAINT` and dies mid-flight —
the same hazard §8c exists to avoid.

**Measured before proposing the constraint** (`ipodhan_staging`, 2026-09-10, 2748 rows / 34 IPOs):
7 collision groups, 21 rows, **14 surplus**, 6 IPOs — `prasol-chemicals-ltd` (x6, OPEN),
`hy-tech-engineers-ltd` (x5, LISTED), `pranav-constructions-ltd`, `ss-retail-ltd` (UPCOMING),
`sumax-engineering-ltd` (SME), `vinod-texworld-ltd` (x2, twice, OPEN). Every group is
byte-identical rows differing ONLY in `seq` (`distinct_bodies=1`, `distinct_kpis=1`,
`max_body_len=0`), so collapsing them loses no fact — unlike §8c's `ipo_intermediaries`, where the
5 collisions were one bank legitimately holding two roles. The duplicate emission itself is an
extractor defect (#502, with #503 for table rows scraped into the heading column); the write
path's de-duplication (`prepareRiskFactorRows`) is a guard against a mid-write constraint
violation, not the cure.

## 9. Nightly audit -> GitHub issues (live since 2026-09-07 03:45, dry-run by default)
Cron step [4/5] runs `scripts/audit-findings-to-issues.mjs`; dry-run until `touch /root/data-audit-ipodhan/state/issues-live`
(owner word after reading the first dry-run log `/root/data-audit-ipodhan/state/run-<date>.log`: `ISSUES-DRY-RUN` + the
planned create/comment/close/reopen list). Env `AUDIT_ISSUES_DRY_RUN=1` always forces dry-run. State:
`issues-sync-state.json` + `issues-sync.lock` in the same dir; live mode refuses when the dir is missing.

## 9a. Floor delta — the nightly consumer (T-497, signal-ownership.md R3)
Cron step [3/5] now tees the detection-floor's own `[FAIL]`/`[PASS]` lines to
`/root/data-audit-ipodhan/state/floor/<YYYY-MM-DD>.txt` (one fixed path per night, appended if the
step runs twice in a day), in addition to the combined `run-<date>.log`. Read two nights and diff
them: `node scripts/ops/floor-delta.mjs <today.txt> <yesterday.txt> [--notify]` — prints NEW/GONE/SAME
check ids and, for checks failing both nights, NEW per-check entities; exits 3 when anything is NEW
(0 otherwise). `--notify` POSTs a summary to the Notifier (`NOTIFIER_URL`/`NOTIFIER_KEY`, GLOBAL.md §2;
skips cleanly, never fails, when unset). `scripts/audit-findings-to-issues.mjs --new-only` files/comments
only on findings absent from the previous night (a brand-new check, or a rowKey that's genuinely NEW) —
wired into the cron as a **commented-out** line pending the owner's go-live decision (T-497 contract).

## 9b. Morning-read gate — SessionStart consumer + wave-dispatch refusal (T-499, signal-ownership.md)
Every session start runs `scripts/ops/morning-read-gate.mjs` (wired as a SessionStart hook,
`.claude/hooks/morning-read-gate.sh`): it reads the last two nights' floor files over `ssh rfp-vps`
(read-only `cat` of the cron-written file above), caches them under `scripts/ops/state/floor/*.txt`
(gitignored), falls back to that cache when the VPS is unreachable, and prints "floor delta:
unavailable (<reason>)" when neither source has 2 nights — never blocks the session. It also prints
`merged-not-deployed.mjs --brief` (T-498). Any NEW failing check id is merged into
`scripts/ops/state/floor-issues.json` as `{id, issue: null}` (an existing `issue` number is
preserved across re-merges). A PreToolUse hook on the `Agent` tool (`.claude/hooks/wave-dispatch-gate.sh`
-> `scripts/ops/wave-dispatch-gate.mjs`) refuses a dispatch whose prompt looks like a build/wave brief
(`Budget:` + `Class:` lines) while that file still lists an id with `issue: null`, naming the ids in the
refusal; reviewer prompts (`Tier A`/`Tier B` + `review`) are never blocked. Escape hatch: `SIGNAL_GATE_ALLOW=1`.
Fails open (allow) when the state file is missing/unreadable — file the issue and set its `issue` number
in `floor-issues.json` to clear the gate. Tests: `.claude/hooks/tests/morning-read-gate.test.mjs` +
`.claude/hooks/tests/wave-dispatch-gate.test.mjs` (`node --test .claude/hooks/tests/*.test.mjs`).

## 10. User-level hooks (this laptop)
Tests: `cd ~/.claude/hooks && python -m pytest tests -q` (from inside a repo, pytest picks up the repo config and errors).
Fix-contract hook log: `~/.claude/hooks/.fix-contract.log` (512 KB cap, rotates to `.1`); escape `AGENT_FIX_CONTRACT_ALLOW=1`.

### Merging two rows that are one IPO (duplicate rows)

Used 2026-09-09 on Asset Reconstruction Company (India) Ltd, which production carried twice (`ARCIL`
plus a nameless `asset-reconstruction-co-india-ltd`) because the name normaliser folds `Ltd` but not
`Company` vs `Co.`. Tool: `scraper/scripts/repair-merge-duplicate-ipo.ts` (routed through `IPORepository.mergeDuplicateInto`, the shared write path — its raw-SQL prototype `scripts/merge-duplicate-ipo.mjs` failed the write ratchet as a NEW unrouted `ipos` writer) — dry-run by default, refuses a prod
`--apply` without `--allow-prod`, backs up both rows and every child to `scraper/scripts/state/` first, and
runs the whole merge in one transaction.

```bash
PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"')
# run from scraper/ -- the tool uses @ipodhan/shared's db pool (DATABASE_HOST wins over DATABASE_URL)
export DATABASE_HOST=localhost DATABASE_PORT=15432 DATABASE_USER=ipodhan_app DATABASE_PASSWORD="$PW"
# 1. rehearse on staging (it usually carries the same pair)
DATABASE_NAME=ipodhan_staging npx tsx scripts/repair-merge-duplicate-ipo.ts --keep <uuid> --drop <uuid> [--set-issue-size <rupees>]
#    ... then the same line with --apply
# 2. prod dry run
DATABASE_NAME=ipodhan npx tsx scripts/repair-merge-duplicate-ipo.ts --keep <uuid> --drop <uuid> --set-issue-size <rupees>   --issue-size-note "<the evidence that proves the number>"
# 3. prod write (owner word only)
  ... --apply --allow-prod
```

It refuses the merge unless the two rows share an open date and their names fold together, and it
refuses outright when a strong identifier (`cin`/`isin`/`symbol`/`bse_ipo_no`/`bse_scrip_code`)
**disagrees** — that proves two offers rather than one row twice. It carries a column onto the
survivor only where the survivor is empty, writes a `field_sources` row (camelCase `field_name`)
keeping `previous_source` for every column it writes, repoints person-created children
(`user_watchlist`, `affiliate_clicks`, `ipo_reviews`, `audit_logs`, `brlm_track_record`) and deletes
only scraper-derived ones. Child tables are discovered from `information_schema` — 30 tables carry an
`ipo_id`, and a hand-typed list missed 11 of them on the first attempt.

Then drop the cache and verify:

```bash
ssh rfp-vps 'u=$(grep -h "^REDIS_URL=" /var/www/ipodhan/shared/env-prod/scraper.env | head -1 | cut -d= -f2- | tr -d "\"");
  pw=${u#redis://:}; pw=${pw%%@*};
  redis-cli -a "$pw" --no-auth-warning -n 0 DEL "ipo:slug:<old>" "ipo:slug:<new>" "ipo:id:<oldid>" "ipo:id:<newid>"'
curl -s "https://ipodhan.com/api/ipos/<new-slug>?cb=$RANDOM"     # the merged row
curl -s "https://ipodhan.com/api/ipos/<old-slug>?cb=$RANDOM"     # 200, serving the SURVIVOR via ipo_slug_redirects
```

(The env file is `shared/env-prod/scraper.env`, not `shared/scraper.env`.)

**The merge alone does not hold.** Discovery is what minted the duplicate, so unless the normaliser
is fixed the row can be re-created next cycle — `assert-repair-held.mjs` records that happening to
T-277C's merged duplicates. The held-proof is:

```bash
DUPLICATE_INVARIANT_FOLDS=<foldedname> node scripts/assert-repair-held.mjs   scripts/lib/repair-invariants/duplicate-ipo-rows.mjs --cycles 2
```

Without `DUPLICATE_INVARIANT_FOLDS` that invariant reports every duplicate group table-wide, which is
the right shape for detection but useless as a per-repair proof: staging carries 12 unrelated groups
(finding F-57), so an unscoped run is permanently red there.


## Corrupted stored URLs — find them, and the repair that waits for the owner (#582, 2026-09-11)

Read-only, through the tunnel. Finds any stored company website carrying a character outside the
RFC 3986 alphabet — the class that made `Hy-Tech Engineers Ltd.` unreachable via one brace:

```bash
psql "$DSN" -At -F"|" -c "
  select company_name, company_website from ipos
  where company_website is not null
    and company_website !~ '^[A-Za-z0-9:/?#\[\]@!\$&''()*+,;=._~%-]+\$'
  order by company_name;"
```

Measured on `ipodhan_staging` 2026-09-11: **1 of 36** non-null values.
`Hy-Tech Engineers Ltd. | https://www.hy{echengineers.com`

Confirm before believing it is corruption rather than an exotic host — the corrupt name must not
resolve AND the corrected one must:

```bash
node -e 'const d=require("dns");for(const h of process.argv.slice(1))d.lookup(h,{all:true},(e,a)=>console.log(h,e?e.code:JSON.stringify(a)))' \
  "www.hy{echengineers.com" "www.hytechengineers.com"
# expect: ENOTFOUND for the first, public addresses for the second
```

**The repair is a DATA WRITE and is NOT run without the owner's word.** When approved, dry-run first
(`select` the rows the `update` would touch, print the count), then apply on staging, read it back,
and only then prod on a separate approval:

```sql
-- dry run: exactly the rows that would change, and how many
select id, company_name, company_website, replace(company_website,'hy{ech','hytech') as would_become
from ipos where company_website like '%hy{ech%';

-- apply (owner's word only), then read back
update ipos set company_website = replace(company_website,'hy{ech','hytech'), updated_at = now()
where company_website like '%hy{ech%';
```

Redis: the IPO's cached payload must be dropped after any manual row change, or the site serves the
old value for up to an hour — `DEL ipo:detail:<slug>` and the documents key for that IPO
(see the manual-DB-reset note in §2).

Detection so this is not found by reading logs again: substance check
`company_website_characters` (`scripts/lib/substance-checks.mjs`), which names the offending
character. Note its column must be in the `SELECT` of `audit-substance-plausibility.mjs` or the
check silently examines nothing — the suite's own test enforces that.

## 11. Merging a PR — never on a remembered check (incident 2026-09-11, PR #588)

PR #588 was merged on a stale green: both freshness clauses had fired, the
check *had* been run, but it was typed into the same shell command as the
`gh pr merge`, so the clause output printed after the decision was already
committed. Main survived on luck. "Run them as two separate commands" was
rejected as a fix — it is a habit, and a habit fails the first time someone is
tired at 5am.

The mechanism is an exit code:

```bash
node scripts/ops/merge-if-current.mjs <pr-number> && gh pr merge <pr-number> --squash
```

The gate never merges — it holds no merge code path, so there is no ordering in
which a merge could precede the checks. The shell `&&`, not a human, enforces
the sequencing. On a refusal it prints nothing copy-pasteable.

What it refuses on, in order (it stops at the first failure, and the order
matters — a CONFLICTING PR produces no `pull_request` check run at all, which
looks exactly like queue latency if you read CI first):

| exit | meaning |
|---|---|
| 0 | every clause clear |
| 1 | usage (including `--force` with no 20+ character `--reason`) |
| 2 | not mergeable: conflicting, draft, closed, or mergeability still UNKNOWN |
| 3 | a check is not a genuine pass: failed, CANCELLED, never started, or no checks at all |
| 4 | stale: a freshness clause fired |
| 5 | the gate itself cannot run (e.g. `typescript` unresolvable, so clause 2 cannot parse imports) |

Freshness clauses (`BASE = merge-base origin/main <head>`; `MOVED` = files
changed in `BASE..origin/main`):

- **clause 1** — `MOVED` touches `.github/workflows/` or `scripts/ci/`. The
  green was produced by the old pipeline definition.
- **clause 2** — `MOVED` overlaps what the branch changed, or a file the branch
  changes first-level imports. Imports are read with `ts.createSourceFile`, not
  a regex sweep. First level only: a dependency two hops away does not fire it.
- **clause 4** — main and the branch both changed a generated aggregate
  (`docs/reviews/detection-checks.json`, `docs/reviews/failure-classes.md`). A
  textually clean git merge of a generated file can still be semantically stale.

The remedy is the same for all three: rebase, push, let CI run against what
would actually be merged, re-run the gate.

`--force --reason "<20+ chars>"` bypasses, prints every clause that fired, and
echoes the reason so it lands in the record. Paste that output into the PR body.

## 12. Integration tests: the only sanctioned target (issue #690)

Owner decision 2026-08-28: "Don't create any new database." Every app database lives on the
**one** Windows-VPS Postgres (`103.118.16.189`) — there is no throwaway/local Postgres for this
project, and there never should be one. `scraper/.env.test.example` used to tell readers to
"point it at a throwaway/local Postgres + Redis instance" — that instruction contradicts the
owner's rule and is what sent agents improvising a local DB each time. This section is the
correction; the example file now points here instead of re-describing the recipe.

**Why the file keeps going missing.** `scraper/.env.test` is gitignored (see the repo root
`.gitignore`), so **every fresh worktree lacks it** — there is nothing to inherit. An agent that
needs an integration proof and finds no `.env.test` either reports the proof unverified or
improvises a local database, which is how this was rediscovered on 2026-09-16 (issue #690). The
fix is not to commit the file (it would need a real password) — it is to make the recipe
findable so the agent copies it instead of inventing one.

**The sanctioned target — nothing else may be used for scraper integration tests:**

- Database: **`ipodhan_test`**, on the one Windows-VPS Postgres instance (`103.118.16.189`).
- Reached through the tunnel on **`localhost:15432`** (§1 above) — this is the ONLY sanctioned
  port for tests. A second, undocumented tunnel may exist on `5432` on this machine
  (`-L 5432:127.0.0.1:5432` to the same host); **5432 must not be used for tests**. Do not
  investigate or touch that process — it is out of scope for this recipe.
- Role: **`ipodhan_app`**. Its schemas were moved to that role on 2026-09-09 specifically so
  `ipodhan_test` can be dropped and rebuilt unattended by a non-superuser.

**`.env.test` template** (copy to `scraper/.env.test`; read the password by NAME from
`D:\Abhay\GLOBAL.env`, never paste the value into this file or any repo file):

```bash
# Read the password at use-time, do not hardcode it:
#   PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"')

DATABASE_URL=postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_test
DATABASE_HOST=localhost
DATABASE_PORT=15432
DATABASE_NAME=ipodhan_test
DATABASE_USER=ipodhan_app
DATABASE_PASSWORD=${PW}

# Redis: same posture as before this section — an unauthenticated local/CI Redis.
# This project has no sanctioned shared test Redis; if a suite needs one, run it
# locally (`redis-server` or a disposable container) — Redis is not the resource
# under the "no new databases" rule, Postgres is.
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PASSWORD=
```

**Rebuild recipe** (run before use, and any time the schema looks stale — this is what makes an
unattended rebuild safe on a non-superuser role):

```bash
PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"')
DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_test" psql "$DATABASE_URL" -c "
  DROP SCHEMA public CASCADE; CREATE SCHEMA public;
  DROP SCHEMA IF EXISTS drizzle CASCADE;
"
cd web && DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_test" npm run db:migrate
```

Check: the rebuild is correct when it leaves **35 tables** — the same table count as prod/staging.
A mismatch means a migration is missing or the wrong database was targeted; do not proceed to
run tests against a mismatched count.

**The rule, stated plainly:** no other port, database, or tunnel may be used for scraper
integration tests. `localhost:15432` against `ipodhan_test` under `ipodhan_app` is the only
sanctioned path. If this recipe is missing or wrong when you read it, say so and stop — do not
invent a local Postgres to route around it.

### Read the test COUNT, never the exit status (verified 2026-09-16)

With `DATABASE_URL` unset, the suite does not fail — it **skips and exits 0**:

```
Tests  no tests
exit 0
```

So a run that executed **nothing** is indistinguishable, to anything checking the exit status, from
a run where every test passed. Chained into `&&`, or read by a script that gates on `$?`, it goes
green on zero coverage.

**`Tests  no tests` is a skipped suite, not a passing one.** Always read the count. Two more ways to
get a misleading result from a correct-looking command:

- **`REDIS_URL` is required even for suites that never touch Redis** — omit it and the suite skips
  the same silent way.
- **Files sharing a table must run one at a time.** `ipo_field_plan` is shared, and
  `FOR UPDATE SKIP LOCKED` is *designed* to return nothing under contention — so a parallel run
  produces a failure that looks like a real defect and is not. Serialise the files; never weaken the
  claim SQL to make a parallel run pass.
## 13. The scraper's wake schedule — it is OS cron now, not pm2 (item 7 slice 1, 2026-09-16)

**What changed.** pm2's `--cron-restart="*/30 * * * *"` used to do two jobs at once: it was the
only bound on a hung scraper AND the only thing that woke it. It bounded the scraper by *killing*
it mid-cycle every 30 minutes, which is what OD-55 forbids ("let the scraper take whatever time it
needs"). Both jobs are now separate and explicit:

| Job | Before | After |
|---|---|---|
| Wake the scraper | pm2 `--cron-restart` | OS crontab line, installed by `deploy-linux.sh` |
| Bound a hung run | pm2 kill at 30 min | `timeout` 2 h inside `scripts/scraper-wake.sh` (OD-55) |
| Skip an overlapping wake | nothing — it killed and restarted | the wrapper's Redis lock read, which logs why it skipped |

**The line the deploy installs** (rewritten on every deploy, idempotent, scoped to its own slot by
the trailing marker — a prod deploy never touches staging's line):

```
*/30 * * * * /var/www/ipodhan/current/scripts/scraper-wake.sh data >> /var/log/ipodhan-scraper-wake-prod.log 2>&1 # ipodhan-scraper-wake:prod
15,45 * * * * .../current-staging/scripts/scraper-wake.sh data >> /var/log/ipodhan-scraper-wake-staging.log 2>&1 # ipodhan-scraper-wake:staging
```

The path is the `current` symlink, never a release directory: retention pruning deletes old
releases, so a schedule pinned to one would start failing silently after a rollback plus a few
deploys.

**Cron's environment is not pm2's**, and the wrapper compensates for that itself. cron gives
`PATH=/usr/bin:/bin`, no login shell, no nvm, no cwd — so `npx` typically resolves to nothing. The
wrapper therefore resolves an absolute `node` and the workspace's own `tsx/dist/cli.mjs`, exports
`TZ=UTC` (T-327 P2-7) and `PYTHON_BIN` (W-111/W-112), and **refuses with exit 78** rather than
running without them. Overrides, if the box needs them, go in the cron line:
`SCRAPER_NODE_BIN=/usr/bin/node SCRAPER_TSX_BIN=/path/to/tsx/dist/cli.mjs PYTHON_BIN=/path/to/venv/bin/python`.

**Exit codes are three distinct readings:** `0` clean finish or a deliberate lock-skip, `124` the
2-hour ceiling fired, `78` a refusal to start (no `timeout`, no node, no tsx — nothing ran), and
anything else is the cycle's own crash status.

Staging keeps the `:15/:45` offset so two slots' extractors never land in the same minute on the
2-vCPU box (W-178).

**Reading it on the box** (read-only; the VPS is production — no ad-hoc runs):

```bash
crontab -l | grep ipodhan-scraper-wake          # is the wake scheduled at all?
tail -50 /var/log/ipodhan-scraper-wake-prod.log # what did the last wakes do?
grep -c wake-skipped  /var/log/ipodhan-scraper-wake-prod.log   # skipped on a held lock
grep    ceiling-tripped /var/log/ipodhan-scraper-wake-prod.log # hit the 2-hour ceiling
```

**The failure mode to watch for.** With `--no-autorestart` and no cron line, pm2 shows the scraper
app as *exited* — which is exactly what a healthy one-shot looks like — while nothing is scraping.
So `pm2 status` alone can NEVER tell you the wake is alive. **`crontab -l | grep
ipodhan-scraper-wake` is the check**; if it returns nothing, the scraper is not running at all and
the deploy's `install_scraper_cron` warn line will say so in the deploy log.

### 12a. The cost of OD-55: a crashed cycle now blocks the next wake for 2h05m

**Read this before clearing anything.** Raising the ceiling changed a real operational number, and
it is a cost, not a free win:

| | Before | After |
|---|---|---|
| A cycle that crashes without releasing its lock blocks the next wake for | **25 minutes** | **2 h 05 m** |

Why: the `scraper:cycle` lock TTL used to be sized deliberately *shorter* than pm2's 30-minute
force-restart, so a killed cycle's lock was always gone before the next one. That restart is
exactly what this slice removes (OD-55 — a document read is not on a clock), so the TTL now sits
above the 2-hour ceiling instead: the **ceiling** ends a hung cycle, never a lock expiry.

A *healthy* long cycle is unaffected — it extends its lock every 5 minutes. The 2 h 05 m only
applies when the extender stops, i.e. the process died without its signal handler running (SIGKILL,
OOM kill, a hard box reboot). A normal crash or a `pm2 stop` releases the lock on the way out.

**Symptom:** every wake logs `wake-skipped` with a large `lock_ttl`, and no cycle runs.

```bash
tail -20 /var/log/ipodhan-scraper-wake-prod.log | grep wake-skipped   # is it skipping every time?
redis-cli -u "$REDIS_URL" TTL lock:resource:scraper:cycle             # seconds left (-2 = free)
pm2 status ipodhan-scraper                                            # is a cycle genuinely running?
```

**Clearing it — only when no cycle is actually running.** The lock is doing its job if one is; check
`pm2 status` and the box's node processes first. A wrongly-cleared lock lets two cycles write
concurrently, which is the thing the lock exists to prevent.

```bash
# 1. PROVE nothing is running before deleting anything.
pm2 status ipodhan-scraper                 # expect 'stopped'/'errored', not 'online'
pgrep -af 'tsx .*src/index.ts' || echo "no cycle process — safe to clear"

# 2. Then, and only then:
redis-cli -u "$REDIS_URL" DEL lock:resource:scraper:cycle
redis-cli -u "$REDIS_URL" DEL lock:resource:filing-auto-persist:cycle   # the inner one, same rule

# 3. The next cron wake picks it up. Do NOT hand-start a cycle to "catch up" —
#    a wake is due within 30 minutes and a manual run competes with it.
tail -f /var/log/ipodhan-scraper-wake-prod.log
```

The deploy already clears both keys on every deploy (`release_scraper_cycle_locks()` in
`deploy-linux.sh`, atomically and only if the token still matches), so a deploy is the safe way to
clear a stale lock when one is due anyway.

### 8e. 2026-09-16 production repair session (#661, item 2 slice 3b, #692) — BLOCKED, not applied

Owner-approved repair session for three classes (provenance-for-absent-values #661/#684, segment
provenance item-2-s3b #650/#655, STANBIK face-value-as-band #692/#515). All three read cleanly on
prod but **none applied** — every write path shares `scraper/scripts/lib/repair-tool.ts`'s
`upsertFieldSource()`, which targets `field_sources.row_key`, a column `schema.ts` declares and a
regular (non-gated) journaled migration (`20260910043758_salty_shen.sql`, tag
`20260910043758_salty_shen` in `meta/_journal.json`) adds — but production has never run it. See
`### 8c-note` above: the *constraint swap* (`_gated/E1_row_key_unique_constraints.sql`) is
deliberately gated; the plain `ADD COLUMN row_key` migration is NOT gated and should be live on
prod but isn't. `npm run audit:schema-drift` against prod (tunnel) confirms independently:
`[MISSING_COLUMN] "field_sources.row_key"`, `[MISSING_COLUMN] "data_conflicts.row_key"`, plus
dozens of missing indexes/unique constraints across dependant tables — production's applied
migrations are behind main by more than this one column.

**Repair 1 — provenance-for-absent-values (#661/#684).**
```bash
cd scraper && npx tsx scripts/repair-provenance-for-absent-values.ts          # dry-run
```
`current_database(): ipodhan` printed. BEFORE count printed partially (450 across 12 fields,
in progress toward the PR's measured 453/13) before the SELECT itself crashed:
`column fs.row_key does not exist` (`42703`) on the 13th field (`openDate`). Never reached
`--apply`. **STOP — not applied.**

**Repair 2 — segment provenance (item 2 slice 3b, #650/#655).**
```bash
cd scraper && npx tsx scripts/repair-segment-provenance.ts                                    # dry-run
cd scraper && npx tsx scripts/repair-segment-provenance.ts --apply --allow-prod               # apply
```
Dry-run: `current_database(): ipodhan`, **39 rows WOULD be written of 335 candidates** —
`{"clear-non-ipo":31,"apply-sourced":8}`. The 8 `apply-sourced` rows are exactly the ones named in
#650/#655 (WINDLAS BIOTECH, KWALITY WALLS, AAA TECHNOLOGIES, CMS INFO SYSTEMS via NSE; WESTERN
OVERSEAS STUDY ABROAD, SHIPWAVES ONLINE, STANBIK AGRO, MARUTI INTERIOR PRODUCTS via BSE); the 31
`clear-non-ipo` rows are pre-existing, PR-documented tool behaviour ("Non-IPO rows → cleared to
NULL... unchanged behaviour", PR #661 body) — not a new/unexplained population, so this did NOT
trip the stop condition. Apply crashed on the FIRST insert (`RAVINDRA ENERGY LTD`, offering_type
rights): `column "row_key" of relation "field_sources" does not exist`. The insert runs inside
`NodePgSession.transaction()` — Postgres aborts the whole transaction on error, so nothing
committed. Read-back dry-run after the crash reconfirmed **39 of 335, unchanged**. **STOP — not
applied, no partial write.**

**Repair 3 — STANBIK face-value-as-band (item 2 slice 6, #692/#515).**
```bash
cd scraper && npx tsx scripts/repair-face-value-band-chittorgarh.ts --slug stanbik-agro-ltd                              # dry-run
cd scraper && npx tsx scripts/repair-face-value-band-chittorgarh.ts --slug stanbik-agro-ltd --apply --expect-db ipodhan --allow-prod   # apply
```
Dry-run (takes ~4-5 min live-fetching Chittorgarh report 82 across FY2024-25/2025-26/2026-27,
FY2026-27 mainboard+SME buckets fail gracefully at the 200-page ceiling per the tool's documented
resilience fix): `current_database(): ipodhan`, class rows = 1, resolved
`stanbik-agro-ltd: issue price 30.00 (2025 sme, .../stanbik-agro-ipo/2602/); face_value=10` —
matches the PR body exactly. Apply: `ALLOW-PROD: writing against "ipodhan"`, resolved the same
price, then `BROKE writing stanbik-agro-ltd: ... column "row_key" of relation "field_sources" does
not exist` (tool's own per-row error handling, exit 2). Read-back dry-run after: class rows still
1, same resolution — unchanged. **STOP — not applied, no partial write.**

**Unblock:** run the journaled (non-gated) migrations against prod — at minimum
`20260910043758_salty_shen` (adds `field_sources.row_key`, `data_conflicts.row_key`) — via the
normal `db:migrate` path, on the owner's word (schema DDL against prod is outside a data-repair
brief's authority; `audit:schema-drift` names the full gap, most of which is unrelated missing
indexes/constraints, not just `row_key`). Once applied, re-run all three dry-runs (expect the same
identities/counts measured here — 453ish provenance rows across 13 fields, 39 segment rows
[8 apply-sourced + 31 clear-non-ipo], 1 STANBIK row) then `--apply --allow-prod`, then the
`assert-repair-held.mjs --cycles 2` prod hold for each, per the owner brief.

**Prod hold command (not started — nothing applied to hold):**
```bash
node scripts/assert-repair-held.mjs provenance-parent-not-null --cycles 2 --expect-db ipodhan
node scripts/assert-repair-held.mjs segment-provenance --cycles 2 --expect-db ipodhan
node scripts/assert-repair-held.mjs face-value-band-chittorgarh --cycles 2 --expect-db ipodhan
```

## 14. Staging windows and the manual button (owner standing rule 2026-09-16, "staging deploys in windows, not per merge")

**What changed.** Staging used to auto-deploy on every push to `main` (34 deploys on 2026-09-10
alone), then on a GitHub `schedule` poll that was measured to NEVER actually fire on this repo's
Actions setup (29 `push` runs, 1 `workflow_dispatch`, 0 `schedule` runs — see the header of
`.github/workflows/deploy-linux.yml`). Both automatic triggers are gone. `deploy-linux.yml` has no
automatic trigger at all now — only `workflow_dispatch`, with a `mode` input (`manual` default,
or `window`). The reliable timer is the box's own root crontab, the same mechanism the scraper
wake already uses.

**The two windows.** 13:30 and 21:30 IST, installed by `scripts/deploy-linux.sh`'s
`install_staging_window_cron` (staging slot only — a prod deploy never installs or touches this
line), idempotent and marker-scoped exactly like the scraper wake line:

```
30 13,21 * * * /var/www/ipodhan/current-staging/scripts/ops/staging-window-deploy.sh >> /var/log/ipodhan-staging-window.log 2>&1 # ipodhan-staging-window
```

The payload, `scripts/ops/staging-window-deploy.sh`, runs `gh workflow run deploy-linux.yml -f
slot=staging -f mode=window` and gets out of the way — it never waits for the run. A `mode=window`
dispatch still runs the served-vs-head + docs-only skip gate (same logic that used to run only on
`schedule`), so a window with nothing new to deploy correctly no-ops rather than rebuilding
unchanged code.

**The manual button.** `scripts/ops/deploy-staging-now.sh --reason "<text>"`, run from a laptop
with `gh` authenticated. Dispatches with `mode=manual` (always deploys unconditionally, same as
every dispatch did before this change). Capped at **2 dispatches per calendar day** — a per-day
JSON counter at `scripts/ops/state/staging-now-YYYY-MM-DD.json` (gitignored, laptop-local). A 3rd
dispatch the same day is refused, printing the first two reasons; `--override` bypasses the cap
and is logged as an override in the same state file. `--dry-run` prints the exact `gh` command
without dispatching or counting.

**Reading a window run:**

```bash
tail -50 /var/log/ipodhan-staging-window.log            # did the cron fire, did gh accept the dispatch?
gh run list --workflow deploy-linux.yml --limit 5        # the runs themselves — look for mode=window
gh run view <run-id> --log | grep -A3 'Decide whether a window staging deploy is needed'
crontab -l | grep ipodhan-staging-window                 # is the window actually scheduled?
```

A run whose `decide` job printed `no deploy this tick` (served already matches head, or the only
changes are docs) is a correct skip, not a failure — the workflow still exits green.

**Prod is untouched.** The `decide` job refuses any `mode=window` dispatch against `slot=prod`
outright (separate step, fails loudly) — a window can only ever reach staging; the only route to
prod remains an explicit human `workflow_dispatch` with `slot=prod` from a `release/prod-<date>`
branch (W-141, unchanged by this rule).

## 15. Config-only deploy (S5) — a manifest change reaches a slot without a build (item 3 S5, 2026-09-17)

**What it does.** `scripts/ops/deploy-config.sh` copies ONLY `scraper/config/field-manifest.json`
from a sha on `origin/main` into `$ROOT/shared/config/<slot>/field-manifest.json`, verifies it,
writes a `CONFIG_SHA` file next to it, and appends one line to `shared/config/deploy-config.log`.
Every release's `scraper/config/field-manifest.json` is a symlink into that shared file
(`scripts/deploy-linux.sh`'s release-link block, step 5.1) — no build, no PM2 restart, no new
release directory. The next scraper wake reads through the symlink and logs
`field-manifest: version=... fields=... sha256=... config_sha=<sha>`.

**Run it (staging, from the laptop):**

```bash
ssh rfp-vps "cd /var/www/ipodhan/current-staging && bash scripts/ops/deploy-config.sh \
  --slot staging --sha <sha on origin/main> --reason \"<why>\""
```

**Run it (prod)** — same command with `--slot prod --i-have-the-owners-word`, only on the owner's
explicit word (the script refuses `--slot prod` without that flag):

```bash
ssh rfp-vps "cd /var/www/ipodhan/current && bash scripts/ops/deploy-config.sh \
  --slot prod --sha <sha on origin/main> --reason \"<why>\" --i-have-the-owners-word"
```

**Rollback** — the same command with the previous sha; it is logged like any other run, nothing
destructive happens (the shared file is just overwritten again).

**Repo-root resolution.** A release directory (what `current`/`current-staging` point at) has no
`.git` above it — it is a `git archive | tar -x` export (#748) — so the script can't read
`origin/main` from its own checkout. It resolves the checkout to use, in order: `DEPLOY_CONFIG_REPO`
if set; else its own tree, if that happens to be a real git checkout (laptop/CI); else the on-box
clone at `/var/www/ipodhan/repo` (the server default). The command above works unmodified because
that on-box clone is the server default. Set `DEPLOY_CONFIG_REPO=<path>` only on a box where the
repo clone lives somewhere else. The run's first log line names which one it picked
(`repo-root: using <path> (...)`).

**Reading the result:** (prod's current link is `current`, not `current-prod`; staging's is
`current-staging` — substitute `current` for `<slot>=prod` below, `current-staging` for
`<slot>=staging`)

```bash
ssh rfp-vps "readlink /var/www/ipodhan/current-<slot>/scraper/config/field-manifest.json"  # -> /shared/config/<slot>/field-manifest.json
ssh rfp-vps "cat /var/www/ipodhan/shared/config/<slot>/CONFIG_SHA"                          # the sha just deployed, or 'release'
ssh rfp-vps "tail -1 /var/www/ipodhan/shared/config/deploy-config.log"                      # <iso> <slot> <sha> <sha256> <user> <reason>
```

The next scraper cycle's start-of-run log line names the same sha:
`field-manifest: version=... fields=... sha256=... config_sha=<sha>` — that line, read from the
cycle log, is the runtime proof a config-only deploy actually took effect.

**The files involved.** `$ROOT/shared/config/<slot>/field-manifest.json` (the live file, symlinked
into every release), `$ROOT/shared/config/<slot>/CONFIG_SHA` (`<sha>` or the literal `release` when
no config deploy has run yet — the release's own committed file is what is being served), and
`$ROOT/shared/config/deploy-config.log` (append-only history of every run, any slot).

**The cap.** Staging is capped at **4 config-deploy runs per UTC calendar day**
(`scripts/ops/state/deploy-config-staging-<date>.json`, laptop/box-local, gitignored) — a 5th run
the same day is refused with reason `cap`. Prod carries no daily cap; `--i-have-the-owners-word`
is the gate instead. `--dry-run` prints what would happen and writes nothing.

### 15a. The three guards that stop a config/code mismatch killing the scraper (#793, 2026-09-19)

**What went wrong first.** A commit tightened the manifest SCHEMA (`comparisonFamily` became a
required enum) and updated the repo's manifest in the same change. The code deployed to staging;
the shared config stayed a day old, because a code deploy deliberately never overwrites it (only
the command in section 15 does). All 190 fields failed validation, the scraper crashed at process
start in 4-6 seconds, every 30-minute cycle failed from 02:33Z, and the deploy reported SUCCESS
throughout — its gate checks served sha, migrations and row counts, none of which need the scraper
to start. Eighteen `wake-failed` lines sat unread. A human noticed 28 minutes later.

The general shape, not specific to this manifest: **any config whose VALIDATOR ships on the code
path while its VALUE ships on a different path.**

**Guard 1 — the deploy refuses (automatic).** `preflight_deployed_config()` in
`scripts/deploy-linux.sh` runs `scraper/src/scripts/validate-deployed-config.ts` against the
release, loading all four `scraper/config/*.json` files through the scraper's OWN loaders. A
refusal fails the deploy and prints the loader's own error. Nothing to run by hand; to check a
release yourself:

```bash
cd /var/www/ipodhan/current-staging/scraper   # or current/ for prod
node ../node_modules/tsx/dist/cli.mjs src/scripts/validate-deployed-config.ts \
  --release-dir /var/www/ipodhan/current-staging
```

Exit 0 = every deployed config loads under the deployed schema. Exit 1 names the file, the
resolved symlink target, and why it was refused. **Fix for the refusal is always section 15:**
`scripts/ops/deploy-config.sh --slot <slot> --sha <the served sha>`.

**Guard 2 — the wake log has a reader.** From the laptop:

```bash
node scripts/ops/wake-delta.mjs --slot staging          # read it
node scripts/ops/wake-delta.mjs --slot prod --file-issues # read it and file the NEW ones
```

Read-only ssh. Prints each failure class as an identity (kind, exit code, occurrence count, first
and last seen, jobs) and diffs NEW / GONE / SAME against `scripts/ops/state/wake-<slot>.json`.
Exit 3 = a failure class with no issue number (signal-ownership R2); clear it with `--file-issues`
or `--track '<kind>::exit=<N>=<issue>'`. Exit 2 = the ssh read itself failed, with its cause.

**Guard 3 — lineage drift, read from OUTSIDE the scraper.**

```bash
node scripts/ops/config-lineage.mjs --slot staging          # read it
node scripts/ops/config-lineage.mjs --slot prod --notify    # read it and page on drift
```

Exit 0 = in sync, or genuinely unknowable (it says which). Exit 3 = the config is
from a different commit than the code, with the `deploy-config.sh` line to fix it.

**Why this is a separate script and not just the scraper's own hourly check.** The
in-cycle copy (`checkConfigLineage` in `scraper/src/services/deploy-drift-monitor.ts`)
runs from `runStep(...)` inside `main()`, and `main()` (`scraper/src/index.ts:1651`) is
reached only AFTER the startup config validators at 1646-1650 — the very calls that
throw when config and schema disagree. In the full incident the process is dead in 4-6
seconds and that check never executes. It is a detector killed by the failure it
detects, so it is kept only as a secondary signal for the weaker case (config stale but
still schema-valid); this script is the one that actually covers the outage.

**`CONFIG_SHA` reading `release` is NOT an all-clear.** `deploy-linux.sh` writes that
marker in exactly one branch — the first seed, when the shared file was missing — and no
later deploy rewrites it. A slot seeded once on day 1 still reads `release` after thirty
deploys, with day-1 config. Both this script and the in-process check report it as
UNKNOWN rather than in-sync, because it is the most drift-prone state, not the safest.
Guard 1 is what covers that case: it validates content on every deploy regardless of sha.

To read the two shas by hand:

```bash
# The port is whatever the slot's env file says, and the monitor reads it the
# same way - never hardcode one here.
SLOT=staging
ssh rfp-vps "cat /var/www/ipodhan/shared/config/$SLOT/CONFIG_SHA"
ssh rfp-vps "PORT=\$(sed -n 's/^PORT=//p' /var/www/ipodhan/shared/env/$SLOT/web.env.local); curl -s localhost:\$PORT/api/version"
```

## 16. unattended-upgrades must not restart the Actions runners (owner-approved 2026-09-26, #630)

**Why:** needrestart's post-upgrade sweep restarted `actions.runner.*`, which killed staging deploy run 34549307959
(`a854ca7a`) at 06:45:46 IST and skipped `deploy-linux.sh`'s EXIT trap, leaving an orphan `npm run build` and a
half-built release folder. It recurs on every upgrade that overlaps a deploy.

**Applied 2026-09-26 on the VPS (owner OK for this one change):** `/etc/needrestart/conf.d/zz-no-actions-runner-restart.conf`

```
$nrconf{override_rc}{qr(^actions\.runner\..+\.service$)} = 0;
```

It covers both runners on the box (`actions.runner.abhayla-IPODhan.linux-vps-ipodhan` and
`actions.runner.abhayla-BestDematAccount.hostinger-deploy`). Security upgrades still apply; a runner picks up library
updates at its next normal restart.

**Read it back (read-only):**

```
ssh -o BatchMode=yes rfp-vps 'perl -c /etc/needrestart/conf.d/zz-no-actions-runner-restart.conf; systemctl is-active actions.runner.abhayla-IPODhan.linux-vps-ipodhan.service'
```

Proof that needrestart loads it: `needrestart.conf` lines 229-230 `do` every `conf.d/*.conf`; loading the real config
and matching the IPODhan runner's unit name yields exactly one rule, `^actions\.runner\..+\.service$ => 0`.
**Undo:** `rm /etc/needrestart/conf.d/zz-no-actions-runner-restart.conf`. The repo-side half (a deploy start removes
orphan half-built releases the killed trap left behind) stays open in #630.
