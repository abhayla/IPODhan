import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadValidatedConfig } from './validated-config-loader.js';
import { fieldManifestSchema, type FieldManifest } from './field-manifest-schema.js';

// `scraper` is "type": "module", so __dirname does NOT exist at module scope.
// It must be derived from import.meta.url. See scripts/ci/check-esm-module-globals.mjs.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

// Exported (item 3 slice S0b) so the process-start log line in scraper/src/index.ts can name the
// same file loadFieldManifest actually read, without duplicating this path-join logic.
export const DEFAULT_MANIFEST_PATH = join(MODULE_DIR, '..', '..', '..', 'scraper', 'config', 'field-manifest.json');

// CRITICAL-2 (Tier A review, PR #753): module-level cache, keyed by resolved path. Every
// write-path call (`hasManifestRow`, `resolveFieldSourcePolicy`) re-read + re-parsed + fully
// re-validated the 190-row manifest from disk with no memoization -- measured ~4ms/call, and a
// single write went through this twice (once per call site). A fresh scraper process reads the
// file once per unique path for the life of the process; a config-only deploy replaces the file
// between PROCESSES, never within one, so no TTL/invalidation is needed (explicitly not added
// per the review). Tests rely on `vi.resetModules()` between cases (see
// field-priority-matrix-shim-and-shadow.test.ts) to get a fresh cache per test -- a module-level
// Map is safe precisely because resetModules() clears it along with everything else in the
// module's closure.
const manifestCache = new Map<string, FieldManifest>();

/**
 * Reads and validates scraper/config/field-manifest.json via the shared
 * loadValidatedConfig (schema validation, OD-51). Then runs one further
 * cross-check the zod schema cannot express (a zod schema cannot see across
 * two sibling keys of the same object): every source named in a field's
 * `rank[]` array must have `capability.<source>.capable === true` in the
 * SAME row. A schema failure throws first; only a schema-valid file reaches
 * the cross-check, so the two failure modes are never conflated.
 *
 * Memoized per path (CRITICAL-2). A throw is NOT cached -- only a fully validated manifest is
 * ever stored, so a malformed file keeps throwing on every call rather than caching a failure.
 */
export function loadFieldManifest(path: string = DEFAULT_MANIFEST_PATH): FieldManifest {
  const cached = manifestCache.get(path);
  if (cached) return cached;

  const manifest = loadValidatedConfig(path, fieldManifestSchema);

  for (const [fieldKey, entry] of Object.entries(manifest.fields)) {
    for (const [ipoType, sources] of Object.entries(entry.rank)) {
      for (const source of sources ?? []) {
        const capabilityEntry = entry.capability[source];
        if (!capabilityEntry || capabilityEntry.capable !== true) {
          throw new Error(
            `loadFieldManifest: field "${fieldKey}" ranks source "${source}" (in rank.${ipoType}) ` +
              `but capability.${source}.capable is ${capabilityEntry ? 'false' : 'missing'} — ` +
              `a source must be marked capable:true to appear in a rank list.`
          );
        }
      }
    }
  }

  manifestCache.set(path, manifest);
  return manifest;
}
