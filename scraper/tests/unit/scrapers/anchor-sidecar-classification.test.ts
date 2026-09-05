import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * W-142 round 2 — the two review findings that live in the scrape layer.
 *
 * MAJOR-1: the automatic door pins the row it selected and the file it proved
 * exists, so the scrape must NOT re-select a row and must NOT reach the
 * network — a 3-retry HTTP download with no timeout, fired from inside the
 * deadline-checked extract loop, was the hole.
 *
 * MAJOR-2: `spawnSync` reports `status === null` for ANY signal, its own
 * timeout included. Classifying that as a memory abort gave a merely-slow scan
 * the W-137 hard-failure marker, a 24h backoff floor, and an error line naming
 * a cause that never happened.
 */
const spawnSyncMock = vi.fn();
vi.mock('node:child_process', () => ({ spawnSync: (...a: unknown[]) => spawnSyncMock(...a) }));

const axiosGet = vi.fn(async () => {
  throw new Error('the automatic door must never reach the network');
});
vi.mock('axios', () => ({ default: { get: (...a: unknown[]) => axiosGet(...a) } }));

import {
  extractPageTexts,
  scrapeAnchorInvestorsDetailed,
  SIDECAR_TIMEOUT_MS,
  ANCHOR_SIDECAR_MEMORY_CEILING_EXIT,
} from '../../../src/scrapers/anchor-investors-scraper.js';

beforeEach(() => {
  spawnSyncMock.mockReset();
  axiosGet.mockClear();
});

describe('MAJOR-2 — a timed-out sidecar is not a memory abort', () => {
  it('an ETIMEDOUT kill is an ordinary retryable failure with an honest reason', () => {
    spawnSyncMock.mockReturnValue({
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
    });
    const result = extractPageTexts('C:/store/x.pdf');
    expect(result.ok).toBe(false);
    expect((result as { kind: string }).kind).toBe('sidecar_error');
    expect((result as { reason: string }).reason).toContain(String(SIDECAR_TIMEOUT_MS));
    expect((result as { reason: string }).reason).not.toContain('memory');
  });

  it('exit 3 (the memory guard) IS a hard failure', () => {
    spawnSyncMock.mockReturnValue({
      status: ANCHOR_SIDECAR_MEMORY_CEILING_EXIT,
      stdout: '{"error":"memory ceiling exceeded"}',
      stderr: '',
    });
    const result = extractPageTexts('C:/store/x.pdf');
    expect((result as { kind: string }).kind).toBe('hard_failure');
  });

  it('a C-level OOM stderr signature IS a hard failure even on a timeout kill', () => {
    spawnSyncMock.mockReturnValue({
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: 'OpenBLAS error: Memory allocation still failed after 10 retries, giving up.',
      error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
    });
    expect((extractPageTexts('C:/store/x.pdf') as { kind: string }).kind).toBe('hard_failure');
  });

  it('a bare SIGKILL (kernel OOM, no shell, no stderr) keeps the W-137 hard-failure floor', () => {
    // The live W-137 shape: spawnSync runs python with NO shell, so the
    // OOM-killer leaves status null / signal SIGKILL / no error / no stderr —
    // the "Killed" line isMemoryAbortStderr matches is printed by a shell.
    spawnSyncMock.mockReturnValue({ status: null, signal: 'SIGKILL', stdout: '', stderr: '' });
    const result = extractPageTexts('C:/store/x.pdf');
    expect((result as { kind: string }).kind).toBe('hard_failure');
    expect((result as { reason: string }).reason).toContain('SIGKILL');
  });

  it('a SIGKILL that came from OUR OWN timeout is still the ordinary timeout path', () => {
    spawnSyncMock.mockReturnValue({
      status: null,
      signal: 'SIGKILL',
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
    });
    const result = extractPageTexts('C:/store/x.pdf');
    expect((result as { kind: string }).kind).toBe('sidecar_error');
  });

  it('another signal with no memory signature is an ordinary failure naming the signal', () => {
    spawnSyncMock.mockReturnValue({ status: null, signal: 'SIGSEGV', stdout: '', stderr: '' });
    const result = extractPageTexts('C:/store/x.pdf');
    expect((result as { kind: string }).kind).toBe('sidecar_error');
    expect((result as { reason: string }).reason).toContain('SIGSEGV');
  });
});

describe('MAJOR-1 — a pinned document is never re-selected and never downloaded', () => {
  const dbThatMustNotBeQueried = {
    select: () => {
      throw new Error('the pinned path must not re-select the anchor row');
    },
  } as never;

  it('a missing store file is refused with a reason — no HTTP download is attempted', async () => {
    const outcome = await scrapeAnchorInvestorsDetailed(dbThatMustNotBeQueried, 'ipo-1', 'Qualiance', {
      documentId: 'anchor-1',
      pdfPath: 'C:/store/definitely-not-here.pdf',
    });

    expect(outcome.data).toBeNull();
    expect(outcome.failure?.kind).toBe('unreadable_file');
    expect(outcome.failure?.reason).toContain('never downloads');
    expect(axiosGet).not.toHaveBeenCalled();
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('runs the sidecar on the pinned path itself, without touching the documents table', async () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '{"pages":["nothing parseable"]}', stderr: '' });

    const pinnedPdfPath = import.meta.url.replace('file:///', '');
    const outcome = await scrapeAnchorInvestorsDetailed(
      dbThatMustNotBeQueried,
      'ipo-1',
      'Qualiance',
      { documentId: 'anchor-1', pdfPath: pinnedPdfPath }
    );

    // The parse fails (this file is not an anchor letter) — the point is WHICH
    // file was read and that no row lookup or download happened. Find the
    // sidecar invocation by its argv content (the script path), not by a
    // fixed call/arg index — which binary got spawned (`python`, or a
    // `python3` fallback on a box with no `python` symlink) and how many
    // attempts it took must not matter to this assertion.
    const sidecarCall = spawnSyncMock.mock.calls.find(
      (call) =>
        Array.isArray(call[1]) &&
        call[1].some((arg) => typeof arg === 'string' && arg.includes('anchor_report_text'))
    );
    expect(sidecarCall).toBeDefined();
    expect(sidecarCall?.[1]).toContain(pinnedPdfPath);
    expect(outcome.failure?.kind).toBe('parse_failed');
    expect(axiosGet).not.toHaveBeenCalled();
  });
});
