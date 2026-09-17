/**
 * One mapping from manifest source codes to writer sources (stage 3, item 3, slice S0c).
 *
 * The manifest (`field-manifest-schema.ts`'s `sourceCodeSchema`) names sources in its own
 * vocabulary (`DOC`, `REG`, document-type codes like `RHP`/`PRICE_BAND_AD`, plus the scraper
 * names it shares with the writer). The writer stores a different, narrower vocabulary in
 * `field_sources.source` (`ScraperSource` in `packages/shared/src/db/types.ts`,
 * `field-priority-matrix.ts`, and `ScraperSourceValue` in
 * `field-extraction-failures-repository.ts`) — every filing document type collapses to the
 * single writer source `DRHP` (see `filing-persister.ts`'s SOURCE ENUM NOTE;
 * `scraperSourceForDocType` always returns `'DRHP'`). This module is the single place that
 * translation lives, so the walk, the generator's self-check, and (from S1) the writer all
 * import the same table instead of re-deriving it.
 */

import type { SourceCode } from './field-manifest-schema.js';
import type { ScraperSource } from './field-priority-matrix.js';

export type ManifestSourceCode = SourceCode;

/** Document-type codes the manifest can rank; each collapses to the `DRHP` writer source. */
const DOCUMENT_TYPE_CODES = [
  'DRHP',
  'RHP',
  'PROSPECTUS',
  'CORRIGENDUM',
  'PRICE_BAND_AD',
] as const;

export interface SourceCodeMapping {
  writerSource: ScraperSource;
  /** The manifest row's `documentType` values this code can arrive labelled as, when relevant. */
  docTypes?: readonly string[];
}

/**
 * Every `sourceCodeSchema` value maps to exactly one writer source. `DOC` and every filing
 * document-type code (`DRHP`/`RHP`/`PROSPECTUS`/`CORRIGENDUM`/`PRICE_BAND_AD`) collapse to the
 * writer's `DRHP`; the rest are identity (the manifest word already IS the writer word).
 */
export const MANIFEST_TO_WRITER: Readonly<Record<ManifestSourceCode, SourceCodeMapping>> = {
  ADMIN: { writerSource: 'ADMIN' },
  DOC: { writerSource: 'DRHP', docTypes: DOCUMENT_TYPE_CODES },
  DRHP: { writerSource: 'DRHP', docTypes: ['DRHP'] },
  RHP: { writerSource: 'DRHP', docTypes: ['RHP'] },
  PROSPECTUS: { writerSource: 'DRHP', docTypes: ['PROSPECTUS'] },
  CORRIGENDUM: { writerSource: 'DRHP', docTypes: ['CORRIGENDUM'] },
  PRICE_BAND_AD: { writerSource: 'DRHP', docTypes: ['PRICE_BAND_AD'] },
  NSE: { writerSource: 'NSE' },
  BSE: { writerSource: 'BSE' },
  CHITTORGARH: { writerSource: 'CHITTORGARH' },
  MONEYCONTROL: { writerSource: 'MONEYCONTROL' },
  INVESTORGAIN_GMP: { writerSource: 'INVESTORGAIN_GMP' },
  REG: { writerSource: 'REG' },
};

/**
 * Moved from `field-plan-walk.ts:765-766` (re-exported there so its existing importers keep
 * working). The manifest names sources `DOC`/`BSE`/`CHITTORGARH`; the writer's `ScraperSource`
 * has no `DOC` — every filing document type writes as `DRHP`. Behaviour is unchanged: this
 * returns the same values the inline `manifestSource === 'DOC' ? 'DRHP' : manifestSource` did.
 */
export function mapManifestSourceToScraperSource(manifestSource: string): ScraperSource {
  const entry = MANIFEST_TO_WRITER[manifestSource as ManifestSourceCode];
  return entry ? entry.writerSource : (manifestSource as ScraperSource);
}

/**
 * Inverse of `mapManifestSourceToScraperSource`: given the writer source that actually got
 * stored (plus the `docType` that travelled with a filing write, when there is one), returns
 * the manifest code it corresponds to. For `DRHP` writes, `docType` selects among
 * `DRHP`/`RHP`/`PROSPECTUS`/`CORRIGENDUM`/`PRICE_BAND_AD`; with no `docType` it returns the
 * generic `DOC` code. For every other writer source the mapping is identity.
 */
export function writerSourceToManifestCode(
  source: ScraperSource,
  docType?: string
): ManifestSourceCode {
  if (source === 'DRHP') {
    if (docType && (DOCUMENT_TYPE_CODES as readonly string[]).includes(docType)) {
      return docType as ManifestSourceCode;
    }
    return 'DOC';
  }
  return source as ManifestSourceCode;
}
