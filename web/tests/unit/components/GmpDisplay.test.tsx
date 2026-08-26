/**
 * Unit tests for GmpDisplay (T-326).
 *
 * Regression coverage for React error #418 (hydration text mismatch) seen on
 * /, /mainboard-ipos, /sme-ipos in the 2026-08-25 Production Verification run
 * (GitHub Actions run 32907427121). Root cause: `ago()` read `Date.now()`
 * directly in the render body, so the server render and the client's
 * pre-hydration render computed the freshness text at two different real
 * instants — any elapsed minute rollover between them produced two different
 * text nodes for the same DOM position, which is exactly what React's
 * hydration check flags.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { GmpDisplay } from '@/components/shared/GmpDisplay';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GmpDisplay — server/client first-paint determinism', () => {
  it('the render-function output (pre-effects) is identical regardless of when "now" is, for the same props — proving no Date.now() read leaks into the render body', () => {
    // gmpUpdatedAt is fixed. `renderToStaticMarkup` runs the component's
    // render body WITHOUT flushing effects (there is no commit/effect phase
    // in a static SSR render) — this is the exact code path Next.js uses to
    // produce the HTML the browser first paints, and the exact code path the
    // client re-executes synchronously during hydration before any effect
    // runs. If the render body reads Date.now() directly (the pre-fix bug),
    // these two calls — made at two different real instants, exactly as
    // happens between an ISR-cached server render and a later browser load —
    // produce different text and React flags a hydration mismatch (#418).
    const gmpUpdatedAt = new Date('2026-08-25T10:00:00.000Z').toISOString();
    const props = { gmp: 44, gmpPercent: 2.1, gmpUpdatedAt, gmpTrend: 'up' as const };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T10:02:00.000Z')); // "2m ago" if read eagerly
    const renderAtT1 = renderToStaticMarkup(<GmpDisplay {...props} />);

    vi.setSystemTime(new Date('2026-08-25T10:03:30.000Z')); // "3m ago" if read eagerly — crosses a minute boundary
    const renderAtT2 = renderToStaticMarkup(<GmpDisplay {...props} />);

    expect(renderAtT2).toBe(renderAtT1);
  });

  it('fills in the real freshness text after mount (useEffect), without changing the value/trend already shown', async () => {
    vi.useFakeTimers();
    const gmpUpdatedAt = new Date('2026-08-25T09:00:00.000Z').toISOString();
    vi.setSystemTime(new Date('2026-08-25T09:05:00.000Z'));

    const { container } = render(
      <GmpDisplay gmp={44} gmpPercent={2.1} gmpUpdatedAt={gmpUpdatedAt} gmpTrend="up" />
    );

    // Testing Library's render() flushes the mount effect synchronously (act()),
    // so by the time render() returns, the freshness text is already the real
    // computed value — proving the deferred-to-effect value is correct, not
    // that the empty pre-effect state is observable here (that property is
    // covered by the renderToStaticMarkup test above, which never runs effects).
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute('title')).toBe('GMP updated 5m ago');
  });

  it('renders an em dash and no freshness text when gmp is null', () => {
    const { container } = render(<GmpDisplay gmp={null} gmpUpdatedAt={null} />);
    expect(container.textContent).toBe('—');
  });
});
