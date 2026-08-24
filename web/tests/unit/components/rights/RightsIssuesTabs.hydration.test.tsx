/**
 * Hydration-mismatch regression test for RightsIssuesTabs (T-310). The
 * Open Date / Close Date columns are the surviving date rendering after
 * this task removed the "Record Date"/"Renunciation Date" labels — this
 * proves the relabel did not introduce a server/client render mismatch.
 * Same renderToString -> hydrateRoot probe shape as UPIDeadlineTimer
 * (T-302C F1) and OFSTable (T-310).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useRouter, useSearchParams } from 'next/navigation';
import { RightsIssuesTabs } from '@/components/rights/RightsIssuesTabs';
import type { RightsIssueData } from '@/lib/services/rights-service';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

function makeRights(overrides: Partial<RightsIssueData>): RightsIssueData {
  return {
    id: 'rights-1',
    companyName: 'Acme Rights Co',
    slug: 'acme-rights-co',
    openDate: '2026-06-05',
    closeDate: '2026-06-10',
    issuePrice: 200,
    issueSize: '150',
    status: 'CLOSED',
    ...overrides,
  };
}

async function probeHydration(rights: RightsIssueData[]): Promise<string[]> {
  const element = (
    <RightsIssuesTabs upcomingRights={rights} liveRights={[]} initialTab="upcoming" />
  );
  const html = renderToString(element);

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
      hydrateRoot(container, element);
    });
  } finally {
    console.error = originalConsoleError;
    document.body.removeChild(container);
  }

  return errors.filter((e) => e.includes('did not match') || e.includes('Hydration'));
}

describe('RightsIssuesTabs Open/Close Date columns hydration (T-310)', () => {
  beforeEach(() => {
    (useRouter as ReturnType<typeof vi.fn>).mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
    });
    (useSearchParams as ReturnType<typeof vi.fn>).mockReturnValue(new URLSearchParams('tab=upcoming'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('produces zero hydration warnings for rows with Open/Close dates', async () => {
    const warnings = await probeHydration([makeRights({})]);
    expect(warnings).toEqual([]);
  });
});
