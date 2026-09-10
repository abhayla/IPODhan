import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadValidatedConfig } from './validated-config-loader.js';
import { downloadAllowlistSchema, type DownloadAllowlist } from './download-allowlist-schema.js';

// `scraper` is "type": "module", so __dirname does NOT exist at module scope.
// It must be derived from import.meta.url. See scripts/ci/check-esm-module-globals.mjs.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

const DEFAULT_ALLOWLIST_PATH = join(
  MODULE_DIR,
  '..',
  '..',
  '..',
  'scraper',
  'config',
  'download-allowlist.json'
);

/**
 * Reads and validates `scraper/config/download-allowlist.json` via the
 * shared `loadValidatedConfig` (OD-51) — the set of hosts data, not a
 * literal in `company-host-source.ts`.
 */
export function loadDownloadAllowlist(path: string = DEFAULT_ALLOWLIST_PATH): DownloadAllowlist {
  return loadValidatedConfig(path, downloadAllowlistSchema);
}
