#!/usr/bin/env node
// Config/code lineage check — #793 M3, runnable from OUTSIDE the scraper.
//
// WHY THIS EXISTS SEPARATELY FROM deploy-drift-monitor.ts.
// The in-cycle check (checkConfigLineage) runs from `runStep(...)` inside the
// scraper's main(), and main() is reached only AFTER
// validateFieldManifestAtStartup() / validateSwitchoverAtStartup() /
// validateValidationRulesAtStartup() (scraper/src/index.ts:1646-1651). Those are
// exactly the calls that throw when the config and the schema disagree. So in
// the incident this mechanism was built for — the config refuses, the process
// dies in 4-6 seconds — main() never runs and the in-cycle check never executes.
// It can only ever page in the weaker case where the config is stale but still
// schema-valid.
//
// A detector that is killed by the failure it detects is not a detector. This
// script is the one that actually covers the incident: it runs from the laptop
// (or any box cron) over read-only ssh, so the scraper being dead is irrelevant
// to it — and a dead scraper is precisely when it should be speaking.
//
// It compares two facts that both live on the VPS:
//   - the slot's SERVED sha, from /api/version on localhost
//   - shared/config/<slot>/CONFIG_SHA, the commit the shared config came from
//
// Exit codes:
//   0  in sync, or genuinely unknowable (says which)
//   2  bad arguments, or the ssh read failed (cause printed)
//   3  DRIFT: the config is from a different commit than the code
//
// Usage:
//   node scripts/ops/config-lineage.mjs --slot staging
//   node scripts/ops/config-lineage.mjs --slot prod --notify

import { execFileSync } from 'node:child_process';

const SSH_HOST = process.env.FAILURE_DELTA_SSH_HOST || 'rfp-vps';
const SLOTS = ['prod', 'staging'];
const DEPLOY_ROOT = process.env.DEPLOY_ROOT || '/var/www/ipodhan';

/**
 * Shared with deploy-drift-monitor.ts's shasMatch(): the served sha is 8 hex
 * chars (deploy-linux.sh serves $SHORT_SHA) and a CONFIG_SHA written by
 * deploy-config.sh is the full 40, so this is a prefix comparison in both
 * directions, guarded to real hex so a stray value can never "match".
 */
export function shasMatch(servedSha, configSha) {
  const hex7Plus = /^[0-9a-f]{7,}$/i;
  if (!hex7Plus.test(servedSha) || !hex7Plus.test(configSha)) return false;
  return servedSha.startsWith(configSha) || configSha.startsWith(servedSha);
}

/**
 * @returns {{status: 'in-sync'|'drift'|'unknown', servedSha: string|null, configSha: string|null, detail: string}}
 */
export function classify(servedSha, configSha) {
  if (!servedSha) {
    return { status: 'unknown', servedSha, configSha, detail: 'the slot did not answer /api/version — cannot tell' };
  }
  if (!configSha) {
    return { status: 'unknown', servedSha, configSha, detail: 'CONFIG_SHA is missing or empty — cannot tell' };
  }
  if (configSha === 'release') {
    // Deliberately NOT in-sync. deploy-linux.sh writes this marker only in its
    // first-seed branch and no later deploy rewrites it, so a slot seeded once
    // reads `release` forever while its shared manifest stays at day-1 content.
    // That is the most drift-prone state there is; calling it in-sync would
    // exempt exactly the slots most at risk.
    return {
      status: 'unknown',
      servedSha,
      configSha,
      detail:
        'CONFIG_SHA is the "release" seed marker: the shared config has never been config-deployed, so its lineage ' +
        'cannot be read from a sha. It is whatever the FIRST deploy to this slot seeded, however many deploys ago. ' +
        'The deploy-time gate (preflight_deployed_config) is what covers this case.',
    };
  }
  if (shasMatch(servedSha, configSha)) {
    return { status: 'in-sync', servedSha, configSha, detail: 'the config was deployed from the commit the code is serving' };
  }
  return {
    status: 'drift',
    servedSha,
    configSha,
    detail: `the code serves ${servedSha} but the config came from ${configSha.slice(0, 8)}`,
  };
}

