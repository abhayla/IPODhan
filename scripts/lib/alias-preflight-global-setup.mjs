/**
 * Run-level form of the preflight, for vitest's `globalSetup`.
 *
 * vitest runs a globalSetup ONCE per run (not per test file) and aborts the
 * whole run if it throws, so this is where the "which checkout did this run
 * read" line belongs: one line per run on a healthy run, a loud refusal on a
 * broken one. Printing on SUCCESS is the point -- both wrong answers on
 * 2026-09-10 looked like ordinary output, and the missing line was the one
 * naming the tree.
 */
import { assertAliasResolvesInTree } from './alias-preflight.mjs';

export default function setup() {
  assertAliasResolvesInTree();
}
