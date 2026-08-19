# Production Postgres Credential Rotation — Plan (T-215)

**Status: AWAITING OWNER APPROVAL. Nothing in §4 has been executed.**

Context and exposure analysis: [`SECURITY-CREDENTIAL-EXPOSURE.md`](./SECURITY-CREDENTIAL-EXPOSURE.md).

> **No credential values appear in this document, and none may ever be added.**
> Credentials are referred to by name and location only.

Target: the PostgreSQL superuser (`user postgres`) on `103.118.16.189`, serving database
`ipodhan`. The same host also serves **algochanakya.com** — a mistake here takes down two
live sites.

---

## 1. Consumer enumeration

Every place the credential is used, and how each was found. A missed consumer is an outage,
so this section is deliberately exhaustive.

### 1.1 Discovery method

| # | Method | What it found |
|---|---|---|
| 1 | `grep` for every env-var name family (`DATABASE_*`, `DATABASE_URL`, `TEST_DATABASE_URL`, `DB_*`, `POSTGRES_*`, `PGPASSWORD`) | The four parallel naming families in §1.2 |
| 2 | `grep` for connection constructors (`new Pool(`, `new Client(`, `drizzle(`, `pg.Pool`) | ~120 direct construction sites |
| 3 | Read of the two shared pool modules | The **branch-selection rule** in §1.3 — the single most important cutover fact |
| 4 | Read of `.github/workflows/*.yml` | `secrets.DATABASE_URL` as sole prod source; the env-file materialization step |
| 5 | Read of `ecosystem.config.js` + the generated copy inside `deploy.yml` | PM2 sets **no** DB vars — creds come only from on-disk `.env` files |
| 6 | Filesystem search for `docker-compose*`/`Dockerfile` | None — deployment is PM2-on-Windows, not containerized |
| 7 | `grep` for the host `103.118.16.189` and tunnel port `15432` | Hardcoded prod fallbacks; the SSH-tunnel workflow |
| 8 | `grep` for `.env.example` / template files | Three env templates, each documenting a *different* var family |

### 1.2 The four env-var families (root cause of rotation risk)

One database is reached through four different variable sets. **Rotating only one family
leaves the others on the old password.**

| Family | Variables | Where it is authoritative |
|---|---|---|
| **A — discrete** | `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD` | Local dev; operator scripts. **Takes precedence over B when set — see §1.3** |
| **B — connection string** | `DATABASE_URL` | **Production.** The only DB credential in `web/.env.local` and `scraper/.env` |
| **C — test** | `TEST_DATABASE_URL`, `TEST_DB_*` | Integration tests. `scraper/tests/test-utils/db.ts` falls back to family A |
| **D — legacy / shell** | `DB_PASSWORD`, `POSTGRES_*`, `PGPASSWORD` | Backup scripts, `.bat`/`.ps1` helpers, `database/*.js` |

### 1.3 ⚠ The precedence trap — read before cutover

`packages/shared/src/db/index.ts:27` and `web/lib/db.ts:23` select the connection branch
like this:

```js
process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
  ? { host, port, database, user, password }   // family A wins
  : { connectionString: process.env.DATABASE_URL }
```

If **both** `DATABASE_HOST` and `DATABASE_PASSWORD` are set, `DATABASE_URL` is **silently
ignored**. Any environment that has family-A vars exported (a shell profile, a leftover
`.env`, a PM2 saved dump) will keep using the old password after `DATABASE_URL` is rotated,
with no error to indicate it.

**Mitigation:** cutover step 4.6 explicitly asserts family-A vars are absent in the
production process environment.

### 1.4 Production runtime consumers (these cause an outage if missed)

