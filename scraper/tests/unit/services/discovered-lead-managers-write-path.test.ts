import { describe, it, expect, vi } from 'vitest';
import { parseBseParties } from '../../../src/services/bse-party-parser.js';
import { recordDiscoveredLeadManagers } from '../../../src/services/data-persister.js';

/**
 * T-503 / #416 — real Steamhouse India payload (BSE core-API
 * `GetMkt_ISSUE_BBS_IPO/w?IPO_NO=7954`, fetched 2026-09-08, one BRLM, no
 * co-BRLM). RCA: `document-discovery-runner.ts` parses this row's lead
 * managers via `parseBseParties` for its `result.leadManagers`, but
 * `document-cycle.ts` only ever forwarded the COUNT into
 * `bsePayloadLeadManagerCount` via `recordBseDiscoveryMetadata` — the names
 * were discarded, so `ipos.lead_managers` stayed null even though the BSE
 * payload named a real BRLM.
 *
 * Round 2 (#417 review): the fixture below also exercises the two round-2
 * fixes — a `field_sources` provenance row upserted in the SAME transaction
 * as the `ipos` write (MAJOR), and a SQL-level WHERE guard (simulated here
 * via the fake transaction's `update().where()` returning zero rows when the
 * simulated row is already populated) instead of a stale pre-read snapshot
 * (MODERATE TOCTOU).
 */
const STEAMHOUSE_BSE_ROW = {
  IPO_NO: '7954',
  ScripName: 'Steamhouse India Limited',
  Book_Running_Lead_Manager:
    'EQUIRUS CAPITAL LIMITED (Formerly Equirus Capital Private Limited)^Unit no. 2601B, 26th Floor, A Wing, Marathon Futurex,Mafatlal Mills Compound, N M Joshi Marg ,Delisle Road, Lower Parel Mumbai - 400 013||||||||steam.ipo@equirus.com|Mrunal Jadhav/ Rahul Wadekar',
  Co_Book_Running_Lead_Manager: '',
};

/**
 * A fake transactional db whose `ipos.update().where().returning()` behaves
 * like the real SQL WHERE guard: it returns the updated row ONLY when
 * `simulatedStoredLeadManagers` is empty/null at call time — exactly what
 * `lead_managers IS NULL OR jsonb_array_length(lead_managers) = 0` would do
 * in Postgres. `fieldSourcesRows` accumulates every upserted provenance row
 * so tests can assert on it.
 */
function fakeTransactionalDb(opts: { simulatedStoredLeadManagers: string[] | null; previousSource?: string | null }) {
  const fieldSourcesRows: Array<Record<string, unknown>> = [];
  const insertCalls: Array<Record<string, unknown>> = [];

  const tx = {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            const guardPasses =
              !opts.simulatedStoredLeadManagers || opts.simulatedStoredLeadManagers.length === 0;
            return guardPasses ? [{ id: 'ipo-1' }] : [];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (opts.previousSource ? [{ source: opts.previousSource }] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertCalls.push(v);
        return {
          onConflictDoUpdate: async (arg: { set: Record<string, unknown> }) => {
            fieldSourcesRows.push({ ...v, ...arg.set });
          },
        };
      },
    }),
  };

  const dbLike = {
    transaction: async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx),
    update: tx.update,
    select: tx.select,
    insert: tx.insert,
  };

  return { dbLike, fieldSourcesRows, insertCalls };
}

describe('T-503 — discovered BSE lead managers reach ipos.lead_managers', () => {
  it('parses the real Steamhouse payload to exactly 1 BRLM (the class this check flags)', () => {
    const parsed = parseBseParties(STEAMHOUSE_BSE_ROW as never);
    expect(parsed.leadManagers).toEqual([
      'EQUIRUS CAPITAL LIMITED (Formerly Equirus Capital Private Limited)',
    ]);
  });

  it('writes the discovered names through the shared write path when the field is empty, and upserts field_sources in the same transaction', async () => {
    const { leadManagers } = parseBseParties(STEAMHOUSE_BSE_ROW as never);
    const { dbLike, fieldSourcesRows } = fakeTransactionalDb({ simulatedStoredLeadManagers: null });

    const result = await recordDiscoveredLeadManagers('ipo-steamhouse', leadManagers, 'BSE', dbLike as never);

    expect(result).toEqual({ written: true });
    expect(fieldSourcesRows).toHaveLength(1);
    expect(fieldSourcesRows[0]).toMatchObject({
      ipoId: 'ipo-steamhouse',
      tableName: 'ipos',
      fieldName: 'leadManagers',
      source: 'BSE',
      previousSource: null,
    });
  });

  it('carries the previousSource forward when a provenance row already exists', async () => {
    const { dbLike, fieldSourcesRows } = fakeTransactionalDb({
      simulatedStoredLeadManagers: null,
      previousSource: 'MONEYCONTROL',
    });

    await recordDiscoveredLeadManagers('ipo-1', ['NSE Broker Securities Limited'], 'NSE', dbLike as never);

    expect(fieldSourcesRows[0]).toMatchObject({ source: 'NSE', previousSource: 'MONEYCONTROL' });
  });

  it('MODERATE TOCTOU fix: a concurrent value already stored blocks the write via the SQL WHERE guard, not a stale pre-read', async () => {
    const { dbLike, fieldSourcesRows } = fakeTransactionalDb({
      simulatedStoredLeadManagers: ['ADMIN Set Bank Limited'],
    });

    const result = await recordDiscoveredLeadManagers(
      'ipo-1',
      ['Some Other Bank Limited'],
      'BSE',
      dbLike as never
    );

    expect(result).toEqual({ written: false });
    expect(fieldSourcesRows).toHaveLength(0); // no provenance row for a write that never happened
  });

  it('writes nothing when the discovered names are absent or sanitize away to nothing (no transaction opened)', async () => {
    const { dbLike } = fakeTransactionalDb({ simulatedStoredLeadManagers: null });
    const txSpy = vi.spyOn(dbLike, 'transaction');

    expect(await recordDiscoveredLeadManagers('ipo-1', [], 'BSE', dbLike as never)).toEqual({ written: false });
    expect(await recordDiscoveredLeadManagers('ipo-1', null, 'BSE', dbLike as never)).toEqual({ written: false });
    // A bare contact fragment with no legal-entity keyword sanitizes to nothing.
    expect(await recordDiscoveredLeadManagers('ipo-1', ['Rahul Sharma'], 'BSE', dbLike as never)).toEqual({
      written: false,
    });
    expect(txSpy).not.toHaveBeenCalled();
  });
});
