# Disabled workflows — Windows-VPS era (retired 2026-08-21, T-252)

GitHub Actions only reads `.github/workflows/`. Everything in this folder is **inert**: it
cannot be triggered, scheduled, or dispatched. That is the point.

## Why these five are here

IPODhan finished migrating off the Windows VPS (`103.118.16.189`) and now **serves from the
Linux box** (`72.61.240.224`) — see `.github/workflows/deploy-linux.yml`. All five workflows
below ran `runs-on: self-hosted`, which resolved to the Windows runner
`windows-vps-ipodhan`. On the Windows box the IPODhan PM2 apps are stopped
(`ipodhan-web` x2) or deregistered (`ipodhan-scraper`), so every one of these would now
operate a dead deployment.

| Workflow | What it used to do |
|---|---|
| `deploy.yml` | Deploy to Production — the Windows PM2 deploy. **Superseded by `deploy-linux.yml`.** |
| `vps-backfill.yml` | Run scraper backfills on the Windows box. |
| `vps-recover.yml` | Incident maintenance on the Windows PM2 apps. |
| `vps-setup-ssh.yml` | One-time SSH setup on the Windows box. |
| `vps-status.yml` | Read-only status of the Windows PM2 apps. |

Moving them out (rather than adding an `if: false` guard) is deliberate: a guarded workflow
still *succeeds* while doing nothing, which reads as "the deploy worked". A missing workflow
fails loudly and honestly.

## What still runs on the Windows box

The Windows VPS is **not** decommissioned — it is now **the database host only**:

- PostgreSQL 16 (databases `ipodhan`, `ipodhan_staging`, plus co-tenants). The app connects
  to it remotely as `ipodhan_app`; the `postgres` superuser is localhost-only since T-252.
- The nightly DB backup scheduled task `IPODhan-DB-Backup` (02:00 IST): `pg_dump -Fc` +
  restore-verify + offsite copy to the Linux box.
- Redis, which **AlgoChanakya** uses (db1, ~157k SmartAPI instrument keys) — untouched.

## Restoring one

Move the file back and commit:

```bash
git mv .github/workflows-disabled/<name>.yml .github/workflows/<name>.yml
```

The Windows runner `windows-vps-ipodhan` is registered to this repo but its service is
**stopped and set to Disabled** (T-252). Re-enable it first, or the job will queue forever:

```powershell
Set-Service 'actions.runner.abhayla-IPODhan.windows-vps-ipodhan' -StartupType Automatic
Start-Service 'actions.runner.abhayla-IPODhan.windows-vps-ipodhan'
```
