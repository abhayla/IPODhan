/**
 * The production `OverrideReader` (item 3 slice S4) — adapts
 * `FieldSourceOverridesRepository` to the resolver's `OverrideReader` interface
 * (`field-source-policy.ts`). Filters the repository's "every active row for (table, field)" down
 * to rows that also match this query's `ipoId` (global rows, `ipoId === null`, always match).
 *
 * A missing table is already handled inside the repository (returns [] and logs once) — this
 * reader adds nothing on top of that; "layer 2 absent" and "no matching override" look identical
 * to the resolver by design (S4 safety property: a missing table must never crash the resolver).
 */
import type { FieldSourceOverridesRepository } from '@ipodhan/shared/repositories/field-source-overrides-repository';
import type { OverrideReader, PolicyQuery, ResolvedOverride } from './field-source-policy.js';
import type { SourceCode } from './field-manifest-schema.js';

export function createFieldSourceOverridesReader(repository: FieldSourceOverridesRepository): OverrideReader {
  return {
    async resolve(query: PolicyQuery): Promise<ResolvedOverride[]> {
      const rows = await repository.listActiveFor(query.table, query.column);
      const matching = rows.filter((row) => row.ipoId === null || row.ipoId === query.ipoId);
      return matching.map((row) => ({
        id: row.id,
        ranks: [row.rank1Source, row.rank2Source, row.rank3Source].filter(
          (s): s is SourceCode => s !== null
        ),
        expiresAt: row.expiresAt.toISOString(),
        ipoScoped: row.ipoId !== null,
      }));
    },
  };
}
