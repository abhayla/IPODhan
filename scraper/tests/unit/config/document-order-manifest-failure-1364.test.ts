/**
 * #1364 round 2 (MINOR 3): documentOrderForField used to answer 'UNDECIDED' silently when the field
 * manifest could not be loaded. Every other manifest consumer (hasManifestRow, resolveFieldSourcePolicy)
 * lets the load error propagate, so this one logs the cause and rethrows too: a field we cannot classify
 * gets no guessed order.
 *
 * OD-154 (owner, 2026-10-01, PR #1418): price-dependent = the manifest ranks PRICE_BAND_AD for the field;
 * every other document field follows PROSPECTUS > CORRIGENDUM > PRICE_BAND_AD > RHP > DRHP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { loadMock, errorMock } = vi.hoisted(() => ({ loadMock: vi.fn(), errorMock: vi.fn() }));

vi.mock('../../../src/config/field-manifest-loader.js', () => ({
  loadFieldManifest: loadMock,
  DEFAULT_MANIFEST_PATH: 'x',
}));
vi.mock('../../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: errorMock },
}));

import { documentOrderForField } from '../../../src/config/field-priority-matrix.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('documentOrderForField (#1364 round 2)', () => {
  it('logs the cause and rethrows when the manifest cannot be loaded', () => {
    loadMock.mockImplementation(() => {
      throw new Error('manifest unreadable: ENOENT');
    });
    expect(() => documentOrderForField('registrar')).toThrow(/manifest unreadable/);
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(String(errorMock.mock.calls[0][0])).toContain('manifest unreadable: ENOENT');
  });

  it('OD-154: a field the manifest ranks PRICE_BAND_AD for is price-dependent, every other field is POST_ISSUE', () => {
    loadMock.mockReturnValue({
      fields: {
        'ipos.price_range_max': { documentType: 'PRICE_BAND_AD' },
        'ipos.registrar': { documentType: 'RHP' },
      },
    });
    expect(documentOrderForField('priceRangeMax')).toBe('PRICE');
    expect(documentOrderForField('registrar')).toBe('POST_ISSUE');
    expect(documentOrderForField('someFieldWithNoManifestRow')).toBe('POST_ISSUE');
  });
});
