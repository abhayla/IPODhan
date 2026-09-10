/**
 * Side-effect wrapper: importing this runs the preflight (item 1 slice s14).
 *
 * Kept separate from `alias-preflight.mjs` so the pure functions stay
 * importable by their own unit tests without firing the assert. This is the
 * form every entry point uses — the FIRST import of a root-invoked tsx
 * entry, and the vitest `setupFiles` entry — because ESM evaluates imported
 * modules in source order, so listing it first makes it run before any
 * module that could read the wrong tree.
 */
import { assertAliasResolvesInTree } from './alias-preflight.mjs';

assertAliasResolvesInTree();