| # | Consumer | Location | Credential source | Restart needed |
|---|---|---|---|---|
| P1 | `ipodhan-web` (Next.js, PM2 cluster ×2, port 3001) | VPS `C:\Apps\IPODhan\current\web` | `web\.env.local` → `DATABASE_URL` | Yes — `pm2 delete` + start |
| P2 | `ipodhan-scraper` (PM2 fork, cron `*/30`) | VPS `C:\Apps\IPODhan\current\scraper` | `scraper\.env` → `DATABASE_URL` | Yes |
| P3 | Calendar refresh job (hourly, `0 * * * *`) | `scraper/src/jobs/refresh-calendar.ts:33` | Same `DATABASE_URL` as P2 | Runs in P2's process |
| P4 | Deploy migration step | `.github/workflows/deploy.yml:425` | `secrets.DATABASE_URL` | Runs at deploy |
| P5 | Production build step | `.github/workflows/deploy.yml:79, 242` | `secrets.DATABASE_URL` | Runs at deploy |
| P6 | `vps-backfill.yml` | Runs from `C:\Apps\IPODhan\current\scraper` | **Inherits `scraper\.env`** — no secret of its own | Breaks silently if that file is stale |

**Critical:** `ecosystem.config.js` (both the repo copy and the copy generated inside
`deploy.yml`'s here-string) sets **no DB env vars at all**. P1/P2 read credentials
exclusively from the on-disk `.env` files written by `deploy.yml:253` and `:265`.
Therefore **rotating the GitHub secret is a no-op until a deploy runs.**

### 1.5 Secret store

| Store | Key | Note |
|---|---|---|
| GitHub Actions secrets | `DATABASE_URL` | Sole source for prod. Referenced at `deploy.yml` lines 79, 242, 253, 265, 425 |
| VPS `web\.env.local` | `DATABASE_URL` | Written by `deploy.yml:253`. Also read by `scripts/audit/chittorgarh-audit.py:17` and two scraper integration tests, **by regex** |
| VPS `scraper\.env` | `DATABASE_URL` | Written by `deploy.yml:265` |
| `$secureDir\ipodhan-database-url.txt` | connection string | Written by `scripts/setup-production-database.ps1:356` — an on-disk credential artifact outside the repo. **Must be updated or deleted at cutover** |
| `$secureDir\ipodhan-db-password.txt` | raw password | Written by `scripts/setup-production-database.ps1:220` (ACL'd at `:223-228`). Nothing reads it at runtime, but it holds the old value until cleared. **Must be updated or deleted at cutover** |
| Deploy backup dirs (`C:\Apps\IPODhan\backups\*`) | `.env` files | The backup at `deploy.yml:148` excludes only `node_modules`/`.next`, so it **captures `.env` files**. Any backup predating cutover holds the old credential — see §4.5a |

### 1.6 Operator / developer consumers (breakage is annoying, not an outage)

- **~120 direct connection sites** across `web/scripts/`, `scraper/src/scripts/`,
  `scraper/scripts/`, root `scripts/`, `database/` — all read env, none embed a literal
  post-`d3284473`.
- **~74 indirect consumers** importing the shared pool (`web/lib/db`, `packages/shared`).
- **Backfill scripts relying on `override:true`** — several scraper backfills deliberately
  override the ambient env because `scraper/.env` carries direct-prod credentials; see the
  comment at `scraper/scripts/backfill-financials-chittorgarh-detail.ts:24-33`, and the same
  pattern in `backfill-financials-pdf.ts:24`, `backfill-clean-company-names.ts:32`,
  `backfill-demand-graph.ts:8`, `backfill-primary-source-documents.ts:10`,
  `backfill-subscription.ts:9`. These are where the §1.3 precedence trap actually bites —
  they fail on auth post-rotation until the developer's local env is refreshed.
- **SSH tunnel workflow** — `localhost:15432` → `103.118.16.189:5432`, used by gated
  migrations and audit scripts. Documented across `docs/goals/**`, `docs/contracts/**`,
  `.claude/rules/drizzle-migration-gated-ddl.md:49`. Developers holding this tunnel must
  re-fetch the new credential.
- **Backup scripts** — `scripts/backup-database.sh:109`, `scripts/backup-database.ps1:97`
  export `PGPASSWORD` from `POSTGRES_PASSWORD` (family D). **Must be rotated or backups
  silently start failing** — a broken backup is discovered only when a restore is needed.
- **Three env templates**, each documenting a different family and all needing refresh:
  `.env.production.template:24-31`, `web/.env.example:31-35`,
  `scraper/.env.example:2`.

### 1.7 ⚠ Two silent production fallbacks

```js
host: process.env.DATABASE_HOST || '103.118.16.189'
```

- `scraper/src/scripts/verify-bse-data.ts:18`
- `scraper/src/scripts/comprehensive-verification.ts:18`

With `DATABASE_HOST` unset these connect to **production** rather than failing. Post-rotation
they will fail on auth instead — which is safer, but the hardcoded host should be removed
(§5, follow-up F3).

### 1.8 Not consumers (checked, ruled out)

- **No Docker/containers** — no `docker-compose*`, no `Dockerfile` anywhere in the repo.
- **CI test Postgres** (`test.yml:68-70, 125-127`) uses throwaway container credentials
  (`postgres:16` service, literal `postgres`/`postgres`). Ephemeral, **not** prod, needs no
  rotation.
- **`vps-recover.yml:38`** restarts the Postgres service but holds no credential.
- **`ci.yml`, `pr-gate.yml`, `prod-verify.yml`** reference no DB secret.

---

## 2. Least-privilege role design

### 2.1 Recommendation: rotate first, split privileges second

**The app does not need superuser** — no runtime DDL exists (verified: every
`CREATE`/`ALTER`/`DROP` occurrence lives in one-off operator scripts or migration files,
none in `scraper/src/{scheduler,jobs,orchestrators,services,repositories}` or in any web
server path).

But one runtime operation **blocks a plain non-superuser role**, and fixing it requires a
schema change. Per the contract's DoD ("if least-privilege turns out to be a larger change,
say so and rotate the existing credential as step one rather than blocking on the bigger
fix"), the plan is deliberately **two-phase**:

| Phase | Action | Risk | When |
|---|---|---|---|
| **Phase 1 (this task)** | Rotate the `postgres` password in place. Same role, same privileges, new secret. | Low — no privilege semantics change; only the value moves | On owner approval |
| **Phase 2 (follow-up F1)** | Introduce `ipodhan_app` / `ipodhan_migrator` / `ipodhan_backup` and drop the app off superuser | Medium — needs the §2.2 blocker fixed and a migration | Separate task |

Rationale: the exposed value is live *right now* on a host serving two production sites.
Phase 1 removes that exposure in minutes with near-zero behavioural risk. Coupling it to a
privilege split would delay the fix behind a schema migration — exactly the trap the DoD
warns against.

### 2.2 The blocker Phase 2 must solve first

`scraper/src/jobs/refresh-calendar.ts:44` runs hourly:

```js
await pool.query('SELECT refresh_calendar_view()')
```

That function (`web/drizzle/migrations/0001_add_calendar_materialized_view.sql:102-112`)
executes `REFRESH MATERIALIZED VIEW CONCURRENTLY calendar_view` and has **no
`SECURITY DEFINER`** (verified: zero occurrences repo-wide). It therefore runs
`SECURITY INVOKER`, and PostgreSQL requires the **caller to own** the materialized view.
**Ownership cannot be granted via `GRANT`.**

Two fixes, preferred first:

```sql
-- (a) preferred: function runs as its owner; app only needs EXECUTE
ALTER FUNCTION refresh_calendar_view() SECURITY DEFINER;

-- (b) alternative: hand the matview to the app role
ALTER MATERIALIZED VIEW calendar_view OWNER TO ipodhan_app;
```

Also note the GRANT block at that migration's lines 114–117 is **commented out**, so
migrations currently apply no grants at all — Phase 2 must add them explicitly.

### 2.3 Phase 2 target design (for the follow-up task, not this one)

```sql
-- application role: web + scraper. No DDL, no superuser.
GRANT CONNECT ON DATABASE ipodhan TO ipodhan_app;
GRANT USAGE ON SCHEMA public TO ipodhan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ipodhan_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ipodhan_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ipodhan_app;

ALTER DEFAULT PRIVILEGES FOR ROLE ipodhan_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ipodhan_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ipodhan_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ipodhan_app;

ALTER FUNCTION refresh_calendar_view() SECURITY DEFINER;   -- §2.2 blocker
```

| Role | Purpose | Privileges |
|---|---|---|
| `ipodhan_app` | web + scraper runtime | above; **no** DDL, **no** superuser |
| `ipodhan_migrator` | `drizzle-kit migrate` in deploy only | owns schema objects; DDL rights |
| `ipodhan_backup` | `pg_dump` | `pg_read_all_data` (predefined role, PG14+) — not superuser |

Notes for Phase 2:
- Extensions (`pg_trgm`, `uuid-ossp` at `0000_initial_schema.sql:2-3`) need elevated rights
  only **at migration time**, never at runtime.
- `pg_dump` already runs `--no-owner --no-acl` (`backup-database.sh:112-121`), so the backup
  role needs `SELECT` on every table but no ownership.
- `web/app/api/health-detailed/route.ts:75-79` reads `pg_stat_database.numbackends` — visible
  to any role, **not** a superuser requirement.
- ⚠ `deploy.yml:419` sets `continue-on-error: true` on the migration step. After a privilege
  split, a migration failing on insufficient rights would **not** fail the deploy — it would
  ship the app against a stale schema. Tighten this as part of Phase 2 (follow-up F2).

---

## 3. Pre-cutover checklist (owner + operator, before step 4.1)

- [ ] Owner has read §1.4 and accepts a brief `ipodhan-web` / `ipodhan-scraper` restart.
- [ ] Confirm **algochanakya.com does not use this Postgres role.** This is the weakest link
      in the plan: algochanakya is outside this repository and its consumers **cannot be
      enumerated from here**. If it shares the role, its consumers join §1.4 and this plan
      must be extended before proceeding. Concrete check — on the VPS, enumerate who is
      actually connecting, over a window that spans a scraper tick:

      ```sql
      SELECT datname, usename, application_name, count(*)
      FROM pg_stat_activity
      WHERE backend_type = 'client backend'
      GROUP BY 1,2,3 ORDER BY 4 DESC;
      ```

      Any `usename = postgres` row whose `datname`/`application_name` is not IPODhan's is a
      consumer this plan does not cover. Cross-check algochanakya's own config directly.
- [ ] Confirm whether a **backup scheduled task was ever registered.**
      `scripts/backup-database.ps1:13-15` carries a commented `Register-ScheduledTask`
      example. If it was actually registered it is a live family-D consumer — check with
      `Get-ScheduledTask | Where-Object TaskName -like '*ipodhan*'`.
- [ ] Console/RDP access to `103.118.16.189` is confirmed working **independently of** the
      credential being rotated (rollback depends on it).
- [ ] A fresh `pg_dump` backup exists and its restore path is known.
- [ ] Cutover is scheduled **outside** the scraper's `*/30` cron tick and outside market
      hours (09:00–15:30 IST, Mon–Fri) to minimise data-write collisions.
- [ ] The new password is generated ≥24 chars, and **avoids** `@ : / ? # [ ] %` — see the
      §4.2 encoding trap.
- [ ] GitHub Actions "Deploy to Production VPS" (`workflow_dispatch`) can be run by the owner.

---

## 4. Cutover procedure — OWNER-GATED, DO NOT RUN UNATTENDED

Estimated: 20–30 min. Expected downtime: one PM2 restart cycle (~30–60 s).
Every step lists its own verification and rollback.

### 4.1 Generate and store the new secret

1. Generate a new strong password (≥24 chars, excluding `@ : / ? # [ ] %`).
2. Store it **only** in the estate's project-unique secret location (the project's own
   `.env` / secret store). **Never** in `GLOBAL.md`, never in any repo file, never in a
   commit message or PR body.

**Verify:** the value exists in the secret store and nowhere in the repo
(`git status` clean; `node scripts/check-staged-secrets.js` passes).
**Rollback:** none needed — nothing has changed yet.

#### 4.2 ⚠ Encoding trap

`web/TESTING_PLAN.md:44-45` documents that the two families encode differently:
`DATABASE_URL` requires `%`-encoding for reserved characters (e.g. `@` → `%40`) while
`DATABASE_PASSWORD` takes the raw value. A password containing a reserved character will
break **exactly one** of the two families and pass the other — a partial, hard-to-diagnose
failure. Avoiding those characters entirely (§4.1) removes the trap.

### 4.3 Change the password on the database

On the VPS, via console/RDP (not via a connection using the credential being replaced):

```sql
ALTER ROLE postgres WITH PASSWORD '<new-value>';
```

**Verify:** a fresh `psql` login with the new value succeeds.
**Rollback:** `ALTER ROLE postgres WITH PASSWORD '<old-value>';` — keep the old value
available in the secret store until step 4.9 completes.

### 4.4 Update the GitHub Actions secret

Update repository secret `DATABASE_URL` to the new connection string (host, port, database,
user unchanged; only the password segment differs).

**Verify:** GitHub shows the secret's "Updated" timestamp as now.
**Rollback:** restore the previous secret value.

### 4.5 Redeploy to materialize the new credential on the VPS

Run **Deploy to Production VPS** (`workflow_dispatch`). This rewrites `web\.env.local`
(`deploy.yml:253`) and `scraper\.env` (`:265`), then `pm2 delete` + `pm2 start`.

> **Do not hand-edit the `.env` files instead.** A manual edit is overwritten by the next
> deploy, silently reverting the rotation. The deploy **is** the propagation mechanism.

**Verify:** workflow run is green; its health-check step (polls `http://localhost:3001`,
10 attempts) passes.

#### ⚠ 4.5a — If the deploy fails, do NOT leave the auto-rollback's `.env` in place

The deploy's `Create backup` step runs at `deploy.yml:148` — **before** the env files are
written at `:247`. It uses `robocopy /E /XD node_modules .next`, which excludes only those
two directories, so **the backup contains `web\.env.local` and `scraper\.env` holding the
OLD password**. The `if: failure()` rollback (`deploy.yml:515-516`) restores that directory
wholesale.

Consequence: if the post-rotation deploy fails its health check, the auto-rollback brings the
app back up with **old-password env files against an already-rotated database** — an outage,
not a cure. The auto-rollback is safe for ordinary deploys and **unsafe for this one**.

If the deploy fails at this step, choose one and do not stop in between:

- **Roll forward (preferred):** re-run the deploy so `.env` is rewritten from the rotated
  secret; or
- **Roll back fully:** apply 4.3's `ALTER ROLE` rollback so the database matches the restored
  old-password `.env`, then verify V1–V6.

Treat any deploy backup taken before this cutover as a **stale-credential artifact**.

### 4.6 Assert the precedence trap is not armed

Confirm no family-A vars reach the apps. Check **both** the on-disk env files (the actual
credential source per §1.4) and **every** running process — not a single hardcoded PM2 id:

```powershell
# 1. On-disk env files — the real source of truth
Select-String -Path "$env:DEPLOY_DIR\web\.env.local","$env:DEPLOY_DIR\scraper\.env" `
  -Pattern "DATABASE_HOST=|DATABASE_PASSWORD="

# 2. Every running PM2 process, by id from jlist (web runs 2 cluster instances)
(pm2 jlist | ConvertFrom-Json) | ForEach-Object {
  "--- $($_.name) (id $($_.pm_id)) ---"
  pm2 env $_.pm_id | Select-String "DATABASE_HOST|DATABASE_PASSWORD"
}
```

**Expect: no matches from either command.** Any match means `DATABASE_URL` is being ignored
(§1.3) and that process is still on the old password — remove the vars and restart before
continuing.

> Do **not** use `pm2 env 0`: `0` is a process id, not a name. `ipodhan-web` runs 2 cluster
> instances and `ipodhan-scraper` is normally *stopped* between cron ticks, so a single-id
> check inspects at most one of three processes — and ids are renumbered by
> `pm2 delete`/`pm2 start`. The scraper cannot be checked this way while stopped, which is
> why the on-disk file check above is the authoritative one.

### 4.7 Rotate the remaining consumers

- Update the backup scripts' `POSTGRES_PASSWORD` source (family D) — `backup-database.sh:36-40`,
  `backup-database.ps1:36-40`.
- Update or delete **both** on-disk artifacts written by `setup-production-database.ps1`:
  `$secureDir\ipodhan-database-url.txt` (`:356`) and `$secureDir\ipodhan-db-password.txt`
  (`:220`).
- Notify any developer holding the `localhost:15432` SSH tunnel to re-fetch the credential,
  and to refresh their local `web/.env.local` — several backfill scripts load it with
  `override:true` specifically because it carries direct-prod credentials
  (`scraper/scripts/backfill-financials-chittorgarh-detail.ts:24-33`). Those scripts will
  fail on auth until refreshed.
- Discard deploy backups taken before cutover, or mark them as holding a dead credential
  (§4.5a).

**Verify:** run one backup manually and confirm a non-empty dump is produced.
**Rollback:** restore the prior values from the secret store.

### 4.8 Post-cutover verification (capture evidence for each)

| # | Check | Pass criterion |
|---|---|---|
| V1 | `curl -I https://ipodhan.com` | HTTP 200 |
| V2 | `npm run audit:prod` | exit 0; real IPO data, no seed/dummy names |
| V3 | `cd web && npm run test:prod-verify` | Browser sweep green — no console errors, no blank pages |
| V4 | `curl -I https://algochanakya.com` | HTTP 200 (shared host unaffected) |
| V5 | Next scraper one-shot (within 30 min) | Completes; new rows written; `scraper_logs` shows success |
| V6 | `pm2 list` after ≥10 min | `ipodhan-web` online ×2, `ipodhan-scraper` **stopped** between cron ticks (that is correct — `autorestart:false` + `cron_restart`), restart counters not climbing |
| V7 | Calendar refresh job (hourly) | Next tick succeeds — proves the matview path still works |

> V6 note: a *stopped* scraper is the healthy state for this app. See
> `.claude/rules/pm2-scheduled-one-shot-scraper.md` — `autorestart:false` is load-bearing.

### 4.9 Prove the old credential is dead (mandatory)

A rotation nobody verified is not a rotation. Attempt an explicit connection with the **old**
credential and capture the refusal.

Use `-W` so psql **prompts** for the password — paste the old value at the prompt:

```bash
psql -h 103.118.16.189 -U postgres -d ipodhan -W -c 'select 1'
```

**Expect:** `FATAL: password authentication failed for user "postgres"`.

> Do **not** use `PGPASSWORD='<old-value>' psql ...`. That places a live credential into
> shell history and into the process list visible to other users on the host. `-W` (or a
> `PGPASSFILE`) removes the exposure at the source instead of relying on the operator
> remembering to scrub it afterwards.

Record the transcript in the evidence file. The prompt form emits no value, so nothing needs
redacting — but re-read the transcript before saving it and confirm no value is present.

If this **succeeds**, the rotation did not take: stop, investigate, do not close the task.

### 4.10 Full rollback (if cutover fails)

1. `ALTER ROLE postgres WITH PASSWORD '<old-value>';` (via console/RDP).
2. Restore the previous GitHub secret value.
3. Re-run the deploy workflow to rewrite the `.env` files.
4. Confirm V1–V6 pass on the restored credential.
5. Record what failed before re-attempting.

Rollback stays available until the old value is deliberately discarded — do that only after
4.9 passes.

---

## 5. Follow-ups (out of scope for T-215)

| ID | Item | Why |
|---|---|---|
| **F1** | Phase 2 least-privilege split (`ipodhan_app` / `_migrator` / `_backup`) | App runs as superuser today; §2.2 blocker must be fixed first |
| **F2** | Remove `continue-on-error: true` from the migration step (`deploy.yml:419`) | A failed migration currently ships silently against a stale schema |
| **F3** | Remove hardcoded prod-host fallbacks | `verify-bse-data.ts:18`, `comprehensive-verification.ts:18` connect to prod when env is unset |
| **F4** | Consolidate the four env-var families onto one | The §1.3 precedence trap is a permanent footgun |
| **F5** | **T-216 — git history rewrite** | History still contains the old value; required before any public-visibility change |
