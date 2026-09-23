/**
 * OD-85 write rule (§2.3.3.2 "Source record keys"): "its id is recorded into
 * `field_sources.data_lineage`". One record is processed per scope; the key ids that bound it (a key
 * hit, a fallback bind that recorded the record's keys, or a create that wrote them) are noted here
 * and `FieldSourcesRepository.trackFieldUpdate` merges them into every lineage row it writes for
 * THAT ipo as `sourceKeyIds`. Outside a scope nothing is noted and nothing is added, so callers that
 * never bind by key (document path, admin tools) are unchanged.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface LineageHolder {
  ipoId: string | null;
  keyIds: string[];
}

const store = new AsyncLocalStorage<LineageHolder>();

/** Runs `fn` as one record's scope. A nested call reuses the outer scope (same record). */
export function withSourceKeyLineage<T>(fn: () => Promise<T>): Promise<T> {
  if (store.getStore()) return fn();
  return store.run({ ipoId: null, keyIds: [] }, fn);
}

/** Notes the keys that bound `ipoId` for the record in scope. A bind to another row replaces the note. */
export function noteSourceKeyBind(ipoId: string, keyIds: readonly string[]): void {
  const holder = store.getStore();
  if (!holder || keyIds.length === 0) return;
  if (holder.ipoId !== ipoId) {
    holder.ipoId = ipoId;
    holder.keyIds = [];
  }
  for (const id of keyIds) if (!holder.keyIds.includes(id)) holder.keyIds.push(id);
}

/** `{ sourceKeyIds }` for a lineage row of `ipoId`, or null when this write did not come through a key bind. */
export function sourceKeyLineageFor(ipoId: string | null | undefined): { sourceKeyIds: string[] } | null {
  const holder = store.getStore();
  if (!holder || !ipoId || holder.ipoId !== ipoId || holder.keyIds.length === 0) return null;
  return { sourceKeyIds: [...holder.keyIds] };
}
