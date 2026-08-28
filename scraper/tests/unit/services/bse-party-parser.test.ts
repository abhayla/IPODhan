import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseBseParties,
  parseBsePartyField,
  parseBsePartyNames,
} from '../../../src/services/bse-party-parser.js';
import { extractBseCoreRow } from '../../../src/services/bse-ipo-board.js';

const FIXTURES = join(__dirname, '../../fixtures/documents');
const skywaysRow = extractBseCoreRow(
  JSON.parse(readFileSync(join(FIXTURES, 'bse-skyways-core.json'), 'utf8'))
) as Record<string, string>;

describe('parseBseParties — the F17 co-BRLM defect, on the REAL Skyways payload', () => {
  it('T10 returns EXACTLY 3 lead managers, BRLM first then both co-BRLMs in order', () => {
    // The live defect: the previous parser split on ^/| but never on '#', so the
    // second co-BRLM (Dolat Finserv) was swallowed and Skyways showed 2 of 3.
    const { leadManagers } = parseBseParties(skywaysRow);
    expect(leadManagers).toEqual([
      'Holani Consultants Private Limited',
      'Shannon Advisors Private Limited',
      'Dolat Finserv Private Limited',
    ]);
  });

  it('T11 preserves each party email and contact person from the packed tail', () => {
    const brlm = parseBsePartyField(skywaysRow.Book_Running_Lead_Manager);
    expect(brlm).toHaveLength(1);
    expect(brlm[0]).toMatchObject({
      name: 'Holani Consultants Private Limited',
      email: 'ipo@holaniconsultants.co.in',
      contact: 'Payal Jain',
    });

    const co = parseBsePartyField(skywaysRow.Co_Book_Running_Lead_Manager);
    expect(co.map((p) => p.email)).toEqual([
      'pavan@shannon.co.in',
      'skyways.ipo@dolatfinserv.com',
    ]);
  });

  it('T12 handles a single BRLM with no co-BRLM field', () => {
    const { leadManagers } = parseBseParties({
      Book_Running_Lead_Manager: 'SKI Capital Services Limited^||||||||ipo@skicapital.net',
      Co_Book_Running_Lead_Manager: '',
    });
    expect(leadManagers).toEqual(['SKI Capital Services Limited']);
  });

  it('T13 returns [] for empty, whitespace, null and undefined fields', () => {
    expect(parseBsePartyNames('')).toEqual([]);
    expect(parseBsePartyNames('   ')).toEqual([]);
    expect(parseBsePartyNames(null)).toEqual([]);
    expect(parseBsePartyNames(undefined)).toEqual([]);
    expect(parseBseParties(null)).toEqual({ leadManagers: [], registrar: null, sponsorBanks: [] });
  });

  it('T13b de-duplicates a BRLM that BSE repeats in the co-BRLM field', () => {
    const { leadManagers } = parseBseParties({
      Book_Running_Lead_Manager: 'Acme Capital Limited^||x@y.com',
      Co_Book_Running_Lead_Manager: 'ACME CAPITAL LIMITED^||x@y.com#Beta Advisors Limited^||b@y.com',
    });
    expect(leadManagers).toEqual(['Acme Capital Limited', 'Beta Advisors Limited']);
  });

  it('T14 extracts the registrar name only, dropping the packed address/email', () => {
    expect(parseBseParties(skywaysRow).registrar).toBe('Bigshare Services Private Limited');
  });

  it('T15 splits the #-separated sponsor banks into both banks', () => {
    expect(parseBseParties(skywaysRow).sponsorBanks).toEqual(['AXIS BANK', 'HDFC BANK']);
  });
});
