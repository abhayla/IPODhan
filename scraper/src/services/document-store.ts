/**
 * Local PDF store for downloaded filings — T-403 WP B storage + purge (D4).
 *
 * Layout:   $PROSPECTUS_STORE_DIR/<ipo_id>/<doc_type>-<sha8>.pdf
 *
 * Three properties this module is responsible for:
 *
 *  1. A reader never sees a half-written file. Bytes go to `<name>.tmp-<pid>`
 *     and are then `rename`d, which is atomic within a filesystem. The previous
 *     code had no store at all; a naive `writeFile` would let the extractor
 *     (WP C) open a truncated PDF on a crash.
 *  2. The disk cannot fill. `PROSPECTUS_STORE_MAX_GB` (default 5) is checked
 *     BEFORE a write and the write is REFUSED with an alert. IPODhan has been
 *     here: the 2026-06-13 VPS incident took prod's DB, SSH and runner down
 *     because a deploy-backup filled the disk. RHPs are 15-25 MB each.
 *  3. Files are transient, rows are permanent. `purgeIpoDocuments` deletes the
 *     IPO's DIRECTORY once `close_date + PROSPECTUS_RETENTION_DAYS` has passed
 *     (or on withdrawal) and never touches the database — the `documents` and
 *     `document_fetch_state` rows, and everything extracted from the PDF,
 *     survive. We keep what we learned, not the 23 MB we learned it from.
 *
 * Non-fatal by discipline (`non-fatal-side-effects.md`): purge failures are
 * logged and returned, never thrown into the cycle.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import logger from '../utils/logger.js';

export const DEFAULT_RETENTION_DAYS = 7;
export const DEFAULT_MAX_STORE_GB = 5;
const BYTES_PER_GB = 1024 * 1024 * 1024;

/** Root of the local store. Overridable per environment/slot. */
export function getStoreDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PROSPECTUS_STORE_DIR;
  if (configured && configured.trim() !== '') return configured.trim();
  // Default mirrors the deploy layout: a `prospectus/<slot>` dir beside the app.
  const slot = env.DEPLOY_SLOT && env.DEPLOY_SLOT.trim() !== '' ? env.DEPLOY_SLOT.trim() : 'default';
  return path.join(process.cwd(), 'prospectus', slot);
}

export function getRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PROSPECTUS_RETENTION_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RETENTION_DAYS;
}

export function getMaxStoreBytes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PROSPECTUS_STORE_MAX_GB);
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_STORE_GB) * BYTES_PER_GB;
}

/** `<doc_type>-<first 8 hex of sha256>.pdf` — stable, collision-resistant, greppable. */
export function documentFileName(docType: string, sha256: string): string {
  return `${docType}-${sha256.slice(0, 8)}.pdf`;
}

/** Absolute path a document will occupy. Pure — computes, never creates. */
export function documentPath(
  ipoId: string,
  docType: string,
  sha256: string,
  storeDir: string = getStoreDir()
): string {
  return path.join(storeDir, ipoId, documentFileName(docType, sha256));
}

/** Total bytes currently held under `storeDir`. 0 when the store does not exist. */
export async function getStoreSizeBytes(storeDir: string = getStoreDir()): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // missing or unreadable directory contributes nothing
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          total += (await fsp.stat(full)).size;
        } catch {
          /* raced with a purge — ignore */
        }
      }
    }
  };
  await walk(storeDir);
  return total;
}

export type StoreResult =
  | { stored: true; filePath: string; bytes: number; sha256: string; alreadyPresent: boolean }
  | { stored: false; reason: 'store_full'; detail: string };

/**
 * Write a verified PDF into the store, atomically.
 *
 * Idempotent by content: the file name carries the sha256 prefix, so re-storing
 * the same document is a no-op and returns `alreadyPresent: true` — the matrix
 * R3 case ("link URL changed but the hash is identical: no re-download, no
 * re-extract") costs nothing here.
 */
