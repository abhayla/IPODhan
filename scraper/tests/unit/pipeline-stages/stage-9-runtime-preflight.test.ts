/**
 * Stage 9 of the IPO pipeline test ladder (docs/reviews/ipo-pipeline-stage-gap-analysis.md
 * section 6): "Runtime env - the VPS - preflight script - python3 + pdfplumber + tesseract
 * present, TZ set, store dir writable".
 *
 * FIXTURE IN / EXPECTED-OUTPUT-FILE OUT. The fixture is a scenario name plus a temp PATH of
 * fake executable shims; the expected output is fixtures/stage-9/expected-verdicts.json,
 * written from the script's documented contract BEFORE this file existed. This drives the
 * REAL scripts/preflight-runtime.sh as a subprocess - deleting or weakening a check in the
 * script turns this red. It is not a re-implementation of the checks.
 *
 * Relationship to scripts/tests/preflight-runtime.test.mjs (T-406): that suite is the
 * script's own fine-grained unit self-test (boundary values, parse edge cases). This is the
 * ladder's STAGE-LEVEL harness - one coarse verdict table per provisioning scenario, in the
 * same place and shape as every other stage, so a stage-9 regression shows up in the ladder
 * run rather than only in a script-local suite. Extends, does not duplicate.
 *
 * No VPS access, no network, no DB.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'preflight-runtime.sh');
const EXPECTED = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'stage-9', 'expected-verdicts.json'), 'utf8')
) as {
  checkOrder: string[];
  scenarios: Record<
    string,
    {
      /** The FIXTURE: declared explicitly, never derived from `verdicts` (see the file's _input note). */
      input: {
        pdfplumber: boolean;
        tesseract: boolean;
        tz: string;
        storeDir: 'exists' | 'missing';
        args: string[];
      };
      exitCode: number;
      verdicts: Record<string, string>;
    }
  >;
};

type ShimOpts = {
  pdfplumber: boolean;
  tesseract: boolean;
};

function shim(dir: string, name: string, body: string): void {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}

/**
 * Builds a temp bin dir shadowing python3/tesseract/node/df so the verdicts depend only on
 * the scenario, never on whatever the host machine or CI runner happens to have installed.
 */
function makeShims(opts: ShimOpts): string {
  const dir = mkdtempSync(join(tmpdir(), 'stage9-shims-'));
  shim(
    dir,
    'python3',
    [
      'if [ "$1" = "-c" ]; then',
      '  case "$2" in',
      opts.pdfplumber
        ? '    *pdfplumber*) exit 0 ;;'
        : '    *pdfplumber*) echo "ModuleNotFoundError: No module named pdfplumber" >&2; exit 1 ;;',
      '    *) exit 0 ;;',
      '  esac',
      'fi',
      'echo "Python 3.11.0"',
    ].join('\n')
  );
  if (opts.tesseract) shim(dir, 'tesseract', 'echo "tesseract 5.3.0"');
  shim(dir, 'node', `echo "${opts.nodeVersion ?? 'v22.11.0'}"`);
  // df -Pk <path>: second line's 4th column is the Available 1K-block count.
  // 10485760 KiB = 10 GiB, comfortably over the script's 2GB floor.
  shim(
    dir,
    'df',
    [
      'echo "Filesystem     1024-blocks      Used Available Capacity Mounted on"',
      'echo "shimfs                 0         0 10485760       0% /"',
    ].join('\n')
  );
  return dir;
}

/** Parses the script's `LEVEL check name - detail` lines into {check: level}. */
function parseVerdicts(stdout: string, checkOrder: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^(OK|WARN|FAIL)\s+(.*)$/.exec(line.trim());
    if (!m) continue;
    const rest = m[2];
    const check = checkOrder.find((c) => rest.startsWith(c));
    if (check) out[check] = m[1];
  }
  return out;
}

describe('pipeline stage 9 - VPS runtime preflight', () => {
  for (const [name, expected] of Object.entries(EXPECTED.scenarios)) {
    it(`scenario ${name} matches the expected verdict file`, () => {
      const input = expected.input;
      const shims = makeShims({
        pdfplumber: input.pdfplumber,
        tesseract: input.tesseract,
        nodeVersion: input.nodeVersion,
      });
      const workspace = mkdtempSync(join(tmpdir(), 'stage9-ws-'));
      const storeDir = join(workspace, 'prospectus');
      const tzFile = join(workspace, 'timezone');
      try {
        mkdirSync(storeDir, { recursive: true });
        writeFileSync(tzFile, 'Asia/Kolkata\n');

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          PATH: `${shims}${delimiter}${process.env.PATH ?? ''}`,
          PREFLIGHT_ETC_TIMEZONE_FILE: tzFile,
          PROSPECTUS_STORE_DIR: input.storeDir === 'missing' ? join(workspace, 'does-not-exist') : storeDir,
          ADMIN_API_TOKEN: 'stage9-fixture-token',
          TZ: input.tz,
        };

        const run = spawnSync('bash', [SCRIPT, ...input.args], {
          env,
          encoding: 'utf8',
          timeout: 30_000,
        });

        expect(run.error, `failed to spawn bash for ${SCRIPT}`).toBeUndefined();
        const actual = parseVerdicts(run.stdout ?? '', EXPECTED.checkOrder);
        expect(actual, `stdout was:\n${run.stdout}\n${run.stderr}`).toEqual(expected.verdicts);
        expect(run.status, `stdout was:\n${run.stdout}`).toBe(expected.exitCode);
      } finally {
        rmSync(shims, { recursive: true, force: true });
        rmSync(workspace, { recursive: true, force: true });
      }
    });
  }

  it('emits a verdict for every check the expected file names (no silently dropped check)', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    for (const check of EXPECTED.checkOrder) {
      expect(src, `preflight script no longer emits the check "${check}"`).toContain(check);
    }
  });
});
