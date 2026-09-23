import { describe, it, expect } from 'vitest';
import {
  normalizeSourceKeyValue,
  nseIssueKeyValue,
  chittorgarhPageId,
  recheckKeyBind,
  od83Supersedes,
  normalizeSourceKeyRefs,
  supersedeOlderKeysOnRelaunchMerge,
} from './ipo-source-keys';
import { withSourceKeyLineage, noteSourceKeyBind, sourceKeyLineageFor } from './source-key-lineage';
import { FieldSourcesRepository } from './field-sources-repository';
import { REPOINT_TABLES, checkMergeEligibility, assessRelaunch, relaunchException } from '../utils/duplicate-ipo-merge';

// OD-85 / OD-86 pure rules (docs/design/data-sourcing-pull-model.md §2.3.3.2, §2.3.3.3).
describe('OD-85 key values', () => {
  it('trims and upper-cases (BSE "MOMSBELIEF " F-133); NSE key is SYMBOL|SERIES and needs a series', () => {
    expect(normalizeSourceKeyValue('MOMSBELIEF ')).toBe('MOMSBELIEF');
    expect(nseIssueKeyValue('momsbelief ', 'eq')).toBe('MOMSBELIEF|EQ');
    expect(nseIssueKeyValue('COALINDIA', null)).toBeNull();
  });
  it('the Chittorgarh page id ignores the slug (F-148)', () => {
    expect(chittorgarhPageId('https://www.chittorgarh.com/ipo/hero-motors-ipo/2225/')).toBe('2225');
    expect(chittorgarhPageId('https://www.chittorgarh.com/ipo/x/2225/')).toBe('2225');
    expect(chittorgarhPageId('https://www.chittorgarh.com/ipo/no-id/')).toBeNull();
  });
  it('collapses duplicate refs and drops malformed ones', () => {
    expect(normalizeSourceKeyRefs([
      { source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: ' 7900' },
      { source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '7900' },
      { source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '   ' },
    ]).map((r) => r.keyValue)).toEqual(['7900']);
  });
});

describe('OD-85 re-check on every key bind', () => {
  const row = { offeringType: 'IPO', segment: 'SME', openDate: '2026-08-19', priceRangeMin: 95, cin: null, isin: 'INE1B7I01014' };
  it('passes the Dhanwel re-read (57 days, same band)', () => {
    expect(recheckKeyBind({ openDate: '2026-06-23', priceRangeMin: 95, segment: 'SME' }, row).ok).toBe(true);
  });
  it('an ISIN contradiction is an identifier contradiction (-> DISPUTED); Himalaya values', () => {
    expect(recheckKeyBind({ isin: 'INE1OTR01013' }, row)).toMatchObject({ ok: false, identifierContradiction: true });
  });
  it('type, segment, band and >180 days each refuse without disputing the key', () => {
    expect(recheckKeyBind({ offeringType: 'OFS' }, row)).toMatchObject({ ok: false, identifierContradiction: false });
    expect(recheckKeyBind({ segment: 'MAINBOARD' }, row).ok).toBe(false);
    expect(recheckKeyBind({ priceRangeMin: 100 }, row).ok).toBe(false);
    expect(recheckKeyBind({ openDate: '2027-03-01' }, row).ok).toBe(false);
  });
});

describe('OD-83 supersede test', () => {
  const same = { shares: 2_700_000, priceMin: 95, priceMax: 99 };
  it('same shares + band + older postponed -> supersede (Dhanwel 7794 -> 7900)', () => {
    expect(od83Supersedes({ attrs: { ...same, postponed: true }, recordOpenDate: '2026-06-23' }, { attrs: same, recordOpenDate: '2026-08-19' }).ok).toBe(true);
  });
  it('strictly earlier also passes; equal dates without postponed flag hold', () => {
    expect(od83Supersedes({ attrs: same, recordOpenDate: '2026-06-23' }, { attrs: same, recordOpenDate: '2026-08-19' }).ok).toBe(true);
    expect(od83Supersedes({ attrs: same, recordOpenDate: '2026-08-19' }, { attrs: same, recordOpenDate: '2026-08-19' }).ok).toBe(false);
  });
  it('a differing band or an unknown share count holds', () => {
    expect(od83Supersedes({ attrs: { ...same, postponed: true } }, { attrs: { ...same, priceMin: 100, priceMax: 105 } }).ok).toBe(false);
    expect(od83Supersedes({ attrs: { priceMin: 95, priceMax: 99, postponed: true } }, { attrs: same }).ok).toBe(false);
  });
});

