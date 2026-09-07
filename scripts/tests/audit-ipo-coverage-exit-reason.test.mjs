// T-500 (#404): "audit-ipo-coverage.mjs --gate exits 2 with no output when run
// from the laptop through the tunnel." RCA: on a connection refused with BOTH
// an IPv6 and IPv4 attempt (Node's dual-stack Happy Eyeballs), `pg` rejects with
// an `AggregateError` whose OWN `.message` is the empty string — the real
// reasons live in `.errors[]`. The gate's catch block printed `err.message`
// only, so a real connection failure produced an exit code with zero stderr:
// silence is indistinguishable from a hang. Fixed by formatting the reason
// from AggregateError sub-errors (and `.cause`) before every non-zero exit.
//
// Spawns the REAL script (never a re-implementation) so a regression in the
// gate's own catch block turns this red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import net from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'audit-ipo-coverage.mjs');

function runScript(env) {
  return spawnSync(process.execPath, [SCRIPT, '--gate'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    cwd: join(__dirname, '..', '..'),
  });
}

test('missing DB env: prints a one-line reason to stderr and exits 2', () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DATABASE_HOST;
  delete env.DATABASE_PASSWORD;
  const result = spawnSync(process.execPath, [SCRIPT, '--gate'], {
    env,
    encoding: 'utf8',
    cwd: join(__dirname, '..', '..'),
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /audit-ipo-coverage: /);
  assert.match(result.stderr, /no DB connection configured/i);
});

test('unreachable DB host (connection refused): prints the connection error and exits non-zero — never silent', async () => {
  // Bind an ephemeral port then close it immediately so the port is free but
  // guaranteed to refuse the next connection attempt (matches the tunnel-down
  // shape: DATABASE_HOST/PORT set, nothing listening).
  const probe = net.createServer();
  const port = await new Promise((resolve, reject) => {
    probe.listen(0, '127.0.0.1', () => resolve(probe.address().port));
    probe.on('error', reject);
  });
  await new Promise((resolve) => probe.close(resolve));

  // 'localhost' (not '127.0.0.1') is deliberate: it resolves to BOTH ::1 and
  // 127.0.0.1, so Node's Happy-Eyeballs dual-stack dial produces an
  // AggregateError whose own `.message` is `''` — the exact shape that made
  // the real tunnel-down run print nothing (#404's `err.message` bug).
  const result = runScript({
    DATABASE_HOST: 'localhost',
    DATABASE_PORT: String(port),
    DATABASE_NAME: 'ipodhan',
    DATABASE_USER: 'postgres',
    DATABASE_PASSWORD: 'x',
  });

  assert.notEqual(result.status, 0, 'must not exit 0 on a connection failure');
  // The historical defect: stderr was EMPTY on this exact path.
  assert.notEqual(result.stderr.trim(), '', 'stderr must never be empty on a non-zero exit');
  assert.match(result.stderr, /audit-ipo-coverage: /);
  assert.match(result.stderr, /ECONNREFUSED|refused/i);
});