export async function storeDocument(params: {
  ipoId: string;
  docType: string;
  pdf: Buffer;
  sha256?: string;
  storeDir?: string;
  maxStoreBytes?: number;
}): Promise<StoreResult> {
  const storeDir = params.storeDir ?? getStoreDir();
  const maxBytes = params.maxStoreBytes ?? getMaxStoreBytes();
  const sha256 = params.sha256 ?? createHash('sha256').update(params.pdf).digest('hex');
  const filePath = documentPath(params.ipoId, params.docType, sha256, storeDir);

  if (fs.existsSync(filePath)) {
    return { stored: true, filePath, bytes: params.pdf.length, sha256, alreadyPresent: true };
  }

  // Cap check BEFORE the write, not after: the point is to never exceed it.
  const currentBytes = await getStoreSizeBytes(storeDir);
  if (currentBytes + params.pdf.length > maxBytes) {
    const detail =
      `document store is full: ${currentBytes} bytes held + ${params.pdf.length} incoming ` +
      `exceeds the ${maxBytes}-byte cap (PROSPECTUS_STORE_MAX_GB) at ${storeDir}`;
    logger.error(
      { ipoId: params.ipoId, docType: params.docType, currentBytes, incoming: params.pdf.length, maxBytes, storeDir },
      'Document store full — REFUSING the write (P2)'
    );
    return { stored: false, reason: 'store_full', detail };
  }

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  // temp-then-rename: a reader never observes a partial file.
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  try {
    await fsp.writeFile(tmpPath, params.pdf);
    await fsp.rename(tmpPath, filePath);
  } catch (error) {
    await fsp.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }

  logger.info(
    { ipoId: params.ipoId, docType: params.docType, bytes: params.pdf.length, sha256: sha256.slice(0, 8), filePath },
    'Stored document PDF'
  );
  return { stored: true, filePath, bytes: params.pdf.length, sha256, alreadyPresent: false };
}

/**
 * Is this IPO's local PDF directory due for deletion?
 *
 * Due when `close_date + retentionDays` is strictly BEFORE today, or immediately
 * on withdrawal (matrix F15). An IPO with no close date is never purged on a
 * schedule — guessing a date here would delete a live IPO's filings.
 */
export function isPurgeDue(params: {
  closeDate: Date | string | null;
  withdrawn?: boolean;
  retentionDays?: number;
  now?: Date;
}): boolean {
  if (params.withdrawn === true) return true;
  if (!params.closeDate) return false;
  const close = params.closeDate instanceof Date ? params.closeDate : new Date(params.closeDate);
  if (Number.isNaN(close.getTime())) return false;

  const retentionDays = params.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const now = params.now ?? new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  // Compare whole days so the boundary does not move with the time of day.
  const closeDay = Math.floor(close.getTime() / dayMs);
  const today = Math.floor(now.getTime() / dayMs);
  return today - closeDay > retentionDays;
}

export interface PurgeResult {
  ipoId: string;
  purged: boolean;
  filesDeleted: number;
  bytesFreed: number;
  error?: string;
}

/**
 * Delete an IPO's local PDF directory. FILES ONLY — no database row is touched
 * here, by design (lifecycle-plan S6 / D4).
 *
 * Never throws: a purge failure must not fail the cycle
 * (`non-fatal-side-effects.md`). The failure is logged and returned instead.
 */
export async function purgeIpoDocuments(
  ipoId: string,
  storeDir: string = getStoreDir()
): Promise<PurgeResult> {
  const dir = path.join(storeDir, ipoId);
  let filesDeleted = 0;
  let bytesFreed = 0;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => null);
    if (entries === null) return { ipoId, purged: false, filesDeleted: 0, bytesFreed: 0 };

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(dir, entry.name);
      try {
        bytesFreed += (await fsp.stat(full)).size;
      } catch {
        /* already gone */
      }
      filesDeleted++;
    }
    await fsp.rm(dir, { recursive: true, force: true });

    // One log line per purged IPO — the audit trail for "where did the PDFs go".
    logger.info({ ipoId, filesDeleted, bytesFreed, dir }, 'Purged local IPO document PDFs (rows retained)');
    return { ipoId, purged: true, filesDeleted, bytesFreed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ ipoId, dir, error: message }, 'Document purge failed (non-fatal)');
    return { ipoId, purged: false, filesDeleted, bytesFreed, error: message };
  }
}
