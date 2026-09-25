#!/usr/bin/env bash
# Shared IST-day helper (#1057, #1064; .claude/rules/ist-timezone.md: every
# schedule and cadence is stated and reasoned about in IST, no exceptions
# for a UTC-hosted cron). Any per-day cap/counter in scripts/ops that a
# human reads as "N per day" MUST key on the IST calendar date, not the
# UTC one, or it resets at 05:30 IST instead of midnight IST.
#
# IST = UTC+5:30, no DST; computed by fixed-offset arithmetic on the epoch
# second (never `TZ=Asia/Kolkata date`, which needs tzdata the box may not
# have). Mirrors scripts/lib/ist-day.mjs.
#
# Usage: ist_day_from_epoch <epoch_seconds>
ist_day_from_epoch() {
  local epoch="$1"
  date -u -d "@$(( epoch + 19800 ))" +%F
}
