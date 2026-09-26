/**
 * #583: spawn-level error codes that describe the box or our own spawn clock,
 * not the document being read. `ETIMEDOUT` is `spawnSync` killing the child at
 * its `timeout`; the others are the kernel refusing to start a process (no
 * pids, no memory, no file handles). `ENOENT` is deliberately absent: a missing
 * interpreter is a deploy fault with its own loud path (W-111).
 *
 * This only NAMES the failure kind recorded on the row. It does not change
 * whether the failure counts toward the attempt limit: every failure counts,
 * and a document blocked at the limit recovers only by the spec's own triggers
 * (§5.3 step 5: an extractor version change, a newer document type, the
 * re-read loop), never on a timer (OD-21, OD-33).
 *
 * Shared by the filing extractor (`filing-auto-persist.ts`) and the anchor
 * sidecar (`anchor-investors-scraper.ts`) so both paths classify the same codes
 * the same way.
 */
export type SpawnFailureKind = 'spawn_timeout' | 'spawn_resource';

const RESOURCE_CODES: ReadonlySet<string> = new Set(['EAGAIN', 'ENOMEM', 'EMFILE', 'ENFILE']);

export function classifySpawnErrorCode(code: string | null | undefined): SpawnFailureKind | null {
  if (code === 'ETIMEDOUT') return 'spawn_timeout';
  if (typeof code === 'string' && RESOURCE_CODES.has(code)) return 'spawn_resource';
  return null;
}

export function isTransientSpawnError(code: string | null | undefined): boolean {
  return classifySpawnErrorCode(code) !== null;
}
