import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdvancedGMPMetrics } from '@/components/ipo/AdvancedGMPMetrics';
import type { GMPRecord } from '@/lib/db/types';

const mockGMPRecordWithAdvancedMetrics: GMPRecord = {
  id: '1',
  ipoId: 'ipo-1',
  timestamp: new Date('2025-01-01'),
  gmp: 100,
  expectedListingPrice: 220,
  subjectRate: 150,
  kostakRate: 80,
  saudaDetails: 'Grey market trading active. Kostak trading at ₹60-₹100 per lot. Subject rate varies based on market sentiment.',
  source: 'IPO Central',
};

const mockGMPRecordWithoutAdvancedMetrics: GMPRecord = {
  id: '2',
  ipoId: 'ipo-2',
  timestamp: new Date('2025-01-02'),
  gmp: 120,
  expectedListingPrice: 240,
  subjectRate: null,
  kostakRate: null,
  saudaDetails: null,
  source: 'Market',
};

const mockGMPRecordWithPartialMetrics: GMPRecord = {
  id: '3',
  ipoId: 'ipo-3',
  timestamp: new Date('2025-01-03'),
  gmp: 110,
  expectedListingPrice: 230,
  subjectRate: 180,
  kostakRate: null,
  saudaDetails: null,
  source: 'Market',
};

describe('AdvancedGMPMetrics', () => {
  it('should not render when gmpRecords is empty', () => {
    const { container } = render(<AdvancedGMPMetrics gmpRecords={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('should not render when no advanced metrics are available', () => {
    const { container } = render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithoutAdvancedMetrics]} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render when at least one advanced metric is available', () => {
    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithPartialMetrics]} />);
    expect(screen.getByText('Advanced Grey Market Metrics')).toBeInTheDocument();
  });

  it('should display kostak rate when available', () => {
    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithAdvancedMetrics]} />);
    expect(screen.getByText(/Kostak Rate:/)).toBeInTheDocument();
    expect(screen.getByText(/₹80/)).toBeInTheDocument();
  });

  it('should display subject rate when available', () => {
    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithAdvancedMetrics]} />);
    expect(screen.getByText(/Subject\/Safalya Rate:/)).toBeInTheDocument();
    expect(screen.getByText(/₹150/)).toBeInTheDocument();
  });

  it('should not display kostak rate when null', () => {
    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithPartialMetrics]} />);
    expect(screen.queryByText(/Kostak Rate:/)).not.toBeInTheDocument();
  });

  it('should display sauda details button when available', () => {
    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithAdvancedMetrics]} />);
    expect(screen.getByText('Grey Market Trading Details')).toBeInTheDocument();
  });

  it('should not display sauda details button when null', () => {
    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithPartialMetrics]} />);
    expect(screen.queryByText('Grey Market Trading Details')).not.toBeInTheDocument();
  });

  it('should expand sauda details when button is clicked', async () => {
    const user = userEvent.setup();
    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithAdvancedMetrics]} />);

    // Initially, details should not be visible
    expect(screen.queryByText(/Grey market trading active/)).not.toBeInTheDocument();

    // Click to expand
    const expandButton = screen.getByText('Grey Market Trading Details');
    await user.click(expandButton);

    // Details should now be visible
    expect(screen.getByText(/Grey market trading active/)).toBeInTheDocument();
    expect(screen.getByText(/Kostak trading at ₹60-₹100 per lot/)).toBeInTheDocument();
  });

  it('should collapse sauda details when button is clicked again', async () => {
    const user = userEvent.setup();
    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithAdvancedMetrics]} />);

    const expandButton = screen.getByText('Grey Market Trading Details');

    // Expand
    await user.click(expandButton);
    expect(screen.getByText(/Grey market trading active/)).toBeInTheDocument();

    // Collapse
    await user.click(expandButton);
    expect(screen.queryByText(/Grey market trading active/)).not.toBeInTheDocument();
  });

  it('should display disclaimer about unofficial nature', () => {
    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithAdvancedMetrics]} />);
    expect(screen.getByText(/Grey market trading is unofficial and unregulated/)).toBeInTheDocument();
  });

  it('should show "What is Grey Market?" info icon with tooltip', () => {
    const { container } = render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithAdvancedMetrics]} />);
    // Check that there are info icons rendered (SVG elements in the component)
    const infoIcons = container.querySelectorAll('svg');
    expect(infoIcons.length).toBeGreaterThan(0);
  });

  it('should display difference explanation when both kostak and subject rates exist', () => {
    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithAdvancedMetrics]} />);
    expect(screen.getByText(/Difference:/)).toBeInTheDocument();
    expect(screen.getByText(/Kostak is the rate for selling application rights/)).toBeInTheDocument();
  });

  it('should not display difference explanation when only one rate exists', () => {
    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithPartialMetrics]} />);
    expect(screen.queryByText(/Difference:/)).not.toBeInTheDocument();
  });

  it('should handle multiple records and use the latest one', () => {
    const recordOld: GMPRecord = {
      ...mockGMPRecordWithAdvancedMetrics,
      kostakRate: 70,
      subjectRate: 140,
    };

    render(<AdvancedGMPMetrics gmpRecords={[mockGMPRecordWithAdvancedMetrics, recordOld]} />);

    // Should use the first record (latest)
    expect(screen.getByText(/₹80/)).toBeInTheDocument(); // kostak from first record
    expect(screen.getByText(/₹150/)).toBeInTheDocument(); // subject from first record
  });

  it('should handle empty sauda details string', () => {
    const recordEmptyDetails: GMPRecord = {
      ...mockGMPRecordWithAdvancedMetrics,
      saudaDetails: '',
    };

    render(<AdvancedGMPMetrics gmpRecords={[recordEmptyDetails]} />);

    // Should not show sauda details button for empty string
    expect(screen.queryByText('Grey Market Trading Details')).not.toBeInTheDocument();
  });
});
