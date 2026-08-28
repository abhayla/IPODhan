# DB host disk — the Windows VPS C: drive

The Windows VPS `103.118.16.189` runs the **only** PostgreSQL for every app
(ipodhan, algochanakya, gorefer, cricscores…). If its `C:` fills, every app's
writes fail. This has happened twice:

| Date | What the first signal was | Free space at detection |
|---|---|---|
| 2026-06-13 (issue #15) | Prod DB / SSH / runner down | 0 |
| 2026-08-28 | Scraper upserts failing `could not extend file "base/22301/88646": No space left on device` | 19.8 MB |

Both times **nothing was watching the drive**. The first signal was production
breaking. That is the gap this page closes.

## The watch

`scripts/windows/disk-free-heartbeat.ps1` runs every 15 minutes on the VPS as the
scheduled task `IPODhan-DiskFree` (S4U Administrator).

- Reads `C:` free GB.
- **P0** below 3 GB, **P1** below 10 GB, otherwise one `info` heartbeat per day.
- POSTs to the Notifier gateway (`project: ipodhan`, `type: disk-free`), deduped
  per severity per day.
- **Fails open** — a Notifier outage logs and exits 0; it never breaks the box.
- Writes `%ProgramData%\IPODhan\disk-free-state.json` on every run, so the
  nightly audit can see the drive even when the Notifier is down.

A measurement failure exits `2` and pages nothing rather than reporting `0 GB
free` as if it were measured — absence of evidence is not evidence of a full disk,
and it is not evidence of a healthy one either.

### Commands

```powershell
.\scripts\windows\disk-free-heartbeat.ps1              # measure + page
.\scripts\windows\disk-free-heartbeat.ps1 -SelfTest    # fixture tests (exit 1 on failure)
.\scripts\windows\disk-free-heartbeat.ps1 -Register     # install the scheduled task
.\scripts\windows\disk-free-heartbeat.ps1 -FreeGbOverride 2.5 -DryRun
```

## What actually fills this drive

Postgres is **not** the consumer. Measured 2026-08-28: all 27 databases together
were 861 MB, WAL 80 MB. The space goes to:

- **Spent fleet worktrees** under `C:\Abhay\` — roughly 280–300 MB each, and the
  fleet creates one per task. 16 of them held ~4.5 GB.
- **Claude Desktop's VM bundle** — `AppData\Local\Packages\Claude_*\...\rootfs.vhdx`
  was 7.9 GB.
- **The pagefile** — 11 GB on a box with 6 GB RAM.
- Browser/tool caches: `ms-playwright` 1.2 GB, Chrome profile 1.8 GB, VS Code
  server data 1.2 GB, Dart `Pub` cache 745 MB.

### When you get a P1/P0

1. Check what changed: `Get-PSDrive C`, then the fleet worktree count under `C:\Abhay`.
2. Spent worktrees are the usual cause and the safest thing to remove — but
   **check `git status --porcelain` first**. A dirty worktree holds uncommitted
   work; keep it and say so. Removing a *linked* worktree keeps the branch and its
   commits (they live in the main clone's `.git`); removing a standalone clone
   with unpushed commits loses them permanently.
3. Postgres logs older than 30 days under `C:\Program Files\PostgreSQL\16\data\log`
   are safe. **Never** touch anything else under the data directory.

## Known gap

There is no automatic garbage collection of fleet worktrees yet — see the
weekly GC in T-404. Until that lands, worktrees accumulate at ~300 MB per task.
