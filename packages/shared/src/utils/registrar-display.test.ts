import { describe, it, expect } from 'vitest';
import { effectiveAllotmentCheckUrl, withEffectiveAllotmentCheckUrl } from './registrar-display';

describe('effectiveAllotmentCheckUrl', () => {
  it('returns the URL for an active, healthy registrar', () => {
    expect(
      effectiveAllotmentCheckUrl({
        active: true,
        allotmentUrlHealthy: true,
        allotmentCheckUrl: 'https://example.com/status',
      })
    ).toBe('https://example.com/status');
  });

  it('hides the CTA (returns null) for an inactive registrar even if marked healthy', () => {
    expect(
      effectiveAllotmentCheckUrl({
        active: false,
        allotmentUrlHealthy: true,
        allotmentCheckUrl: 'https://example.com/status',
      })
    ).toBeNull();
  });

  it('hides the CTA (returns null) for an active registrar whose URL is currently dead', () => {
    expect(
      effectiveAllotmentCheckUrl({
        active: true,
        allotmentUrlHealthy: false,
        allotmentCheckUrl: 'https://example.com/status',
      })
    ).toBeNull();
  });

  it('returns null when there was never a URL to begin with', () => {
    expect(
      effectiveAllotmentCheckUrl({ active: true, allotmentUrlHealthy: true, allotmentCheckUrl: null })
    ).toBeNull();
  });
});

describe('withEffectiveAllotmentCheckUrl', () => {
  it('preserves every other field while degrading allotmentCheckUrl', () => {
    const registrar = {
      id: 'r-1',
      name: 'Example Registrar',
      active: true,
      allotmentUrlHealthy: false,
      allotmentCheckUrl: 'https://example.com/status',
    };
    const result = withEffectiveAllotmentCheckUrl(registrar);
    expect(result).toEqual({ ...registrar, allotmentCheckUrl: null });
  });

  it('is a no-op shape-wise for a healthy active registrar', () => {
    const registrar = {
      id: 'r-2',
      active: true,
      allotmentUrlHealthy: true,
      allotmentCheckUrl: 'https://example.com/status',
    };
    expect(withEffectiveAllotmentCheckUrl(registrar)).toEqual(registrar);
  });
});
