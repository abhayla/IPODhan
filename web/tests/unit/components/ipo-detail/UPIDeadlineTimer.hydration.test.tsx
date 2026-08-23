/**
 * Hydration-mismatch regression test for UPIDeadlineTimer (T-302C checker F1).
 *
 * The checker reproduced a real hydration warning with a `renderToString` ->
 * +2s -> `hydrateRoot` probe: server renders "3h 30m", the client's FIRST
 * render (before its `useEffect` has run) computes a fresh `Date.now()` a few
 * seconds later and renders "3h 29m 58s" — a text mismatch on the countdown
 * node. This happens on every OPEN IPO inside its final 24h, because that is
 * exactly when the formatted string includes seconds. This test drives the
 * SAME probe shape the checker used, for both the sub-24h (seconds visible)
 * and >24h (seconds hidden) cases, and asserts zero hydration warnings.
 *
 * `hydrateRoot` runs its reconciliation work on React's concurrent scheduler
 * (async, off the calling stack), so the assertion MUST flush that work with
 * `act()` before inspecting captured console output — checking immediately
 * after the synchronous `hydrateRoot()` call would silently miss the warning
 * (it fires on a later microtask/macrotask, after any `console.error` spy set
 * up around just the call has already been torn down).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { UPIDeadlineTimer } from '@/components/ipo-detail/UPIDeadlineTimer';

async function probeHydration(closeDate: string, serverNowMs: number): Promise<string[]> {
  const dateNowSpy = vi.spyOn(Date, 'now');

  dateNowSpy.mockReturnValue(serverNowMs);
  const html = renderToString(<UPIDeadlineTimer closeDate={closeDate} status="OPEN" />);

  // Same shape as the checker's probe: the client's first render (and the
  // effect that follows) observes a `Date.now()` a couple of seconds later
  // than what the server saw.
  dateNowSpy.mockReturnValue(serverNowMs + 2000);

  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);

  const errors: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };

  try {
    await act(async () => {
      hydrateRoot(container, <UPIDeadlineTimer closeDate={closeDate} status="OPEN" />);
    });
  } finally {
    console.error = originalConsoleError;
    document.body.removeChild(container);
    dateNowSpy.mockRestore();
  }

  return errors.filter((e) => e.includes('did not match') || e.includes('hydrat'));
}

describe('UPIDeadlineTimer hydration (T-302C F1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces zero hydration warnings for an OPEN IPO inside its final 24h (seconds visible)', async () => {
    // closeDate cutoff (17:00 IST = 11:30 UTC) is a few hours after
    // serverNow, so the SSR string is in the sub-24h "seconds visible"
    // branch of formatTimeLeft — the exact case the checker reproduced.
    const serverNow = new Date('2026-08-24T08:00:00.000Z').getTime();
    const warnings = await probeHydration('2026-08-24', serverNow);
    expect(warnings).toEqual([]);
  });

  it('produces zero hydration warnings for an OPEN IPO more than 24h from its cutoff (seconds hidden)', async () => {
    const serverNow = new Date('2026-08-20T00:00:00.000Z').getTime();
    const warnings = await probeHydration('2026-08-24', serverNow);
    expect(warnings).toEqual([]);
  });
});
