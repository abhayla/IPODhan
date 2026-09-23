import { createHash } from 'crypto';

/**
 * #884 review round 2 NEW-1: ONE content fingerprint of the field manifest.
 *
 * The manifest's schema `version` (field-manifest-schema.ts, only 1|2) is not
 * bumped by content edits — 4 of the last 6 were not — so anything keyed on it
 * never sees a manifest fix. This fingerprints what decides WHERE a field is
 * asked: the rank list per IPO type (order kept — order is the ranking), the
 * `capable` flag per source, and the `documentType` the DOC rank reads. Prose
 * (reason text, unit, class, comparison family, notes) and key order are
 * excluded, so rewording an entry reopens nothing.
 *
 * Callers: the field-plan gap key (per field, `fieldManifestEntryFingerprint`)
 * and the closed-IPO job's resourcing version (#919, whole manifest,
 * `fieldManifestFingerprint`) — one definition, never two (#914 class).
 */
export interface FingerprintableManifestEntry {
  rank?: Record<string, readonly string[]>;
  capability?: Record<string, { capable?: boolean }>;
  documentType?: string;
}

function canonicalEntry(entry: FingerprintableManifestEntry | undefined): unknown[] {
  const e = entry ?? {};
  const rank = Object.keys(e.rank ?? {})
    .sort()
    .map((ipoType) => [ipoType, [...(e.rank?.[ipoType] ?? [])]]);
  const capable = Object.keys(e.capability ?? {})
    .sort()
    .map((source) => [source, e.capability?.[source]?.capable === true]);
  return [rank, capable, e.documentType ?? null];
}

/** sha256 hex of one manifest entry's routing content. */
export function fieldManifestEntryFingerprint(entry: FingerprintableManifestEntry | undefined): string {
  return createHash('sha256').update(JSON.stringify(canonicalEntry(entry))).digest('hex');
}

/** sha256 hex of every entry's routing content, keyed and sorted by `table.field`. */
export function fieldManifestFingerprint(fields: Record<string, FingerprintableManifestEntry> | unknown): string {
  const entries = (fields ?? {}) as Record<string, FingerprintableManifestEntry>;
  const canonical = Object.keys(entries)
    .sort()
    .map((key) => [key, canonicalEntry(entries[key])]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
