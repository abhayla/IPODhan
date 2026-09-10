import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadValidatedConfig } from './validated-config-loader.js';
import { validationRulesFileSchema, type ValidationRule } from './validation-rules-schema.js';

// `scraper` is "type": "module", so __dirname does NOT exist at module scope.
// It must be derived from import.meta.url. See scripts/ci/check-esm-module-globals.mjs.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

const DEFAULT_RULES_PATH = join(MODULE_DIR, '..', '..', '..', 'scraper', 'config', 'validation-rules.json');

/**
 * Reads and validates `scraper/config/validation-rules.json` through the same
 * shared `loadValidatedConfig` (parse -> schema -> throw, no fallback, no
 * silent repair) that `loadFieldManifest()` uses. Then runs the one
 * cross-check the per-rule zod schema cannot express, because it needs to see
 * across sibling rules: two rules for the SAME (table, column) whose
 * (offeringType, segment, date) windows overlap would make the outcome depend
 * on array order rather than on the rule set, so it is rejected loudly here
 * instead of silently picking the first match at write time.
 */
export function loadValidationRules(path: string = DEFAULT_RULES_PATH): ValidationRule[] {
  const file = loadValidatedConfig(path, validationRulesFileSchema);

  for (let i = 0; i < file.rules.length; i++) {
    for (let j = i + 1; j < file.rules.length; j++) {
      const a = file.rules[i];
      const b = file.rules[j];
      if (a.appliesTo.table !== b.appliesTo.table || a.appliesTo.column !== b.appliesTo.column) continue;
      if (!setsIntersect(a.offeringTypes, b.offeringTypes)) continue;
      if (!setsIntersect(a.segments, b.segments)) continue;
      if (!dateWindowsOverlap(a.validFrom, a.validTo, b.validFrom, b.validTo)) continue;
      throw new Error(
        `loadValidationRules: rules "${a.id}" and "${b.id}" both cover ` +
          `${a.appliesTo.table}.${a.appliesTo.column} for an overlapping ` +
          `(offeringType, segment, date) window — a value would be judged by whichever ` +
          `rule happens to come first in the file. Narrow one of the two windows.`
      );
    }
  }

  return file.rules;
}

function setsIntersect(a: string[], b: string[]): boolean {
  if (a.includes('ALL') || b.includes('ALL')) return true;
  return a.some((x) => b.includes(x));
}

function dateWindowsOverlap(
  aFrom: string | null,
  aTo: string | null,
  bFrom: string | null,
  bTo: string | null
): boolean {
  const aStart = aFrom ?? '0000-01-01';
  const aEnd = aTo ?? '9999-12-31';
  const bStart = bFrom ?? '0000-01-01';
  const bEnd = bTo ?? '9999-12-31';
  return aStart <= bEnd && bStart <= aEnd;
}
