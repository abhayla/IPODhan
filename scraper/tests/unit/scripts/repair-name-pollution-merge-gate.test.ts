import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mergeLoser, MERGED_BY } from '../../../scripts/repair-name-pollution-and-redirects.js';

/**
 * #1051 (class: any code path that merges or removes an `ipos` row outside
 * `IPORepository.mergeDuplicateInto`). The name-pollution repair used to delete a loser row
 * directly: no eligibility check, no `ipo_merge_log`, no `--unmerge`. Every loser now goes
 * through the gated, logged, undoable merge (spec section 2.3.3.3, OD-38, OD-69, OD-92), and a
 * refusal is reported for that row and skipped, never forced.
 */

const here = dirname(fileURLToPath(import.meta.url));
const scraperRoot = resolve(here, '../../..');

const REFUSAL =
  'mergeDuplicateInto: refused — the two company names do not fold to the same string ' +
  '("Jay Bee Laminations Ltd." -> jaybeelaminations, "Jay Bee Laminations Ltd. O" -> jaybeelaminationso)';

describe('mergeLoser — the name-pollution loser merge goes through mergeDuplicateInto', () => {
  it('calls mergeDuplicateInto(canonical, loser) with apply passed through and the tool named as author', async () => {
    const mergeDuplicateInto = vi.fn().mockResolvedValue({ applied: true, keepSlug: 'k', droppedSlug: 'd' });
    const out = await mergeLoser({ mergeDuplicateInto } as never, 'keep-id', 'drop-id', { apply: true });
    expect(mergeDuplicateInto).toHaveBeenCalledTimes(1);
    const [keepId, dropId, opts] = mergeDuplicateInto.mock.calls[0];
    expect(keepId).toBe('keep-id');
    expect(dropId).toBe('drop-id');
    expect(opts.apply).toBe(true);
    expect(opts.mergedBy).toBe(MERGED_BY);
    expect(out.outcome).toBe('merged');
  });

  it('a dry run asks mergeDuplicateInto for its plan (apply:false), so refusals show up before --apply', async () => {
    const mergeDuplicateInto = vi.fn().mockResolvedValue({ applied: false });
    const out = await mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: false });
    expect(mergeDuplicateInto.mock.calls[0][2].apply).toBe(false);
    expect(out.outcome).toBe('planned');
  });

  it('never forces the gate: no forceDifferentName, no allowProd, no issue-size acknowledgement', async () => {
    const mergeDuplicateInto = vi.fn().mockResolvedValue({ applied: true });
    await mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: true });
    const opts = mergeDuplicateInto.mock.calls[0][2];
    expect(opts.forceDifferentName ?? false).toBe(false);
    expect(opts.allowProd ?? false).toBe(false);
    expect(opts.setIssueSize).toBeUndefined();
    expect(opts.issueSizeNote).toBeUndefined();
  });

  it('a refusal is returned for that row, with the gate reason verbatim, and is not thrown', async () => {
    const mergeDuplicateInto = vi.fn().mockRejectedValue(new Error(REFUSAL));
    const out = await mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: true });
    expect(out.outcome).toBe('refused');
    expect(out.outcome === 'refused' && out.reason).toContain('company names do not fold');
    expect(mergeDuplicateInto).toHaveBeenCalledTimes(1); // no retry with a looser option
  });

  it('any other error (not a gate refusal) is rethrown, so a broken merge stops the run', async () => {
    const mergeDuplicateInto = vi.fn().mockRejectedValue(new Error('connection terminated unexpectedly'));
    await expect(mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: true })).rejects.toThrow(
      /connection terminated/
    );
  });
});

describe('#1051 source guards — no raw ipos delete remains in either tool', () => {
  const RAW_IPOS_DELETE = /\.delete\(\s*(schema\.)?ipos\b|delete\s+from\s+ipos\b/i;
  const RAW_IPOS_WRITE = /\b(delete\s+from|update|insert\s+into)\s+ipos\b/i;

  it('repair-name-pollution-and-redirects.ts has no direct ipos delete', () => {
    const src = readFileSync(resolve(scraperRoot, 'scripts/repair-name-pollution-and-redirects.ts'), 'utf8');
    expect(src).not.toMatch(RAW_IPOS_DELETE);
    expect(src).toMatch(/mergeDuplicateInto\(/);
  });

  it('classify-suspect-ipos.ts is report-only: no raw ipos delete and no raw ipos write', () => {
    const src = readFileSync(resolve(scraperRoot, 'scripts/audit/classify-suspect-ipos.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(RAW_IPOS_DELETE);
    expect(code).not.toMatch(RAW_IPOS_WRITE);
  });
});
