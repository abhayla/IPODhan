/**
 * Review round 1 (MAJOR-2, PR #914): the nightly check s_settled_field_rewritten ranks sources
 * through scraper/config/writer-source-ranking.json — the writer's own getSourcePriority /
 * allowsSameSourceRefresh answers. This fails when the committed table differs from what the
 * writer answers today (regenerate: `npx tsx scripts/build-writer-ranking-snapshot.ts`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildWriterRankingSnapshot } from '../../../src/config/writer-source-ranking.js';
import { getSourcePriority } from '../../../src/config/field-priority-matrix.js';
import { FEATURE_FLAGS } from '../../../src/config/feature-flags.js';

const committed = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'config', 'writer-source-ranking.json'), 'utf8')
);

describe('writer-source-ranking.json is the writer ranking itself', () => {
  it('matches what getSourcePriority/allowsSameSourceRefresh answer today (no stale snapshot)', () => {
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildWriterRankingSnapshot())));
  });

  it('records BOTH flag states, and they differ where a group is flipped (issueSize: NSE ranked off, unranked on)', () => {
    expect(committed.rank.policyWriterOff.MAINBOARD.unknown.issueSize.NSE).toBeGreaterThanOrEqual(0);
    expect(committed.rank.policyWriterOn.MAINBOARD.unknown.issueSize.NSE).toBeUndefined();
  });

  it('spot-checks the table against getSourcePriority itself, venue included (OD-64)', () => {
    const f = FEATURE_FLAGS as { ENABLE_POLICY_WRITER: boolean };
    const saved = f.ENABLE_POLICY_WRITER;
    try {
      f.ENABLE_POLICY_WRITER = false;
      expect(committed.rank.policyWriterOff.MAINBOARD.unknown.openDate.DRHP).toBe(getSourcePriority('openDate', 'DRHP', 'ipos', 'MAINBOARD', []));
      expect(committed.rank.policyWriterOff.SME_BSE.BSE.priceRangeMin.NSE).toBeUndefined();
      expect(getSourcePriority('priceRangeMin', 'NSE', 'ipos', 'SME_BSE', ['BSE'])).toBe(-1);
    } finally {
      f.ENABLE_POLICY_WRITER = saved;
    }
  });

  it('build restores ENABLE_POLICY_WRITER after snapshotting', () => {
    const f = FEATURE_FLAGS as { ENABLE_POLICY_WRITER: boolean };
    const before = f.ENABLE_POLICY_WRITER;
    buildWriterRankingSnapshot();
    expect(f.ENABLE_POLICY_WRITER).toBe(before);
  });
});
