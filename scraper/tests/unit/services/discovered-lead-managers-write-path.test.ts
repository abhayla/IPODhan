import { describe, it, expect, vi } from 'vitest';
import { parseBseParties } from '../../../src/services/bse-party-parser.js';
import { recordDiscoveredLeadManagers } from '../../../src/services/data-persister.js';

/**
 * T-503 / #416 — real Steamhouse India payload (BSE core-API
 * `GetMkt_ISSUE_BBS_IPO/w?IPO_NO=7954`, fetched 2026-09-08, one BRLM, no
 * co-BRLM). RCA: `document-discovery-runner.ts` parses this row's lead
 * managers via `parseBseParties` for its `result.leadManagers`, but
 * `document-cycle.ts` (lines 1071-1088) only ever forwarded the COUNT into
 * `bsePayloadLeadManagerCount` via `recordBseDiscoveryMetadata` — the names
 * were discarded, so `ipos.lead_managers` stayed null even though the BSE
 * payload named a real BRLM. Fixture is the field this class turns on:
 * `Book_Running_Lead_Manager` / `Co_Book_Running_Lead_Manager`.
 */
const STEAMHOUSE_BSE_ROW = {
  IPO_NO: '7954',
  ScripName: 'Steamhouse India Limited',
  Book_Running_Lead_Manager:
    'EQUIRUS CAPITAL LIMITED (Formerly Equirus Capital Private Limited)^Unit no. 2601B, 26th Floor, A Wing, Marathon Futurex,Mafatlal Mills Compound, N M Joshi Marg ,Delisle Road, Lower Parel Mumbai - 400 013||||||||steam.ipo@equirus.com|Mrunal Jadhav/ Rahul Wadekar',
  Co_Book_Running_Lead_Manager: '',
};

function fakeRepo() {
  return { update: vi.fn().mockResolvedValue({}) };
}

describe('T-503 — discovered BSE lead managers reach ipos.lead_managers', () => {
  it('parses the real Steamhouse payload to exactly 1 BRLM (the class this check flags)', () => {
    const parsed = parseBseParties(STEAMHOUSE_BSE_ROW as never);
    expect(parsed.leadManagers).toEqual([
      'EQUIRUS CAPITAL LIMITED (Formerly Equirus Capital Private Limited)',
    ]);
  });

  it('writes the discovered names through the shared repository write path when the field is empty', async () => {
    const repo = fakeRepo();
    const { leadManagers } = parseBseParties(STEAMHOUSE_BSE_ROW as never);

    await recordDiscoveredLeadManagers(repo as never, 'ipo-steamhouse', leadManagers, {
      leadManagers: null,
    });

    expect(repo.update).toHaveBeenCalledTimes(1);
    const [id, patch] = repo.update.mock.calls[0];
    expect(id).toBe('ipo-steamhouse');
    expect(patch.leadManagers).toEqual([
      'EQUIRUS CAPITAL LIMITED (Formerly Equirus Capital Private Limited)',
    ]);
    expect(patch.updatedAt).toBeInstanceOf(Date);
  });

  it('never overwrites a lead_managers field a higher-priority source already populated', async () => {
    const repo = fakeRepo();
    await recordDiscoveredLeadManagers(repo as never, 'ipo-1', ['Some Other Bank Limited'], {
      leadManagers: ['ADMIN Set Bank Limited'],
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('writes nothing when the discovered names are absent or sanitize away to nothing', async () => {
    const repo = fakeRepo();
    await recordDiscoveredLeadManagers(repo as never, 'ipo-1', [], { leadManagers: null });
    await recordDiscoveredLeadManagers(repo as never, 'ipo-1', null, { leadManagers: null });
    // A bare contact fragment with no legal-entity keyword sanitizes to nothing.
    await recordDiscoveredLeadManagers(repo as never, 'ipo-1', ['Rahul Sharma'], {
      leadManagers: null,
    });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
