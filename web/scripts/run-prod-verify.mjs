#!/usr/bin/env node
// W-164: cross-platform launcher for `npm run test:prod-verify`.
//
// The Playwright config (playwright.config.ts) only skips starting a local
// `next dev` server when PROD_BASE_URL is set — but a bare
// `playwright test production-verification` never set it, so the config
// booted a local Next server on the laptop even though the spec itself
// (tests/e2e/production-verification.spec.ts) already defaults its target to
// https://ipodhan.com. This script sets the one env var both the config and
// the spec key off, so a local server is never started for this command.
import { spawnSync } from 'node:child_process';

const PROD_BASE_URL = process.env.PROD_BASE_URL || 'https://ipodhan.com';

const result = spawnSync(
  'npx',
  ['playwright', 'test', 'production-verification', '--project=chromium'],
  {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PROD_BASE_URL },
  }
);

process.exit(result.status ?? 1);
