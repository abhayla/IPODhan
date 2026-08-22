import { describe, it, expect } from 'vitest';
import { resolveRegistrarId, type RegistrarLookupRow } from './registrar-matcher';

/**
 * P3-2 (round-2 review, T-278): ipos.registrar_id was NULL for all 328 rows —
 * no write path ever populated the FK to the 15-row registrars reference
 * table. These are the REAL variants pulled from prod's distinct free-text
 * `ipos.registrar` values (evidence: 2026-08-22-T-278/06-registrar-variants.json).
 */
describe('resolveRegistrarId', () => {
  const registrars: RegistrarLookupRow[] = [
    { id: 'r-bigshare', name: 'Bigshare Services Pvt Ltd', shortName: 'Bigshare' },
    { id: 'r-cameo', name: 'Cameo Corporate Services Limited', shortName: 'Cameo' },
    { id: 'r-kfin', name: 'KFin Technologies Limited', shortName: 'KFin' },
    { id: 'r-linkintime', name: 'Link Intime India Pvt Ltd', shortName: 'Link Intime' },
    { id: 'r-maheshwari', name: 'Maheshwari Datamatics Pvt Ltd', shortName: 'Maheshwari' },
    { id: 'r-mas', name: 'Mas Services Limited', shortName: 'MAS' },
    { id: 'r-purva', name: 'Purva Sharegistry India Pvt Ltd', shortName: 'Purva Sharegistry' },
    { id: 'r-skyline', name: 'Skyline Financial Services Pvt Ltd', shortName: 'Skyline' },
    { id: 'r-irms', name: 'Integrated Registry Management Services Pvt Ltd', shortName: 'IRMS' },
  ];

  it.each([
    ['Big Share Services Private Limited', 'r-bigshare'],
    ['Bigshare Services Private Limited', 'r-bigshare'],
    ['BIGSHARE SERVICES PRIVATE LIMITED', 'r-bigshare'],
    ['BIGSHARE SERVICES PRIVATE LTD', 'r-bigshare'],
    ['Bigshare Services Pvt. Ltd.', 'r-bigshare'],
    ['Cameo Corporate Services Ltd.', 'r-cameo'],
    ['CAMEO CORPORATE SERVICES LTD.^Subramanian Building,1,Club House Road,Chennai,Tamil Nadu- 600002', null], // address-suffixed — sanitizeRegistrar must run first
    ['Kfin Technologies Limited', 'r-kfin'],
    ['KFIN Technologies Limited', 'r-kfin'],
    ['Kfin Technologies Ltd.', 'r-kfin'],
    ['LINK INTIME INDIA PRIVATE LIMITED', 'r-linkintime'],
    ['Maheshwari Datamatics Private Limited', 'r-maheshwari'],
    ['MAS Services Ltd.', 'r-mas'],
    ['Purva Sharegistry (India) Private Limited', 'r-purva'],
    ['Purva Sharegistry (India) Pvt. Ltd.', 'r-purva'],
    ['Skyline financial services private Limited', 'r-skyline'],
    ['INTEGRATED REGISTRY MANAGEMENT SERVICES PRIVATE LIMITED', 'r-irms'],
    // Known corporate rename (Link Intime -> MUFG Intime, 2023) — bridged via alias table.
    ['MUFG Intime India Private Limited', 'r-linkintime'],
    ['MUFG Intime India Private Limited (formerly known as Link Intime India Private Limited)', 'r-linkintime'],
    ['MUFG Intime India Pvt. Ltd.', 'r-linkintime'],
    // Registrars with NO reference row — genuinely unmatched, never guessed.
    ['ADROIT CORPORATE SERVICES PRIVATE LIMITED', null],
    ['Maashitla Securities Private Limited', null],
    ['MCS Share Transfer Agent Limited', null],
    ['Mudra RTA Ventures Private Limited', null],
    [null, null],
    ['', null],
  ])('resolves "%s" -> %s', (raw, expectedId) => {
    expect(resolveRegistrarId(raw, registrars)).toBe(expectedId);
  });

  it('never guesses on an ambiguous match (two reference rows normalize the same)', () => {
    const ambiguous: RegistrarLookupRow[] = [
      { id: 'r-a', name: 'Acme Registrars Limited', shortName: null },
      { id: 'r-b', name: 'Acme Registrars Pvt Ltd', shortName: null },
    ];
    expect(resolveRegistrarId('Acme Registrars Ltd', ambiguous)).toBeNull();
  });
});
