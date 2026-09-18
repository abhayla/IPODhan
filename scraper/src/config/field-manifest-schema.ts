import { z } from 'zod';

// Source codes named in field-manifest.json `rank[]` arrays and `capability`
// maps. Matches the card's `SourceCode` union (item-02-field-manifest-and-
// priority-config.md `## Interfaces`).
export const sourceCodeSchema = z.enum([
  'ADMIN',
  'DOC',
  'DRHP',
  'RHP',
  'PROSPECTUS',
  'CORRIGENDUM',
  'PRICE_BAND_AD',
  'NSE',
  'BSE',
  'CHITTORGARH',
  'MONEYCONTROL',
  'INVESTORGAIN_GMP',
  'REG',
  'API_FALLBACK',
]);

export type SourceCode = z.infer<typeof sourceCodeSchema>;

const capabilityEntrySchema = z
  .object({
    capable: z.boolean(),
    reason: z.string().min(1),
  })
  .strict();

// A row MAY add further IPO-type keys beyond MAINBOARD/SME_BSE/SME_NSE (e.g.
// RIGHTS, OFS, NCD) — the card's `IpoTypeKey` is `'MAINBOARD' | 'SME_BSE' |
// 'SME_NSE' | string`. MAINBOARD is the only required key; the loader does
// NOT default a missing key to `[]`.
const rankSchema = z
  .record(z.string(), z.array(sourceCodeSchema))
  .refine((rank) => Array.isArray(rank.MAINBOARD), {
    message: 'rank.MAINBOARD is required and must be an array of SourceCode',
  });

export const fieldManifestEntrySchema = z
  .object({
    class: z.enum(['D', 'T', 'X', 'W', 'M']),
    documentType: z
      .enum(['DRHP', 'RHP', 'PROSPECTUS', 'CORRIGENDUM', 'PRICE_BAND_AD', 'RATIOS_BASIS_ISSUE_PRICE'])
      .optional(),
    documentSection: z.string().optional(),
    rank: rankSchema,
    // A partial map — only sources actually referenced by this field carry
    // an entry (the TS interface's `Record<SourceCode, ...>` is a target
    // shape, not a requirement that every one of the 13 SourceCode values
    // be listed on every row). Key names are validated as real SourceCode
    // values via the .refine below (z.record with an enum key forces every
    // enum member to be present, which is wrong here — see field-manifest-
    // loader.test.ts's fixtures, which only ever list a few sources).
    capability: z.record(z.string(), capabilityEntrySchema).refine(
      (capability) => Object.keys(capability).every((key) => sourceCodeSchema.safeParse(key).success),
      { message: 'capability keys must be valid SourceCode values' }
    ),
    na: z.array(z.string()).optional(),
    unit: z.enum(['rupee', 'crore', 'keep']),
    // S3b step 1 (issue #775): how the OD-59 comparator reads two witnesses' values before
    // deciding CONFIRMED/DISPUTED. Derived from structure (scripts/generate-field-manifest.mjs),
    // never hand-assigned. ABSTAIN is a real family, not an omission: it marks fields (free
    // prose, structured lists of objects) that opt OUT of consensus entirely rather than being
    // marked permanently DISPUTED on formatting/ordering noise.
    comparisonFamily: z.enum(['MONEY', 'RATIO', 'IDENTITY', 'IDENTIFIER', 'DATE', 'BOOLEAN', 'SET', 'COUNT', 'ABSTAIN']),
  })
  .strict();

export type FieldManifestEntry = z.infer<typeof fieldManifestEntrySchema>;

export const fieldManifestSchema = z
  .object({
    // item 3 slice S0b: version 2 is the generated manifest (190 fields, produced by
    // scripts/generate-field-manifest.mjs from docs/design/field-source-resolution.spec.mjs).
    // version 1 (the 10 hand-written rows) stays accepted so a revert lands cleanly (card rollback).
    version: z.union([z.literal(1), z.literal(2)]),
    generatedFrom: z.string().min(1),
    fields: z.record(z.string(), fieldManifestEntrySchema),
  })
  .strict();

export type FieldManifest = z.infer<typeof fieldManifestSchema>;
