/**
 * #993: `provenanceLineage` decides what one `field_sources` row's `data_lineage` records. The
 * incoming caller's lineage (a filing's document id) may only land on a row written FOR that
 * caller's source; a row kept under another owner (set merge, SME collapse) must not name the
 * document, because the document is not that row's evidence.
 */
import { describe, it, expect } from 'vitest';
import { provenanceLineage } from '../../../src/services/data-consolidation-service';

const LINEAGE = { method: 'FILING_EXTRACTION', docType: 'RHP', documentId: 'doc-1' };

describe('#993 provenanceLineage', () => {
  it('stamps the incoming lineage on a row written for the incoming source', () => {
    expect(provenanceLineage({ source: 'DRHP', lineage: LINEAGE }, 'DRHP', undefined)).toEqual(LINEAGE);
  });

  it('never stamps it on a row written for another source', () => {
    expect(provenanceLineage({ source: 'DRHP', lineage: LINEAGE }, 'NSE', undefined)).toBeUndefined();
    expect(provenanceLineage({ source: 'DRHP', lineage: LINEAGE }, 'NSE', 'manifest@1')).toEqual({ policyOrigin: 'manifest@1' });
  });

  it('keeps the policy origin alongside the lineage', () => {
    expect(provenanceLineage({ source: 'DRHP', lineage: LINEAGE }, 'DRHP', 'manifest@1')).toEqual({ ...LINEAGE, policyOrigin: 'manifest@1' });
  });

  it('is unchanged from before #993 when no lineage is supplied', () => {
    expect(provenanceLineage(undefined, 'DRHP', undefined)).toBeUndefined();
    expect(provenanceLineage(undefined, 'DRHP', 'manifest@1')).toEqual({ policyOrigin: 'manifest@1' });
  });
});
