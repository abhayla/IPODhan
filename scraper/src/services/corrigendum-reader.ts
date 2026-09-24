/**
 * Item 9 — the corrigendum step of the document cycle (OD-90, spec section 2.5.5 as amended).
 *
 * A stored CORRIGENDUM is read ONCE per document (its sha256 names the stored file; a new file is
 * a new document row), never on a timer (OD-33, F-151/F-152): text layer first, OCR only for a
 * page with no usable text (`read_corrigendum_pages.py`, same order as `extract_filing.py`). Its
 * correction sentences become SUGGESTIONS in the admin conflicts queue. This step writes NO field:
 * the admin accepts a suggestion (an ADMIN write) or dismisses it.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, recordCorrigendumSuggestions, type CorrigendumPage, type RecordResult } from '@ipodhan/shared';
import logger from '../utils/logger.js';

export const CORRIGENDUM_DOC_TYPE = 'CORRIGENDUM';
export const CORRIGENDUM_READER_VERSION = 'read_corrigendum_pages.py@2026-09-24';

export function corrigendumReaderScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', '..', 'scripts', 'read_corrigendum_pages.py');
}

export type CorrigendumPageReader = (pdfPath: string) => Promise<CorrigendumPage[]>;

/** Spawns the python page reader. Throws with the reader's own cause on any failure (signal-ownership R6). */
export const defaultCorrigendumPageReader: CorrigendumPageReader = async (pdfPath) => {
  const bin = process.env.PYTHON_BIN?.trim() || 'python';
  const run = spawnSync(bin, [corrigendumReaderScriptPath(), pdfPath], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  if (run.error) throw new Error(`corrigendum reader could not start: ${run.error.message}`);
  const out = (run.stdout ?? '').trim();
  let parsed: { pages?: CorrigendumPage[]; error?: string } = {};
  try {
    parsed = out ? JSON.parse(out) : {};
  } catch {
    throw new Error(`corrigendum reader printed no JSON (exit ${run.status}): ${(run.stderr ?? '').slice(-500)}`);
  }
  if (run.status !== 0 || parsed.error || !Array.isArray(parsed.pages)) {
    throw new Error(parsed.error ?? `corrigendum reader exit ${run.status}: ${(run.stderr ?? '').slice(-500)}`);
  }
  return parsed.pages;
};

export type CorrigendumSuggestionRunner = (args: {
  ipoId: string;
  documentId: string;
  pdfPath: string;
}) => Promise<RecordResult>;

/** Read one stored corrigendum and record its suggestions. Idempotent per document. */
export function buildCorrigendumSuggestionRunner(
  readPages: CorrigendumPageReader = defaultCorrigendumPageReader,
  database: Parameters<typeof recordCorrigendumSuggestions>[0] = db as never
): CorrigendumSuggestionRunner {
  return async ({ ipoId, documentId, pdfPath }) => {
    const pages = await readPages(pdfPath);
    const result = await recordCorrigendumSuggestions(database, { ipoId, documentId, pages });
    // PR #989 review (MINOR 4): a corrigendum exists because something changed; reading one and
    // finding no correction is not a success to pass silently — the admin never hears of it.
    if (result.parsed === 0) {
      logger.warn(
        { ipoId, documentId, pageCount: pages.length },
        'Corrigendum read yielded 0 suggestions — no correction pattern matched; needs a human look'
      );
    }
    return result;
  };
}
