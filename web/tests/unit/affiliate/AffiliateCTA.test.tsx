/**
 * Unit Tests for AffiliateCTA Component
 *
 * Tests:
 * - Banner renders with correct content
 * - Banner can be dismissed
 * - Cookie is set on dismissal
 * - Banner doesn't show when cookie is set
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AffiliateCTA } from '@/components/affiliate/AffiliateCTA';

// Mock fetch
global.fetch = vi.fn();

// Mock Next.js Image component
vi.mock('next/image', () => ({
  default: (props: { src: string; alt: string }) => <img src={props.src} alt={props.alt} />,
}));

describe('AffiliateCTA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear cookies
    document.cookie = 'ipodhan_banner_dismissed=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  it('renders banner with title and subtitle', () => {
    render(<AffiliateCTA />);

    expect(screen.getByText('Open a Free Demat Account')).toBeInTheDocument();
    expect(
      screen.getByText('Start investing in IPOs today with our trusted broker partners')
    ).toBeInTheDocument();
  });

  it('renders broker buttons', () => {
    render(<AffiliateCTA />);

    expect(screen.getByText(/Apply via Zerodha/i)).toBeInTheDocument();
    expect(screen.getByText(/Apply via Angel One/i)).toBeInTheDocument();
  });

  it('renders dismiss button', () => {
    render(<AffiliateCTA />);

    const dismissButton = screen.getByLabelText('Dismiss banner');
    expect(dismissButton).toBeInTheDocument();
  });

  it('hides banner when dismiss button is clicked', async () => {
    const user = userEvent.setup();
    render(<AffiliateCTA />);

    const dismissButton = screen.getByLabelText('Dismiss banner');
    await user.click(dismissButton);

    await waitFor(() => {
      expect(screen.queryByText('Open a Free Demat Account')).not.toBeInTheDocument();
    });
  });

  it('sets cookie on dismissal', async () => {
    const user = userEvent.setup();
    render(<AffiliateCTA />);

    const dismissButton = screen.getByLabelText('Dismiss banner');
    await user.click(dismissButton);

    await waitFor(() => {
      expect(document.cookie).toContain('ipodhan_banner_dismissed=true');
    });
  });

  it('does not render when cookie is set', () => {
    document.cookie = 'ipodhan_banner_dismissed=true; path=/';

    render(<AffiliateCTA />);

    expect(screen.queryByText('Open a Free Demat Account')).not.toBeInTheDocument();
  });
});
