/**
 * Each field's OD-59 comparison family, read from the scraper's field manifest
 * (scraper/config/field-manifest.json, keys `table.snake_column`), so the admin queue compares a
 * conflict's two values exactly as the scraper does (areEquivalent, @ipodhan/shared/utils/value-equivalence).
 *
 * Read at run time on the server (the release carries scraper/config next to web/). When the file
 * cannot be read the map is empty and every field compares without a family: a pair within 0.5%
 * then stays on the disagreement list (shown, never hidden) — the safe direction.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComparisonFamily } from '@ipodhan/shared/utils/value-equivalence';

export type ManifestFamily = ComparisonFamily | 'ABSTAIN';

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/** `table.camelField` -> family, from a manifest's `fields` object. */
export function familiesFromManifest(fields: Record<string, { comparisonFamily?: string }>): Map<string, ManifestFamily> {
  const out = new Map<string, ManifestFamily>();
  for (const [key, def] of Object.entries(fields)) {
    const dot = key.indexOf('.');
    if (dot === -1 || !def?.comparisonFamily) continue;
    out.set(`${key.slice(0, dot)}.${snakeToCamel(key.slice(dot + 1))}`, def.comparisonFamily as ManifestFamily);
  }
  return out;
}

let cached: Map<string, ManifestFamily> | null = null;

export function loadComparisonFamilies(): Map<string, ManifestFamily> {
  if (cached) return cached;
  const candidates = [
    process.env.FIELD_MANIFEST_PATH,
    resolve(process.cwd(), '..', 'scraper', 'config', 'field-manifest.json'),
    resolve(process.cwd(), 'scraper', 'config', 'field-manifest.json'),
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as { fields?: Record<string, { comparisonFamily?: string }> };
      if (parsed.fields) {
        cached = familiesFromManifest(parsed.fields);
        return cached;
      }
    } catch {
      // try the next location
    }
  }
  cached = new Map();
  return cached;
}

/** The family of a conflict's field; a row table's `table:rowKey` name is looked up by its bare table. */
export function familyFor(families: Map<string, ManifestFamily>, tableName: string, fieldName: string): ManifestFamily | undefined {
  const i = tableName.indexOf(':');
  return families.get(`${i === -1 ? tableName : tableName.slice(0, i)}.${fieldName}`);
}
