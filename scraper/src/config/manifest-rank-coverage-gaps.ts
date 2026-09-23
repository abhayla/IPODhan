/**
 * #884: every manifest rank that names a source the walk cannot actually ask
 * for that field — the configuration gaps that, before #884, burned a plan
 * row's attempts until the claim query retired it.
 *
 *   NO_FETCHER  — the rank names a source with no registered fetcher.
 *   NO_MAPPING  — the source's manifest capability is true, but its adapter's
 *                 serveable-field set has no entry for the field.
 *   NO_DOCTYPE  — a DOC rank on a field whose manifest entry has no documentType.
 *   NO_COLUMN_READ — a DOC rank on a table the DOC fetcher cannot read yet
 *                 (`DOC_READABLE_TABLES`; review round 1, MINOR-5).
 *
 * Ranks and documentType are read through `resolveFieldSourcePolicy` — the
 * resolver the walk itself asks — per IPO type, never from raw manifest JSON
 * (review round 1, MINOR-5), so the check sees exactly the ranks the walk sees.
 *
 * Pure (the caller supplies the registered sources and each adapter's
 * serveable keys) so the CI test can run it without a database. The result is
 * compared against a committed SHRINK-ONLY baseline: a new gap fails CI; fixing
 * one requires removing its baseline line. Fixing the ranks themselves is
 * owner/spec work (the manifest's rankings are the spec's), never this check's.
 */
import { columnToCamelCase } from './field-name-case.js';
import { resolveFieldSourcePolicy } from './field-source-policy.js';

export type ManifestRankGapKind = 'NO_FETCHER' | 'NO_MAPPING' | 'NO_DOCTYPE' | 'NO_COLUMN_READ';

interface ManifestLike {
  fields: Record<
    string,
    {
      documentType?: string | null;
      rank?: Record<string, readonly (string | null)[]>;
      capability?: Record<string, { capable?: boolean } | undefined>;
    }
  >;
}

export function listManifestRankCoverageGaps(
  manifest: ManifestLike,
  registeredSources: readonly string[],
  serveableBySource: Record<string, ReadonlySet<string>>,
  docReadableTables: readonly string[]
): string[] {
  const registered = new Set(registeredSources);
  const gaps = new Set<string>();
  for (const [key, entry] of Object.entries(manifest.fields)) {
    const dot = key.indexOf('.');
    const tableName = key.slice(0, dot);
    const fieldName = key.slice(dot + 1);
    const camelKey = `${tableName}.${columnToCamelCase(fieldName)}`;
    for (const ipoType of Object.keys(entry.rank ?? {})) {
      const policy = resolveFieldSourcePolicy(
        { table: tableName, column: fieldName, ipoType } as never,
        { manifest: manifest as never }
      );
      for (const source of policy.ranks as readonly (string | null)[]) {
        if (!source) continue;
        if (!registered.has(source)) {
          gaps.add(`${key} ${source} NO_FETCHER`);
          continue;
        }
        // Not capable = the fetcher answers NOT_PRINTED, a settled "no", never a gap.
        if (entry.capability?.[source]?.capable !== true) continue;
        if (source === 'DOC') {
          if (!policy.documentType) gaps.add(`${key} DOC NO_DOCTYPE`);
          else if (!docReadableTables.includes(tableName)) gaps.add(`${key} DOC NO_COLUMN_READ`);
          continue;
        }
        const serveable = serveableBySource[source];
        if (serveable && !serveable.has(camelKey)) gaps.add(`${key} ${source} NO_MAPPING`);
      }
    }
  }
  return [...gaps].sort();
}
