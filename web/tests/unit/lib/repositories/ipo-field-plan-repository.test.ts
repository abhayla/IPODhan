/**
 * Item 21 slice 4 — the read side of ipo_field_plan (lane A's item 5 table,
 * on main since 2026-09-11).
 *
 * Stale is `now > verify_due_at`, per field. The card closed that fork on
 * purpose: a single global "stale after N days" constant is wrong at every
 * value it could take. At 3 days a LISTED IPO's issue price would read "being
 * rechecked" forever, three days after listing, because nothing re-reads a
 * final price and nothing should. A NULL verify_due_at means "never due
 * again" — that is not stale, it is settled.
 *
 * The db is a stub: these guards are about what the repository DOES with rows,
 * and a stub cannot hide a wrong comparison the way a live table with one happy
 * row can.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  IpoFieldPlanRepository,
  summariseFieldGroup,
} from '@/lib/repositories/ipo-field-plan-repository';

const IPO = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-09-11T00:00:00Z');

type Row = Record<string, unknown>;

function makeRepo(rows: Row[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  const db = { select, insert: vi.fn(), update: vi.fn(), delete: vi.fn() } as unknown as never;
  const redis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn().mockResolvedValue(0),
    keys: vi.fn().mockResolvedValue([]),
  } as unknown as never;
  return new IpoFieldPlanRepository(db, redis);
}

function row(over: Row = {}): Row {
  return {
    tableName: 'ipos',
    fieldName: 'issue_size',
    state: 'SUPPLIED',
    chosenSource: 'DOC',
    chosenDocumentType: 'RHP',
    verifyDueAt: new Date('2026-09-20T00:00:00Z'),
    verifyState: 'CONFIRMED',
    updatedAt: new Date('2026-09-06T00:00:00Z'),
    ...over,
  };
}

describe('IpoFieldPlanRepository.getIPOProvenanceMap', () => {
  it('keys by table.column, the same key the manifest and the field groups use', async () => {
    const map = await makeRepo([row()]).getIPOProvenanceMap(IPO, NOW);
    expect(Object.keys(map)).toEqual(['ipos.issue_size']);
  });

  it('carries the source and document type the plan actually chose', async () => {
    const map = await makeRepo([row()]).getIPOProvenanceMap(IPO, NOW);
    expect(map['ipos.issue_size'].chosenSource).toBe('DOC');
    expect(map['ipos.issue_size'].chosenDocumentType).toBe('RHP');
  });

  it('is not stale while verify_due_at is in the future', async () => {
    const map = await makeRepo([row()]).getIPOProvenanceMap(IPO, NOW);
    expect(map['ipos.issue_size'].isStale).toBe(false);
  });

  it('is stale once now has passed verify_due_at', async () => {
    const rows = [row({ verifyDueAt: new Date('2026-09-10T23:59:00Z') })];
    const map = await makeRepo(rows).getIPOProvenanceMap(IPO, NOW);
    expect(map['ipos.issue_size'].isStale).toBe(true);
  });

  it('treats a NULL verify_due_at as settled, never as stale', async () => {
    const map = await makeRepo([row({ verifyDueAt: null })]).getIPOProvenanceMap(IPO, NOW);
    expect(map['ipos.issue_size'].isStale).toBe(false);
  });

  it('drops a field the plan has not supplied — there is nothing truthful to say about it', async () => {
    const rows = [row({ state: 'PENDING', chosenSource: null, chosenDocumentType: null })];
    expect(await makeRepo(rows).getIPOProvenanceMap(IPO, NOW)).toEqual({});
  });

  it('drops a row whose state is SUPPLIED but which names no source — the same silence', async () => {
    const rows = [row({ chosenSource: null })];
    expect(await makeRepo(rows).getIPOProvenanceMap(IPO, NOW)).toEqual({});
  });

  it('returns an empty map rather than throwing when the IPO has no plan rows at all', async () => {
    expect(await makeRepo([]).getIPOProvenanceMap(IPO, NOW)).toEqual({});
  });
});

describe('summariseFieldGroup — one line under a block that shows several fields', () => {
  const fresh = {
    key: 'ipos.issue_size',
    tableName: 'ipos',
    fieldName: 'issue_size',
    chosenSource: 'DOC',
    chosenDocumentType: 'RHP',
    confirmedAt: new Date('2026-09-06T00:00:00Z'),
    isStale: false,
  };
  const older = { ...fresh, key: 'ipo_details.fresh_issue', fieldName: 'fresh_issue', confirmedAt: new Date('2026-08-28T00:00:00Z') };
  const map = { [fresh.key]: fresh, [older.key]: older };

  it('reports the OLDEST confirmation in the group — a block is only as fresh as its stalest number', () => {
    const got = summariseFieldGroup(map, [fresh.key, older.key]);
    expect(got?.confirmedAt).toEqual(new Date('2026-08-28T00:00:00Z'));
  });

  it('is stale when ANY field in the block is stale, never only when all of them are', () => {
    const withStale = { ...map, [older.key]: { ...older, isStale: true } };
    expect(summariseFieldGroup(withStale, [fresh.key, older.key])?.isStale).toBe(true);
  });

  it('names the source only when every field in the block agrees', () => {
    expect(summariseFieldGroup(map, [fresh.key, older.key])?.chosenSource).toBe('DOC');
  });

  it('says MULTIPLE rather than picking one source when the block mixes sources', () => {
    const mixed = { ...map, [older.key]: { ...older, chosenSource: 'BSE', chosenDocumentType: null } };
    const got = summariseFieldGroup(mixed, [fresh.key, older.key]);
    expect(got?.chosenSource).toBe('MULTIPLE');
    expect(got?.chosenDocumentType).toBeNull();
  });

  it('returns null when the block has no provenance at all, so the page renders nothing', () => {
    expect(summariseFieldGroup({}, [fresh.key, older.key])).toBeNull();
  });

  it('ignores a key the block lists but the plan has no row for', () => {
    const got = summariseFieldGroup({ [fresh.key]: fresh }, [fresh.key, 'ipos.nonexistent']);
    expect(got?.confirmedAt).toEqual(new Date('2026-09-06T00:00:00Z'));
  });
});
