import { readFileSync } from 'fs';
import type { ZodType } from 'zod';

/**
 * Loads a JSON config file at `configPath` and validates it against `schema`.
 * No fallback, no default, no silent repair (OD-5) — throws or returns the
 * typed value. One loader for the whole `scraper/config/` family (OD-51).
 */
export function loadValidatedConfig<T>(configPath: string, schema: ZodType<T>): T {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`loadValidatedConfig: cannot read config file "${configPath}": ${cause}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`loadValidatedConfig: "${configPath}" is not valid JSON (parse failure): ${cause}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.length ? issue.path.join('.') : '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `loadValidatedConfig: "${configPath}" failed schema validation (${result.error.issues.length} issue(s)): ${issues}`
    );
  }

  return result.data;
}
