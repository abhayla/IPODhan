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

  it('never forces the gate beyond allowProd: no forceDifferentName, no issue-size acknowledgement', async () => {
    const mergeDuplicateInto = vi.fn().mockResolvedValue({ applied: true });
    await mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: true });
    const opts = mergeDuplicateInto.mock.calls[0][2];
    expect(opts.forceDifferentName ?? false).toBe(false);
    expect(opts.setIssueSize).toBeUndefined();
    expect(opts.issueSizeNote).toBeUndefined();
  });

  // #1051 finding 2: the prod guard lives INSIDE mergeDuplicateInto (ipo-repository.ts:1548) and
  // checks its OWN `opts.allowProd`, independent of whatever authorized the CLI run. Before this
  // fix, `--allow-prod` reached `openRepairDb()` but never reached this call, so the first merge
  // on prod refused mid-run — after the canonical rename had already been written. This test
  // pins the fix: `--allow-prod` (mergeLoser's `allowProd: true`) must reach `mergeDuplicateInto`,
  // and a normal call (no `allowProd`) must NOT claim prod authorization.
  it('threads allowProd:true through to mergeDuplicateInto when the caller was run with --allow-prod', async () => {
    const mergeDuplicateInto = vi.fn().mockResolvedValue({ applied: true });
    await mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: true, allowProd: true });
    const opts = mergeDuplicateInto.mock.calls[0][2];
    expect(opts.allowProd).toBe(true);
  });

  it('does not claim prod authorization when the caller was not run with --allow-prod', async () => {
    const mergeDuplicateInto = vi.fn().mockResolvedValue({ applied: true });
    await mergeLoser({ mergeDuplicateInto } as never, 'k', 'd', { apply: true });
    const opts = mergeDuplicateInto.mock.calls[0][2];
    expect(opts.allowProd ?? false).toBe(false);
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

  it('classify-suspect-ipos.ts never deletes an ipos row; its only write is the reclass offering_type update', () => {
    const src = readFileSync(resolve(scraperRoot, 'scripts/audit/classify-suspect-ipos.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(RAW_IPOS_DELETE);
    expect(code).not.toMatch(/\bdelete\s+from\s+ipos\b/i);
    // #1051 finding 3: reclass mode is outside the class (no merge, no row removed) and is
    // allowed to write — but ONLY offering_type, and only through this one update statement.
    const updateMatches = code.match(/update\s+ipos\s+set\s+[a-z_]+\s*=/gi) ?? [];
    expect(updateMatches.length).toBe(1);
    expect(updateMatches[0].toLowerCase()).toContain('offering_type');
  });

  it('classify-suspect-ipos.ts refuses --apply for --depollute delete, and guards reclass --apply behind --allow-prod on prod', () => {
    const src = readFileSync(resolve(scraperRoot, 'scripts/audit/classify-suspect-ipos.ts'), 'utf8');
    expect(src).toMatch(/APPLY\s*&&\s*mode\s*===\s*'delete'/);
    expect(src).toMatch(/--apply is refused for --depollute delete/);
    expect(src).toMatch(/allow-prod/);
  });
});
