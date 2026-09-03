import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractWebsiteFromCoverText } from '../../../src/services/company-host-source.js';

/**
 * W-31 — the COMPANY rung skipped with `no_company_url` on every document type
 * of the DEEPA walk, because no issuer website was ever stored. The website IS
 * printed on page 1 of the RHP we already held; the extractor missed it because
 * a mainboard cover is a TABLE — the `WEBSITE` column header sits ~330 chars
 * before its own cell, with the registered-office address in between.
 *
 * Fixture: page 1 of the real Deepa Jewellers RHP, captured 2026-09-02.
 */
const DEEPA_COVER = readFileSync(
  join(__dirname, '../../fixtures/rhp/deepa-cover.txt'),
  'utf8'
);

describe('W-31 — issuer website read off the filing cover', () => {
  it('extracts the issuer site from the DEEPA RHP table-layout cover', () => {
    expect(extractWebsiteFromCoverText(DEEPA_COVER)).toBe('https://www.deepajewel.com');
  });

  it('does not mistake the compliance officer e-mail domain for the website', () => {
    expect(DEEPA_COVER).toContain('cs@deepajewel.com');
    expect(extractWebsiteFromCoverText(DEEPA_COVER)).not.toContain('@');
  });

  it('still prefers a labelled "Website: ..." when the cover has one', () => {
    expect(extractWebsiteFromCoverText('Our Company Website: www.issuer.com')).toBe(
      'https://www.issuer.com'
    );
  });

  it('never returns an intermediary site from the table fallback', () => {
    const cover = 'REGISTRAR TO THE OFFICE\nWEBSITE\nRegistrar to the offer\nwww.bigshareonline.com';
    expect(extractWebsiteFromCoverText(cover)).toBeNull();
  });

  it('picks the issuer, not the banker, when a table-layout cover lists both', () => {
    // The shape that broke the first cut: the issuer's own block first, then the
    // BRLM's block with its OWN website column. Read forward-only from the word
    // "Website", the banker's site is just as reachable as the issuer's — the
    // label that disowns it sits BEFORE the header, and the issuer's block ends
    // at the "BOOK RUNNING LEAD MANAGER" heading.
    const cover = [
      'ISSUER LIMITED',
      'CORPORATE IDENTITY NUMBER: U12345MH2016PLC000001',
      'REGISTERED OFFICE  CONTACT PERSON  TELEPHONE AND E-MAIL  WEBSITE',
      '12 Some Road, Mumbai-400001, Maharashtra, India.',
      'A Person, Company Secretary and Compliance Officer',
      'Telephone: +91 22 1234 5678',
      'E-mail: cs@issuerltd.com',
      'www.issuerltd.com',
      'BOOK RUNNING LEAD MANAGER',
      'Holani Consultants Private Limited',
      'Telephone: +91 141 000 0000',
      'WEBSITE',
      'www.holaniconsultants.co.in',
    ].join('\n');
    expect(extractWebsiteFromCoverText(cover)).toBe('https://www.issuerltd.com');
  });

  it('returns null when the cover carries no website at all', () => {
    expect(extractWebsiteFromCoverText('RED HERRING PROSPECTUS\nDated: August 25, 2026')).toBeNull();
  });
});
