/**
 * Unit Tests: MainboardSummaryMetrics Component
 * Story 9.15: Mainboard IPOs Landing Page
 *
 * Tests the summary metrics component displaying 6 metric cards.
 * Target: >80% code coverage for component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MainboardSummaryMetrics } from '@/components/mainboard/MainboardSummaryMetrics';
import type { MainboardSummaryMetrics as MetricsType } from '@/lib/services/mainboard-landing-service';

describe('MainboardSummaryMetrics', () => {
  const mockMetrics: MetricsType = {
    totalIPOs: 150,
    listedInGain: 90,
    listedInLoss: 40,
    upcomingAndOngoing: 20,
    gainAOT: 25.45,
    lossAOT: 15.32,
  };

  it('should render all 6 metric cards', () => {
    // Act
    render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert - Check all 6 titles are present
    expect(screen.getByText('Total Mainboard IPOs')).toBeInTheDocument();
    expect(screen.getByText('Listed in Gain')).toBeInTheDocument();
    expect(screen.getByText('Listed in Loss')).toBeInTheDocument();
    expect(screen.getByText('Upcoming & OnGoing')).toBeInTheDocument();
    expect(screen.getByText('Gain (All Over Time)')).toBeInTheDocument();
    expect(screen.getByText('Loss (All Over Time)')).toBeInTheDocument();
  });

  it('should display correct metric values', () => {
    // Act
    render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert
    expect(screen.getByText('150')).toBeInTheDocument(); // totalIPOs
    expect(screen.getByText('90')).toBeInTheDocument(); // listedInGain
    expect(screen.getByText('40')).toBeInTheDocument(); // listedInLoss
    expect(screen.getByText('20')).toBeInTheDocument(); // upcomingAndOngoing
    expect(screen.getByText('25.45')).toBeInTheDocument(); // gainAOT
    expect(screen.getByText('15.32')).toBeInTheDocument(); // lossAOT
  });

  it('should display percentage suffix for AOT metrics', () => {
    // Act
    const { container } = render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert - Check for % suffix
    const percentSigns = container.querySelectorAll('.text-3xl .text-2xl');
    expect(percentSigns.length).toBe(2); // gainAOT and lossAOT
  });

  it('should apply green color to gain metrics', () => {
    // Act
    const { container } = render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert - Check for green text classes (gain metrics)
    const greenTexts = container.querySelectorAll('.text-green-700');
    expect(greenTexts.length).toBeGreaterThanOrEqual(2); // At least listedInGain and gainAOT
  });

  it('should apply red color to loss metrics', () => {
    // Act
    const { container } = render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert - Check for red text classes (loss metrics)
    const redTexts = container.querySelectorAll('.text-red-700');
    expect(redTexts.length).toBeGreaterThanOrEqual(2); // At least listedInLoss and lossAOT
  });

  it('should render responsive grid layout', () => {
    // Act
    const { container } = render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert - Check for responsive grid classes
    const gridContainer = container.querySelector('.grid');
    expect(gridContainer).toHaveClass('grid-cols-1');
    expect(gridContainer).toHaveClass('md:grid-cols-2');
    expect(gridContainer).toHaveClass('lg:grid-cols-3');
  });

  it('should render icons for all metric cards', () => {
    // Act
    const { container } = render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert - Check for icon containers
    const iconContainers = container.querySelectorAll('.rounded-full');
    expect(iconContainers.length).toBe(6); // One icon per metric card
  });

  it('should apply hover effects to cards', () => {
    // Act
    const { container } = render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert - Check for hover classes
    const cards = container.querySelectorAll('.hover\\:shadow-md');
    expect(cards.length).toBe(6);
  });

  it('should handle zero values correctly', () => {
    // Arrange
    const zeroMetrics: MetricsType = {
      totalIPOs: 0,
      listedInGain: 0,
      listedInLoss: 0,
      upcomingAndOngoing: 0,
      gainAOT: 0,
      lossAOT: 0,
    };

    // Act
    render(<MainboardSummaryMetrics metrics={zeroMetrics} />);

    // Assert - Check all zeros are displayed
    const zeroElements = screen.getAllByText('0');
    expect(zeroElements.length).toBeGreaterThanOrEqual(4); // At least 4 zero values

    // Check formatted zeros for percentages
    expect(screen.getByText('0.00')).toBeInTheDocument();
  });

  it('should format decimal values to 2 decimal places for AOT metrics', () => {
    // Arrange
    const decimalMetrics: MetricsType = {
      totalIPOs: 100,
      listedInGain: 60,
      listedInLoss: 30,
      upcomingAndOngoing: 10,
      gainAOT: 25.456789, // Should be formatted to 25.46
      lossAOT: 15.123456, // Should be formatted to 15.12
    };

    // Act
    render(<MainboardSummaryMetrics metrics={decimalMetrics} />);

    // Assert
    expect(screen.getByText('25.46')).toBeInTheDocument();
    expect(screen.getByText('15.12')).toBeInTheDocument();
  });

  it('should render cards with correct border styling', () => {
    // Act
    const { container } = render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert - Check for left border
    const cards = container.querySelectorAll('.border-l-4');
    expect(cards.length).toBe(6);
  });

  it('should display all card titles with correct styling', () => {
    // Act
    const { container } = render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert - Check for title styling
    const titles = container.querySelectorAll('.text-sm.font-medium.text-gray-600');
    expect(titles.length).toBe(6);
  });

  it('should render large font size for metric values', () => {
    // Act
    const { container } = render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert - Check for large font class
    const values = container.querySelectorAll('.text-3xl');
    expect(values.length).toBe(6);
  });

  it('should handle large numbers correctly', () => {
    // Arrange
    const largeMetrics: MetricsType = {
      totalIPOs: 9999,
      listedInGain: 5000,
      listedInLoss: 4000,
      upcomingAndOngoing: 999,
      gainAOT: 99.99,
      lossAOT: 88.88,
    };

    // Act
    render(<MainboardSummaryMetrics metrics={largeMetrics} />);

    // Assert
    expect(screen.getByText('9999')).toBeInTheDocument();
    expect(screen.getByText('5000')).toBeInTheDocument();
    expect(screen.getByText('4000')).toBeInTheDocument();
    expect(screen.getByText('999')).toBeInTheDocument();
    expect(screen.getByText('99.99')).toBeInTheDocument();
    expect(screen.getByText('88.88')).toBeInTheDocument();
  });

  it('should apply consistent spacing between cards', () => {
    // Act
    const { container } = render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert - Check for gap class
    const gridContainer = container.querySelector('.grid');
    expect(gridContainer).toHaveClass('gap-4');
  });

  it('should render CardHeader and CardContent for each card', () => {
    // Act
    const { container } = render(<MainboardSummaryMetrics metrics={mockMetrics} />);

    // Assert
    // CardHeader has flex-row class
    const cardHeaders = container.querySelectorAll('.flex.flex-row');
    expect(cardHeaders.length).toBe(6);
  });
});
