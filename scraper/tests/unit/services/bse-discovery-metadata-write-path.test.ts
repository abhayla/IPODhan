import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordBseDiscoveryMetadata } from '../../../src/services/data-persister.js';
import { execFileSync } from 'node:child_process';

/**
 * T-403 B1. The first cut wrote `UPDATE ipos SET bse_ipo_no = ...` as raw SQL
 * straight from `document-cycle.ts`, which `scraper-write-path.md` forbids and
 * `check-write-ratchet.mjs` failed on (exit 1). These tests pin BOTH halves of
 * the fix: the write goes through the shared path, and the cycle file stays free
 * of any write pattern so the ratchet cannot regress silently.
 */

const repoRoot = join(__dirname, '../../../..');

function fakeRepo() {
  return { update: vi.fn().mockResolvedValue({}) };
}

describe('B1 — BSE discovery metadata goes through the shared write path', () => {
  it('writes both columns via the IPO repository, never raw SQL', async () => {
    const repo = fakeRepo();
    await recordBseDiscoveryMetadata(repo as never, 'ipo-1', {
      bseIpoNo: 7903,
      bsePayloadLeadManagerCount: 3,
    });

    expect(repo.update).toHaveBeenCalledTimes(1);
    const [id, patch] = repo.update.mock.calls[0];
    expect(id).toBe('ipo-1');
    expect(patch).toMatchObject({ bseIpoNo: 7903, bsePayloadLeadManagerCount: 3 });
    expect(patch.updatedAt).toBeInstanceOf(Date);
  });

  it('omits absent values rather than nulling a column it was not given', async () => {
    const repo = fakeRepo();
    await recordBseDiscoveryMetadata(repo as never, 'ipo-1', { bsePayloadLeadManagerCount: 3 });
    const [, patch] = repo.update.mock.calls[0];
    expect(patch).not.toHaveProperty('bseIpoNo');
    expect(patch.bsePayloadLeadManagerCount).toBe(3);
  });

  it('does not touch the database at all when there is nothing to record', async () => {
    const repo = fakeRepo();
    await recordBseDiscoveryMetadata(repo as never, 'ipo-1', {});
    await recordBseDiscoveryMetadata(repo as never, 'ipo-1', { bseIpoNo: null });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('the REAL write ratchet passes, and does not name document-cycle.ts', () => {
    // Runs the actual pr-gate.yml gate rather than re-implementing its regexes,
    // so a T-403 write creeping back in fails here exactly as it fails in CI.
    let stdout = '';
    let exitCode = 0;
    try {
      stdout = execFileSync('node', ['scripts/check-write-ratchet.mjs'], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
    } catch (error) {
      const e = error as { status?: number; stdout?: string };
      exitCode = e.status ?? 1;
      stdout = e.stdout ?? '';
    }
    expect(stdout).not.toContain('document-cycle.ts');
    expect(exitCode).toBe(0);
  }, 60_000);

  it('the ratchet baseline was NOT widened to grandfather this write', () => {
    const baseline = JSON.parse(
      readFileSync(join(repoRoot, 'config/write-ratchet-baseline.json'), 'utf8')
    );
    const files: string[] = baseline.files.map((f: { file: string }) => f.file);
    expect(files).not.toContain('scraper/src/services/document-cycle.ts');
    expect(files).toContain('scraper/src/services/data-persister.ts');
  });
});