function readSlot(slot) {
  // Read-only: a cat and a curl against localhost on the box. Never writes.
  // The port is read from the slot's env file, the same way the in-process
  // monitor reads it — never hardcoded.
  const cmd = [
    `cat ${DEPLOY_ROOT}/shared/config/${slot}/CONFIG_SHA 2>/dev/null || echo ''`,
    `PORT=$(sed -n 's/^PORT=//p' ${DEPLOY_ROOT}/shared/env/${slot}/web.env.local 2>/dev/null)`,
    `curl -s --max-time 5 "localhost:\${PORT:-3000}/api/version" 2>/dev/null || echo ''`,
  ].join('; ');

  let raw;
  try {
    raw = execFileSync('ssh', [SSH_HOST, cmd], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  } catch (err) {
    const cause = err?.stderr?.toString().trim() || err?.message || String(err);
    console.error(`exit 2: cannot read slot "${slot}" over ssh (host=${SSH_HOST}): ${cause}`);
    process.exit(2);
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const configSha = lines[0]?.trim() || null;
  let servedSha = null;
  for (const line of lines.slice(1)) {
    try {
      servedSha = JSON.parse(line)?.data?.sha ?? servedSha;
    } catch {
      // not the JSON line
    }
  }
  return { servedSha, configSha };
}

function notify(slot, result) {
  const url = process.env.NOTIFIER_URL;
  const key = process.env.NOTIFIER_KEY || process.env.NOTIFIER_KEY_IPODHAN;
  if (!url || !key) {
    console.log('--notify: NOTIFIER_URL/NOTIFIER_KEY not set — skipping the post (nothing else changes)');
    return;
  }
  const body = {
    project: 'ipodhan',
    severity: slot === 'prod' ? 'P1' : 'P2',
    title: `IPODhan ${slot} config is from a different commit than the code`,
    body:
      `${result.detail}. If the newer code tightened a config schema the scraper will refuse to start (#793). ` +
      `Fix: scripts/ops/deploy-config.sh --slot ${slot} --sha ${result.servedSha}`,
    type: 'config-lineage-drift',
    dedupeKey: `config-lineage:${slot}:${result.servedSha}`,
  };
  try {
    execFileSync('curl', ['-s', '-X', 'POST', `${url}/notify`, '-H', `X-Api-Key: ${key}`, '-H', 'Content-Type: application/json', '-d', JSON.stringify(body)], {
      encoding: 'utf8',
    });
    console.log(`--notify: posted a ${body.severity} for ${slot}`);
  } catch (err) {
    console.error(`--notify: POST failed (non-fatal): ${err?.message ?? String(err)}`);
  }
}

function main() {
  const argv = process.argv.slice(2);
  let slot = null;
  let shouldNotify = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slot') slot = argv[++i];
    else if (argv[i] === '--notify') shouldNotify = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/ops/config-lineage.mjs --slot prod|staging [--notify]');
      process.exit(0);
    }
  }
  if (!slot || !SLOTS.includes(slot)) {
    console.error(`error: --slot must be one of: ${SLOTS.join(', ')}`);
    process.exit(2);
  }

  const { servedSha, configSha } = readSlot(slot);
  const result = classify(servedSha, configSha);

  console.log(`config-lineage --slot ${slot}`);
  console.log(`served sha: ${servedSha ?? '<unknown>'}`);
  console.log(`config sha: ${configSha ?? '<unknown>'}`);
  console.log(`${result.status.toUpperCase()}: ${result.detail}`);

  if (result.status === 'drift') {
    if (shouldNotify) notify(slot, result);
    console.log('');
    console.log(`exit 3: run scripts/ops/deploy-config.sh --slot ${slot} --sha ${servedSha} to ship the config this code expects.`);
    process.exit(3);
  }
}

if (process.argv[1] && process.argv[1].endsWith('config-lineage.mjs')) {
  main();
}
