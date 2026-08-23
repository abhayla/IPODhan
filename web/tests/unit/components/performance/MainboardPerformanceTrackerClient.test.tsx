import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import path from 'path';
import { useRouter } from 'next/navigation';
import { MainboardPerformanceTrackerClient } from '@/components/performance/MainboardPerformanceTrackerClient';

// T-265: regression coverage — this page used to render a hardcoded
// generateMockPerformanceData() fallback (fictional companies, future listing
// dates). It must now render only data returned by /api/ipos/history, and
// degrade to an honest empty state (never invented rows) on fetch failure.

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

const FAKE_COMPANY_NAMES = [
  'Tech Innovations Ltd',
  'Green Energy Solutions',
  'Healthcare Plus India',
  'Infrastructure Builders Corp',
  'Digital Finance Ltd',
  'Manufacturing Excellence Ltd',
];

describe('MainboardPerformanceTrackerClient', () => {
  beforeEach(() => {
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: vi.fn() });
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches from /api/ipos/history and renders only real, MAINBOARD-segment rows', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'real-1',
            companyName: 'Real Mainboard Co Ltd',
            slug: 'real-mainboard-co-ltd',
            segment: 'MAINBOARD',
            listingDate: '2026-01-10',
            issuePrice: '120.00',
            listingClose: '130.50',
            listingGainPercent: 8.75,
            currentPriceLive: 145.2,
            currentGainLive: 21.0,
          },
          {
            id: 'real-2',
            companyName: 'Real SME Co Ltd',
            slug: 'real-sme-co-ltd',
            segment: 'SME',
            listingDate: '2026-01-05',
            issuePrice: '60.00',
            listingClose: '65.00',
            listingGainPercent: 8.33,
            currentPriceLive: 70.0,
            currentGainLive: 16.67,
          },
        ],
      }),
    });

    render(<MainboardPerformanceTrackerClient initialYear="2026" />);

    await waitFor(() => {
      expect(screen.getByText('Real Mainboard Co Ltd')).toBeInTheDocument();
    });

    // Only the MAINBOARD-segment row renders — the SME row is filtered out.
    expect(screen.queryByText('Real SME Co Ltd')).not.toBeInTheDocument();

    // No fabricated company from the old generateMockPerformanceData() survives.
    for (const fakeName of FAKE_COMPANY_NAMES) {
      expect(screen.queryByText(fakeName)).not.toBeInTheDocument();
    }

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain('/api/ipos/history');
    expect(requestedUrl).toContain('year=2026');
  }, 15000); // full-suite parallel jsdom load can exceed the 5000ms default

  // T-277F checker finding #3: `listingGainPercent ?? 0` used to render a row
  // with no listing_performance data (e.g. a reclassified trust) as a fake
  // 0.00/+0.00% instead of being excluded — a null gain must never render.
  it('excludes a MAINBOARD row with null listingGainPercent instead of rendering a fake 0.00%', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'real-1',
            companyName: 'Real Mainboard Co Ltd',
            slug: 'real-mainboard-co-ltd',
            segment: 'MAINBOARD',
            listingDate: '2026-01-10',
            issuePrice: '120.00',
            listingClose: '130.50',
            listingGainPercent: 8.75,
            currentPriceLive: 145.2,
            currentGainLive: 21.0,
          },
          {
            id: 'no-perf-data',
            companyName: 'Cube Highways Trust',
            slug: 'cube-highways-trust',
            segment: 'MAINBOARD',
            listingDate: '2026-08-03',
            issuePrice: null,
            listingClose: null,
            listingGainPercent: null,
            currentPriceLive: null,
            currentGainLive: null,
          },
        ],
      }),
    });

    render(<MainboardPerformanceTrackerClient initialYear="2026" />);

    await waitFor(() => {
      expect(screen.getByText('Real Mainboard Co Ltd')).toBeInTheDocument();
    });

    expect(screen.queryByText('Cube Highways Trust')).not.toBeInTheDocument();
  }, 15000);

  it('renders an honest empty state (no invented rows) when the API call fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    render(<MainboardPerformanceTrackerClient initialYear="2026" />);

    await waitFor(() => {
      expect(screen.getByText(/No Mainboard IPOs listed in 2026/i)).toBeInTheDocument();
    });

    for (const fakeName of FAKE_COMPANY_NAMES) {
      expect(screen.queryByText(fakeName)).not.toBeInTheDocument();
    }
  });

  it('renders an honest empty state when the API returns zero rows', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    render(<MainboardPerformanceTrackerClient initialYear="2026" />);

    await waitFor(() => {
      expect(screen.getByText(/No Mainboard IPOs listed in 2026/i)).toBeInTheDocument();
    });
  });

  // P3-13 (T-302): the page now server-renders initial rows. The client
  // component must show them on the FIRST render (no loading skeleton, no
  // client fetch) instead of discarding them and re-fetching.
  it('renders server-provided initialData immediately without a client fetch', () => {
    render(
      <MainboardPerformanceTrackerClient
        initialYear="2026"
        initialData={[
          {
            id: 'ssr-1',
            companyName: 'Server Rendered Co Ltd',
            slug: 'server-rendered-co-ltd',
            listedOn: '2026-01-10',
            issuePrice: 100,
            listingDayClose: 110,
            listingDayGain: 10,
            currentPrice: 120,
            profitLoss: 20,
          },
        ]}
      />
    );

    // Present on the FIRST synchronous render — no waitFor, no fetch.
    expect(screen.getByText('Server Rendered Co Ltd')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never contains a mock/demo-data generator function in its module source', () => {
    // Guards against reintroducing generateMockPerformanceData or an equivalent.
    const filePath = path.resolve(
      __dirname,
      '../../../../components/performance/MainboardPerformanceTrackerClient.tsx'
    );
    const source = readFileSync(filePath, 'utf-8');
    expect(source).not.toMatch(/generateMock/i);
    expect(source).not.toMatch(/mockData/i);
    expect(source).not.toMatch(/demonstration data/i);
  });
});