describe('merge tool (OD-85 repoint, OD-86 relaunch exception)', () => {
  it('ipo_source_keys is on the repoint list', () => {
    expect(REPOINT_TABLES.has('ipo_source_keys')).toBe(true);
  });
  const keep = { openDate: '2026-08-19', symbol: 'DHANWEL', cin: null };
  const drop = { openDate: '2026-06-23', symbol: 'DHANWEL', cin: null };
  const attrs = { shares: 2_700_000, priceMin: 95, priceMax: 99 };
  const base = {
    keepOpenDate: keep.openDate, dropOpenDate: drop.openDate, keepCompanyName: 'Dhanwel Hybrid Seeds Ltd', dropCompanyName: 'Dhanwel Hybrid Seeds Ltd',
    forceDifferentName: false, identifiers: [{ column: 'bse_ipo_no', keepValue: 7900, dropValue: 7794 }, { column: 'symbol', keepValue: 'DHANWEL', dropValue: 'DHANWEL' }],
    keepIssueSize: null, dropIssueSize: null,
  };
  it('relaunch (older postponed) merges despite differing dates and IPO_NOs', () => {
    const relaunch = assessRelaunch(keep, drop, [{ attrs }], [{ attrs: { ...attrs, postponed: true } }]);
    expect(relaunchException(relaunch)).toBe(true);
    expect(checkMergeEligibility({ ...base, relaunch })).toEqual({ eligible: true });
  });
  it('without the postponed flag, OD-69 refuses as before', () => {
    const relaunch = assessRelaunch(keep, drop, [{ attrs }], [{ attrs }]);
    expect(checkMergeEligibility({ ...base, relaunch }).eligible).toBe(false);
  });
  it('a differing ISIN is still refused under the exception', () => {
    const relaunch = assessRelaunch(keep, drop, [{ attrs }], [{ attrs: { ...attrs, postponed: true } }]);
    const r = checkMergeEligibility({ ...base, relaunch, identifiers: [...base.identifiers, { column: 'isin', keepValue: 'INE1B7I01014', dropValue: 'INE1OTR01013' }] });
    expect(r.eligible).toBe(false);
  });
});

describe('OD-85 write rule: binding key ids reach field_sources.data_lineage (scope semantics)', () => {
  it('a key noted inside a record scope is returned for that ipo only, never outside the scope', async () => {
    expect(sourceKeyLineageFor('ipo-1')).toBeNull();
    await withSourceKeyLineage(async () => {
      noteSourceKeyBind('ipo-1', ['k1']);
      noteSourceKeyBind('ipo-1', ['k1', 'k2']);
      expect(sourceKeyLineageFor('ipo-1')).toEqual({ sourceKeyIds: ['k1', 'k2'] });
      expect(sourceKeyLineageFor('ipo-2')).toBeNull();
      // a nested scope is the same record: it sees and extends the outer note
      await withSourceKeyLineage(async () => {
        expect(sourceKeyLineageFor('ipo-1')).toEqual({ sourceKeyIds: ['k1', 'k2'] });
      });
    });
    expect(sourceKeyLineageFor('ipo-1')).toBeNull();
  });
  it('two records processed concurrently never see each other\'s keys', async () => {
    const seen: unknown[] = [];
    await Promise.all(['a', 'b'].map((id) => withSourceKeyLineage(async () => {
      noteSourceKeyBind(`ipo-${id}`, [`k-${id}`]);
      await new Promise((r) => setTimeout(r, 5));
      seen.push([sourceKeyLineageFor('ipo-a'), sourceKeyLineageFor('ipo-b')]);
    })));
    expect(seen).toContainEqual([{ sourceKeyIds: ['k-a'] }, null]);
    expect(seen).toContainEqual([null, { sourceKeyIds: ['k-b'] }]);
  });
});

describe('OD-86 + OD-83 at merge time: supersedeOlderKeysOnRelaunchMerge', () => {
  const key = (id: string, ipoId: string, source: string, keyType: string, keyValue: string, state = 'ACTIVE') =>
    ({ id, ipoId, source, keyType, keyValue, state }) as never;
  it('the older record\'s key of a source the newer also carries is SUPERSEDED by the newer key; others are untouched', async () => {
    const updates: { set: Record<string, unknown> }[] = [];
    const tx = { update: () => ({ set: (set: Record<string, unknown>) => ({ where: async () => { updates.push({ set }); } }) }) } as never;
    const ids = await supersedeOlderKeysOnRelaunchMerge(
      tx,
      [key('o-bse', 'old', 'BSE', 'BSE_IPO_NO', '7794'), key('o-cg', 'old', 'CHITTORGARH', 'CG_PAGE_ID', '2846')],
      [key('n-bse', 'new', 'BSE', 'BSE_IPO_NO', '7900')],
      'test'
    );
    expect(ids).toEqual(['o-bse']);
    expect(updates.length).toBe(1);
    expect(updates[0].set.state).toBe('SUPERSEDED');
    expect(updates[0].set.supersededBy).toBe('n-bse');
  });
});

describe('OD-85 write rule wired into FieldSourcesRepository.trackFieldUpdate', () => {
  const captureRepo = () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          inserted.push(v);
          return { onConflictDoUpdate: () => ({ returning: async () => [v] }) };
        },
      }),
    } as never;
    const redis = { del: async () => 0, keys: async () => [], scan: async () => ['0', []], get: async () => null } as never;
    return { repo: new FieldSourcesRepository(db, redis), inserted };
  };
  it('a write inside a key-bind scope for that ipo carries sourceKeyIds merged into its lineage; outside it, lineage is unchanged', async () => {
    const { repo, inserted } = captureRepo();
    await withSourceKeyLineage(async () => {
      noteSourceKeyBind('ipo-1', ['key-7900']);
      await repo.trackFieldUpdate({ ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'openDate', source: 'BSE' as never, dataLineage: { policyOrigin: 'm' } });
      await repo.trackFieldUpdate({ ipoId: 'ipo-other', tableName: 'ipos', fieldName: 'openDate', source: 'BSE' as never });
    });
    await repo.trackFieldUpdate({ ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'closeDate', source: 'BSE' as never });
    expect(inserted.map((v) => v.dataLineage)).toEqual([{ policyOrigin: 'm', sourceKeyIds: ['key-7900'] }, null, null]);
  });
});
