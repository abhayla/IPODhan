/**
 * Hydration-mismatch regression test for OFSTable's "Last updated" banner
 * (T-310). The banner is new in this task and formats a date derived purely
 * from the `ofsIssues` prop (never `Date.now()`/`new Date()` without an
 * argument), so server and client renders should produce byte-identical
 * markup — this test proves that with the same renderToString -> hydrateRoot
 * probe shape used for UPIDeadlineTimer (T-302C F1).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { OFSTable } from '@/components/ofs/OFSTable';
import type { OFSData } from '@/lib/services/ofs-service';

function makeOFS(overrides: Partial<OFSData>): OFSData {
  return {
    id: 'ofs-1',
    companyName: 'Acme OFS Co',
    slug: 'acme-ofs-co',
    nonRetailDate: '2026-06-08',
    retailDate: '2026-06-09',
    openDate: '2026-06-08',
    closeDate: '2026-06-09',
    issuePrice: 500,
    issueSize: '300',
    status: 'CLOSED',
    updatedAt: '2026-06-13T21:09:10.010Z',
    ...overrides,
  };
}

async function probeHydration(ofsIssues: OFSData[]): Promise<string[]> {
  const html = renderToString(<OFSTable ofsIssues={ofsIssues} />);

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
      hydrateRoot(container, <OFSTable ofsIssues={ofsIssues} />);
    });
  } finally {
    console.error = originalConsoleError;
    document.body.removeChild(container);
  }

  return errors.filter((e) => e.includes('did not match') || e.includes('hydrat'));
}

describe('OFSTable "Last updated" banner hydration (T-310)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces zero hydration warnings when rows carry an updatedAt (banner rendered)', async () => {
    const warnings = await probeHydration([makeOFS({})]);
    expect(warnings).toEqual([]);
  });

  it('produces zero hydration warnings when no row carries an updatedAt (banner absent)', async () => {
    const warnings = await probeHydration([makeOFS({ updatedAt: null })]);
    expect(warnings).toEqual([]);
  });
});
