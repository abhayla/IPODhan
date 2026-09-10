/**
 * Per-FILE form of the preflight: checks, but prints only when it refuses.
 *
 * Used as the vitest `setupFiles` entry. `setupFiles` runs once per test
 * file and `isolate: true` gives each file a fresh module registry, so the
 * printing form emitted two lines x ~280 files = ~560 lines per scraper run.
 * That volume is exactly what teaches people to scroll past the guard, and a
 * guard nobody reads is a guard that has been muted.
 *
 * So the RUN-level line comes from `alias-preflight-global-setup.mjs` (vitest
 * runs a globalSetup once per run) and this layer stays silent until it has
 * something to say. It is kept, rather than replaced by globalSetup alone,
 * because a single misconfigured file -- one that somehow resolves elsewhere
 * than the run as a whole -- must still fail closed on its own.
 */
import { assertAliasResolvesInTree } from './alias-preflight.mjs';

assertAliasResolvesInTree({ printOnSuccess: false });
