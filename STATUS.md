# T-328 STATUS

Contract: `C:\Abhay\GetWorkDone\heartbeats\T-328.prompt.txt`
Worktree: `C:\Abhay\Ventures\IPODhan-T-328` (branch `fleet/T-328-detection-to-correction`, off `origin/main` @ `d002d234`)

## DoD checklist

- [x] 1. PLAN.md committed first — `evidence/2026-08-26-T-328/PLAN.md`
- [ ] 2. MECHANISM: HOLD in `resolveConflict` + RED→GREEN tests + negative control
- [ ] 3. TZ tie-break (interim, removable, tied to T-327)
- [ ] 4. UI marker ("under verification") + visual check 390/768/1280
- [ ] 5. Alert body states HELD/tie-broken action
- [ ] 6. Zero new test failures vs origin/main; tsc clean; PR opened; never merged

## Environment note

`D:\Abhay\GetWorkDone\evidence\2026-08-26-T-328\` is unreachable from this
worktree (`D:` is a read-only ISO mount, `OPENSTACK`, no `Abhay` tree). Evidence
committed in-repo at `evidence/2026-08-26-T-328/` instead, following the
convention of prior tasks (`evidence/2026-08-23-T-298/` referenced in
`docs/architecture/write-path-hardening.md`).

## Coordination boundary (do not touch)

- `nse-api-client.ts` date parsing — T-327's surface.
- `issueSize`/lot validation — T-329's surface.
- My surface: `resolveConflict`, the status engine, the monitor's alert body,
  the UI marker.

## Log

- 2026-08-26: worktree fresh (previous claim died with no diff). Read both
  required architecture docs. Reproduced the reviewer's mechanism by tracing
  code (read-only DB access not available in this worktree): confirmed
  `openDate`/`closeDate` have NO camelCase entry in `field-priority-matrix.ts`
  (only snake_case `open_date`/`close_date` exist), so they fall to DEFAULT
  rules where NSE outranks CHITTORGARH — the exact Lumino mechanism. Confirmed
  `status-updater-service.ts` (not the dead `update-statuses.ts` scheduler job)
  is the live status-flip path, reading purely from `ipos` DB columns. Wrote
  PLAN.md.
