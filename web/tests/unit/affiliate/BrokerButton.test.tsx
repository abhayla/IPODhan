/**
 * Unit Tests for BrokerButton Component
 *
 * Tests:
 * - Component renders with broker information
 * - External link has correct attributes
 * - Click tracking is called
 * - Google Analytics event is triggered
 * - Loading state during tracking
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrokerButton } from '@/components/affiliate/BrokerButton';
import type { BrokerConfig } from '@/lib/config/affiliate-links';

// Mock fetch
global.fetch = vi.fn();

// Mock Next.js Image component
vi.mock('next/image', () => ({
  default: (props: { src: string; alt: string }) => <img src={props.src} alt={props.alt} />,
}));

describe('BrokerButton', () => {
  const mockBroker: BrokerConfig = {
    id: 'zerodha',
    name: 'Zerodha',
    link: 'https://test.zerodha.com',
    logo: '/logos/zerodha.svg',
    cta: 'Apply via Zerodha',
    description: 'Test broker',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  it('renders broker name and logo', () => {
    render(<BrokerButton broker={mockBroker} source="homepage" />);

    expect(screen.getByText('Apply via Zerodha')).toBeInTheDocument();
    expect(screen.getByAltText('Zerodha logo')).toBeInTheDocument();
  });

  it('renders as external link with correct attributes', () => {
    render(<BrokerButton broker={mockBroker} source="homepage" />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://test.zerodha.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('tracks click when button is clicked', async () => {
    const user = userEvent.setup();
    render(<BrokerButton broker={mockBroker} source="homepage" />);

    const link = screen.getByRole('link');
    await user.click(link);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/affiliate/track',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            broker: 'zerodha',
            source: 'homepage',
            ipoId: null,
          }),
        })
      );
    });
  });

  it('includes IPO ID when provided', async () => {
    const user = userEvent.setup();
    const ipoId = '123e4567-e89b-12d3-a456-426614174000';
    render(
      <BrokerButton broker={mockBroker} source="ipo_detail" ipoId={ipoId} />
    );

    const link = screen.getByRole('link');
    await user.click(link);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/affiliate/track',
        expect.objectContaining({
          body: JSON.stringify({
            broker: 'zerodha',
            source: 'ipo_detail',
            ipoId,
          }),
        })
      );
    });
  });

  it('triggers Google Analytics event if available', async () => {
    const mockGtag = vi.fn();
    (window as unknown as { gtag: typeof mockGtag }).gtag = mockGtag;

    const user = userEvent.setup();
    render(<BrokerButton broker={mockBroker} source="homepage" />);

    const link = screen.getByRole('link');
    await user.click(link);

    await waitFor(() => {
      expect(mockGtag).toHaveBeenCalledWith('event', 'affiliate_click', {
        broker: 'Zerodha',
        source: 'homepage',
        ipo_id: 'none',
      });
    });

    delete (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  });

  it('handles tracking failure gracefully', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const user = userEvent.setup();
    render(<BrokerButton broker={mockBroker} source="homepage" />);

    const link = screen.getByRole('link');
    await user.click(link);

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to track affiliate click:',
        expect.any(Error)
      );
    });

    consoleError.mockRestore();
  });

  it('prevents double-clicking during tracking', async () => {
    const user = userEvent.setup();
    render(<BrokerButton broker={mockBroker} source="homepage" />);

    const link = screen.getByRole('link');

    // Click multiple times rapidly
    await user.click(link);
    await user.click(link);
    await user.click(link);

    // Should only track once
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
