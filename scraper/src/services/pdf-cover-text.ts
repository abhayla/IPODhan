/**
 * First-page text extraction for the cover-page company check (T-403 M1).
 *
 * WHY THIS EXISTS. `document-download-verifier.ts` has implemented matrix §3
 * step 4 ("the cover page contains the company name") since the first cut, but
 * the runner passed `expectedCompanyName` WITHOUT an extractor, so the check
 * silently never ran and F8 — storing another company's filing — was unguarded
 * in production. This module is the missing half.
 *
 * Two real-world facts drive the design, both measured on the T-403 acceptance
 * PDFs (2026-08-28):
 *
 *  1. `getText({ last: 1 })` returns the LAST page, not the first. On a 644-page
 *     RHP that is the declaration page, which does not carry the cover's company
 *     name. The cover needs `{ first: 1, last: 1 }`.
 *  2. Newspaper-advertisement PDFs (price-band ads, corrigenda, addenda) are
 *     typeset with subsetted fonts carrying no ToUnicode map, so their text
 *     layer extracts as mojibake: Skyways' 10,621-character price-band ad
 *     yielded SIX alphanumeric characters. Judging a company name against that
 *     would reject a perfectly good filing. Such text is reported as unusable so
 *     the caller SKIPS the check rather than failing it.
 */

import logger from '../utils/logger.js';

/**
 * Minimum alphanumeric characters on page 1 for the text layer to be considered
 * usable. Measured spread on the acceptance set is stark and needs no fine
 * tuning: real cover pages yielded 438-1,081 alphanumerics, every mojibake
 * layer yielded 4-6.
 */
export const MIN_COVER_ALNUM_CHARS = 200;

/** How long a single first-page extraction may take before we give up on it. */
export const COVER_EXTRACT_TIMEOUT_MS = 30_000;

export type CoverTextResult =
  | { usable: true; text: string; alnum: number }
  | { usable: false; reason: 'no_text_layer' | 'extract_failed'; detail: string };

/** Count of [A-Za-z0-9] — the mojibake discriminator. */
export function countAlphanumeric(text: string): number {
  return (String(text ?? '').match(/[A-Za-z0-9]/g) ?? []).length;
}

/**
 * Decide whether extracted page-1 text can be reasoned about. Separated from the
 * IO so the threshold is unit-testable without a PDF.
 */
export function judgeCoverText(text: string): CoverTextResult {
  const alnum = countAlphanumeric(text);
  if (alnum < MIN_COVER_ALNUM_CHARS) {
    return {
      usable: false,
      reason: 'no_text_layer',
      detail: `page 1 yielded ${alnum} alphanumeric characters (min ${MIN_COVER_ALNUM_CHARS}) — scanned or font-subsetted`,
    };
  }
  return { usable: true, text, alnum };
}

/**
 * Extract page 1 of a PDF as text. Never throws: a broken PDF returns
 * `extract_failed` so the caller can skip the check explicitly rather than
 * having an exception decide the document's fate.
 */
export async function extractCoverText(pdf: Buffer): Promise<CoverTextResult> {
  let parser: { getText: (o: unknown) => Promise<{ text?: string }>; destroy?: () => Promise<void> } | null =
    null;
  try {
    const mod = (await import('pdf-parse')) as unknown as { PDFParse: new (o: unknown) => never };
    parser = new mod.PDFParse({ data: pdf }) as never;

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`cover extraction timed out after ${COVER_EXTRACT_TIMEOUT_MS}ms`)),
        COVER_EXTRACT_TIMEOUT_MS
      )
    );
    // first:1,last:1 — the COVER. See the module note: last:1 is the last page.
    const result = await Promise.race([parser!.getText({ first: 1, last: 1 }), timeout]);
    return judgeCoverText(result?.text ?? '');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.debug({ error: detail }, 'Cover-page text extraction failed (check will be skipped)');
    return { usable: false, reason: 'extract_failed', detail };
  } finally {
    try {
      await parser?.destroy?.();
    } catch {
      /* releasing the parser must never mask the result */
    }
  }
}
