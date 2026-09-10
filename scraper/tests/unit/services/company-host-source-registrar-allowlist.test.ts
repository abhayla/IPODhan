// implements: OD-37 (the host allow-list extended to the registrars)
import { describe, it, expect } from 'vitest';
import {
  isTrustedDocumentHost,
  isStorableFromCompanyPage,
  extractVerifierLinks,
} from '../../../src/services/company-host-source.js';

/**
 * Item 22 slice 7. OD-37 asks for the document host allow-list to cover the
 * registrars as well as the exchanges and SEBI.
 *
 * The pieces were all built and none of them were connected.
 * `isTrustedDocumentHost` has taken a `registrarHosts` set since slice 22-1;
 * `loadRegistrarDocumentHosts` reads and caches it;
 * `resetRegistrarDocumentHostsCache` exists for the cycle boundary. But BOTH
 * real call sites — `isStorableFromCompanyPage` and `extractVerifierLinks` —
 * called it with ONE argument, so the set was always the empty default and a
 * filing served by a legitimate registrar was refused exactly as before.
 *
 * That is why these tests assert on the two WRAPPERS rather than on
 * `isTrustedDocumentHost` directly: testing the inner function proves only that
 * it can accept a set, which was never in doubt. What was broken was that
 * nothing passed one.
 */

const REGISTRARS = new Set(['linkintime.co.in', 'kfintech.com']);
const RHP = 'https://linkintime.co.in/downloads/acme-rhp.pdf';
const COMPANY = 'https://www.acme.co.in';

describe('the allow-list itself already accepted a registrar host', () => {
  it('isTrustedDocumentHost says yes when the set is supplied', () => {
    expect(isTrustedDocumentHost(RHP, REGISTRARS)).toBe(true);
  });

  it('and no when it is not — which is what every caller was doing', () => {
    expect(isTrustedDocumentHost(RHP)).toBe(false);
  });
});

describe('the company rung passes the registrar set through', () => {
  it('stores a filing served by a registrar', () => {
    expect(isStorableFromCompanyPage(RHP, COMPANY, REGISTRARS)).toBe(true);
  });

  it('still refuses a third party that is NOT a registrar', () => {
    // The owner's rule is that a filing is never stored from a third party.
    // Widening the allow-list must not widen it to everything.
    expect(
      isStorableFromCompanyPage('https://cdn.some-doc-host.com/acme-rhp.pdf', COMPANY, REGISTRARS)
    ).toBe(false);
  });

  it('still stores from the issuer own host, unchanged', () => {
    expect(isStorableFromCompanyPage('https://www.acme.co.in/ir/rhp.pdf', COMPANY, REGISTRARS)).toBe(true);
  });

  it('with no registrar set supplied, behaves exactly as before', () => {
    expect(isStorableFromCompanyPage(RHP, COMPANY)).toBe(false);
  });
});

describe('the verifier rung passes the registrar set through', () => {
  const html = `
    <a href="https://linkintime.co.in/downloads/acme-rhp.pdf">RHP</a>
    <a href="https://cdn.some-doc-host.com/acme-rhp.pdf">mirror</a>
    <a href="https://www.bseindia.com/downloads/acme-rhp.pdf">BSE copy</a>
  `;

  it('keeps a registrar link when the set is supplied', () => {
    const urls = extractVerifierLinks(html, 'https://verifier.example', [], REGISTRARS).map(l => l.url);
    expect(urls).toContain('https://linkintime.co.in/downloads/acme-rhp.pdf');
    expect(urls).toContain('https://www.bseindia.com/downloads/acme-rhp.pdf');
    expect(urls).not.toContain('https://cdn.some-doc-host.com/acme-rhp.pdf');
  });

  it('drops the registrar link when it is not supplied — the behaviour on main today', () => {
    const urls = extractVerifierLinks(html, 'https://verifier.example', []).map(l => l.url);
    expect(urls).not.toContain('https://linkintime.co.in/downloads/acme-rhp.pdf');
  });
});
