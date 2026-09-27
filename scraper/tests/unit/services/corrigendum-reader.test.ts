/**
 * Item 9 (OD-90), PR #989 review MINOR 4: a corrigendum read that yields no suggestion must not
 * pass as a silent success — it is logged at warn with the document id so a human looks at it.
 * MUTATION: drop the `parsed === 0` warn in buildCorrigendumSuggestionRunner -> RED.
 */
import { describe, it, expect, vi } from 'vitest';

const { warn, spawnSyncMock } = vi.hoisted(() => ({ warn: vi.fn(), spawnSyncMock: vi.fn() }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('node:child_process', () => ({ spawnSync: (...args: unknown[]) => spawnSyncMock(...args) }));
vi.mock('../../../src/utils/low-priority-spawn.js', () => ({
  EXTRACTOR_BUSY_EXIT_CODE: 75,
  withLowPriority: (bin: string, args: string[]) => ({ bin: 'nice', args: ['-n', '10', bin, ...args] }),
}));

import {
  buildCorrigendumSuggestionRunner,
  defaultCorrigendumPageReader,
  CorrigendumReaderBusyError,
} from '../../../src/services/corrigendum-reader.js';

describe('buildCorrigendumSuggestionRunner — zero suggestions', () => {
  it('warns with the document id when a corrigendum yields no suggestion, and writes nothing', async () => {
    const db = new Proxy({}, { get: () => { throw new Error('no DB access expected'); } });
    const run = buildCorrigendumSuggestionRunner(
      async () => [{ page: 1, text: 'Notice to investors. No change of any kind is announced here.', ocr: false }] as never,
      db as never
    );
    const result = await run({ ipoId: 'ipo-1', documentId: 'doc-zero-1', pdfPath: 'x.pdf' });
    expect(result.parsed).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ ipoId: 'ipo-1', documentId: 'doc-zero-1', pageCount: 1 });
  });
});

/**
 * #151 round 3 (W-178c): the corrigendum reader is a heavy python extractor (pdfplumber + OCR, up
 * to 15 min) spawned by BOTH slots. It runs at low priority like extract_filing.py, and its box-lock
 * busy exit (75) is a typed busy, never a document failure.
 * MUTATION: drop withLowPriority from defaultCorrigendumPageReader -> the nice test is RED;
 * drop the EXTRACTOR_BUSY_EXIT_CODE check -> the busy test is RED (it becomes a plain Error).
 */
describe('defaultCorrigendumPageReader - low priority and the box-lock busy exit', () => {
  it('spawns the reader through withLowPriority (nice), never bare python', async () => {
    spawnSyncMock.mockReset().mockReturnValue({ status: 0, stdout: '{"pages": []}', stderr: '' });
    await defaultCorrigendumPageReader('c.pdf');
    const [bin, args] = spawnSyncMock.mock.calls[0];
    expect(bin).toBe('nice');
    expect(args.slice(0, 2)).toEqual(['-n', '10']);
    expect(String(args[3])).toMatch(/read_corrigendum_pages\.py$/);
    expect(args[4]).toBe('c.pdf');
  });

  it('exit 75 (another extractor holds the box lock) throws CorrigendumReaderBusyError', async () => {
    spawnSyncMock.mockReset().mockReturnValue({ status: 75, stdout: '', stderr: 'extractor busy: box lock held (W-178c)' });
    await expect(defaultCorrigendumPageReader('c.pdf')).rejects.toBeInstanceOf(CorrigendumReaderBusyError);
  });

  it('any other non-zero exit is still an ordinary failure with its cause', async () => {
    spawnSyncMock.mockReset().mockReturnValue({ status: 1, stdout: '', stderr: 'Traceback: boom' });
    const err = await defaultCorrigendumPageReader('c.pdf').catch((e) => e);
    expect(err).not.toBeInstanceOf(CorrigendumReaderBusyError);
    expect(String(err.message)).toContain('boom');
  });
});
