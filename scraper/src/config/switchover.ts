/**
 * Item 3 slice S1b — which reconciliation groups are FLIPPED to decide from
 * `resolveFieldSourcePolicy(...)` instead of the legacy `field-priority-matrix.ts` rank list.
 *
 * `scraper/config/switchover.json` ships INSIDE the release (a committed file, like
 * `field-manifest.json` was before item 3 slice S5's config-deploy). It is NOT config-deployed
 * and NOT symlinked by S5 — config-deploy of switchover.json is a follow-up (extend
 * deploy-config.sh, a separate Tier A PR); until then a flip is a code deploy.
 *
 * Validated at process start (`validateSwitchoverAtStartup`, index.ts) next to the manifest
 * check, same shape: a schema failure OR a cross-check failure throws synchronously, before
 * `main()` runs.
 */
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadValidatedConfig } from './validated-config-loader.js';
import { loadFieldManifest } from './field-manifest-loader.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

// Same convention as field-manifest-loader.ts's DEFAULT_MANIFEST_PATH: scraper/src/config -> up
// three -> scraper/config/switchover.json.
export const DEFAULT_SWITCHOVER_PATH = join(MODULE_DIR, '..', '..', '..', 'scraper', 'config', 'switchover.json');

const switchoverSchema = z
  .object({
    version: z.literal(1),
    groups: z.record(z.string(), z.array(z.string().min(1))),
    flipped: z.array(z.string()),
    identityFields: z.array(z.string()),
  })
  .strict();

export interface Switchover {
  version: 1;
  groups: Record<string, string[]>;
  flipped: string[];
  identityFields: string[];
}

/** field key -> which group it belongs to, built once per loaded Switchover. */
function buildFieldToGroup(sw: Switchover): Map<string, string> {
  const map = new Map<string, string>();
  for (const [group, fields] of Object.entries(sw.groups)) {
    for (const field of fields) {
      if (map.has(field)) {
        throw new Error(
          `loadSwitchover: field "${field}" is listed in more than one group ("${map.get(field)}" and "${group}") — a field may belong to at most one reconciliation group.`
        );
      }
      map.set(field, group);
    }
  }
  return map;
}

/**
 * Reads and validates `switchover.json`. Cross-checks the zod schema cannot express on its own
 * (mirrors `loadFieldManifest`'s pattern):
 *  - every field named in a group must exist in the field manifest (`table.column` key)
 *  - a field may belong to at most one group
 *  - every entry in `flipped` must name a group that exists in `groups`
 *  - every entry in `identityFields` must exist in the field manifest
 */
export function loadSwitchover(path: string = DEFAULT_SWITCHOVER_PATH): Switchover {
  const sw = loadValidatedConfig(path, switchoverSchema);
  const manifest = loadFieldManifest();

  for (const [group, fields] of Object.entries(sw.groups)) {
    for (const field of fields) {
      if (!(field in manifest.fields)) {
        throw new Error(
          `loadSwitchover: group "${group}" names field "${field}", which has no entry in the field manifest.`
        );
      }
    }
  }

  // Throws on a field in two groups.
  buildFieldToGroup(sw);

  for (const group of sw.flipped) {
    if (!(group in sw.groups)) {
      throw new Error(`loadSwitchover: "flipped" names group "${group}", which is not defined in "groups".`);
    }
  }

  for (const field of sw.identityFields) {
    if (!(field in manifest.fields)) {
      throw new Error(
        `loadSwitchover: identityFields names field "${field}", which has no entry in the field manifest.`
      );
    }
  }

  return sw;
}

let cached: Switchover | undefined;
let cachedPath: string | undefined;

function getSwitchover(path: string = DEFAULT_SWITCHOVER_PATH): Switchover {
  if (cached === undefined || cachedPath !== path) {
    cached = loadSwitchover(path);
    cachedPath = path;
  }
  return cached;
}

/** Test-only: forces the next `groupOf`/`isFlipped` call (with no explicit path) to reload. */
export function resetSwitchoverCache(): void {
  cached = undefined;
  cachedPath = undefined;
}

/** Which group `table.column` belongs to, or `null` when it is in no group. */
export function groupOf(table: string, column: string, path?: string): string | null {
  const sw = getSwitchover(path);
  const fieldMap = buildFieldToGroup(sw);
  return fieldMap.get(`${table}.${column}`) ?? null;
}

/** Is `table.column`'s group (if any) in the `flipped` list? */
export function isFlipped(table: string, column: string, path?: string): boolean {
  const sw = getSwitchover(path);
  const group = groupOf(table, column, path);
  return group !== null && sw.flipped.includes(group);
}
