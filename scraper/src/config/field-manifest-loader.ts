import { join } from 'path';
import { loadValidatedConfig } from './validated-config-loader';
import { fieldManifestSchema, type FieldManifest } from './field-manifest-schema';

const DEFAULT_MANIFEST_PATH = join(__dirname, '..', '..', '..', 'scraper', 'config', 'field-manifest.json');

/**
 * Reads and validates scraper/config/field-manifest.json via the shared
 * loadValidatedConfig (schema validation, OD-51). Then runs one further
 * cross-check the zod schema cannot express (a zod schema cannot see across
 * two sibling keys of the same object): every source named in a field's
 * `rank[]` array must have `capability.<source>.capable === true` in the
 * SAME row. A schema failure throws first; only a schema-valid file reaches
 * the cross-check, so the two failure modes are never conflated.
 */
export function loadFieldManifest(path: string = DEFAULT_MANIFEST_PATH): FieldManifest {
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

  return manifest;
}
