import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resetNiceOnPathCache,
  resolveExtractorNice,
  withLowPriority,
} from '../../../src/utils/low-priority-spawn';

const REAL_PLATFORM = process.platform;

function forcePlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

/** Fake "does this POSIX path exist" check — `nice` resolves only under
 * `/usr/bin`, mirroring a typical Linux box, without touching the real
 * filesystem (a Windows dev box's own drive-letter paths cannot round-trip
 * through the guard's `:`-delimited PATH parsing at all). */
const fakePathExists = (p: string) => p === '/usr/bin/nice';
const noPathExists = () => false;

describe('withLowPriority', () => {
  beforeEach(() => {
    resetNiceOnPathCache();
  });

  afterEach(() => {
    forcePlatform(REAL_PLATFORM);
    resetNiceOnPathCache();
  });

  it('wraps with nice on a forced linux platform when nice is on PATH', () => {
    forcePlatform('linux');
    const env = { PATH: '/usr/bin:/bin' };
    const result = withLowPriority('python', ['script.py', 'a.pdf'], env, fakePathExists);
    expect(result.bin).toBe('nice');
    // First two argv entries after 'nice' are '-n', '<level>', then the
    // original bin, then the original args, in order.
    expect(result.args.slice(0, 2)).toEqual(['-n', '15']);
    expect(result.args.slice(2)).toEqual(['python', 'script.py', 'a.pdf']);
  });

  it('honours EXTRACTOR_NICE and clamps it into 0-19', () => {
    forcePlatform('linux');
    const env = { PATH: '/usr/bin:/bin', EXTRACTOR_NICE: '25' };
    expect(resolveExtractorNice(env)).toBe(19);
    const result = withLowPriority('python', ['x.py'], env, fakePathExists);
    expect(result.args[1]).toBe('19');
  });

  it('clamps a negative EXTRACTOR_NICE up to 0', () => {
    const env = { EXTRACTOR_NICE: '-5' };
    expect(resolveExtractorNice(env)).toBe(0);
  });

  it('falls back to the default (15) on a non-numeric EXTRACTOR_NICE', () => {
    const env = { EXTRACTOR_NICE: 'not-a-number' };
    expect(resolveExtractorNice(env)).toBe(15);
  });

  it('returns the plain spawn unchanged on a non-linux platform', () => {
    forcePlatform('win32');
    const env = { PATH: '/usr/bin:/bin' };
    const result = withLowPriority('python', ['script.py'], env, fakePathExists);
    expect(result).toEqual({ bin: 'python', args: ['script.py'] });
  });

  it('returns the plain spawn unchanged on linux when nice is not on PATH', () => {
    forcePlatform('linux');
    const env = { PATH: '/no/such/dir:/also/missing' };
    const result = withLowPriority('python', ['script.py'], env, noPathExists);
    expect(result).toEqual({ bin: 'python', args: ['script.py'] });
  });
});
