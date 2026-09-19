/**
 * Deploy-time gate for the failure class "shared config not shipped by the code
 * deploy" (#793, docs/reviews/failure-classes/shared-config-not-shipped-by-code-deploy.json).
 *
 * WHY THIS EXISTS. Several files under `scraper/config/` are SYMLINKS inside a
 * release, pointing at `$ROOT/shared/config/<slot>/`, which a code deploy
 * deliberately never overwrites (deploy-linux.sh step 5.1 only SEEDS when the
 * shared file is missing or empty; `scripts/ops/deploy-config.sh` is the only
 * thing that replaces it). So a single commit can ship a TIGHTER validator on
 * the code path while the VALUE it validates stays at an older config-deploy
 * sha. On 2026-09-19 `b5614cc7` made `comparisonFamily` a required enum in
 * `field-manifest-schema.ts` and added it to the repo manifest in the same
 * commit; staging deployed the code, the shared manifest stayed a day old, all
 * 190 fields failed validation and the scraper died at start in 4-6 seconds,
 * every 30 minutes, for six hours. The deploy reported SUCCESS throughout,
 * because its gate checked served sha, migrations and row counts — none of
 * which require the scraper process to start.
 *
 * WHAT IT DOES. Runs the REAL loaders — the same functions the scraper calls at
 * process start — against the DEPLOYED files (resolved through the symlink), so
 * the verdict comes from the code that actually crashed, not a re-implementation
 * of the schema that can drift from it. Prints one line per config and exits
 * non-zero with the loader's own error text on the first refusal.
 *
 * FAIL CLOSED. A config file that cannot be read, is not JSON, or refuses the
 * schema is a FAILURE. So is this script being unable to run at all — the deploy
 * script treats a non-zero exit, including a crash, as a failed gate. A gate that
 * silently skips is the bug being fixed.
 *
 * WHAT IT CANNOT CATCH. Anything that changes the shared config AFTER the deploy
 * (a later hand-edit, a config deploy that lands a bad file), and any failure
 * inside a cycle once it starts. This proves the process can load its config at
 * this moment, never that a cycle will succeed.
 *
 * Usage: node <tsx/dist/cli.mjs> src/scripts/validate-deployed-config.ts [--release-dir <dir>]
 * (default release dir: two levels above this file's scraper/src/scripts/ home).
 */
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFieldManifest } from '../config/field-manifest-loader.js';
import { loadValidationRules } from '../config/validation-rules-loader.js';
import { loadDownloadAllowlist } from '../config/download-allowlist-loader.js';
import { loadSwitchover } from '../config/switchover.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** scraper/src/scripts -> scraper/src -> scraper -> <release root>. */
const DEFAULT_RELEASE_DIR = resolve(MODULE_DIR, '..', '..', '..');

interface ConfigCheck {
  /** Path relative to the release root, as it appears in a release directory. */
  readonly file: string;
  /** The REAL loader the scraper uses — never a re-implementation of the schema. */
  readonly load: (path: string) => unknown;
  /** One-line summary of what loaded, so a PASS line carries evidence and not just "ok". */
  readonly describe: (loaded: never) => string;
}

const CHECKS: readonly ConfigCheck[] = [
  {
    file: 'scraper/config/field-manifest.json',
    load: (p) => loadFieldManifest(p),
    describe: (m: never) => `${Object.keys((m as { fields: object }).fields).length} field(s)`,
  },
  {
    file: 'scraper/config/validation-rules.json',
    load: (p) => loadValidationRules(p),
    describe: (r: never) => `${(r as unknown[]).length} rule(s)`,
  },
  {
    file: 'scraper/config/download-allowlist.json',
    load: (p) => loadDownloadAllowlist(p),
    describe: () => 'allowlist loaded',
  },
  {
    file: 'scraper/config/switchover.json',
    load: (p) => loadSwitchover(p),
    describe: () => 'switchover loaded',
  },
];

function parseReleaseDir(argv: readonly string[]): string {
  const i = argv.indexOf('--release-dir');
  if (i === -1) return DEFAULT_RELEASE_DIR;
  const value = argv[i + 1];
  if (!value) {
    console.error('validate-deployed-config: --release-dir needs a directory argument');
    process.exit(2);
  }
  return resolve(value);
}

/**
 * The point of the whole gate: say WHICH file was really read. A release's
 * config path is usually a symlink into shared/config/<slot>/, and the entire
 * failure class is "the thing behind the link is not the thing in the commit",
 * so an operator reading this output must see the resolved target, not the link.
 */
function resolvedTarget(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return `${path} (unresolvable)`;
  }
}

function main(): void {
  const releaseDir = parseReleaseDir(process.argv.slice(2));
  console.log(`validate-deployed-config: release=${releaseDir}`);

  let failures = 0;
  for (const check of CHECKS) {
    const path = join(releaseDir, check.file);
    const target = resolvedTarget(path);
    try {
      const loaded = check.load(path);
      console.log(`OK   ${check.file} -> ${target} (${check.describe(loaded as never)})`);
    } catch (err) {
      failures++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`FAIL ${check.file} -> ${target}`);
      console.error(`     ${message}`);
    }
  }

  if (failures > 0) {
    console.error('');
    console.error(
      `validate-deployed-config: ${failures} of ${CHECKS.length} deployed config file(s) REFUSED by the deployed schema. ` +
        'The scraper would crash at process start. Run scripts/ops/deploy-config.sh for this slot, or fix the config, before this deploy can be called good.'
    );
    process.exit(1);
  }

  console.log(`validate-deployed-config: all ${CHECKS.length} deployed config file(s) load under the deployed schema`);
}

main();
