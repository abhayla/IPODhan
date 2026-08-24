#!/usr/bin/env bash
# One-time, hand-run setup for pm2-logrotate on the IPODhan Linux box (T-311,
# 2026-06-13 disk-full-incident class). NOT invoked by deploy-linux.sh or any
# CI job — installing/enabling a pm2 module is a one-time, owner-run action
# on the box itself (see owner-gated-feature-flags.md for the same "code
# ships the check, a human flips production" split): deploy-linux.sh's
# assert_pm2_logrotate_installed() only WARNS if this has not been run yet;
# it never runs it for you.
#
# Idempotent: `pm2 install pm2-logrotate` on an already-installed module and
# `pm2 set <key> <same value>` are both safe to re-run.
#
# Run on the box: bash scripts/ops/install-pm2-logrotate.sh
set -euo pipefail

echo "Installing pm2-logrotate..."
pm2 install pm2-logrotate

echo "Applying config (max_size=50M retain=7 compress=true rotateInterval=daily@00:00 UTC)..."
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

echo "Done. Verify with: pm2 jlist | grep -o '\"name\":\"pm2-logrotate\"'"
