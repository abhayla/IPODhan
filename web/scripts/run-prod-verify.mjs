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
//
// Round 2: forward extra CLI args (e.g. `npm run test:prod-verify -- --grep
// compare`) which the round-1 script silently dropped, and validate
// PROD_BASE_URL is actually an http(s) URL before spawning Playwright.
import { spawnSync } from 'node:child_process';

export function isValidProdBaseUrl(url) {
  return /^https?:\/\//i.test(url);
}

export function buildPlaywrightArgs(extraArgs) {
  return ['playwright', 'test', 'production-verification', '--project=chromium', ...extraArgs];
}

function main() {
  const PROD_BASE_URL = process.env.PROD_BASE_URL || 'https://ipodhan.com';

  if (!isValidProdBaseUrl(PROD_BASE_URL)) {
    console.error(
      `[run-prod-verify] PROD_BASE_URL must start with http:// or https:// (got: ${PROD_BASE_URL})`
    );
    process.exit(2);
    return;
  }

  const extraArgs = process.argv.slice(2);

  const result = spawnSync('npx', buildPlaywrightArgs(extraArgs), {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PROD_BASE_URL },
  });

  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main();
}
