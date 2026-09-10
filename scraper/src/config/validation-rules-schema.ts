import { z } from 'zod';

/**
 * Zod schema for `scraper/config/validation-rules.json` (item 4, OD-21).
 *
 * DEVIATION FROM THE BUILD CARD, recorded deliberately: the card's Files table
 * names `validation-rules.yaml` + a draft-07 `validation-rules.schema.json`.
 * Item 2 — the family this file is the second member of — actually shipped
 * `scraper/config/field-manifest.json` validated by a zod schema through
 * `loadValidatedConfig` (JSON only, no YAML parser exists anywhere in
 * `scraper/`). The brief's instruction ("follow item 2's loader contract
 * exactly, do not invent a second parse-validate-throw shape") wins over the
 * card's file extension: JSON + zod, one loader for the whole family.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The restricted assertion DSL. A small named-function dispatch table, NOT an
 * eval — so a malformed or unknown assertion fails at `loadValidationRules()`
 * time (startup), never at write time. Parsed here so the failure is a schema
 * failure with a path, exactly like every other malformed field.
 */
export type ParsedAssertion =
  | { fn: 'ENUM'; allowed: number[] }
  | { fn: 'RANGE'; min: number; max: number }
  | { fn: 'DATE_WITHIN_WORKING_DAYS'; laterField: string; earlierField: string; days: number; exchangeField: string };

export function parseAssertion(assertion: string): ParsedAssertion {
  const enumMatch = /^ENUM\(\s*value\s*,\s*\[([^\]]*)\]\s*\)$/.exec(assertion);
  if (enumMatch) {
    const parts = enumMatch[1].split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length === 0) throw new Error(`ENUM assertion "${assertion}" has an empty allowed set`);
    const allowed = parts.map((p) => {
      const n = Number(p);
      if (!Number.isFinite(n)) throw new Error(`ENUM assertion "${assertion}" has a non-numeric member "${p}"`);
      return n;
    });
    return { fn: 'ENUM', allowed };
  }

  const rangeMatch = /^RANGE\(\s*value\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(assertion);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error(`RANGE assertion "${assertion}" has a non-numeric bound`);
    }
    if (min >= max) throw new Error(`RANGE assertion "${assertion}" has min >= max`);
    return { fn: 'RANGE', min, max };
  }

  const dateMatch =
    /^DATE_WITHIN_WORKING_DAYS\(\s*([a-z_]+)\s*,\s*([a-z_]+)\s*,\s*(\d+)\s*,\s*([a-z_]+)\s*\)$/.exec(assertion);
  if (dateMatch) {
    return {
      fn: 'DATE_WITHIN_WORKING_DAYS',
      laterField: dateMatch[1],
      earlierField: dateMatch[2],
      days: Number(dateMatch[3]),
      exchangeField: dateMatch[4],
    };
  }

  throw new Error(
    `unknown or malformed assertion "${assertion}" — supported: ENUM(value, [..]), RANGE(value, min, max), ` +
      `DATE_WITHIN_WORKING_DAYS(laterField, earlierField, n, exchangeField)`
  );
}

const nullableIsoDate = z
  .string()
  .regex(ISO_DATE, 'must be an ISO date (YYYY-MM-DD)')
  .nullable();

export const validationRuleSchema = z
  .object({
    id: z.string().min(1),
    appliesTo: z
      .object({
        table: z.string().min(1),
        column: z.string().min(1),
      })
      .strict(),
    offeringTypes: z.array(z.string().min(1)).min(1),
    segments: z.array(z.string().min(1)).min(1),
    validFrom: nullableIsoDate,
    validTo: nullableIsoDate,
    assertion: z.string().min(1).superRefine((value, ctx) => {
      try {
        parseAssertion(value);
      } catch (err) {
        ctx.addIssue({ code: 'custom', message: err instanceof Error ? err.message : String(err) });
      }
    }),
    causeTemplate: z.string().min(1),
  })
  .strict()
  .refine(
    (rule) => !(rule.validFrom && rule.validTo) || rule.validFrom <= rule.validTo,
    { message: 'validFrom must not be after validTo' }
  );

export const validationRulesFileSchema = z
  .object({
    version: z.literal(1),
    rules: z.array(validationRuleSchema).min(1),
  })
  .strict()
  .refine(
    (file) => new Set(file.rules.map((r) => r.id)).size === file.rules.length,
    { message: 'rule ids must be unique' }
  );

export type ValidationRuleFile = z.infer<typeof validationRulesFileSchema>;
export type ValidationRule = z.infer<typeof validationRuleSchema>;
