# T-339 STATUS — consolidation mandatory, one write path, key-beats-name identity quarantine

Branch: `fleet/T-339` off `origin/main` @ b49f764f
Worktree: `D:/Abhay/Ventures/IPODhan-t339` (never touches the shared clone)

## STEP 1 — READ-ONLY live flag capture (done BEFORE any code change)

Method: SSH to the Linux app box (creds from `D:/Abhay/GLOBAL.env`, never printed),
read the two hand-provisioned, release-independent env files the deploy links into
each release (`scripts/deploy-linux.sh` header: `$ROOT/shared/env/<SLOT>/scraper.env`).
Read-only `grep` of four non-secret keys. No writes, no prod DB access.

| Key | prod (`/var/www/ipodhan/shared/env/prod/scraper.env`) | staging (`.../staging/scraper.env`) |
|---|---|---|
| `ENABLE_DATA_CONSOLIDATION` | `true` | `true` |
| `ENABLE_CONFLICT_DETECTION` | `true` | `true` |
| `ENABLE_SOURCE_TRACKING`    | `true` | `true` |
| `CONSOLIDATION_PERCENTAGE`  | `100`  | `100`  |

Corroboration: `/var/www/ipodhan/current/scraper/.env -> /var/www/ipodhan/shared/env/prod/scraper.env`,
and `scraper/src/config/feature-flags.ts:17` loads that file via dotenv — so these ARE
the values the running scraper sees. (`pm2 jlist` shows `<unset>` for all four because
the scraper reads them through dotenv at runtime, not from pm2's captured env — that is
expected, not a contradiction.)

Note: `.claude/tasks/lessons.md:92-94` (T-283) recorded `CONSOLIDATION_PERCENTAGE` as
never set in any env. That is now STALE — it is set to 100 in both slots today.

### Scope consequence (contract STEP 1 clause)

> "If prod already runs consolidation ON at 100%, item 1 shrinks to deleting the dead
> flag code paths; items 2-3 stay."

Prod IS on at 100%. So item 1 = delete the dead OFF-path code (the three `ENABLE_*`
flags, `CONSOLIDATION_PERCENTAGE`, the `upsertIPO` bypass), making consolidation
unconditional. No behavioural change in prod; the change removes the ability to
silently regress to last-writer-wins.

## Progress log
- [x] STEP 1 live flag capture
- [ ] Item 1 — consolidation mandatory + single write path
- [ ] Item 2 — key-beats-name identity quarantine
- [ ] Item 3 — docs rollout note + prod env cleanup list
