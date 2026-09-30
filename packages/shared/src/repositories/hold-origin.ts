/**
 * #1299: who started an identity hold. The admin create form wraps its whole transaction in
 * `withHoldOrigin('admin-create', ...)`; `IPORepository.recordIdentityHold` (the ONE writer of
 * IDENTITY_HELD_FOR_REVIEW rows) reads it, so EVERY hold path an admin create can reach is tagged
 * without each caller threading a parameter (the same-name hold, the OD-68 fold hold, the slug-taken
 * hold, the alias and name-only holds). A scraper runs outside any scope and is never tagged.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type HoldOrigin = 'admin-create';

const store = new AsyncLocalStorage<HoldOrigin>();

export function withHoldOrigin<T>(origin: HoldOrigin, fn: () => Promise<T>): Promise<T> {
  return store.run(origin, fn);
}

export function currentHoldOrigin(): HoldOrigin | undefined {
  return store.getStore();
}
