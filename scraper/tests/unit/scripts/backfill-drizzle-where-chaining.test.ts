/**
 * #488 — Drizzle's `.where()` REPLACES the previous where clause rather than
 * ANDing it. Four backfill scripts built their IPO filter with more than one
 * `.where()` call on the same query builder (either independent `if` blocks,
 * or an if/else that still dropped a BASE filter set applied before the
 * branch), which silently discarded earlier conditions whenever two filters
 * could co-occur. Each script now exports a pure `build*Conditions()`
 * function that collects every applicable condition into an array, applied
 * as ONE combined `where(and(...))` call; these tests exercise those
 * functions directly (no DB, no process.exit, no script side effects) and
 * flatten the resulting `and(...)` SQL fragment to assert every expected
 * bound parameter survives.
 */
import { describe, it, expect } from 'vitest';
import { and } from 'drizzle-orm';
import { buildIpoReviewsConditions } from '../../../scripts/backfill-ipo-reviews.js';
import { buildPeerCompaniesConditions } from '../../../scripts/backfill-peer-companies.js';
import { buildObjectivesIposConditions } from '../../../scripts/backfill-objectives.js';
import { buildAnchorInvestorsIposConditions } from '../../../scripts/backfill-anchor-investors.js';

/**
 * Flatten a drizzle SQL fragment into the literal text it carries plus every
 * bound parameter value, so a test can assert on what actually reaches
 * Postgres rather than on the builder object's shape.
 */
function flattenSql(node: any, out: { text: string[]; params: unknown[] } = { text: [], params: [] }) {
  if (node == null) return out;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    out.params.push(node);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) flattenSql(n, out);
    return out;
  }
  if (Array.isArray(node.queryChunks)) {
    for (const chunk of node.queryChunks) flattenSql(chunk, out);
    return out;
  }
  if (Array.isArray(node.value)) {
    out.text.push(node.value.join(''));
    return out;
  }
  if ('value' in node && typeof node.value !== 'object') {
    out.params.push(node.value);
    return out;
  }
  if (typeof node.name === 'string') {
    out.text.push(node.name);
    return out;
  }
  return out;
}

function flatten(conds: unknown[]) {
  return flattenSql(and(...(conds as any[])));
}

describe('backfill-ipo-reviews.ts — buildIpoReviewsConditions', () => {
  it('status + segment together: BOTH predicates present (status no longer dropped)', () => {
    const where = flatten(buildIpoReviewsConditions({ status: 'OPEN', segment: 'MAINBOARD' }));
    expect(where.params).toContain('OPEN');
    expect(where.params).toContain('MAINBOARD');
  });

  it('no status given: the default OPEN/CLOSED/LISTED set is still applied', () => {
    const where = flatten(buildIpoReviewsConditions({ segment: 'SME' }));
    expect(where.params).toContain('OPEN');
    expect(where.params).toContain('CLOSED');
    expect(where.params).toContain('LISTED');
    expect(where.params).toContain('SME');
  });
});

describe('backfill-peer-companies.ts — buildPeerCompaniesConditions', () => {
  it('status + sector together: BOTH predicates present alongside the base sector-not-null filter', () => {
    const conds = buildPeerCompaniesConditions({ status: 'OPEN', sector: 'FMCG' });
    // The base "sector is not null" condition, plus status, plus sector.
    expect(conds.length).toBe(3);
    const where = flatten(conds);
    expect(where.params).toContain('OPEN');
    expect(where.params).toContain('FMCG');
  });
});

describe('backfill-objectives.ts — buildObjectivesIposConditions', () => {
  it('status + ipoId together: BOTH predicates present alongside the base document-type/url filter', () => {
    const conds = buildObjectivesIposConditions({ status: 'OPEN', ipoId: '11111111-1111-1111-1111-111111111111' });
    expect(conds.length).toBe(4);
    const where = flatten(conds);
    expect(where.params).toContain('OPEN');
    expect(where.params).toContain('11111111-1111-1111-1111-111111111111');
    expect(where.params).toContain('DRHP');
  });
});

describe('backfill-anchor-investors.ts — buildAnchorInvestorsIposConditions', () => {
  it('ipoId given: the base document-type/url filter is still applied alongside it', () => {
    const conds = buildAnchorInvestorsIposConditions({ ipoId: '22222222-2222-2222-2222-222222222222' });
    expect(conds.length).toBe(3);
    const where = flatten(conds);
    expect(where.params).toContain('22222222-2222-2222-2222-222222222222');
    expect(where.params).toContain('DRHP');
  });

  it('status given (no ipoId): the base document-type/url filter is still applied alongside it', () => {
    const conds = buildAnchorInvestorsIposConditions({ status: 'OPEN' });
    expect(conds.length).toBe(3);
    const where = flatten(conds);
    expect(where.params).toContain('OPEN');
    expect(where.params).toContain('DRHP');
  });
});
