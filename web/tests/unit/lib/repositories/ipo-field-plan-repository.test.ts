/**
 * Item 21 slice 4 — the read side of ipo_field_plan (lane A's item 5 table,
 * on main since 2026-09-11).
 *
 * S2 (docs/design/s2-witnesses-plan.md): `verify_due_at` and its four sibling
 * verify* columns are DROPPED from `ipo_field_plan` — 13,512/13,512 plan rows
 * had verify_due_at NULL, no scraper write path ever populated them, and the
 * re-read loop that would have was never built (OD-56 supersedes it). This
 * repository's `isStale` computation read only that column, so it is dropped
 * too (plan's option (a): drop the field, never hard-code false — a
 * permanently-false input is dead logic a later reader would trust).
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
const SLUG = 'armee-infotech-ltd';

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
  const repo = new IpoFieldPlanRepository(db, redis);
  return Object.assign(repo, { __redis: redis as unknown as { get: ReturnType<typeof vi.fn> } });
}

function row(over: Row = {}): Row {
  return {
    tableName: 'ipos',
    fieldName: 'issue_size',
    state: 'SUPPLIED',
    chosenSource: 'DOC',
    chosenDocumentType: 'RHP',
    chosenConfirmedAt: new Date('2026-09-06T00:00:00Z'),
    updatedAt: new Date('2026-09-20T00:00:00Z'),
    ...over,
  };
}

describe('IpoFieldPlanRepository.getIPOProvenanceMap', () => {
  it('keys by table.column, the same key the manifest and the field groups use', async () => {
    const map = await makeRepo([row()]).getIPOProvenanceMap(IPO, SLUG);
    expect(Object.keys(map)).toEqual(['ipos.issue_size']);
  });

  it('carries the source and document type the plan actually chose', async () => {
    const map = await makeRepo([row()]).getIPOProvenanceMap(IPO, SLUG);
    expect(map['ipos.issue_size'].chosenSource).toBe('DOC');
    expect(map['ipos.issue_size'].chosenDocumentType).toBe('RHP');
  });

  it('T3: the returned provenance carries no isStale key at all — the field is dropped, not hard-coded false', async () => {
    const map = await makeRepo([row()]).getIPOProvenanceMap(IPO, SLUG);
    expect('isStale' in map['ipos.issue_size']).toBe(false);
    expect(Object.keys(map['ipos.issue_size']).sort()).toEqual(
      ['chosenDocumentType', 'chosenSource', 'confirmedAt', 'fieldName', 'key', 'tableName'].sort()
    );
  });

  it('drops a field the plan has not supplied — there is nothing truthful to say about it', async () => {
    const rows = [row({ state: 'PENDING', chosenSource: null, chosenDocumentType: null })];
    expect(await makeRepo(rows).getIPOProvenanceMap(IPO, SLUG)).toEqual({});
  });

  it('drops a row whose state is SUPPLIED but which names no source — the same silence', async () => {
    const rows = [row({ chosenSource: null })];
    expect(await makeRepo(rows).getIPOProvenanceMap(IPO, SLUG)).toEqual({});
  });

  it('returns an empty map rather than throwing when the IPO has no plan rows at all', async () => {
    expect(await makeRepo([]).getIPOProvenanceMap(IPO, SLUG)).toEqual({});
  });

  it('keeps two rows for the same table.field distinct when they carry different row keys — a multi-row table (e.g. financial_statements per fiscal year) must not collapse onto one key', async () => {
    const rows = [
      row({
        tableName: 'financial_statements',
        fieldName: 'revenue',
        rowKey: 'FY2024',
        chosenSource: 'DOC',
        updatedAt: new Date('2026-09-01T00:00:00Z'),
      }),
      row({
        tableName: 'financial_statements',
        fieldName: 'revenue',
        rowKey: 'FY2025',
        chosenSource: 'BSE',
        updatedAt: new Date('2026-09-05T00:00:00Z'),
      }),
    ];
    const map = await makeRepo(rows).getIPOProvenanceMap(IPO, SLUG);
    const keys = Object.keys(map).sort();
    expect(keys).toEqual(['financial_statements.FY2024.revenue', 'financial_statements.FY2025.revenue']);
    expect(map['financial_statements.FY2024.revenue'].chosenSource).toBe('DOC');
    expect(map['financial_statements.FY2025.revenue'].chosenSource).toBe('BSE');
  });

  it('resolves a singleton field (row_key "") exactly as before, keyed table.field with no row-key segment', async () => {
    const map = await makeRepo([row({ rowKey: '' })]).getIPOProvenanceMap(IPO, SLUG);
    expect(Object.keys(map)).toEqual(['ipos.issue_size']);
    expect(map['ipos.issue_size'].chosenSource).toBe('DOC');
  });
});

describe('item 21 (OD-72): the date is the READ date, never updated_at', () => {
  it('confirmedAt is chosen_confirmed_at, not updated_at (which any write moves)', async () => {
    const map = await makeRepo([row()]).getIPOProvenanceMap(IPO, SLUG);
    expect(map['ipos.issue_size'].confirmedAt!.toISOString()).toBe('2026-09-06T00:00:00.000Z');
  });

  it('a SUPPLIED row with no recorded read date keeps its source and carries NO date', async () => {
    const map = await makeRepo([row({ chosenConfirmedAt: null })]).getIPOProvenanceMap(IPO, SLUG);
    expect(map['ipos.issue_size'].chosenSource).toBe('DOC');
    expect(map['ipos.issue_size'].confirmedAt).toBeNull();
  });

  it('is cached under the slug-keyed provenance key the OD-40 revalidate call drops', async () => {
    const repo = makeRepo([row()]);
    await repo.getIPOProvenanceMap(IPO, SLUG);
    expect(repo.__redis.get).toHaveBeenCalledWith(`ipo:fieldplan:provenance:${SLUG}`);
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
  };
  const older = { ...fresh, key: 'ipo_details.fresh_issue', fieldName: 'fresh_issue', confirmedAt: new Date('2026-08-28T00:00:00Z') };
  const map = { [fresh.key]: fresh, [older.key]: older };

  it('reports the OLDEST confirmation in the group — a block is only as fresh as its stalest number', () => {
    const got = summariseFieldGroup(map, [fresh.key, older.key]);
    expect(got?.confirmedAt).toEqual(new Date('2026-08-28T00:00:00Z'));
  });

  it('item 21: one member with NO read date leaves the whole block undated (a date must be true of every field in it)', () => {
    const undated = { ...map, [older.key]: { ...older, confirmedAt: null } };
    const got = summariseFieldGroup(undated, [fresh.key, older.key]);
    expect(got?.chosenSource).toBe('DOC');
    expect(got?.confirmedAt).toBeNull();
  });

  it('the summarised line carries no isStale key either', () => {
    const got = summariseFieldGroup(map, [fresh.key, older.key]);
    expect(got && 'isStale' in got).toBe(false);
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

  it('does not arbitrarily pick a row for a multi-row table when no explicit row key is given — a bare table.field lookup against a keyed map must miss, not silently resolve to whichever row happened to load', () => {
    const multiRowMap = {
      'financial_statements.FY2024.revenue': {
        ...fresh,
        key: 'financial_statements.FY2024.revenue',
        tableName: 'financial_statements',
        fieldName: 'revenue',
      },
      'financial_statements.FY2025.revenue': {
        ...older,
        key: 'financial_statements.FY2025.revenue',
        tableName: 'financial_statements',
        fieldName: 'revenue',
      },
    };
    const got = summariseFieldGroup(multiRowMap, ['financial_statements.revenue']);
    expect(got).toBeNull();
  });
});
