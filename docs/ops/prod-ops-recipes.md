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
| DB tunnel | `ssh -i ~/.ssh/ipodhan_vps -o BatchMode=yes -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -N -L 15432:localhost:5432 Administrator@103.118.16.189` | run in the background; `localhost:15432` then reaches prod Postgres. Manual and session-scoped: every fresh session starts with the port down. |

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
grep -h "extractionFailed" ~/.pm2/logs/ipodhan-scraper-out.log | tail -1
# extractor priority on the next cycle (expect ni=10 after the 2026-09-06 release)
ps -o ni=,pid=,args= -p $(pgrep -f venv/prod/bin/python) 2>/dev/null
# tick step (T-498, signal-ownership R5): fix/feat commits merged to main but not yet on the prod tag
node scripts/ops/merged-not-deployed.mjs --brief
```
Env files: `/var/www/ipodhan/shared/env/{prod,staging}/{web,scraper}.env`. Never print a URL value: values are quoted, so mask with `sed -E 's#://[^@]*@#://***@#'` AFTER stripping the key, or print only `grep -c`/key names. Edits: `cp -p $f $f.bak-<date>-<reason>` then append; a scraper.env change takes effect at the next pm2 start.
Standing lines added 2026-09-06: `DSN_ASSERT_REDIS_DB=0` (prod) / `=1` (staging).
Layout: `/var/www/ipodhan/{releases,releases-staging,current,current-staging,shared,repo}`.

## 3. Deploy (only from a frozen release branch, one prod deploy per day, 21:00-23:30 IST)

```bash
# brief step (T-498, signal-ownership R5): what's fixed on main but still failing on prod, before naming the cut
node scripts/ops/merged-not-deployed.mjs --brief
git fetch origin && git rev-parse --short origin/release/prod-<date>          # must equal the brief sha
gh workflow run deploy-linux.yml --ref release/prod-<date> -f slot=prod -f ref=<sha>
gh run list --workflow deploy-linux.yml --limit 1                              # get the run id
gh run view <id> --log | grep -E "probe port|release_scraper_cycle_locks|Deploying|rollback|migrat" # proof lines
```
Rollback = the same command with `-f ref=<previous sha>` (must be an ancestor on the same release branch).
The deploy log IS the Actions run log (`scripts/deploy-linux.sh` prints `==> ...` lines); nothing is written on the box.
NEVER push a non-md file straight to `main`: the write-ratchet (`scripts/check-write-ratchet.mjs`) scans the whole tree incl. docs/, and a raw-SQL template pushed to main on 2026-09-06 turned every open PR gate red. Code-like files go through a PR. Every push to `main` auto-deploys staging EXCEPT markdown-only pushes (`paths-ignore: '**/*.md'`), so ledger/docs pushes are free; batch code pushes.
Tag after verification: `git tag -a prod-<date> <sha> -m "..." && git push origin prod-<date>` (a tag push does not deploy).

## 4. Post-deploy verification

```bash
curl -s -o /dev/null -w '%{http_code}' https://ipodhan.com/
cd web && npm run test:prod-verify          # laptop, needs >= 2.5 GB free
npm run audit:data                          # root; expect only the known legacy reds
# audit:coverage needs a DB: web/.env.local is git-ignored and may be missing on the laptop; supply the tunnel instead:
#   PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"
'); DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan" npm run audit:data
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

## 8. Data repair tools (productized; never hand SQL)

**Shared guards (T-490):** every repair/backfill tool imports `scraper/scripts/lib/repair-tool.ts` - `openRepairDb()`
(prints `current_database(): <name>` from the WRITING pool and refuses a prod `--apply` without `--allow-prod`),
`upsertFieldSource()` (keeps `previous_source`, takes `previous_value` from the caller's ledger),
`buildAlreadyRepairedSet()` (per-field idempotency) and `writeLedgerFile()`. CI enforces it:
`scripts/ci/require-repair-tool-module.mjs` fails a PR whose new `scraper/scripts/{repair,backfill}-*.ts` neither
imports the module nor carries `// repair-tool-exempt: <YYYY-MM-DD> <reason>`.

```bash
# issue_size below the segment floor (share counts / zeros): source = Chittorgarh detail page, cross-checked shares x cap
cd scraper && PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d '"
')
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

## 9. Nightly audit -> GitHub issues (live since 2026-09-07 03:45, dry-run by default)
Cron step [4/5] runs `scripts/audit-findings-to-issues.mjs`; dry-run until `touch /root/data-audit-ipodhan/state/issues-live`
(owner word after reading the first dry-run log `/root/data-audit-ipodhan/state/run-<date>.log`: `ISSUES-DRY-RUN` + the
planned create/comment/close/reopen list). Env `AUDIT_ISSUES_DRY_RUN=1` always forces dry-run. State:
`issues-sync-state.json` + `issues-sync.lock` in the same dir; live mode refuses when the dir is missing.

## 10. User-level hooks (this laptop)
Tests: `cd ~/.claude/hooks && python -m pytest tests -q` (from inside a repo, pytest picks up the repo config and errors).
Fix-contract hook log: `~/.claude/hooks/.fix-contract.log` (512 KB cap, rotates to `.1`); escape `AGENT_FIX_CONTRACT_ALLOW=1`.
