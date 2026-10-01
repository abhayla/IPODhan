import { describe, it, expect } from 'vitest';
import { decideCreateProvenance } from '../../../scripts/repair-create-provenance-1196';

const VALID = ['ADMIN', 'DRHP', 'NSE', 'BSE', 'CHITTORGARH'];

describe('#1196 decideCreateProvenance: the creating source is read from the record, never guessed', () => {
  it('one recorded scraper source -> write under it', () => {
    expect(decideCreateProvenance(['CHITTORGARH', 'CHITTORGARH'], VALID)).toMatchObject({ action: 'write', source: 'CHITTORGARH' });
  });
  it('no recorded creating source -> skip', () => {
    expect(decideCreateProvenance([], VALID)).toMatchObject({ action: 'skip-no-creating-source', source: null });
  });
  it('several different creating sources -> skip, not a pick', () => {
    expect(decideCreateProvenance(['NSE', 'BSE'], VALID)).toMatchObject({ action: 'skip-ambiguous-creating-source', source: null });
  });
  it('ADMIN or a non-enum source -> skip', () => {
    expect(decideCreateProvenance(['ADMIN'], VALID).action).toBe('skip-unusable-creating-source');
    expect(decideCreateProvenance(['SOMETHING_ELSE'], VALID).action).toBe('skip-unusable-creating-source');
  });
});
