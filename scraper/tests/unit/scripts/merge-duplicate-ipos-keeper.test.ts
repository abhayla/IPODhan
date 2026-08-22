import { describe, it, expect } from 'vitest';
import { completeness, pickKeeper, type Row } from '../../../scripts/merge-duplicate-ipos';

/**
 * T-277F checker finding #4: the pair-merge kept the LESS-field-complete row
 * in 2 real prod clusters (shree-balaji-mala-textiles, cube-highways-trust)
 * because child-history count (gmp/subscription rows) ranked FIRST, ahead of
 * field completeness. Since subscriptions/gmp_records are REPOINTED to
 * whichever row is `keep` before the CASCADE delete (see the apply
 * transaction in merge-duplicate-ipos.ts), child count does not protect
 * against data loss — completeness does (lot_size/registrar/etc. on the
 * DELETED row are gone forever, not repointed). pickKeeper must rank
 * completeness first.
 */

function row(overrides: Partial<Row>): Row {
  return {
    id: 'id',
    companyName: 'name',
    slug: 'slug',
    issueSize: null,
    lotSize: null,
    priceRangeMax: null,
    registrar: null,
    createdAt: null,
    ...overrides,
  };
}

describe('completeness', () => {
  it('counts populated structural fields', () => {
    expect(
      completeness(row({ issueSize: '100', lotSize: 50, priceRangeMax: 200, registrar: 'Link Intime' }))
    ).toBe(4);
    expect(completeness(row({}))).toBe(0);
    expect(completeness(row({ issueSize: '0', lotSize: 0 }))).toBe(0);
  });
});

describe('pickKeeper — field-completeness ranks first (T-277F finding #4)', () => {
  it('reproduces the shree-balaji-mala-textiles cluster: keeps the MORE complete row even with zero child history', () => {
    const lessCompleteWithChildren = row({
      id: 'less-complete-c2',
      lotSize: 4000,
      priceRangeMax: 45,
      createdAt: new Date('2026-01-01'),
    }); // c=2
    const moreCompleteNoChildren = row({
      id: 'more-complete-c4',
      issueSize: '1200',
      lotSize: 4000,
      priceRangeMax: 45,
      registrar: 'Bigshare Services',
      createdAt: new Date('2026-01-05'),
    }); // c=4

    const realChildValue = new Map([
      ['less-complete-c2', 3], // has stray gmp/subscription rows
      ['more-complete-c4', 0], // no child history
    ]);

    const keeper = pickKeeper([lessCompleteWithChildren, moreCompleteNoChildren], realChildValue);
    expect(keeper.id).toBe('more-complete-c4');
  });

  it('reproduces the cube-highways-trust cluster: c=2 beats c=1 despite c=1 having child rows', () => {
    const cOne = row({ id: 'c1', registrar: 'Link Intime', createdAt: new Date('2026-02-01') });
    const cTwo = row({
      id: 'c2',
      lotSize: 1,
      registrar: 'Link Intime',
      createdAt: new Date('2026-02-03'),
    });

    const realChildValue = new Map([
      ['c1', 5],
      ['c2', 0],
    ]);

    const keeper = pickKeeper([cOne, cTwo], realChildValue);
    expect(keeper.id).toBe('c2');
  });

  it('falls back to real-child-history count as a tiebreak when completeness is equal', () => {
    const equalA = row({ id: 'a', lotSize: 100, priceRangeMax: 50, createdAt: new Date('2026-01-01') });
    const equalB = row({ id: 'b', lotSize: 200, priceRangeMax: 60, createdAt: new Date('2026-01-02') });

    const realChildValue = new Map([
      ['a', 0],
      ['b', 7],
    ]);

    const keeper = pickKeeper([equalA, equalB], realChildValue);
    expect(keeper.id).toBe('b');
  });

  it('falls back to oldest when completeness AND child-history both tie', () => {
    const older = row({ id: 'older', lotSize: 100, createdAt: new Date('2026-01-01') });
    const newer = row({ id: 'newer', lotSize: 100, createdAt: new Date('2026-06-01') });

    const realChildValue = new Map([
      ['older', 0],
      ['newer', 0],
    ]);

    const keeper = pickKeeper([newer, older], realChildValue);
    expect(keeper.id).toBe('older');
  });
});
