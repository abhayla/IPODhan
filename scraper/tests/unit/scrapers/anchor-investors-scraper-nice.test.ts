import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** W-178: spawnSync mocked at the module boundary, same idiom as
 * filing-auto-persist.test.ts's spawnSyncMock. */
const spawnSyncMock = vi.fn();
vi.mock('child_process', () => ({ spawnSync: (...args: unknown[]) => spawnSyncMock(...args) }));

/** `withLowPriority`/`withBoxLock` mocked at the module boundary, defaulting
 * to a pass-through so tests can assert either shape explicitly per case. */
const lowPrioritySpawnMock = vi.fn((bin: string, args: string[]) => ({ bin, args }));
const boxLockMock = vi.fn((bin: string, args: string[]) => ({ bin, args }));
vi.mock('../../../src/utils/low-priority-spawn.js', () => ({
  withLowPriority: (...args: unknown[]) => lowPrioritySpawnMock(...(args as [string, string[]])),
  withBoxLock: (...args: unknown[]) => boxLockMock(...(args as [string, string[]])),
  EXTRACTOR_BUSY_EXIT_CODE: 75,
}));

import { extractPageTexts } from '../../../src/scrapers/anchor-investors-scraper';

describe('extractPageTexts — W-178 nice-wrapped sidecar spawn', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    lowPrioritySpawnMock.mockClear();
    lowPrioritySpawnMock.mockImplementation((bin: string, args: string[]) => ({ bin, args }));
  });

  afterEach(() => {
    lowPrioritySpawnMock.mockImplementation((bin: string, args: string[]) => ({ bin, args }));
  });

  it('routes the sidecar spawn through withLowPriority with the plain python bin + sidecar args', () => {
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: JSON.stringify(['page one']), stderr: '' });

    extractPageTexts('anchor-report.pdf');

    expect(lowPrioritySpawnMock).toHaveBeenCalledTimes(1);
    const [bin, args] = lowPrioritySpawnMock.mock.calls[0] as [string, string[]];
    expect(bin).toBe('python');
    expect(args[args.length - 1]).toBe('anchor-report.pdf');
  });

  it('spawns whatever withLowPriority returns — nice-wrapped on a forced linux platform', () => {
    lowPrioritySpawnMock.mockImplementation((bin: string, args: string[]) => ({
      bin: 'nice',
      args: ['-n', '15', bin, ...args],
    }));
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: JSON.stringify(['page one']), stderr: '' });

    extractPageTexts('anchor-report.pdf');

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    expect(spawnSyncMock.mock.calls[0][0]).toBe('nice');
    const spawnedArgs = spawnSyncMock.mock.calls[0][1] as string[];
    expect(spawnedArgs[0]).toBe('-n');
    expect(spawnedArgs[1]).toBe('15');
    expect(spawnedArgs[2]).toBe('python');
  });

  it('spawns the plain python bin unchanged when withLowPriority is a no-op', () => {
    spawnSyncMock.mockReturnValueOnce({ status: 0, stdout: JSON.stringify(['page one']), stderr: '' });

    extractPageTexts('anchor-report.pdf');

    expect(spawnSyncMock.mock.calls[0][0]).toBe('python');
  });

  it('W-178c: status 75 (flock -E, box lock timed out) is classified as busy — a non-failure, non-deterministic outcome', () => {
    spawnSyncMock.mockReturnValueOnce({ status: 75, stdout: '', stderr: '' });

    const result = extractPageTexts('anchor-report.pdf');

    expect(result.ok).toBe(false);
    expect((result as { kind?: string }).kind).toBe('busy');
    expect((result as { reason: string }).reason).toContain('another extractor holds the box lock');
  });
});
