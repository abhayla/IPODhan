# Scope: global

# Signal ownership — every signal has a consumer; "known" needs an identity and a number

version: "1.0.0" (owner directive 2026-09-07 23:2x IST: "this skipping is not acceptable now … make this a rule";
RCA: `docs/reviews/rca-2026-09-07-missed-live-defects.md`)

On 2026-09-07 five live defects sat inside signals that already existed (a nightly FAIL line, a per-cycle failure
counter, a PR state) for hours to days before anyone acted. Reviews were not the gap; the gap was between a signal
and an action. This rule closes it.

## R1 — A number is not a reading
A failure counter (`extractionFailed: N`, `iposFailed`, `FAIL x violations`) MUST be resolved to identities before
it is reported: which row / document / error class. A tick or brief line that prints a bare count is a defect.

## R2 — "Known" requires an issue number
A failure MAY be called known, expected or pre-existing ONLY when the line names the tracking issue (`#NNN`) or the
registry class. Memory of "it was the same yesterday" is not evidence. No number = new = escalate this tick.

## R3 — Every nightly signal has a consumer that diffs
The nightly detection floor, the coverage gate and the audit-to-issues sync MUST each have a named consumer that
runs the same day, compares against the previous run (NEW / GONE / SAME by id and by entity), and records the
result where the owner reads it (brief, Notifier, issue). Output nobody reads counts as no detection.

## R4 — New beats standing
A NEW failing id or NEW entity in any signal is acted on before any queued feature work: an issue the same tick,
an owner note in plain words, and either a fix contract or an explicit `deferred: <reason>` on the issue.

## R5 — Fixed on main is not fixed
A production defect is closed only when the fix is reachable from the latest `prod-*` tag AND the signal that
found it has gone GONE in the next run. Until then the brief and the ticks list it under "fixed on main, still
failing on prod".

## R6 — Failures carry their cause
Any logged failure MUST carry the underlying cause (`err.cause` message + code for wrapped errors) and any gate
MUST print its reason before a non-zero exit. A failure that cannot be classified from its log line is a defect
of the logger, filed as such the same day.

## R7 — Time-critical steps do not depend on idleness
A deploy or a proof read with a window MUST be scheduled 30 minutes early and executed by a command that does not
wait for the session to be idle; the brief states when the session went idle.

## Enforcement (deterministic, tracked as contracts)
- `scripts/ops/failure-delta.mjs` (T-496): the tick's failure reading — identities and NEW/GONE/SAME, refuses to
  print a bare count; `--file-issues` files the NEW ones.
- `scripts/ops/floor-delta.mjs` (T-497): nightly floor diff + Notifier post; audit-to-issues live for NEW findings.
- `scripts/ops/merged-not-deployed.mjs` (T-498): fix commits on main not on the prod tag, printed in ticks and briefs.
- SessionStart morning-read gate (T-499): refuses a wave dispatch while a NEW floor FAIL has no issue.
- Cause-bearing logs and gates (T-500); deploy timers 30 min early (T-501).

## CRITICAL RULES
- MUST resolve every failure count to identities before reporting it.
- MUST NOT call a failure known without an issue number or registry class on the same line.
- MUST run a same-day diffing consumer for every nightly signal; unread output is no detection.
- MUST act on NEW signals before queued feature work.
- MUST treat a fix as open until it is on the prod tag and its signal is GONE.
- MUST log the cause of every failure and the reason of every gate exit.
- MUST schedule windowed steps early and run them without depending on idleness.
