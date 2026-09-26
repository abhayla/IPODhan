/**
 * The two locks around the document cycle's extraction phase (#151 round 1).
 *
 * 1. The SLOT extraction lock, `<slot>:lock:resource:filing-auto-persist:cycle`
 *    (MAJOR-1): one extraction pass per slot, so an overlapping cycle of the
 *    same slot cannot extract the same IN_PROGRESS rows twice.
 * 2. The BOX-WIDE extractor lock, `box:lock:resource:extractor`: at most one
 *    python extractor on the box, whichever slot it belongs to. Prod and
 *    staging share one 2-vCPU VPS; two extractors at ~100% CPU each starved
 *    nginx/Next long enough for Cloudflare to return 522s (W-178). The
 *    15-minute cron stagger alone cannot prevent that, because an extraction
 *    pass can outlive it (20-min wake budget, 2-h extraction lock). Before #151
 *    the unprefixed `lock:resource:scraper:cycle`, shared by both slots, gave
 *    this exclusion by accident; the slot namespace removed the accident, so
 *    it is now a deliberate, named, box-wide lock written through the one
 *    documented escape hatch, getBoxWideRedisClient().
 *
 * Order is slot, then box. A refusal of the box lock gives the slot lock back
 * at once, so a refused cycle never blocks its own slot's next cycle. Both
 * locks use the same TTL (FILING_EXTRACTION_LOCK_TTL_MS) and are both
 * registered with the signal-path registry in document-cycle.ts.
 */
import type { DistributedLock } from '../utils/distributed-lock.js';

export const SLOT_EXTRACTION_LOCK_RESOURCE = 'filing-auto-persist:cycle';
export const BOX_EXTRACTOR_LOCK_RESOURCE = 'extractor';

export type ExtractionLocks =
  | { acquired: true; slotToken: string; boxToken: string; heldBy: null }
  | { acquired: false; heldBy: 'slot' | 'box' };

export async function acquireExtractionLocks(
  slotLock: DistributedLock,
  boxLock: DistributedLock,
  ttlMs: number
): Promise<ExtractionLocks> {
  const slot = await slotLock.acquire(SLOT_EXTRACTION_LOCK_RESOURCE, { ttl: ttlMs });
  if (!slot.acquired || !slot.token) return { acquired: false, heldBy: 'slot' };

  const box = await boxLock.acquire(BOX_EXTRACTOR_LOCK_RESOURCE, { ttl: ttlMs });
  if (!box.acquired || !box.token) {
    await slotLock.release(SLOT_EXTRACTION_LOCK_RESOURCE, slot.token).catch(() => false);
    return { acquired: false, heldBy: 'box' };
  }
  return { acquired: true, slotToken: slot.token, boxToken: box.token, heldBy: null };
}

/** Token-checked release of both; box first, so the other slot can start as early as possible. */
export async function releaseExtractionLocks(
  slotLock: DistributedLock,
  boxLock: DistributedLock,
  held: { slotToken: string; boxToken: string }
): Promise<void> {
  const failures: string[] = [];
  try {
    await boxLock.release(BOX_EXTRACTOR_LOCK_RESOURCE, held.boxToken);
  } catch (error) {
    failures.push(`box: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await slotLock.release(SLOT_EXTRACTION_LOCK_RESOURCE, held.slotToken);
  } catch (error) {
    failures.push(`slot: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (failures.length > 0) throw new Error(`extraction lock release failed (${failures.join('; ')})`);
}
