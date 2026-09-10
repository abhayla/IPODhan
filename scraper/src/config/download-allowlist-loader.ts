import { join } from 'path';
import { loadValidatedConfig } from './validated-config-loader.js';
import { downloadAllowlistSchema, type DownloadAllowlist } from './download-allowlist-schema.js';

const DEFAULT_ALLOWLIST_PATH = join(
  __dirname,
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
